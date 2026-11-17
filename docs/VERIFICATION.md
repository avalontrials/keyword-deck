# Verification record

Date: 17 November 2026  
Machine: Windows 11  
Runtime: Node.js 26.13.0, Chrome 157.0.8103.51

## Automated tests

`npm test` — 14/14 passing:

- user keyword parsing, dedupe and six-phrase cap;
- case-insensitive keyword matching;
- generic profile terms;
- exact-keyword question outranks an unrelated promo;
- high-relevance ordering;
- Google query plan uses user keywords;
- RSS parsing and the `queryKeyword` field;
- Google article ID extraction;
- signed `batchexecute` response parsing;
- Apify field normalization;
- blank store defaults and token masking;
- local post flags and run persistence.

## Live generic search

Keywords: `cold brew coffee, coffee subscription`  
Window: 7 days, region US, Apify disabled.

- 25 public posts returned after link resolution and freshness filtering;
- 11 high-relevance posts;
- 10 posts indexed inside 24 hours;
- exact-phrase priority confirmed on a post containing `cold brew coffee` in its caption;
- visible search trace for each query.

The test used a real public search, not fixture data. Result counts change between runs.

## UI checks

- Blank search input on first load; Search disabled until a keyword is entered.
- High-relevance and All-posts views.
- A− / A+ changes real root font size; Atkinson Hyperlegible loaded from the local font files.
- Focus mode hides the rail, hero, options and trace.
- Trace opens with per-query cards.
- Settings exposes region, window, optional default keywords and Apify.
- Manual lanes open only allowlisted hosts in the default browser.
- No runtime exceptions in the browser console.

## Package

- `data/` is excluded from the distributable ZIP.
- No Apify token, search history or saved posts are included.
- Desktop shortcut is installed separately by the recipient.
- Font license is included at `public/fonts/OFL.txt`.

## Not tested

- A live Apify run: no token was available.
- Third-party manual lanes after login: the app only opens the browser URL; it does not read the page.
- Native `.exe` packaging: this is a local Node server plus a Chrome app window.

## Limits

The Google index is incomplete and `pubDate` is an index timestamp, not necessarily the Instagram publish time. The app filters old results locally and reports the run's actual counts. Public endpoints may change without notice.

