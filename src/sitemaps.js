const { default: Apify } = require('apify');
const { POSSIBLE_SITEMAP_PATHS } = require('./constants');

module.exports.getRequestsFromSitemaps = async ({ sitemapUrls, searchFromSitemaps }) => {
    if ((!sitemapUrls || sitemapUrls.length === 0) && !searchFromSitemaps) {
        return [];
    }
    const requestList = await Apify.openRequestList('LIST', []);
}