import fs from "node:fs/promises";
import path from "node:path";
import { nowIso, safeJsonParse, shortId, clamp, toInt } from "./util.mjs";

export const STORE_VERSION = 1;

export const DEFAULT_SETTINGS = Object.freeze({
  market: "US",
  windowHours: 168,
  maxResults: 30,
  sourceGoogle: true,
  enrichInstagram: true,
  chromeProfile: "",
  chromePath: "",
  apifyEnabled: false,
  apifyToken: "",
  apifyActor: "omkar-cloud~instagram-scraper",
  apifyMaxPostsPerSource: 10,
  apifyMaxChargeUsd: 0.1,
  apifyCooldownSeconds: 120,
  defaultKeywords: "",
});

function freshStore() {
  const timestamp = nowIso();
  return {
    version: STORE_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: { ...DEFAULT_SETTINGS },
    runs: [],
    posts: {},
    cache: { decoded: {}, oembed: {} },
    sourceStatus: {
      google: { status: "idle", lastAt: null, message: "Not queried yet" },
      instagram: { status: "idle", lastAt: null, message: "Public oEmbed enrichment" },
      apify: { status: "idle", lastAt: null, message: "Optional connection" },
    },
    counters: { searches: 0, apifyRuns: 0, apifyItems: 0 },
  };
}

function normalizeSettings(input = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...input };
  const markets = new Set(["US", "CA", "GB"]);
  settings.market = markets.has(settings.market) ? settings.market : "US";
  settings.windowHours = [24, 48, 72, 168].includes(Number(settings.windowHours))
    ? Number(settings.windowHours)
    : 168;
  settings.maxResults = clamp(toInt(settings.maxResults, 30), 12, 60);
  settings.sourceGoogle = settings.sourceGoogle !== false;
  settings.chromeProfile = typeof settings.chromeProfile === "string" ? settings.chromeProfile.trim() : "";
  settings.chromePath = typeof settings.chromePath === "string" ? settings.chromePath.trim() : "";
  settings.enrichInstagram = settings.enrichInstagram !== false;
  settings.apifyEnabled = settings.apifyEnabled === true;
  settings.apifyToken = typeof settings.apifyToken === "string" ? settings.apifyToken.trim() : "";
  settings.apifyActor = /^[a-zA-Z0-9_-]+~[a-zA-Z0-9_-]+$/.test(settings.apifyActor)
    ? settings.apifyActor
    : DEFAULT_SETTINGS.apifyActor;
  settings.apifyMaxPostsPerSource = clamp(toInt(settings.apifyMaxPostsPerSource, 10), 3, 50);
  settings.apifyMaxChargeUsd = Math.round(clamp(settings.apifyMaxChargeUsd, 0.01, 1) * 100) / 100;
  settings.apifyCooldownSeconds = clamp(toInt(settings.apifyCooldownSeconds, 120), 30, 3600);
  settings.defaultKeywords = String(settings.defaultKeywords || "").slice(0, 400);
  return settings;
}

function normalizeStore(raw) {
  const base = freshStore();
  if (!raw || typeof raw !== "object") return base;
  return {
    ...base,
    ...raw,
    version: STORE_VERSION,
    settings: normalizeSettings(raw.settings),
    runs: Array.isArray(raw.runs) ? raw.runs.slice(0, 15) : [],
    posts: raw.posts && typeof raw.posts === "object" ? raw.posts : {},
    cache: {
      decoded: raw.cache?.decoded && typeof raw.cache.decoded === "object" ? raw.cache.decoded : {},
      oembed: raw.cache?.oembed && typeof raw.cache.oembed === "object" ? raw.cache.oembed : {},
    },
    sourceStatus: { ...base.sourceStatus, ...(raw.sourceStatus ?? {}) },
    counters: { ...base.counters, ...(raw.counters ?? {}) },
  };
}

export function publicSettings(settings) {
  const { apifyToken, ...safe } = settings;
  return {
    ...safe,
    apifyTokenSet: Boolean(apifyToken),
    apifyTokenHint: apifyToken
      ? `${apifyToken.slice(0, 12)}…${apifyToken.slice(-4)}`
      : null,
  };
}

export async function createStore({ dataDir }) {
  await fs.mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, "store.json");
  let state = freshStore();
  try {
    const raw = await fs.readFile(file, "utf8");
    state = normalizeStore(safeJsonParse(raw));
  } catch (error) {
    if (error.code !== "ENOENT") console.warn(`Could not read store: ${error.message}`);
  }

  let writeChain = Promise.resolve();

  async function save() {
    state.updatedAt = nowIso();
    const snapshot = JSON.stringify(state, null, 2);
    writeChain = writeChain.then(async () => {
      const temporary = `${file}.${process.pid}.${shortId()}.tmp`;
      await fs.writeFile(temporary, snapshot, "utf8");
      await fs.rename(temporary, file);
    });
    return writeChain;
  }

  function getSettings() {
    return state.settings;
  }

  async function updateSettings(patch = {}) {
    const next = { ...state.settings };
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) next[key] = value;
    }
    if (patch.apifyToken === "") next.apifyToken = "";
    state.settings = normalizeSettings(next);
    await save();
    return state.settings;
  }

  function addRun(run) {
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, 15);
    state.counters.searches += 1;
    state.updatedAt = nowIso();
  }

  function latestRun() {
    return state.runs[0] ?? null;
  }

  function getRun(id) {
    return state.runs.find((run) => run.id === id) ?? null;
  }

  function postState(shortcode) {
    return state.posts[shortcode] ?? {};
  }

  async function updatePost(shortcode, patch = {}) {
    if (!shortcode) return null;
    const previous = state.posts[shortcode] ?? {};
    const allowed = ["saved", "contacted", "hidden", "note"];
    const next = { ...previous };
    for (const key of allowed) {
      if (patch[key] !== undefined) next[key] = patch[key];
    }
    next.updatedAt = nowIso();
    next.firstSeenAt = previous.firstSeenAt ?? nowIso();
    state.posts[shortcode] = next;
    await save();
    return next;
  }

  function getCache(kind, key) {
    const bucket = state.cache[kind];
    if (!bucket) return null;
    const entry = bucket[key];
    if (!entry) return null;
    if (entry.expiresAt && new Date(entry.expiresAt).getTime() < Date.now()) {
      delete bucket[key];
      return null;
    }
    return entry.value;
  }

  function setCache(kind, key, value, ttlMs) {
    if (!state.cache[kind]) state.cache[kind] = {};
    state.cache[kind][key] = {
      value,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
    };
  }

  function pruneCache() {
    const now = Date.now();
    for (const bucket of Object.values(state.cache)) {
      for (const [key, entry] of Object.entries(bucket)) {
        if (entry?.expiresAt && new Date(entry.expiresAt).getTime() < now) delete bucket[key];
      }
    }
  }

  async function recordSource(name, status, message) {
    state.sourceStatus[name] = {
      status,
      message,
      lastAt: nowIso(),
    };
    await save();
  }

  async function recordApifyRun({ items, actor }) {
    state.counters.apifyRuns += 1;
    state.counters.apifyItems += items;
    state.sourceStatus.apify = {
      status: "ok",
      message: `${items} item${items === 1 ? "" : "s"} from ${actor}`,
      lastAt: nowIso(),
    };
    await save();
  }

  function stats() {
    return {
      searches: state.counters.searches,
      apifyRuns: state.counters.apifyRuns,
      apifyItems: state.counters.apifyItems,
      saved: Object.values(state.posts).filter((post) => post.saved).length,
      contacted: Object.values(state.posts).filter((post) => post.contacted).length,
    };
  }

  function latestRuns(limit = 8) {
    return state.runs.slice(0, limit).map((run) => ({
      id: run.id,
      keywords: run.keywords,
      query: run.query,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      status: run.status,
      stats: run.stats,
      windowHours: run.windowHours,
      market: run.market,
    }));
  }

  return {
    state,
    file,
    save,
    getSettings,
    updateSettings,
    addRun,
    latestRun,
    getRun,
    postState,
    updatePost,
    getCache,
    setCache,
    pruneCache,
    recordSource,
    recordApifyRun,
    stats,
    latestRuns,
  };
}
