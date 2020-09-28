const moment = require('moment');
const urlLib = require('url');
const Apify = require('apify');

const { log } = Apify.utils;

const isDateValid = (date) => {
    return date instanceof Date && !isNaN(date);
};
module.exports.isDateValid = isDateValid;

module.exports.parseDateToMoment = (dateFrom) => {
    if (!dateFrom) {
        return;
    }

    let parsedDateFrom = new Date(dateFrom);
    // console.log('Parsed new Date:', parsedDateFrom);
    if (isDateValid(parsedDateFrom)) {
        // console.log('returing')
        return moment(parsedDateFrom);
    }
    const split = dateFrom.split(' ');
    const now = moment();
    parsedDateFrom = now.clone().subtract(Number(split[0]), split[1]);
    // console.log('Comparing:', now, parsedDateFrom);
    if (now !== parsedDateFrom) {
        // Means the subtraction worked
        return parsedDateFrom;
    }

    throw new Error('WRONG INPUT: dateFrom is not a valid date. Please use date in YYYY-MM-DD or format like "1 week" or "20 days"');
};

const loadAllDataset = async (dataset, items, offset) => {
    const limit = 250000;
    const newItems = await dataset.getData({ offset, limit }).then((res) => res.items);
    items = items.concat(newItems);
    log.info(`Loaded ${newItems.length} items, totally ${items.length}`);
    if (newItems.length === 0) return items;
    return loadAllDataset(dataset, items, offset + limit).catch((e) => items);
};
module.exports.loadAllDataset = loadAllDataset;

module.exports.executeExtendOutputFn = async (fn, $, item) => {
    const isObject = (val) => typeof val === 'object' && val !== null && !Array.isArray(val);

    let userResult = {};

    if (!fn) {
        return userResult;
    }

    try {
        // For Puppeteer, you will need to do this inside page.evaluate
        userResult = await fn($, item);
    } catch (e) {
        log.warning(`extendOutputFunction crashed! Pushing default output. Please fix your function if you want to update the output. Error: ${e}`);
    }

    if (!isObject(userResult)) {
        log.error('extendOutputFunction has to return an object!!!');
        process.exit(1);
    }
    return userResult;
};

module.exports.findDateInURL = (url) => {
    const match = url.match(/\d{4}-\d{2}-\d{2}/);
    if (match) {
        return match[0];
    }
};

module.exports.parseDomain = (url) => {
    if (!url) return null;
    const parsed = urlLib.parse(url);
    if (parsed && parsed.host) {
        return parsed.host.replace('www.', '');
    }
};

module.exports.completeHref = (parentUrl, path) => {
    const { protocol, host } = urlLib.parse(parentUrl);
    return `${protocol}//${host}${path}`;
};
