import {
  canonicalInstagramUrl,
  cleanText,
  decodeHtmlEntities,
  fetchWithTimeout,
  instagramFormat,
  mapLimit,
  normalizeCaption,
  sleep,
  unique,
} from "./util.mjs";
import { parseKeywords } from "./scoring.mjs";

const MARKETS = {
  US: { hl: "en-US", gl: "US", ceid: "US:en" },
  CA: { hl: "en-CA", gl: "CA", ceid: "CA:en" },
  GB: { hl: "en-GB", gl: "GB", ceid: "GB:en" },
};

const BATCHEXECUTE_URL = "https://news.google.com/_/DotsSplashUi/data/batchexecute";
const QUERY_CACHE = new Map();
const QUERY_CACHE_TTL_MS = 10 * 60 * 1000;
const GARTURLREQ_CONTEXT = [
  ["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1],
  "X",
  "X",
  1,
  [1, 1, 1],
  1,
  1,
  null,
  0,
  0,
  null,
  0,
];

export function buildQueryPlan(keywords, { windowHours = 168 } = {}) {
  const phrases = parseKeywords(keywords);
  if (!phrases.length) return [];
  const days = Math.max(1, Math.ceil(Number(windowHours) / 24));
  const queries = [];

  const add = (id, label, q, keyword = null) => {
    const normalized = q.replace(/\s+/g, " ").trim();
    if (!queries.some((entry) => entry.q === normalized)) {
      queries.push({ id, label, q: normalized, keyword });
    }
  };

  for (const keyword of phrases.slice(0, 5)) {
    add(
      `exact-${queries.length + 1}`,
      `Exact: ${keyword}`,
      `site:instagram.com "${keyword}" when:${days}d`,
      keyword,
    );
  }

  const orTerms = phrases.map((keyword) => `"${keyword}"`).join(" OR ");
  if (phrases.length > 1) {
    add(
      "combined",
      "All keywords together",
      `site:instagram.com (${orTerms}) when:${days}d`,
    );
  }

  add(
    "questions",
    "Questions and advice",
    `site:instagram.com (${orTerms}) (question OR advice OR how OR what OR help) when:${days}d`,
  );

  if (windowHours >= 48) {
    add(
      "fresh",
      "Fresh results",
      `site:instagram.com (${orTerms}) when:1d`,
    );
  }

  return queries.slice(0, 8);
}

export function extractArticleId(googleUrl) {
  try {
    const url = new URL(googleUrl);
    const parts = url.pathname.split("/").filter(Boolean);
    const articlesIndex = parts.lastIndexOf("articles");
    const readIndex = parts.lastIndexOf("read");
    const index = Math.max(articlesIndex, readIndex);
    if (index >= 0 && parts[index + 1]) return parts[index + 1];
    return null;
  } catch {
    return null;
  }
}

export function parseGoogleNewsRss(xml, { query, market = "US", limit = 12 } = {}) {
  const items = [];
  const blocks = String(xml).match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks.slice(0, limit)) {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const dateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const googleUrl = cleanText(linkMatch?.[1] ?? "");
    const rawTitle = cleanText(titleMatch?.[1] ?? "");
    if (!googleUrl || !rawTitle) continue;
    const articleId = extractArticleId(googleUrl);
    if (!articleId) continue;
    const publishedAt = dateMatch ? new Date(cleanText(dateMatch[1])) : null;
    items.push({
      articleId,
      googleUrl,
      rawTitle,
      title: normalizeCaption(rawTitle),
      sourceName: cleanText(sourceMatch?.[1] ?? "Instagram"),
      indexedAt:
        publishedAt && Number.isFinite(publishedAt.getTime())
          ? publishedAt.toISOString()
          : null,
      queryId: query?.id ?? "manual",
      queryLabel: query?.label ?? "Search",
      queryKeyword: query?.keyword ?? null,
      queryText: query?.q ?? "",
      market,
    });
  }
  return items;
}

async function fetchGoogleNewsQuery(query, { market, limit }) {
  const locale = MARKETS[market] ?? MARKETS.US;
  const url =
    "https://news.google.com/rss/search?" +
    new URLSearchParams({
      q: query.q,
      hl: locale.hl,
      gl: locale.gl,
      ceid: locale.ceid,
    }).toString();
  const cacheKey = `${market}:${limit}:${query.q}`;
  const cached = QUERY_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchWithTimeout(
      url,
      { headers: { accept: "application/rss+xml, application/xml, text/xml" } },
      20_000,
    );
    if (response.status === 429 && attempt === 0) {
      await sleep(2200);
      continue;
    }
    if (!response.ok) throw new Error(`Google News returned HTTP ${response.status}`);
    const xml = await response.text();
    const items = parseGoogleNewsRss(xml, { query, market, limit });
    if (items.length) {
      QUERY_CACHE.set(cacheKey, { items, expiresAt: Date.now() + QUERY_CACHE_TTL_MS });
    }
    return items;
  }
  throw new Error("Google News is rate-limiting requests. Try again in a minute.");
}

export async function searchGoogleNews(plan, { market = "US", limitPerQuery = 10, onProgress } = {}) {
  const queryStats = [];
  const all = [];
  const errors = [];
  await mapLimit(plan, 1, async (query, index) => {
    const started = Date.now();
    try {
      const items = await fetchGoogleNewsQuery(query, { market, limit: limitPerQuery });
      queryStats.push({
        id: query.id,
        label: query.label,
        q: query.q,
        count: items.length,
        ms: Date.now() - started,
        status: "ok",
      });
      all.push(...items);
      onProgress?.({ stage: "google", index: index + 1, total: plan.length, query: query.label, count: items.length });
    } catch (error) {
      errors.push(`${query.label}: ${error.message}`);
      queryStats.push({
        id: query.id,
        label: query.label,
        q: query.q,
        count: 0,
        ms: Date.now() - started,
        status: "error",
        error: error.message,
      });
      onProgress?.({ stage: "google", index: index + 1, total: plan.length, query: query.label, count: 0 });
    }
    await sleep(450);
  });
  return { items: all, queryStats, errors };
}

async function fetchSignature(articleId) {
  const pageUrl =
    `https://news.google.com/rss/articles/${encodeURIComponent(articleId)}` +
    "?hl=en-US&gl=US&ceid=US:en";
  const response = await fetchWithTimeout(pageUrl, { headers: { accept: "text/html" } }, 20_000);
  if (!response.ok) throw new Error(`Article page HTTP ${response.status}`);
  const html = await response.text();
  const signature = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const timestamp = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!signature || !timestamp) throw new Error("Google News signature not found");
  return { signature, timestamp };
}

function buildBatchexecuteBody(entries) {
  const envelopes = entries.map((entry, index) => {
    const inner = [
      "garturlreq",
      GARTURLREQ_CONTEXT,
      entry.articleId,
      Number(entry.timestamp),
      entry.signature,
    ];
    return ["Fbv4je", JSON.stringify(inner), null, String(index)];
  });
  return `f.req=${encodeURIComponent(JSON.stringify([envelopes]))}`;
}

export function parseBatchexecuteResponse(text) {
  let body = String(text ?? "");
  if (body.startsWith(")]}'")) {
    const newline = body.indexOf("\n");
    body = newline >= 0 ? body.slice(newline + 1) : body.slice(4);
  }
  body = body.trim();
  if (!body) return [];
  let rows;
  try {
    rows = JSON.parse(body);
  } catch {
    return [];
  }
  const pairs = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    if (row[0] !== "wrb.fr" || row[1] !== "Fbv4je") continue;
    let payload = row[2];
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(payload) || payload[0] !== "garturlres") continue;
    const url = canonicalInstagramUrl(payload[1]);
    if (!url) continue;
    let requestId = null;
    for (const cell of row.slice(3).reverse()) {
      if (cell !== null && cell !== undefined) {
        requestId = String(cell);
        break;
      }
    }
    pairs.push({ requestId, url });
  }
  return pairs;
}

async function decodeBatch(entries, articleIds) {
  const response = await fetchWithTimeout(
    BATCHEXECUTE_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        accept: "application/json, text/plain, */*",
      },
      body: buildBatchexecuteBody(entries),
    },
    25_000,
  );
  if (!response.ok) throw new Error(`Google News decoder HTTP ${response.status}`);
  const text = await response.text();
  const pairs = parseBatchexecuteResponse(text);
  const byRequest = new Map(pairs.filter((pair) => pair.requestId !== null).map((pair) => [pair.requestId, pair.url]));
  const decoded = new Map();
  for (let index = 0; index < entries.length; index += 1) {
    const articleId = articleIds[index];
    const url = byRequest.get(String(index)) ?? pairs[index]?.url ?? null;
    if (url) decoded.set(articleId, url);
  }
  return decoded;
}

export async function resolveGoogleNewsUrls(
  items,
  { cacheGet, setCache, concurrency = 5, onProgress } = {},
) {
  const uniqueItems = [];
  const seen = new Set();
  for (const item of items) {
    if (!item.articleId || seen.has(item.articleId)) continue;
    seen.add(item.articleId);
    uniqueItems.push(item);
  }

  const result = new Map();
  const pending = [];
  for (const item of uniqueItems) {
    const cached = cacheGet?.("decoded", item.articleId);
    if (cached) result.set(item.articleId, cached);
    else pending.push(item);
  }

  const signatures = new Map();
  await mapLimit(pending, concurrency, async (item, index) => {
    try {
      const signature = await fetchSignature(item.articleId);
      signatures.set(item.articleId, signature);
    } catch {
      // A dead or malformed index entry should not fail the whole search.
    }
    if ((index + 1) % 5 === 0) {
      onProgress?.({ stage: "resolve", done: index + 1, total: pending.length });
    }
  });

  const ready = pending.filter((item) => signatures.has(item.articleId));
  for (let offset = 0; offset < ready.length; offset += 20) {
    const chunk = ready.slice(offset, offset + 20);
    const entries = chunk.map((item) => ({
      articleId: item.articleId,
      ...signatures.get(item.articleId),
    }));
    try {
      const decoded = await decodeBatch(entries, chunk.map((item) => item.articleId));
      for (const [articleId, url] of decoded) {
        result.set(articleId, url);
        setCache?.("decoded", articleId, url, 1000 * 60 * 60 * 24 * 30);
      }
    } catch {
      // Keep the Google News caption even when the destination cannot be resolved.
    }
    onProgress?.({ stage: "resolve", done: Math.min(offset + 20, ready.length), total: pending.length });
    if (offset + 20 < ready.length) await sleep(180);
  }

  const resolved = [];
  for (const item of items) {
    const url = result.get(item.articleId);
    if (!url) continue;
    resolved.push({
      ...item,
      url,
      format: instagramFormat(url),
      source: "google-news",
      sourceLabel: "Google News index",
      indexedAt: item.indexedAt,
    });
  }
  onProgress?.({ stage: "resolve-complete", resolved: resolved.length, candidates: items.length });
  return resolved;
}

export function mergeGoogleNewsItems(items) {
  const byArticle = new Map();
  for (const item of items) {
    const previous = byArticle.get(item.articleId);
    if (!previous) {
      byArticle.set(item.articleId, {
        ...item,
        matchedKeywords: item.queryKeyword ? [item.queryKeyword] : [item.queryLabel],
      });
      continue;
    }
    previous.matchedKeywords = unique([
      ...previous.matchedKeywords,
      item.queryKeyword ?? item.queryLabel,
    ]);
    if (!previous.indexedAt && item.indexedAt) previous.indexedAt = item.indexedAt;
    if (item.title.length > previous.title.length) previous.title = item.title;
  }
  return [...byArticle.values()];
}

export const GOOGLE_QUERY_MARKETS = Object.keys(MARKETS);
