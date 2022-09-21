const Apify = require('apify');
const extractor = require('unfluff');

const { countWords, isInDateRange } = require('./article-recognition.js');
const { executeExtendOutputFn, parseDateFromPage } = require('./utils.js');
const { addArticleScraped } = require('./articles-scraped-state');

const { log } = Apify.utils;

module.exports = async ({ request, saveHtml, html, page, $, extendOutputFunction,
    extendOutputFunctionEvaled, parsedDateFrom, mustHaveDate, minWords,
    maxArticlesPerCrawl, onlyNewArticles, onlyNewArticlesPerDomain, state, stateDataset, saveSnapshotsOfInvalidArticles }) => {
    const metadata = extractor(html);

    // await Apify.setValue('ARTICLE', html, { contentType: 'text/html' });

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

    const wordsCount = countWords(completeResult.text);

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

    // We try to upgrade the date, the default parser is not great
    const parsedPageDate = parseDateFromPage(completeResult, request.url);
    // console.log(`Updated date from ${completeResult.date} to ${parsedPageDate}`);
    completeResult.date = parsedPageDate || null;

    const hasValidDate = mustHaveDate ? !!completeResult.date : true;

    // Is false if there is no date
    const isInDateRangeVar = parsedDateFrom ? isInDateRange(completeResult.date, parsedDateFrom) : true;

    const isArticle =
        hasValidDate
        && isInDateRangeVar
        && !!completeResult.title
        && wordsCount >= minWords;

    if (isArticle) {
        log.info(`IS VALID ARTICLE --- ${request.url}`);
        await Apify.pushData(completeResult);
        state.articlesScrapedThisRun++;

        if (maxArticlesPerCrawl && state.articlesScrapedThisRun >= maxArticlesPerCrawl) {
            log.warning(`WE HAVE REACHED MAXIMUM ARTICLES: ${maxArticlesPerCrawl}. FINISHING CRAWLING...`);
            process.exit(0);
        }
    } else {
        const reasons = [];
        if (!hasValidDate) {
            reasons.push(`[Article has no date]`);
        }

        if (!completeResult.title) {
            reasons.push(`[Article has no title]`);
        }

        if (wordsCount < minWords) {
            reasons.push(`[Article has too few words: ${wordsCount} (should be at least ${minWords})]`);
        }

        if (parsedDateFrom && !isInDateRangeVar && hasValidDate) {
            reasons.push(`[Article date is not in date range (${completeResult.date})]`);
        }

        // Date not in range is handled above
        log.warning(`IS NOT VALID ARTICLE --- Reasons: ${reasons.join(', ')} --- ${request.url}`);

        if (saveSnapshotsOfInvalidArticles) {
            log.info(`Saved snapshot of the invalid article page to Key-Value Store with key: ${recordKey}`);
            const urlObj = new URL(request.url);
            const sanitizedUrlPath = `${urlObj.pathname}-${urlObj.search}`.replace(/[^a-zA-Z0-9]/g, '-');
            const recordKey = `INVALID-ARTICLE-${sanitizedUrlPath}`;
            if (page) {
                await Apify.utils.puppeteer.saveSnapshot(page, { key: recordKey });
            } else {
                await Apify.setValue(recordKey, html, { contentType: 'text/html' });
            }
        }
    }
};
