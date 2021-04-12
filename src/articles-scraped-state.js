const Apify = require('apify');

const { log } = Apify.utils;

const { loadDatasetItemsInParallel } = require('./load-datasets');
const { ARTICLES_SCRAPED_DATASET_PREFIX } = require('./constants');

/**
 * Waits until a predicate (funcion that returns bool) returns true
 *
 * @example
 *   let eventFired = false;
 *   await waiter(() => eventFired, { timeout: 120000, pollInterval: 1000 })
 *   // Something happening elsewhere that will set eventFired to true
 *
 * @template {() => Promise<any>} T
 * @param {T} predicate
 * @param {object} [options]
 * @param {number} [options.timeout=120000]
 * @param {number} [options.pollInterval=1000]
 */
const waiter = async (predicate, options = {}) => {
    const { timeout = 120000, pollInterval = 1000 } = options;
    const start = Date.now();

    for (;;) {
        if (await predicate()) {
            return;
        }

        const waitingFor = Date.now() - start;

        if (waitingFor > timeout) {
            throw new Error(`Timeout reached when waiting for predicate for ${waitingFor} ms`);
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
};

module.exports.wasArticleScraped = async (state, url) => {
    const urlObj = new URL(url);
    const { hostname, pathname, search, hash } = urlObj;

    const sanitizedDomain = hostname.replace(/[^a-zA-Z0-9-]/g, '-');

    // If this domain is requested for the first time
    // We have to load it from dataset
    if (!state.perDomainArticlesScraped[sanitizedDomain]) {
        log.warning(`Loading already scraped articles for domain: ${sanitizedDomain} from the dataset, `
            + 'this might block the scraping process for up to a minute');
        // We have to mark this domain as loading so all
        // other concurrent function will wait there
        state.perDomainArticlesScraped[sanitizedDomain] = {
            loading: true,
            articlePathsSet: new Set(),
        };

        const datasetName = `${ARTICLES_SCRAPED_DATASET_PREFIX}${sanitizedDomain}`;

        const articlePaths = await loadDatasetItemsInParallel([datasetName], { batchSize: 10000, debugLog: true })
            .then((items) => items.map((item) => item.path));
        for (const articlePath of articlePaths) {
            state.perDomainArticlesScraped[sanitizedDomain].articlePathsSet.add(articlePath);
        }

        state.perDomainArticlesScraped[sanitizedDomain].loading = false;
        const articlesScraped = state.perDomainArticlesScraped[sanitizedDomain].articlePathsSet.size;
        log.warning(`Loaded all ${articlesScraped} already scraped articles for domain: ${sanitizedDomain}`);
    }

    if (state.perDomainArticlesScraped[sanitizedDomain].loading) {
        await waiter(
            () => state.perDomainArticlesScraped[sanitizedDomain].loading === false,
            // one hour should be enough for anyting
            { timeout: 3600000 },
        );
    }

    return state.perDomainArticlesScraped[sanitizedDomain].articlePathsSet
        .has(`${pathname}${search}${hash}`);
};

module.exports.addArticleScraped = async (state, url) => {
    const wasScraped = await module.exports.wasArticleScraped(state, url);
    if (!wasScraped) {
        const urlObj = new URL(url);
        const { hostname, pathname, search, hash } = urlObj;

        const sanitizedDomain = hostname.replace(/[^a-zA-Z0-9-]/g, '-');

        const articlePath = `${pathname}${search}${hash}`;
        state.perDomainArticlesScraped[sanitizedDomain].articlePathsSet.add(articlePath);
        const datasetName = `${ARTICLES_SCRAPED_DATASET_PREFIX}${sanitizedDomain}`;
        const dataset = await Apify.openDataset(datasetName);
        await dataset.pushData({ path: articlePath });
    }
};
