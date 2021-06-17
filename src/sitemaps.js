const Apify = require('apify');

const { POSSIBLE_SITEMAP_PATHS, SITEMAP_EXTENSIONS } = require('./constants');
const { filterArticleUrls } = require('./filter-article-urls');
const { parseDomain } = require('./utils');

const { log, extractUrls } = Apify.utils;

module.exports.getRequestsFromSitemaps = async ({
    sitemapUrls = [],
    scanSitemaps,
    startUrls,
    proxyConfigurationClass,
    events,
    requestQueue,
    isUrlArticleDefinition,
    state,
    onlyInsideArticles,
    onlyNewArticles,
    onlyNewArticlesPerDomain,
}) => {
    if ((!sitemapUrls || sitemapUrls.length === 0) && (!scanSitemaps || !startUrls || startUrls.length === 0)) {
        return [];
    }

    const capturedUrlsArr = (await Apify.getValue('SITEMAP-GATHERED-URLS')) || [];
    // We dedup it
    const capturedUrls = new Set(...capturedUrlsArr);
    events.on('persistState', async () => {
        await Apify.setValue('SITEMAP-GATHERED-URLS', Array.from(capturedUrls));
    });

    const createdRequests = [];
    // For each domain from start URL, we will create a batch of sitemap links
    if (scanSitemaps && startUrls) {
        const uniqueOrigins = new Set();
        for (const req of startUrls) {
            try {
                const urlObj = new URL(req.url);
                uniqueOrigins.add(urlObj.origin);
            } catch (e) {
                log.warning(`WRONG INPUT: Not a valid start URL, skipping: ${req.url}`);
            }
        }
        for (const urlOrigin of uniqueOrigins.keys()) {
            for (const sitemapPath of POSSIBLE_SITEMAP_PATHS) {
                const sitemapUrl = `${urlOrigin}${sitemapPath}`;
                log.info(`Created sitemap URL: ${sitemapUrl}`);
                createdRequests.push({ url: sitemapUrl });
            }
        }
    }

    // This is buggy but I'm in rush, we just check the domain for the first start URL
    // and assume only capture sitemaps for that, description added to input schema
    const loadedDomain = parseDomain(startUrls[0].url);

    const requestList = await Apify.openRequestList('SITEMAP-LIST', sitemapUrls.concat(createdRequests));
    // We can use default queue here because the article crawler runs after this

    const crawler = new Apify.BasicCrawler({
        requestList,
        requestQueue,
        handleRequestFunction: async ({ request }) => {
            const { body, statusCode } = await Apify.utils.requestAsBrowser({
                url: request.url,
                proxyUrl: proxyConfigurationClass.newUrl(),
            });

            if (statusCode >= 400 && statusCode !== 404) {
                throw `Got blocked with status code: ${statusCode}`;
            }

            const urls = extractUrls({ string: body.toString() });

            // We recursively check for what might be another sitemap
            const nestedSitemapUrls = [];
            const foundUrls = [];
            for (const url of urls) {
                const hasSitemapExt = SITEMAP_EXTENSIONS.some((ext) => url.endsWith(ext));
                if (hasSitemapExt) {
                    nestedSitemapUrls.push(url);
                } else {
                    foundUrls.push(url);
                }
            }
            log.info(`[SITEMAP] - Found nested ${nestedSitemapUrls.length} sitemap URLs, enqueuing from ${request.url}`);
            for (const url of nestedSitemapUrls) {
                await requestQueue.addRequest({
                    url,
                });
            }

            for (const url of foundUrls) {
                capturedUrls.add(url);
            }

            log.info(`[SITEMAP] - Found ${foundUrls.length} normal URLs. `
                + `Total unique found: ${capturedUrls.size} Will scrape in the next step ${request.url}`);
        },
    });

    await crawler.run();

    // I had to remove non-article URLs because there is just too much garbage URLs in sitemaps
    const filteredUrls = await filterArticleUrls({
        links: Array.from(capturedUrls),
        state,
        onlyInsideArticles,
        onlyNewArticles,
        onlyNewArticlesPerDomain,
        loadedDomain,
        isUrlArticleDefinition,
    });

    const filteredRequests = filteredUrls.map((url) => ({
        url,
        userData: {
            label: 'ARTICLE',
        },
    }));

    log.info(`[SITEMAP]: Crawling sitemap finished capturing ${filteredRequests.length} article URLs `
        + `out of total ${capturedUrls.size} URLs. `
        + 'Article scraping will start.');

    return filteredRequests;
};
