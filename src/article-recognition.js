const moment = require('moment');

const { findDateInURL } = require('./utils');

module.exports.countWords = (text) => {
    if (typeof text !== 'string') return false;
    return text.split(' ').length;
};

module.exports.isUrlArticle = (url, isUrlArticleDefinition) => {
    if (typeof url !== 'string') {
        return false;
    }
    const isImage1 = ['.jpg', 'jpeg', '.png'].some((ext) => url.endsWith(ext));
    const isImage2 = ['.jpg?', 'jpeg?', '.png?'].some((ext) => url.includes(ext));
    const isImage = isImage1 || isImage2;
    const isJS = url.endsWith('.js') || url.includes('.js?');
    if (isImage || isJS) {
        return false;
    }

    if (!isUrlArticleDefinition) {
        return true;
    }

    const matches = isUrlArticleDefinition.linkIncludes || [];
    for (const string of matches) {
        if (url.toLowerCase().includes(string)) {
            return true;
        }
    }

    if (isUrlArticleDefinition.hasDate) {
        const foundDate = findDateInURL(url);
        if (foundDate) {
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

module.exports.isInDateRange = (publicationDateISO, dateFrom) => {
    if (!dateFrom) {
        return !!publicationDateISO;
    }
    const publicationDate = moment(publicationDateISO);
    console.log(`Comparing publication date ${publicationDate} > ${dateFrom}: ${publicationDate > dateFrom}`)
    return publicationDate > dateFrom;
};
