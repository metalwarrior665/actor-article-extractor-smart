const Apify = require('apify');
const extractor = require('unfluff');
const chrono = require('chrono-node');
const urlLib = require('url');
const moment = require('moment');

const { log } = Apify.utils;

const { parseDateToMoment, loadAllDataset, executeExtendOutputFn, isDateValid, findDateInURL, parseDomain, completeHref } = require('./utils.js');
const { countWords, isUrlArticle, isInDateRange } = require('./article-recognition.js');
const CUNotification = require('./compute-units-notification.js');
const { MAX_DATASET_ITEMS_LOADED, GOOGLE_BOT_HEADERS } = require('./constants.js');

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    log.info('Input');
    console.dir(input);

    const {
        // These are category URLs mostly
        startUrls = [],
        articleUrls = [],
        onlyNewArticles = false,
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

    const defaultNotificationState = {
        next: notifyAfterCUsPeriodically,
        wasNotified: false,
    };

    const notificationState = (await Apify.getValue('NOTIFICATION-STATE')) || defaultNotificationState;

    // Measure CUs every 30 secs if enabled in input
    if (stopAfterCUs || notifyAfterCUs || notifyAfterCUsPeriodically) {
        if (Apify.isAtHome()) {
            setInterval(async () => {
                await CUNotification(stopAfterCUs, notifyAfterCUs, notificationEmails, notifyAfterCUsPeriodically, notificationState);
            }, 30000);
        } else {
            log.warning('Cannot measure Compute units of local run. Notifications disabled...');
        }
    }

    let articlesScraped = (await Apify.getValue('ARTICLES-SCRAPED')) || 0;
    Apify.events.on('migrating', async () => {
        await Apify.setValue('ARTICLES-SCRAPED', articlesScraped);
    });

    let extendOutputFunctionEvaled;
    if (extendOutputFunction) {
        try {
            extendOutputFunctionEvaled = eval(extendOutputFunction);
        } catch (e) {
            throw new Error(`extendOutputFunction is not a valid JavaScript! Error: ${e}`);
        }
        if (typeof extendOutputFunctionEvaled !== 'function') {
            throw new Error(`extendOutputFunction is not a function! Please fix it or use just default output!`);
        }
    }

    // Valid format is either YYYY-MM-DD or format like "1 week" or "20 days"
    const parsedDateFrom = parseDateToMoment(dateFrom);
    // console.log(parsedDateFrom);

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

    const requestQueue = await Apify.openRequestQueue();

    for (const request of startUrls) {
        const { url } = request;
        log.info(`Enquing start URL: ${url}`);

        await requestQueue.addRequest({
            url,
            userData: {
                // This is here for backwards compatibillity
                label: request.userData && request.userData.label === 'ARTICLE' ? 'ARTICLE' : 'CATEGORY',
                index: 0,
                depth: 0,
            },
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });

    }

    let index = 0;
    for (const request of articleUrls) {
        const { url } = request;
        log.info(`Enquing article URL: ${url}`);

        await requestQueue.addRequest({
            url,
            userData: {
                label: 'ARTICLE',
                index: 0,
            },
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });
        index++;
    }

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

        const { loadedUrl } = request;

        if (title.includes('Attention Required!')) {
            throw new Error('We got captcha on:', request.url);
        }

        if (request.userData.label !== 'ARTICLE') {
            const loadedDomain = parseDomain(loadedUrl);
            log.info(`CATEGORY PAGE - requested URL: ${request.url}, loaded URL: ${loadedUrl}`);

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
                        const absoluteLink = urlLib.resolve(loadedUrl, relativeOrAbsoluteLink);
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
                links = links.filter((href) => !state[href]);
                log.info(`number of inside links after state filter: ${links.length}`);
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
                        .map((link) => link.startsWith('http') ? link : completeHref(request.url, link));
                }
                const purls = pseudoUrls.map((req) => new Apify.PseudoUrl(
                    req.url,
                    { userData: req.userData, depth: request.userData.depth + 1 }
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
        }

        if (request.userData.label === 'ARTICLE') {
            const metadata = extractor(html);

            const result = {
                url: request.url,
                loadedUrl,
                domain: request.userData.domain,
                loadedDomain: request.userData.loadedDomain,
                ...metadata,
                html: saveHtml ? html : undefined,
            };

            let userResult = {};
            if (extendOutputFunction) {
                if (page) {
                    await Apify.utils.puppeteer.injectJQuery(page);
                    const pageFunctionString = extendOutputFunction.toString();

                    const evaluatePageFunction = async (fnString, item) => {
                        const fn = eval(fnString);
                        try {
                            const userResult = await fn($, item);
                            return { userResult };
                        } catch (e) {
                            return { error: e.toString()};
                        }
                    };
                    const resultOrError = await page.evaluate(evaluatePageFunction, pageFunctionString, result);
                    if (resultOrError.error) {
                        log.warning(`extendOutputFunctionfailed. Returning default output. Error: ${resultOrError.error}`);
                    } else {
                        userResult = resultOrError.userResult;
                    }
                } else {
                    userResult = await executeExtendOutputFn(extendOutputFunctionEvaled, $, result);
                }
            }

            const completeResult = { ...result, ...userResult };

            // We try native new Date() first and then Chrono
            let parsedPageDate;
            if (completeResult.date) {
                const nativeDate = new Date(completeResult.date);
                if (isDateValid(nativeDate)) {
                    parsedPageDate = moment(nativeDate.toISOString());
                } else {
                    parsedPageDate = chrono.parseDate(completeResult.date);
                }
            }

            // Last fallback is on date in URL, then we give up
            if (!parsedPageDate) {
                parsedPageDate = findDateInURL(request.url);
            }

            completeResult.date = parsedPageDate || null;

            const wordsCount = countWords(completeResult.text);

            const isInDateRangeVar = isInDateRange(completeResult.date, parsedDateFrom);
            if (mustHaveDate && !isInDateRangeVar && !!completeResult.date) {
                log.warning(`ARTICLE - ${request.userData.index} - DATE NOT IN RANGE: ${completeResult.date}`);
                return;
            }

            if (onlyNewArticles) {
                state[completeResult.url] = true;
                await stateDataset.pushData({ url: request.url });
            }

            const hasValidDate = mustHaveDate ? isInDateRangeVar : true;

            const isArticle =
                hasValidDate
                && !!completeResult.title
                && wordsCount > minWords;

            if (isArticle) {
                log.info(`IS VALID ARTICLE --- ${request.url}`);
                await Apify.pushData(completeResult);
                articlesScraped++;

                if (maxArticlesPerCrawl && articlesScraped >= maxArticlesPerCrawl) {
                    log.warning(`WE HAVE REACHED MAXIMUM ARTICLES: ${maxArticlesPerCrawl}. FINISHING CRAWLING...`);
                    process.exit(0);
                }
            } else {
                log.warning(`IS NOT VALID ARTICLE --- date: ${hasValidDate}, title: ${!!completeResult.title}, words: ${wordsCount}, dateRange: ${isInDateRangeVar} --- ${request.url}`);
            }
        }
    };

    let proxyConfigurationClass;
    if (proxyConfiguration && (proxyConfiguration.useApifyProxy || Array.isArray(proxyConfiguration.proxyUrls))) {
        proxyConfigurationClass = await Apify.createProxyConfiguration({
            groups: proxyConfiguration.apifyProxyGroups,
            countryCode: proxyConfiguration.apifyProxyCountry,
        });
    }

    const genericCrawlerOptions = {
        requestQueue,
        handlePageFunction,
        maxConcurrency,
        maxRequestRetries: 3,
        maxRequestsPerCrawl: maxPagesPerCrawl,
        proxyConfiguration: proxyConfigurationClass,
        gotoTimeoutSecs: useBrowser ? 120 : undefined,
    };

    const crawler = useBrowser
        ? new Apify.PuppeteerCrawler(genericCrawlerOptions)
        : new Apify.CheerioCrawler(genericCrawlerOptions);

    log.info('starting crawler...');
    await crawler.run();
    log.info('crawler finished...');
});
