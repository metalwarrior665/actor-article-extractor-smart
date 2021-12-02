const Apify = require('apify');
const extractor = require('unfluff');

const { countWords, isInDateRange } = require('./article-recognition.js');
const { executeExtendOutputFn, parseDateFromPage } = require('./utils.js');
const { addArticleScraped } = require('./articles-scraped-state');

const { log } = Apify.utils;

module.exports = async ({ request, saveHtml, html, page, $, extendOutputFunction,
    extendOutputFunctionEvaled, parsedDateFrom, mustHaveDate, minWords,
    maxArticlesPerCrawl, onlyNewArticles, onlyNewArticlesPerDomain, state, stateDataset }) => {
    const metadata = extractor(html);

    const result = {
        url: request.url,
        loadedUrl: request.loadedUrl,
        domain: request.userData.domain,
        loadedDomain: request.userData.loadedDomain,
        ...metadata,
        html: saveHtml ? html : undefined,
    };

    let userResult = {};
    if (extendOutputFunction) {
        userResult = await executeExtendOutputFn({ page, $,
            extendOutputFunction, extendOutputFunctionEvaled, item: result });
    }
    const completeResult = { ...result, ...userResult };

    // We try to upgrade the date, the default parser is not great
    const parsedPageDate = parseDateFromPage(completeResult, request.url);
    // console.log(`Updated date from ${completeResult.date} to ${parsedPageDate}`);
    completeResult.date = parsedPageDate || null;

    const wordsCount = countWords(completeResult.text);

    const isInDateRangeVar = isInDateRange(completeResult.date, parsedDateFrom);
    if (mustHaveDate && !isInDateRangeVar && !!completeResult.date) {
        log.warning(`ARTICLE - DATE NOT IN RANGE: ${completeResult.date}`);
        return;
    }

    // await Apify.setValue('ARTICLE', html, { contentType: 'text/html' });

    // maybe kept for backwards compat
    if (onlyNewArticles) {
        if (!state.overallArticlesScraped.has(request.url)) {
            state.overallArticlesScraped.add(request.url);
            await stateDataset.pushData({ url: request.url });
        }
    }

    if (onlyNewArticlesPerDomain) {
        await addArticleScraped(state, request.url);
    }

    const hasValidDate = mustHaveDate ? isInDateRangeVar : true;

    const isArticle =
        hasValidDate
        && !!completeResult.title
        && wordsCount > minWords;

    if (isArticle) {
        log.info(`IS VALID ARTICLE --- ${request.url}`);
        await Apify.pushData(completeResult);
        state.articlesScrapedThisRun++;

        if (maxArticlesPerCrawl && state.articlesScrapedThisRun >= maxArticlesPerCrawl) {
            log.warning(`WE HAVE REACHED MAXIMUM ARTICLES: ${maxArticlesPerCrawl}. FINISHING CRAWLING...`);
            process.exit(0);
        }
    } else {
        log.warning(`IS NOT VALID ARTICLE --- date: ${hasValidDate}, `
            + `title: ${!!completeResult.title}, words: ${wordsCount}, dateRange: ${isInDateRangeVar} --- ${request.url}`);
    }
};
