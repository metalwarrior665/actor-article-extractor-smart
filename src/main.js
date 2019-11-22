const Apify = require('apify');
const extractor = require('unfluff');
const chrono = require('chrono-node');
const urlLib = require('url');

const { log } = Apify.utils;

const MAX_DATASET_ITEMS_LOADED = 3 * 1000 * 1000;

const loadAllDataset = async (dataset, items, offset) => {
    const limit = 250000;
    const newItems = await dataset.getData({ offset, limit }).then((res) => res.items);
    items = items.concat(newItems);
    console.log(`Loaded ${newItems.length} items, totally ${items.length}`);
    if (newItems.length === 0) return items;
    return loadAllDataset(dataset, items, offset + limit).catch((e) => items);
};

const countWords = (text) => {
    if (typeof text !== 'string') return false;
    return text.split(' ').length;
};

const isUrlArticle = (url, isUrlArticleDefinition) => {
    if (!isUrlArticleDefinition) {
        return true;
    }
    const matches = isUrlArticleDefinition.linkIncludes || [];
    for (const string of matches) {
        if (url.toLowerCase().includes(string)) {
            return true;
        }
    }

    const minDashes = isUrlArticleDefinition.minDashes || 0;

    const dashes = url.split('').reduce((acc, char) => char === '-' ? acc + 1 : acc, 0);
    if (dashes >= minDashes) {
        return true;
    }
    return false;
};

const isInDateRange = (publicationDateISO, dateFrom) => {
    if (!dateFrom) {
        return true;
    }
    const publicationDate = new Date(publicationDateISO);
    const dateFromDate = new Date(dateFrom); // This can be any string that can be converted to a date
    return publicationDate > dateFromDate;
};

const parseDomain = (url) => {
    if (!url) return null;
    const parsed = urlLib.parse(url);
    if (parsed && parsed.host) {
        return parsed.host.replace('www.', '');
    }
};

const completeHref = (parentUrl, path) => {
    const { protocol, host } = urlLib.parse(parentUrl);
    return `${protocol}//${host}${path}`
}

Apify.main(async () => {
    const input = await Apify.getValue('INPUT');
    console.log('input');
    console.dir(input);

    const {
        startUrls,
        onlyNewArticles = false,
        onlyInsideArticles = false,
        saveHtml = false,
        minWords = 150,
        dateFrom,
        isUrlArticleDefinition,
        pseudoUrls,
        linkSelector,
        maxDepth,
        proxyConfiguration = { useApifyProxy: true },
        debug = false,
    } = input;

    if (dateFrom) {
        const date = new Date(dateFrom);
        if (!date || date === 'Invalid Date') {
            throw new Error('WRONG INPUT: dateFrom is not a valid date');
        }
    }

    const arePseudoUrls = pseudoUrls && pseudoUrls.length > 0;
    if ((arePseudoUrls && !linkSelector) || (linkSelector && !arePseudoUrls)) {
        console.log('WARNING - If you use only Pseudo URLs or only Link selector, they will not work. You need to use them together.');
    }

    // Only relevant for incremental run
    const state = {};
    let stateDataset;
    if (onlyNewArticles) {
        console.log('loading state dataset...');
        const datasetToOpen = 'articles-state';
        stateDataset = await Apify.openDataset(datasetToOpen);
        const { itemCount } = await stateDataset.getInfo();
        const rawOffset = itemCount - MAX_DATASET_ITEMS_LOADED;
        const offset = rawOffset < 0 ? 0 : rawOffset;
        console.log(`State dataset contains ${itemCount} items, max dataset load is ${MAX_DATASET_ITEMS_LOADED}, offset: ${offset}`);
        const stateData = await loadAllDataset(stateDataset, [], offset);
        stateData.forEach((item) => {
            state[item.url] = true;
        });
        console.log('state prepared');
    }

    console.log(`We got ${startUrls.length} from the list`);

    const requestQueue = await Apify.openRequestQueue();

    for (const request of startUrls) {
        const { url } = request;
        console.log(`enquing start URL: ${url}`);
        if (request.userData && request.userData.label === 'ARTICLE') {
            await requestQueue.addRequest({ url, userData: { label: 'ARTICLE', index: 0, depth: 0 } });
        } else {
            await requestQueue.addRequest({ url, userData: { label: 'CATEGORY', index: 0, depth: 0 } });
        }
    }

    const handlePageFunction = async ({ request, $, html, response }) => {
        const title = $('title').text();

        const { loadedUrl } = request;

        if (title.includes('Attention Required!')) {
            throw new Error('We got captcha on:', request.url);
        }

        if (request.userData.label !== 'ARTICLE') {
            const loadedDomain = parseDomain(loadedUrl);
            console.log(`CATEGORY PAGE - requested URL: ${request.url}, loaded URL: ${loadedUrl}`);

            if (request.userData.depth >= maxDepth) {
                console.log(`Max depth of ${maxDepth} reached, not enqueueing any more request for --- ${request.url}`);
                return;
            }

            // all links
            const allHrefs = [];
            let aTagsCount = 0;
            $('a').each(function () {
                aTagsCount++;
                const relativeOrAbsoluteLink = $(this).attr('href');
                if (relativeOrAbsoluteLink) {
                    const absoluteLink = urlLib.resolve(loadedUrl, relativeOrAbsoluteLink);
                    allHrefs.push(absoluteLink);
                }
            });
            console.log(`total number of a tags: ${aTagsCount}`);
            console.log(`total number of links: ${allHrefs.length}`);

            let links = allHrefs;
            await Apify.setValue('LINKS', links);

            // filtered only inside links
            if (onlyInsideArticles) {
                links = allHrefs.filter((link) => loadedDomain === parseDomain(link));
                console.log(`number of inside links: ${links.length}`);
            }

            // filtered only new urls
            if (onlyNewArticles) {
                links = links.filter((href) => !state[href]);
                console.log(`number of inside links after state filter: ${links.length}`);
            }

            // filtered only proper article urls
            const articleUrlHrefs = links.filter((link) => isUrlArticle(link, isUrlArticleDefinition));
            console.log(`number of article url links: ${articleUrlHrefs.length}`);

            let index = 0;
            for (const url of articleUrlHrefs) {
                index++;
                await requestQueue.addRequest({
                    url,
                    userData: { domain: request.userData.domain, label: 'ARTICLE', index, loadedDomain },
                });
            }
            if (debug) {
                await Apify.setValue(Math.random().toString(), html, { contentType: 'text/html' });
            }

            // We handle optional pseudo URLs and link selectors here
            if (pseudoUrls && pseudoUrls.length > 0 && linkSelector) {
                const selectedLinks = $(linkSelector)
                    .map(function () { return $(this).attr('href'); }).toArray()
                    .filter((link) => !!link)
                    .map((link) => link.startsWith('http') ? link : completeHref(request.url, link));
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
                console.log(`Link selector found ${selectedLinks.length} links, enqueued through PURLs: ${enqueued} --- ${request.url}`);
            }
        }

        if (request.userData.label === 'ARTICLE') {
            const metadata = extractor(html);

            metadata.date = chrono.parseDate(metadata.date);


            const isInDateRangeVar = isInDateRange(metadata.date, dateFrom);
            if (!isInDateRangeVar && !!metadata.date && countWords(metadata.text)) {
                console.log(`ARTICLE - ${request.userData.index} - DATE NOT IN RANGE: ${metadata.date}`);
            }
            const wordsCount = countWords(metadata.text);

            const result = {
                url: request.url,
                loadedUrl,
                domain: request.userData.domain,
                loadedDomain: request.userData.loadedDomain,
                isArticle: !!metadata.date && !!metadata.title && wordsCount > minWords && isInDateRangeVar,
                metadata,
                html: saveHtml ? html : undefined,
            };

            if (onlyNewArticles) {
                state[result.url] = true;
                await stateDataset.pushData({ url: request.url });
            }

            if (result.isArticle) {
                console.log(`IS VALID ARTICLE --- ${request.url}`);
                await Apify.pushData(result);
            } else {
                console.log(`IS NOT VALID ARTICLE --- date: ${!!metadata.date}, title: ${!!metadata.title}, words: ${wordsCount}, dateRange: ${isInDateRangeVar} --- ${request.url}`);
            }
        }
    };

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        handlePageFunction,
        maxRequestRetries: 3,
        useApifyProxy: proxyConfiguration.useApifyProxy,
        apifyProxyGroups: proxyConfiguration.apifyProxyGroups,
    });

    console.log('starting crawler...');
    await crawler.run();
    console.log('crawler finished...');
});
