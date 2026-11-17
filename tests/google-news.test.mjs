import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQueryPlan,
  extractArticleId,
  parseBatchexecuteResponse,
  parseGoogleNewsRss,
} from "../lib/google-news.mjs";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
  <title>My cold brew coffee routine &amp; the ratio I use - Instagram</title>
  <link>https://news.google.com/rss/articles/CBMiVkFVX3lxTE9vRDNyTXgtTUtYczJTUjhsem9yYldwejE4cWJ6dWJsYng1aW1la2JqTHpLSXBvdGZ2YmRMUllNMF91V0Nvd1MzUTB5a0xkN0dwbmdyZTFR?oc=5</link>
  <pubDate>Sun, 15 Nov 2026 18:03:46 GMT</pubDate>
  <source url="https://www.instagram.com">Instagram</source>
</item>
<item>
  <title>A new coffee subscription - Instagram</title>
  <link>https://news.google.com/rss/articles/ABC123?oc=5</link>
  <pubDate>Mon, 16 Nov 2026 01:00:00 GMT</pubDate>
  <source url="https://www.instagram.com">Instagram</source>
</item>
</channel></rss>`;

test("buildQueryPlan uses the user keywords, not a fixed niche", () => {
  const plan = buildQueryPlan(["cold brew coffee", "coffee subscription"], {
    windowHours: 72,
  });
  assert.ok(plan.length >= 3);
  assert.match(plan[0].q, /^site:instagram\.com "cold brew coffee"/);
  assert.match(plan[0].q, /when:3d$/);
  assert.ok(plan.some((entry) => entry.id === "combined"));
  assert.ok(plan.some((entry) => entry.id === "questions"));
  const joined = plan.map((entry) => entry.q).join(" ");
  assert.ok(joined.includes("cold brew coffee"));
  assert.ok(joined.includes("coffee subscription"));
});

test("parseGoogleNewsRss decodes entities and keeps the keyword", () => {
  const [first, second] = parseGoogleNewsRss(rss, {
    query: { id: "exact-1", label: "Exact: cold brew coffee", keyword: "cold brew coffee" },
    limit: 10,
  });
  assert.equal(first.title, "My cold brew coffee routine & the ratio I use");
  assert.equal(first.sourceName, "Instagram");
  assert.equal(first.indexedAt, "2026-11-15T18:03:46.000Z");
  assert.equal(first.queryKeyword, "cold brew coffee");
  assert.equal(second.title, "A new coffee subscription");
});

test("extractArticleId handles RSS and read URLs", () => {
  assert.equal(
    extractArticleId("https://news.google.com/rss/articles/CBMiABC?oc=5"),
    "CBMiABC",
  );
  assert.equal(
    extractArticleId("https://news.google.com/read/CBMiXYZ?hl=en-US"),
    "CBMiXYZ",
  );
  assert.equal(extractArticleId("https://example.com/nope"), null);
});

test("parseBatchexecuteResponse finds the Instagram destination", () => {
  const response = `)]}'

[["wrb.fr","Fbv4je","[\\"garturlres\\",\\"https://www.instagram.com/reel/DfYYtegTeDF/\\",1]",null,null,null,"0"],["di",13]]`;
  const pairs = parseBatchexecuteResponse(response);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].url, "https://www.instagram.com/reel/DfYYtegTeDF/");
  assert.equal(pairs[0].requestId, "0");
});
