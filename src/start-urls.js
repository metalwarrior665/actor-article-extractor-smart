const Apify = require('apify');

const { GOOGLE_BOT_HEADERS } = require('./constants');

const { log } = Apify.utils;

module.exports = ({ startUrls, articleUrls, useGoogleBotHeaders }) => {
    const sources = [];
    for (const request of startUrls) {
        const { url, requestsFromUrl } = request;
        log.info(`Adding start URL: ${url || requestsFromUrl}`);

        sources.push({
            ...request,
            userData: {
                // This is here for backwards compatibillity
                label: request.userData && request.userData.label === 'ARTICLE' ? 'ARTICLE' : 'CATEGORY',
                index: 0,
                depth: 0,
            },
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });
    }

    for (const request of articleUrls) {
        const { url, requestsFromUrl } = request;
        log.info(`Adding article URL: ${url || requestsFromUrl}`);

        sources.push({
            ...request,
            userData: {
                label: 'ARTICLE',
                index: 0,
            },
            headers: useGoogleBotHeaders ? GOOGLE_BOT_HEADERS : undefined,
        });
    }
    return sources;
};
