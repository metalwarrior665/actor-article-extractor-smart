const Apify = require('apify');

const { log } = Apify.utils;

const { parseDateToMoment, evalPageFunction } = require('./utils.js');
const { setupNotifications } = require('./compute-units-notification.js');
const { MAX_DATASET_ITEMS_LOADED } = require('./constants.js');
const getStartSources = require('./start-urls');
const { loadDatasetItemsInParallel } = require('./load-datasets');
const { getRequestsFromSitemaps } = require('./sitemaps');

const handleCategory = require('./handle-category');
const handleArticle = require('./handle-article');

// TODO1: Got a powerful idea, we should try to scrape sitemaps!!!
// TODO2: Enqueue from articles too!
Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    log.info('Input');
    console.dir(input);

    const {
        // These are category URLs mostly
        startUrls = [],
        articleUrls = [],
        sitemapUrls = [],
        // Kept for backwards compat, better to use onlyNewArticlesPerDomain
        onlyNewArticles = false,
        onlyNewArticlesPerDomain = false,
        onlyInsideArticles = true,
        enqueueFromArticles = false,
        // NOTE: Be very careful about sitemaps URLs as those can explode in URLs
        // with old articles and garbage
        scanSitemaps = false,
        saveHtml = false,
        useGoogleBotHeaders = false,
        minWords = 150,
        dateFrom,
        isUrlArticleDefinition,
        mustHaveDate = true,
        pseudoUrls,
        linkSelector,
        maxDepth,
        maxPagesPerCrawl,
        maxArticlesPerCrawl,
        proxyConfiguration = { useApifyProxy: true },
        debug = false,
        maxConcurrency,
        extendOutputFunction,

        // browser options
        useBrowser = false,
        pageWaitMs,
        pageWaitSelector,

        // notification options for J.S.
        stopAfterCUs,
        notifyAfterCUs,
        notificationEmails,
        notifyAfterCUsPeriodically,
    } = input;

    // Valid format is either YYYY-MM-DD or format like "1 week" or "20 days"
    const parsedDateFrom = parseDateToMoment(dateFrom);

    const arePseudoUrls = pseudoUrls && pseudoUrls.length > 0;
    if ((arePseudoUrls && !linkSelector) || (linkSelector && !arePseudoUrls)) {
        log.warning('WARNING - If you use only Pseudo URLs or only Link selector, they will not work. You need to use them together.');
    }

    const proxyConfigurationClass = await Apify.createProxyConfiguration(proxyConfiguration);

    const extendOutputFunctionEvaled = evalPageFunction(extendOutputFunction);

    await setupNotifications({ stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically });

    const dataset = await Apify.openDataset();
    const { itemCount } = await dataset.getInfo();

    const state = {
        articlesScrapedThisRun: itemCount,
        overallArticlesScraped: new Set(),
        // Object with domains as keys
        perDomainArticlesScraped: {},
    };

    // This is kept only for backwards compat
    // Use onlyNewArticlesPerDomain preferably
    let stateDataset;
    if (onlyNewArticles) {
        log.info('loading state dataset...');
        const datasetToOpen = 'articles-state';
        stateDataset = await Apify.openDataset(datasetToOpen);
        const { itemCount, id } = await stateDataset.getInfo();
        const rawOffset = itemCount - MAX_DATASET_ITEMS_LOADED;
        const offset = rawOffset < 0 ? 0 : rawOffset;
        log.info(`State dataset contains ${itemCount} items, max dataset load is ${MAX_DATASET_ITEMS_LOADED}, offset: ${offset}`);
        const overallArticleUrls = await loadDatasetItemsInParallel([id || datasetToOpen], { offset, debugLog: true })
            .then((items) => items.map((item) => item.url));
        log.info(`${overallArticleUrls.length} article URLs loaded from state dataset`);
        overallArticleUrls.forEach((url) => {
            state.overallArticlesScraped.add(url);
        });
        log.info(`Loaded ${state.overallArticlesScraped.size} unique article URLs that were already scraded to be skipped this scrape`);
    }

    log.info(`We got ${startUrls.concat(articleUrls).length} start URLs`);

    let sources = getStartSources({ startUrls, articleUrls, useGoogleBotHeaders });

    const requestQueue = await Apify.openRequestQueue();

    // Running separate crawler here. We could integrate it into the main one
    // but this is probably cleaner
    const sitemapSources = await getRequestsFromSitemaps({
        sitemapUrls,
        scanSitemaps,
        startUrls,
        proxyConfigurationClass,
        events: Apify.events,
        requestQueue,
        isUrlArticleDefinition,
        state,
        onlyInsideArticles,
        onlyNewArticles,
        onlyNewArticlesPerDomain,
    });

    sources = sources.concat(sitemapSources);

    const requestList = await Apify.openRequestList('MAIN-LIST', sources);

    // This can be Cheerio or Puppeteer page so we have to differentiate that often
    // That's why there will be often "if (page) {...}"
    const handlePageFunction = async ({ request, $, body, page }) => {
        if (page && (pageWaitMs)) {
            await page.waitFor(pageWaitMs);
        }

        if (page && (pageWaitSelector)) {
            await page.waitFor(pageWaitSelector);
        }

        const html = page ? await page.content() : body;

        const title = page
            ? await page.title()
            : $('title').text();

        if (title.includes('Attention Required!')) {
            throw new Error('We got captcha on:', request.url);
        }

        if (request.userData.label === 'ARTICLE') {
            await handleArticle({ request, saveHtml, html, page, $, extendOutputFunction,
                extendOutputFunctionEvaled, parsedDateFrom, mustHaveDate, minWords,
                maxArticlesPerCrawl, onlyNewArticles, onlyNewArticlesPerDomain, state,
                stateDataset });
        }

        // If we enqueue from articles, we work with the like with categories
        // after we scrape them
        if (request.userData.label !== 'ARTICLE' || enqueueFromArticles) {
            // TODO: Refactor this
            await handleCategory({ request, maxDepth, page, $, requestQueue,
                state, onlyInsideArticles, onlyNewArticles, onlyNewArticlesPerDomain,
                isUrlArticleDefinition, useGoogleBotHeaders,
                debug, html, pseudoUrls, linkSelector });
        }
    };

    const genericCrawlerOptions = {
        requestList,
        requestQueue,
        handlePageFunction,
        maxConcurrency,
        maxRequestRetries: 3,
        maxRequestsPerCrawl: maxPagesPerCrawl,
        proxyConfiguration: proxyConfigurationClass,
    };

    const cheerioCrawlerOptions = {
        ...genericCrawlerOptions,
        requestTimeoutSecs: 120,
    };

    const puppeteerCrawlerOptions = {
        ...genericCrawlerOptions,
        preNavigationHooks: [(crawlingContext, gotoOptions) => { gotoOptions.timeout = 120000; }],
    };

    const crawler = useBrowser
        ? new Apify.PuppeteerCrawler(puppeteerCrawlerOptions)
        : new Apify.CheerioCrawler(cheerioCrawlerOptions);

    log.info('starting crawler...');
    await crawler.run();
    log.info('crawler finished...');
});
