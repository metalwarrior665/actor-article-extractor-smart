const Apify = require('apify');

const { parseDomain } = require('./utils');
const { isUrlArticle } = require('./article-recognition.js');
const { GOOGLE_BOT_HEADERS } = require('./constants');
const { wasArticleScraped } = require('./articles-scraped-state');

const { log } = Apify.utils;

module.exports = async ({
    request,
    maxDepth,
    page,
    $,
    requestQueue,
    state,
    onlyInsideArticles,
    onlyNewArticles,
    onlyNewArticlesPerDomain,
    isUrlArticleDefinition,
    useGoogleBotHeaders,
    debug,
    html,
    pseudoUrls,
    linkSelector,
}) => {
    const loadedDomain = parseDomain(request.loadedUrl);
    log.info(`CATEGORY PAGE - requested URL: ${request.url}, loaded URL: ${request.loadedUrl}`);

    if (request.userData.depth >= maxDepth) {
        log.warning(`Max depth of ${maxDepth} reached, not enqueueing any more request for --- ${request.url}`);
        return;
    }

    // all links
    let allHrefs = [];
    let aTagsCount = 0;
    if (page) {
        allHrefs = await page.$$eval('a', (els) => els.map((el) => el.href));
    } else {
        $('a').each(function () {
            aTagsCount++;
            const relativeOrAbsoluteLink = $(this).attr('href');
            if (relativeOrAbsoluteLink) {
                const urlObj = new URL(relativeOrAbsoluteLink, request.loadedUrl);
                const absoluteLink = urlObj.href;
                allHrefs.push(absoluteLink);
            }
        });
    }
    log.info(`total number of a tags: ${aTagsCount}`);
    log.info(`total number of links: ${allHrefs.length}`);

    let links = allHrefs;

    // filtered only inside links
    if (onlyInsideArticles) {
        links = allHrefs.filter((link) => loadedDomain === parseDomain(link));
        log.info(`number of inside links: ${links.length}`);
    }

    // filtered only new urls
    if (onlyNewArticles) {
        links = links.filter((href) => !state.overallArticlesScraped.has(href));
        log.info(`number of inside links after state filter: ${links.length}`);
    }

    // filtered only new urls for that domain
    if (onlyNewArticlesPerDomain) {
        const articlesOnlyNewInDomain = [];
        for (const url of links) {
            // This does a theoretically long loading behind
            // Might wait for up to a minute here on the first url
            // Once the cache is loaded in the state, it is instant check
            const wasScraped = await wasArticleScraped(state, url);
            if (!wasScraped) {
                articlesOnlyNewInDomain.push(url);
            }
        }
        links = articlesOnlyNewInDomain;
        log.info(`number of inside link after per domain scraped article filter: ${links.length}`);
    }

    // filtered only proper article urls
    const articleUrlHrefs = links.filter((link) => isUrlArticle(link, isUrlArticleDefinition));
    log.info(`number of article url links: ${articleUrlHrefs.length}`);

    let index = 0;
    for (const url of articleUrlHrefs) {
        index++;
        await requestQueue.addRequest({
            url,
            userData: {
                domain: request.userData.domain,
                label: 'ARTICLE',
                index,
                loadedDomain,
                headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : {},
            },
        });
    }
    if (debug) {
        await Apify.setValue(Math.random().toString(), html || await page.content(), { contentType: 'text/html' });
    }

    // We handle optional pseudo URLs and link selectors here
    if (pseudoUrls && pseudoUrls.length > 0 && linkSelector) {
        let selectedLinks;
        if (page) {
            selectedLinks = await page.$$eval(linkSelector, (els) => els.map((el) => el.href).filter((link) => !!link));
        } else {
            selectedLinks = $(linkSelector)
                .map(function () { return $(this).attr('href'); }).toArray()
                .filter((link) => !!link)
                .map((link) => new URL(link, request.url).href);
        }
        const purls = pseudoUrls.map((req) => new Apify.PseudoUrl(
            req.url,
            {
                userData: {
                    ...req.userData,
                    depth: request.userData.depth + 1,
                },
            },
        ));

        let enqueued = 0;
        for (const url of selectedLinks) {
            for (const purl of purls) {
                if (purl.matches(url)) {
                    // userData are passed along
                    await requestQueue.addRequest(purl.createRequest(url));
                    enqueued++;
                    break; // We finish the inner loop because the first PURL that matches wons
                }
            }
        }
        log.info(`Link selector found ${selectedLinks.length} links, enqueued through PURLs: ${enqueued} --- ${request.url}`);
    }
};
