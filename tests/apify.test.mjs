import test from "node:test";
import assert from "node:assert/strict";
import { normalizeApifyItem } from "../lib/apify.mjs";

test("normalizeApifyItem maps common actor fields", () => {
  const post = normalizeApifyItem({
    url: "https://www.instagram.com/reel/DfugESJlkH9/",
    caption: "Cold brew coffee at home: any ratio advice?",
    ownerUsername: "coffee_account",
    timestamp: "2026-11-16T02:15:00.000Z",
    likesCount: 281,
    commentsCount: 44,
    videoViewCount: 12000,
    displayUrl: "https://scontent.cdninstagram.com/example.jpg",
  });
  assert.equal(post.shortcode, "DfugESJlkH9");
  assert.equal(post.author, "coffee_account");
  assert.equal(post.metrics.likes, 281);
  assert.equal(post.metrics.comments, 44);
  assert.equal(post.metrics.views, 12000);
  assert.equal(post.postedAt, "2026-11-16T02:15:00.000Z");
  assert.equal(post.format, "Reel");
});

test("normalizeApifyItem rejects rows without a post URL", () => {
  assert.equal(normalizeApifyItem({ caption: "No URL here" }), null);
});

test("normalizeApifyItem accepts unix seconds and shortcodes", () => {
  const post = normalizeApifyItem({
    shortCode: "ABC123xyz",
    timestamp: 1763260000,
    commentsCount: 2,
  });
  assert.equal(post.url, "https://www.instagram.com/p/ABC123xyz/");
  assert.equal(Number.isFinite(new Date(post.postedAt).getTime()), true);
  assert.equal(post.metrics.comments, 2);
});
