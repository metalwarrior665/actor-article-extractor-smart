## Smart article extractor

Smart article extractor scrapes news, scientific or other articles from any website. It uses a smart algorithm to decide what page is an article and automatically extracts rich information about each article. It traverses the whole website with one click. This scraper is very cheap to run so you can extract a large amount of parsed articles from many websites.

- [Features](#features)
- [Example output](#example-output)
- [Publishing article content](#publishing-article-content)
- [How to run](#how-to-run)
- [Changelog](#changelog)
- [Extend output function](#extend-output-function-(optional))

### Features
This actor is an extension of Apify's [Article Text Extractor](https://apify.com/mtrunkat/article-text-extractor) which extract rich information from a single article page. It has several extra features:

- Allows opening pages with a browser (Puppeteer) which can wait for dynamically loaded data
- Allows extraction of any number of URLs - support for Start URLs, Pseudo URLs and max crawling depth
- Smart article recognition - an Actor can decide what pages on a website are in fact articles to be scraped. This is customizable.
- Additional filters - Date of articles, minimum words
- Date normalization
- Some extra data fields
- Allows custom scraping function - You can add/overwrite your own fields from the parsed HTML
- Allows using Google Bot headers (bypassing paywalls)


### Example output
If you run the Article extractor on the [Apify platform](https://apify.com), you can automatically get the output in many formats like JSON, CSV, XML, Excel, RSS, etc. Here is a JSON example:

```json
{
  "url": "https://www.thetimes.co.uk/edition/news/ex-mp-charlie-elphicke-sang-i-m-a-naughty-tory-after-groping-woman-court-told-nnr6nlw89",
  "loadedUrl": "https://www.thetimes.co.uk/edition/news/ex-mp-charlie-elphicke-sang-i-m-a-naughty-tory-after-groping-woman-court-told-nnr6nlw89",
  "title": "Ex-MP Charlie Elphicke sang ‘I’m a naughty Tory’ after groping woman, court told",
  "softTitle": "Ex-MP Charlie Elphicke sang ‘I’m a naughty Tory’ after groping woman, court told",
  "date": "2020-07-07T12:13:00.000Z",
  "author": [
    "Fariha Karim"
  ],
  "publisher": null,
  "copyright": "Times Newspapers Limited 2020",
  "favicon": "/d/img/icons/favicon-ab3ea01fbe.ico",
  "description": "A woman broke down in tears as she told a court today how a former Tory MP sexually assaulted her at his home while his children were in bed.The woman, who cannot be identified for legal reasons, told",
  "lang": "en",
  "canonicalLink": "https://www.thetimes.co.uk/article/ex-mp-charlie-elphicke-sang-i-m-a-naughty-tory-after-groping-woman-court-told-nnr6nlw89",
  "tags": [],
  "image": "https://www.thetimes.co.uk/imageserver/image/%2Fmethode%2Ftimes%2Fprod%2Fweb%2Fbin%2Fdfdec16c-bf85-11ea-bb37-3d3cce807650.jpg?crop=3023%2C1700%2C238%2C316&resize=685",
  "videos": [],
  "links": [],
  "text": "A woman broke down in tears as she told a court today how a former Tory MP sexually assaulted her at his home while his children were in bed.\n\nThe woman, who cannot be identified for legal reasons, told Southwark crown court that Charlie Elphicke had invited her for a drink in 2007 while his wife Natalie was away on a business trip.\n\nShe said that the children were in bed and she had a cup of tea while Mr Elphicke drank wine in the garden and they chatted.\n\nAfter about an hour, she said, “the weather changed so he suggested they go inside to the lounge” and they shared a £40 bottle of wine.\n\nShe said they carried on talking in the living room"
}
```

### Publishing article content
Please be aware that most articles are under copyright. Before you publish them anywhere visibly, check the Terms of use of the scraped site.

### How to run
Smart article extractor can be run as an [Apify Actor](https://apify.com/actors) on the Apify platform where it is seamlessly integrated with nice input UI. You can also run it locally or on any other infrastructure since it is build with the open-source [Apify SDK](https://github.com/apify/apify-js) scraping library.

More detailed documentation to come...

### Changelog
This actor is under active development. For more detailed information on recent updates, check [Changelog](https://github.com/metalwarrior665/actor-article-extractor-smart/blob/master/CHANGELOG.md)

### Extend output function (optional)

You can use this function to update the default output of this actor. This function gets a JQuery handle `$` as an argument so you can choose what data from the page you want to scrape. It also receives the `currentItem` parameter which is the default output parsed by the scraper so you can explore any fields. The output from this will function will get merged with the default output.

The return value of this function has to be an object!

You can return fields to achieve 3 different things:
- Add a new field - Return an object with a field that is not in the default output
- Change a field - Return an existing field with a new value
- Remove a field - Return an existing field with a value `undefined`


Let's say that you want to accomplish this
- Remove `links` and `videos` fields from the output
- Add a `pageTitle` field
- Change the date selector (In rare cases the scraper is not able to find it)
- Save the original date parsed so you can compare with your date

```javascript
($, currentItem) => {
    return {
        links: undefined,
        videos: undefined,
        pageTitle: $('title').text(),
        date: $('.my-date-selector').text(),
        originalDate: currentItem.date,
    }
}
```

