import {
  canonicalInstagramUrl,
  fetchWithTimeout,
  hoursSince,
  instagramFormat,
  instagramShortcode,
  mapLimit,
  nowIso,
  shortId,
  unique,
} from "./util.mjs";
import { buildQueryPlan, mergeGoogleNewsItems, resolveGoogleNewsUrls, searchGoogleNews } from "./google-news.mjs";
import { fetchInstagramOEmbed } from "./instagram.mjs";
import { runApifySearch } from "./apify.mjs";
import { buildQueryProfile, parseKeywords, rankPosts, summarize } from "./scoring.mjs";

function normalizeUrl(value) {
  return canonicalInstagramUrl(value) ?? null;
}

function authorFromTitle(title = "") {
  const match = title.match(/^(.{2,80}?)\s*\(@([A-Za-z0-9._]+)\)/);
  if (!match) return { author: null, authorUrl: null };
  return {
    author: match[1].trim(),
    authorUrl: `https://www.instagram.com/${match[2]}/`,
  };
}

function thumbnailProxy(url) {
  return url ? `/api/media?u=${encodeURIComponent(url)}` : null;
}

async function buildGooglePosts(items, { settings, store, limit, onProgress }) {
  const selected = items.slice(0, Math.min(items.length, limit + 18));
  let enriched = 0;
  const posts = [];
  await mapLimit(selected, 4, async (item) => {
    const url = normalizeUrl(item.url);
    if (!url) return;
    const shortcode = instagramShortcode(url);
    let oembed = null;
    if (settings.enrichInstagram) {
      oembed = await fetchInstagramOEmbed(url, {
        cacheGet: store.getCache,
        setCache: store.setCache,
      });
      if (oembed?.ok) enriched += 1;
    }
    const fromTitle = authorFromTitle(item.rawTitle ?? item.title);
    const caption = oembed?.caption || item.title || "Public Instagram post";
    posts.push({
      id: shortcode,
      shortcode,
      url,
      format: instagramFormat(url),
      caption,
      author: oembed?.author ?? fromTitle.author,
      authorUrl: oembed?.authorUrl ?? fromTitle.authorUrl,
      postedAt: null,
      indexedAt: item.indexedAt,
      source: "google-news",
      sourceLabel: "Google News index",
      sources: ["google-news"],
      metrics: null,
      thumbnailUrl: thumbnailProxy(oembed?.thumbnailUrl),
      thumbnailRemote: oembed?.thumbnailUrl ?? null,
      enrichment: oembed?.ok ? "instagram-oembed" : "google-title",
      matchedKeywords: item.matchedKeywords ?? [],
      formatLabel: instagramFormat(url),
      privateOrRestricted: oembed?.ok === false,
    });
  });
  onProgress?.({ stage: "enrich", enriched, total: selected.length });
  return posts;
}

function mergePosts(posts) {
  const byShortcode = new Map();
  for (const post of posts) {
    const canonical = normalizeUrl(post.url);
    if (!canonical) continue;
    const key = instagramShortcode(canonical);
    if (!key) continue;
    const normalized = { ...post, url: canonical, shortcode: key };
    const existing = byShortcode.get(key);
    if (!existing) {
      byShortcode.set(key, {
        ...normalized,
        sources: unique(normalized.sources ?? [normalized.source]),
        matchedKeywords: unique(normalized.matchedKeywords ?? []),
      });
      continue;
    }
    const preferApify = normalized.source === "apify";
    const merged = {
      ...existing,
      caption:
        (preferApify && normalized.caption) ||
        (normalized.caption.length > existing.caption.length ? normalized.caption : existing.caption),
      author: existing.author || normalized.author,
      authorUrl: existing.authorUrl || normalized.authorUrl,
      postedAt: existing.postedAt || normalized.postedAt,
      indexedAt: existing.indexedAt || normalized.indexedAt,
      metrics: existing.metrics?.likes || existing.metrics?.comments
        ? existing.metrics
        : normalized.metrics || existing.metrics,
      thumbnailUrl: existing.thumbnailUrl || normalized.thumbnailUrl,
      thumbnailRemote: existing.thumbnailRemote || normalized.thumbnailRemote,
      enrichment: preferApify ? "apify" : existing.enrichment,
      format: normalized.format || existing.format,
      sources: unique([...(existing.sources ?? []), normalized.source]),
      matchedKeywords: unique([
        ...(existing.matchedKeywords ?? []),
        ...(normalized.matchedKeywords ?? []),
      ]),
    };
    merged.source = merged.sources.length > 1 ? "merged" : merged.sources[0];
    merged.sourceLabel =
      merged.sources.length > 1
        ? "Google News + Apify"
        : merged.source === "apify"
          ? "Apify Instagram actor"
          : "Google News index";
    byShortcode.set(key, merged);
  }
  return [...byShortcode.values()];
}

function trimRunForStorage(run) {
  return { ...run, results: run.results.slice(0, 60) };
}

export async function runSearch({ store, input = {}, onProgress }) {
  const settings = store.getSettings();
  const keywords = parseKeywords(input.keywords ?? input.query ?? settings.defaultKeywords);
  if (!keywords.length) {
    const error = new Error("Enter at least one keyword or phrase.");
    error.statusCode = 400;
    throw error;
  }

  const startedAt = nowIso();
  const startedMs = Date.now();
  const windowHours = [24, 48, 72, 168].includes(Number(input.windowHours))
    ? Number(input.windowHours)
    : settings.windowHours;
  const market = ["US", "CA", "GB"].includes(input.market) ? input.market : settings.market;
  const limit = Math.max(12, Math.min(Number(input.limit) || settings.maxResults, 60));
  const useGoogle = input.useGoogle === undefined ? settings.sourceGoogle : Boolean(input.useGoogle);
  const useApify = input.useApify === undefined ? settings.apifyEnabled : Boolean(input.useApify);
  if (!useGoogle && !useApify) {
    const error = new Error("Enable at least one source before searching.");
    error.statusCode = 400;
    throw error;
  }
  if (useApify && !settings.apifyToken) {
    const error = new Error("Add an Apify token in Settings, or turn off the Apify source.");
    error.statusCode = 400;
    throw error;
  }

  const profile = buildQueryProfile(keywords);
  const queryPlan = useGoogle ? buildQueryPlan(keywords, { windowHours }) : [];
  const warnings = [];
  const apifyInfo = {
    requested: useApify,
    ok: false,
    items: 0,
    rawCount: 0,
    error: null,
    runId: null,
    capUsd: settings.apifyMaxChargeUsd,
  };

  const apifyPromise =
    useApify && settings.apifyToken
      ? (async () => {
          const last = store.state.sourceStatus.apify;
          const lastAt = last?.lastAt ? new Date(last.lastAt).getTime() : 0;
          if (lastAt && Date.now() - lastAt < settings.apifyCooldownSeconds * 1000) {
            apifyInfo.error = `Cooling down for ${settings.apifyCooldownSeconds}s to prevent duplicate spend.`;
            return [];
          }
          try {
            const result = await runApifySearch({
              token: settings.apifyToken,
              actor: settings.apifyActor,
              keywords,
              limit: settings.apifyMaxPostsPerSource,
              maxChargeUsd: settings.apifyMaxChargeUsd,
              onProgress,
            });
            apifyInfo.ok = true;
            apifyInfo.runId = result.runId;
            apifyInfo.rawCount = result.rawCount;
            apifyInfo.items = result.items.length;
            await store.recordApifyRun({ items: result.items.length, actor: result.actor });
            const cutoff = windowHours * 1.5;
            return result.items.filter(
              (item) => !item.postedAt || hoursSince(item.postedAt) <= cutoff,
            );
          } catch (error) {
            apifyInfo.error = error.message;
            warnings.push(`Apify: ${error.message}`);
            await store.recordSource("apify", "error", error.message);
            return [];
          }
        })()
      : Promise.resolve([]);

  let googleItems = [];
  let queryStats = [];
  const googleStarted = Date.now();
  if (useGoogle) {
    const google = await searchGoogleNews(queryPlan, {
      market,
      limitPerQuery: 10,
      onProgress,
    });
    googleItems = mergeGoogleNewsItems(google.items);
    queryStats = google.queryStats;
    warnings.push(...google.errors);
    if (!google.items.length) {
      warnings.push("Google returned no indexed Instagram items for this window. Try broader keywords or 7 days.");
    }
  }
  const googleMs = Date.now() - googleStarted;

  const preRanked = rankPosts(
    googleItems.map((item) => ({
      ...item,
      caption: item.title,
      postedAt: null,
      indexedAt: item.indexedAt,
      metrics: null,
    })),
    { keywords, profile, windowHours, now: Date.now() },
  ).slice(0, Math.min(googleItems.length, limit + 24));

  const resolveStarted = Date.now();
  const resolvedItems = preRanked.length
    ? await resolveGoogleNewsUrls(preRanked, {
        cacheGet: store.getCache,
        setCache: store.setCache,
        concurrency: 5,
        onProgress,
      })
    : [];
  const resolveMs = Date.now() - resolveStarted;

  const enrichStarted = Date.now();
  const googlePosts = await buildGooglePosts(resolvedItems, {
    settings,
    store,
    limit,
    onProgress,
  });
  const enrichMs = Date.now() - enrichStarted;

  const apifyPosts = await apifyPromise;
  if (apifyInfo.requested && apifyInfo.ok && apifyPosts.length === 0) {
    warnings.push("Apify ran successfully but returned nothing inside the selected time window.");
  }

  const merged = mergePosts([...googlePosts, ...apifyPosts]);
  const freshnessCutoff = windowHours + 12;
  const inWindow = merged.filter(
    (post) => hoursSince(post.postedAt || post.indexedAt) <= freshnessCutoff,
  );
  if (merged.length > inWindow.length) {
    warnings.push(
      `Filtered ${merged.length - inWindow.length} older item${merged.length - inWindow.length === 1 ? "" : "s"} from the selected sources.`,
    );
  }
  const ranked = rankPosts(inWindow, {
    keywords,
    profile,
    windowHours,
    now: Date.now(),
  }).slice(0, limit);

  if (!ranked.length) {
    warnings.push("No public posts survived link resolution. They may have been removed or made private.");
  }

  const stats = summarize(ranked, windowHours);
  const status = ranked.length ? (warnings.length ? "partial" : "ok") : "empty";
  const run = {
    id: `run_${Date.now()}_${shortId(6)}`,
    keywords,
    query: keywords.join(" · "),
    startedAt,
    completedAt: nowIso(),
    status,
    market,
    windowHours,
    limit,
    stats,
    results: ranked,
    queries: queryStats,
    warnings: unique(warnings),
    apify: apifyInfo,
    timing: {
      totalMs: Date.now() - startedMs,
      googleMs,
      resolveMs,
      enrichMs,
    },
    sources: {
      google: googlePosts.length,
      apify: apifyPosts.length,
      rawGoogle: googleItems.length,
    },
  };

  store.addRun(trimRunForStorage(run));
  if (useGoogle) {
    await store.recordSource(
      "google",
      googlePosts.length ? "ok" : "empty",
      googlePosts.length
        ? `${googlePosts.length} post${googlePosts.length === 1 ? "" : "s"} across ${queryStats.filter((q) => q.status === "ok").length} queries`
        : "No usable Instagram links returned",
    );
  }
  if (settings.enrichInstagram && googlePosts.length) {
    await store.recordSource("instagram", "ok", "Public oEmbed captions and previews requested");
  }
  await store.save();
  return run;
}

export async function fetchMediaBuffer(url) {
  const response = await fetchWithTimeout(
    url,
    {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        referer: "https://www.instagram.com/",
      },
    },
    20_000,
  );
  if (!response.ok) {
    const error = new Error(`Media fetch returned HTTP ${response.status}`);
    error.statusCode = response.status === 404 ? 404 : 502;
    throw error;
  }
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    const error = new Error("Remote resource is not an image.");
    error.statusCode = 415;
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > 12 * 1024 * 1024) {
    const error = new Error("Remote image is larger than 12 MB.");
    error.statusCode = 413;
    throw error;
  }
  return { buffer, contentType };
}
