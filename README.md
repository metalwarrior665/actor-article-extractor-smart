### Smart article extractor

This actor is an extension of Apify's [Article Text Extractor](https://apify.com/mtrunkat/article-text-extractor). It has several extra features:

- Allows opening pages with a browser (Puppeteer) which can wait for dynamically loaded data
- Allows extraction of any number of URLs - support for Start URLs, Pseudo URLs and max crawling depth
- Smart article recognition - an Actor can decide what pages on a website are in fact articles to be scraped. This is customizable.
- Additional filters - Date of articles, minimum words
- Date normalization
- Some extra data fields
- Allows custom scraping function - You can add/overwrite your own fields from the parsed HTML
- Allows using Google Bot headers (bypassing paywalls)


Example output:
- [JSON](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=json&clean=1) (looks the best)
- [Table](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=html&clean=1)
- [CSV](https://api.apify.com/v2/datasets/mNg8AeuevQKjBhtTX/items?format=csv&attachment=1&clean=1)

More detailed documentation to come...

### Changelog
This actor is under active development. For more detailed information, check [Changelog](CHANGELOG.md)
- 2020-07-07 - Added option to run with a browser (Puppeteer) and wait till the page dynamically loads

### Extend output function (optional)

You can use this function to update the default output of this actor. This function gets a JQuery handle `$` as an argument so you can choose what data from the page you want to scrape. The output from this will function will get merged with the default output.

The return value of this function has to be an object!

You can return fields to achieve 3 different things:
- Add a new field - Return object with a field that is not in the default output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


Let's say that you want to accomplish this
- Remove `links` and `videos` fields from the output
- Add a `pageTitle` field
- Change the date selector (In rare cases the scraper is not able to find it)

```javascript
($) => {
    return {
        links: undefined,
        videos: undefined,
        pageTitle: $('title').text(),
        date: $('.my-date-selector').text()
    }
}
```

