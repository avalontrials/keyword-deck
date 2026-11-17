import test from "node:test";
import assert from "node:assert/strict";

import { parseInstagramLinks, searchUrl } from "../lib/chrome-google.mjs";

test("reads direct Instagram post links", () => {
  const links = parseInstagramLinks([
    "https://www.instagram.com/p/ABC123/",
    "https://instagram.com/reel/XYZ789/?igsh=1",
    "https://example.com/not-a-post",
  ]);
  assert.deepEqual(links, [
    "https://www.instagram.com/p/ABC123/",
    "https://www.instagram.com/reel/XYZ789/",
  ]);
});

test("reads Google's wrapped /url?q= links", () => {
  const wrapped =
    "/url?q=" + encodeURIComponent("https://www.instagram.com/p/DEF456/?hl=en") + "&sa=U";
  const links = parseInstagramLinks([wrapped]);
  assert.deepEqual(links, ["https://www.instagram.com/p/DEF456/"]);
});

test("drops profile and hashtag links", () => {
  const links = parseInstagramLinks([
    "https://www.instagram.com/someone/",
    "https://www.instagram.com/explore/tags/fsbo/",
  ]);
  assert.deepEqual(links, []);
});

test("builds the exact query a person would type", () => {
  const url = searchUrl("selling our house without a realtor", { windowHours: 24 });
  assert.match(url, /site%3Ainstagram\.com/);
  assert.match(url, /selling\+our\+house\+without\+a\+realtor/);
  assert.match(url, /qdr%3Ad/);
  assert.match(url, /sbd%3A1/);
});
