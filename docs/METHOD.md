# Method and limits

## What this is

Keyword Deck is a local reading desk for **public Instagram posts**. It takes keywords from the user, searches public discovery paths, and builds a ranked deck. It does not post, comment, message, follow, like or authenticate to Instagram.

## User keywords

`lib/scoring.mjs` parses up to six comma-, semicolon- or line-separated phrases. Each phrase is kept as an exact phrase for matching, and its meaningful words are used for broader relevance.

The search input is blank by default. There is no bundled niche list, no default keyword and no sample data. A user can optionally save default keywords in Settings, but they can always override them.

## Google index

`lib/google-news.mjs` builds a query plan from the user's phrases:

- one exact `site:instagram.com "<keyword>"` query per phrase (first five);
- one combined OR query when there is more than one phrase;
- one question/advice query;
- one fresh 24-hour query for longer windows.

Google News article IDs are opaque. The resolver:

1. Fetches `/rss/articles/<id>`.
2. Reads the per-article `data-n-a-sg` signature and `data-n-a-ts` timestamp.
3. POSTs one `f.req` envelope to `https://news.google.com/_/DotsSplashUi/data/batchexecute`.
4. Parses the `garturlres` response to obtain the original Instagram URL.

Links are cached for 30 days. If a destination is not a public `/p/`, `/reel/` or `/tv/` URL, the item is dropped.

## Instagram previews

For each resolved post:

```text
GET https://www.instagram.com/api/v1/oembed/?url=<canonical-post-url>
Headers: X-IG-App-ID: 936619743392459
```

The response supplies `author_name`, `author_url`, `title` (caption) and `thumbnail_url`. Private or restricted posts return 403 and are kept only as a Google-title card, without a preview.

The app does not parse the login-gated Instagram HTML page.

## Relevance

`scorePost()` is an editorial heuristic, not an Instagram ranking.

Positive:

- freshness;
- exact keyword match;
- keyword overlap;
- question or advice language;
- public engagement when Apify supplies it.

Penalties:

- promotional language;
- giveaways;
- generic calls to action;
- weak keyword match;
- posts outside the selected window.

**High relevance** means at least one exact keyword phrase is present and the post is not promo/giveaway. Everything else is **Low relevance**. The numeric score orders the deck; the band is the primary label.

## Optional Apify

`lib/apify.mjs` uses Apify's public API:

- connection test: `GET /v2/users/me`
- start run: `POST /v2/acts/{actor}/runs?maxTotalChargeUsd=...&timeout=...`
- poll: `GET /v2/actor-runs/{runId}`
- dataset: `GET /v2/datasets/{datasetId}/items`

Default actor input for `omkar-cloud~instagram-scraper`:

```json
{
  "searchQueries": ["<keyword 1>", "<keyword 2>"],
  "hashtags": [],
  "maxPostsPerSource": 10
}
```

Cost guard: hard `maxTotalChargeUsd`, bounded posts per source, cooldown, and no automatic retry of a failed paid run.

## Manual lanes

Reddit, Facebook, Threads and LinkedIn open the keyword search in the default browser through a narrow allowlisted `/api/open` endpoint. The app does not read the resulting pages. This avoids API approvals, login scraping and account handling.

## Typography

Atkinson Hyperlegible is bundled locally under the SIL Open Font License. The A− / A+ control changes the root font size; it does not use browser zoom. At 120% and 130% the deck stacks into one column to preserve readable line lengths.

## What it does not do

- No login, cookie import or session bridge.
- No private profiles, private groups or non-public data.
- No CAPTCHA solving or rate-limit evasion.
- No likes, follows, comments, messages or automated outreach.
- No cloud storage or telemetry.

Public endpoints can change. Failures appear in the search trace rather than being silently replaced with fabricated data.

