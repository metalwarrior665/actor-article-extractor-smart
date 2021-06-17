const Apify = require('apify');

const { wasArticleScraped } = require('./articles-scraped-state');
const { parseDomain } = require('./utils');
const { isUrlArticle } = require('./article-recognition');

const { log } = Apify.utils;

module.exports.filterArticleUrls = async ({
    links,
    state,
    onlyInsideArticles,
    onlyNewArticles,
    onlyNewArticlesPerDomain,
    loadedDomain,
    isUrlArticleDefinition,
}) => {
    // filtered only inside links (for sitemaps we filter those separately so we don't pass loadedDomain)
    if (onlyInsideArticles && loadedDomain) {
        links = links.filter((link) => loadedDomain === parseDomain(link));
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
    return articleUrlHrefs;
};
