const Apify = require('apify');

const { log } = Apify.utils;

const { parseDateToMoment, loadAllDataset, evalPageFunction } = require('./utils.js');
const { setupNotifications } = require('./compute-units-notification.js');
const { MAX_DATASET_ITEMS_LOADED } = require('./constants.js');
const getStartSources = require('./start-urls');

const handleCategory = require('./handle-category');
const handleArticle = require('./handle-article');

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    log.info('Input');
    console.dir(input);

    const {
        // These are category URLs mostly
        startUrls = [],
        articleUrls = [],
        onlyNewArticles = false,
        onlyNewArticlesPerDomain = false,
        onlyInsideArticles = true,
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

    await setupNotifications({ stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically });

    const articlesScraped = (await Apify.getValue('ARTICLES-SCRAPED')) || { scraped: 0 };
    Apify.events.on('migrating', async () => {
        await Apify.setValue('ARTICLES-SCRAPED', articlesScraped);
    });

    const extendOutputFunctionEvaled = evalPageFunction(extendOutputFunction);

    // Valid format is either YYYY-MM-DD or format like "1 week" or "20 days"
    const parsedDateFrom = parseDateToMoment(dateFrom);

    const arePseudoUrls = pseudoUrls && pseudoUrls.length > 0;
    if ((arePseudoUrls && !linkSelector) || (linkSelector && !arePseudoUrls)) {
        log.warning('WARNING - If you use only Pseudo URLs or only Link selector, they will not work. You need to use them together.');
    }

    // Only relevant for incremental run
    const state = {};
    let stateDataset;
    if (onlyNewArticles) {
        log.info('loading state dataset...');
        const datasetToOpen = 'articles-state';
        stateDataset = await Apify.openDataset(datasetToOpen);
        const { itemCount } = await stateDataset.getInfo();
        const rawOffset = itemCount - MAX_DATASET_ITEMS_LOADED;
        const offset = rawOffset < 0 ? 0 : rawOffset;
        log.info(`State dataset contains ${itemCount} items, max dataset load is ${MAX_DATASET_ITEMS_LOADED}, offset: ${offset}`);
        const stateData = await loadAllDataset(stateDataset, [], offset);
        stateData.forEach((item) => {
            state[item.url] = true;
        });
        log.info('state prepared');
    }

    log.info(`We got ${startUrls.concat(articleUrls).length} start URLs`);

    const sources = getStartSources({ startUrls, articleUrls, useGoogleBotHeaders });

    const requestQueue = await Apify.openRequestQueue();
    const requestList = await Apify.openRequestList('LIST', sources);

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

        if (request.userData.label !== 'ARTICLE') {
            // TODO: Refactor this
            await handleCategory({ request, maxDepth, page, $, requestQueue,
                state, onlyInsideArticles, onlyNewArticles, isUrlArticleDefinition, useGoogleBotHeaders,
                debug, html, pseudoUrls, linkSelector });
        }

        if (request.userData.label === 'ARTICLE') {
            await handleArticle({ request, saveHtml, html, page, $, extendOutputFunction,
                extendOutputFunctionEvaled, parsedDateFrom, mustHaveDate, minWords,
                maxArticlesPerCrawl, articlesScraped, onlyNewArticles, state,
                stateDataset });
        }
    };

    const proxyConfigurationClass = await Apify.createProxyConfiguration(proxyConfiguration);

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
