import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQueryProfile,
  matchKeywords,
  parseKeywords,
  rankPosts,
  scorePost,
} from "../lib/scoring.mjs";

const keywords = "cold brew coffee, coffee subscription";

test("parseKeywords trims, dedupes and caps the list", () => {
  assert.deepEqual(parseKeywords(" cold brew , Cold Brew; espresso\n| filter coffee "), [
    "cold brew",
    "espresso",
    "filter coffee",
  ]);
  assert.equal(parseKeywords("aa,bb,cc,dd,ee,ff,gg,hh").length, 6);
});

test("keyword matching is case-insensitive", () => {
  assert.deepEqual(matchKeywords("My COLD BREW COFFEE routine", keywords), ["cold brew coffee"]);
  assert.deepEqual(matchKeywords("A coffee subscription for busy people", keywords), [
    "coffee subscription",
  ]);
});

test("profile keeps meaningful terms and exact phrases", () => {
  const profile = buildQueryProfile(keywords);
  assert.deepEqual(profile.keywords, ["cold brew coffee", "coffee subscription"]);
  assert.ok(profile.terms.includes("cold"));
  assert.ok(profile.terms.includes("subscription"));
  assert.equal(profile.phrases.includes("cold brew coffee"), true);
});

test("a fresh exact-keyword question outranks an unrelated promo", () => {
  const good = scorePost(
    {
      caption:
        "Cold brew coffee at home: what ratio do you use? I keep getting it too weak and need advice.",
      indexedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
      format: "Reel",
      metrics: null,
    },
    { keywords, windowHours: 168 },
  );
  const promo = scorePost(
    {
      caption:
        "GIVEAWAY! Win a free coffee maker. DM me and follow for more. Link in bio.",
      indexedAt: new Date().toISOString(),
      format: "Reel",
      metrics: { likes: 50000, comments: 4000 },
    },
    { keywords, windowHours: 168 },
  );
  assert.ok(good.score > promo.score, `${good.score} should beat ${promo.score}`);
  assert.equal(good.priority, "high");
  assert.equal(promo.priority, "low");
  assert.ok(promo.flags.includes("giveaway"));
});

test("rankPosts orders high relevance before low relevance", () => {
  const now = Date.now();
  const ranked = rankPosts(
    [
      {
        shortcode: "low",
        caption: "A generic post about morning routines.",
        indexedAt: new Date(now - 3600_000).toISOString(),
        format: "Post",
      },
      {
        shortcode: "high",
        caption: "My cold brew coffee setup changed my mornings. Any advice on ratios?",
        indexedAt: new Date(now - 7200_000).toISOString(),
        format: "Reel",
      },
    ],
    { keywords, windowHours: 168, now },
  );
  assert.equal(ranked[0].shortcode, "high");
  assert.equal(ranked[0].label, "High relevance");
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].rank, 2);
});
