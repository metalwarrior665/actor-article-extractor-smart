#### 2022-09-21
*Features*
- Nicer messages explaining why an article was marked as invalid
- Added `saveSnapshotsOfInvalidArticles` option to input

#### 2021-6-17
*Features*
- Added `enqueueFromArticles` option to enqueue articles from article pages to get even more articles from the website. You need to enable it in input.
- Added `scanSitemaps` and `sitemapUrls` parameters. `scanSitemaps` automatically searches sitemaps for articles for each start URL and `sitemapUrls` allows you to add the sitemaps manually if necessary. Be careful that `scanSitemaps` may dump a huge amount of (sometimes old) article URLs into the scraping process

#### 2021-03-12
*Fixes*
- `onlyNewArticles` and `onlyNewArticlesPerDomain` was loading duplicate items which caused excess usage of dataset read.

#### 2021-03-31
*Features*
- Added new input option `onlyNewArticlesPerDomain`. This is much more efficient way to deduplicate articles, so use it instead of `onlyNewArticles`.
- `onlyNewArticlesPerDomain` works also on local datasets

#### 2021-01-21
- Fix: Now works with Start URLs from a public spreadsheet

#### 2020-09-28
- Upgraded Apify version `0.21.0` that sometimes crashed at the start of the run
- Added `currentItem` param to `extendOutputFunction`
- Improved logs
- Increased request timeouts to work better on very slow sites

#### 2020-07-07
- Added option to run with browser (Puppeteer)
- Added option to wait for page load or for selector (browser only)
- Added `articleUrls` directly as input option to parse directly on articles
