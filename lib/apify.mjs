import {
  asNumber,
  canonicalInstagramUrl,
  fetchWithTimeout,
  instagramFormat,
  instagramShortcode,
  normalizeCaption,
  pickFirst,
  sleep,
} from "./util.mjs";

const API_ROOT = "https://api.apify.com/v2";

function parseTimestamp(item) {
  const candidates = [
    item.timestamp,
    item.takenAt,
    item.taken_at,
    item.taken_at_timestamp,
    item.createdAt,
    item.date,
  ];
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    if (typeof candidate === "number" || /^\d+$/.test(String(candidate))) {
      const number = Number(candidate);
      const milliseconds = number > 10_000_000_000 ? number : number * 1000;
      const date = new Date(milliseconds);
      if (Number.isFinite(date.getTime())) return date.toISOString();
    }
    const date = new Date(candidate);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return null;
}

function extractUrl(item) {
  const direct = pickFirst(item, ["url", "postUrl", "permalink", "link"]);
  if (direct) {
    const canonical = canonicalInstagramUrl(direct);
    if (canonical) return canonical;
  }
  const shortcode = pickFirst(item, ["shortCode", "shortcode", "code"]);
  if (shortcode) return `https://www.instagram.com/p/${shortcode}/`;
  return null;
}

function extractAuthor(item) {
  return (
    pickFirst(item, ["ownerUsername", "username", "author", "ownerUserName"]) ??
    item.owner?.username ??
    item.user?.username ??
    null
  );
}

function extractCaption(item) {
  return normalizeCaption(
    pickFirst(item, ["caption", "text", "description", "edge_media_to_caption"]) ?? "",
  );
}

function extractMetrics(item) {
  const likes = asNumber(
    pickFirst(item, ["likesCount", "likeCount", "likes", "edge_liked_by"]),
    null,
  );
  const comments = asNumber(
    pickFirst(item, ["commentsCount", "commentCount", "comments"]),
    null,
  );
  const views = asNumber(
    pickFirst(item, [
      "videoViewCount",
      "videoPlayCount",
      "playCount",
      "viewCount",
      "views",
    ]),
    null,
  );
  const shares = asNumber(pickFirst(item, ["reshareCount", "shareCount"]), null);
  if ([likes, comments, views, shares].every((value) => value === null)) return null;
  return { likes, comments, views, shares };
}

function extractThumbnail(item) {
  return (
    pickFirst(item, ["displayUrl", "thumbnailUrl", "thumbnail", "imageUrl", "previewUrl"]) ??
    item.images?.[0] ??
    item.childPosts?.[0]?.displayUrl ??
    null
  );
}

export function normalizeApifyItem(item, context = {}) {
  const url = extractUrl(item);
  if (!url) return null;
  const shortcode = instagramShortcode(url);
  const timestamp = parseTimestamp(item);
  const caption = extractCaption(item);
  const author = extractAuthor(item);
  return {
    id: shortcode,
    shortcode,
    url,
    format: instagramFormat(url),
    caption,
    author,
    authorUrl: author ? `https://www.instagram.com/${author}/` : null,
    postedAt: timestamp,
    indexedAt: timestamp,
    source: "apify",
    sourceLabel: "Apify Instagram actor",
    metrics: extractMetrics(item),
    thumbnailUrl: extractThumbnail(item),
    locationName: pickFirst(item, ["locationName", "location"]),
    enrichment: "apify",
    matchedQueries: context.queryLabel ? [context.queryLabel] : ["Apify"],
    matchedKeywords: context.keywords ?? [],
    raw: undefined,
  };
}

async function apifyRequest(path, { token, method = "GET", body, timeoutMs = 30_000 } = {}) {
  if (!token) throw new Error("Apify token is not configured.");
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetchWithTimeout(
    `${API_ROOT}${path}${separator}token=${encodeURIComponent(token)}`,
    {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
    timeoutMs,
  );
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    const message =
      data?.error?.message ?? data?.message ?? `Apify returned HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function testApifyToken(token) {
  const data = await apifyRequest("/users/me", { token, timeoutMs: 15_000 });
  const user = data?.data ?? data;
  return {
    ok: true,
    username: user?.username ?? null,
    plan: user?.plan?.id ?? user?.plan ?? "free",
    email: user?.email ?? null,
  };
}

function actorInput(actor, { keywords, limit }) {
  if (actor.includes("datamagnet")) {
    return { search_query: keywords.join(" OR "), max_results: Math.max(limit, 10) };
  }
  return {
    searchQueries: keywords.slice(0, 5),
    hashtags: [],
    maxPostsPerSource: limit,
  };
}

export async function runApifySearch({
  token,
  actor = "omkar-cloud~instagram-scraper",
  keywords = [],
  limit = 10,
  maxChargeUsd = 0.1,
  timeoutSec = 180,
  onProgress,
}) {
  if (!token) throw new Error("Apify token is not configured.");
  if (!keywords.length) throw new Error("Keywords are required.");
  const body = actorInput(actor, { keywords, limit });
  const start = await apifyRequest(
    `/acts/${encodeURIComponent(actor)}/runs` +
      `?maxTotalChargeUsd=${encodeURIComponent(maxChargeUsd)}` +
      `&timeout=${encodeURIComponent(timeoutSec)}` +
      `&memory=1024`,
    { token, method: "POST", body, timeoutMs: 30_000 },
  );
  const run = start?.data;
  if (!run?.id) throw new Error("Apify did not return a run id.");
  onProgress?.({ stage: "apify", status: "started", runId: run.id });
  const deadline = Date.now() + Math.min(timeoutSec + 15, 220) * 1000;
  let current = run;
  while (Date.now() < deadline) {
    if (["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"].includes(current.status)) break;
    await sleep(2500);
    const status = await apifyRequest(`/actor-runs/${encodeURIComponent(run.id)}`, {
      token,
      timeoutMs: 20_000,
    });
    current = status?.data ?? current;
    onProgress?.({ stage: "apify", status: current.status, runId: run.id });
  }
  if (current.status !== "SUCCEEDED") {
    throw new Error(`Apify run ended with status ${current.status ?? "UNKNOWN"}.`);
  }
  const datasetId = current.defaultDatasetId;
  if (!datasetId) throw new Error("Apify run has no default dataset.");
  const items = await apifyRequest(
    `/datasets/${encodeURIComponent(datasetId)}/items?clean=true&limit=${encodeURIComponent(Math.min(limit * 4, 200))}`,
    { token, timeoutMs: 30_000 },
  );
  const rows = Array.isArray(items) ? items : (items?.items ?? []);
  const normalized = rows
    .map((item) => normalizeApifyItem(item, { keywords }))
    .filter(Boolean);
  onProgress?.({ stage: "apify", status: "done", runId: run.id, count: normalized.length });
  return {
    items: normalized,
    runId: run.id,
    datasetId,
    actor,
    rawCount: rows.length,
  };
}
