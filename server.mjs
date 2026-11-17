import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { APP_NAME, APP_VERSION, nowIso, pathInside, safeJsonParse, sha1 } from "./lib/util.mjs";
import { createStore, publicSettings } from "./lib/store.mjs";
import { runSearch, fetchMediaBuffer } from "./lib/search.mjs";
import { isAllowedImageHost } from "./lib/instagram.mjs";
import { testApifyToken } from "./lib/apify.mjs";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = process.env.SIGNAL_DATA_DIR
  ? path.resolve(process.env.SIGNAL_DATA_DIR)
  : path.join(ROOT, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media-cache");
const PORT = Number(process.env.SIGNAL_PORT || process.env.PORT || 4318);
const HOST = "127.0.0.1";
const APP_TOKEN = crypto.randomBytes(24).toString("hex");
const MAX_BODY = 96 * 1024;

const MARKETS = {
  US: "United States",
  CA: "Canada",
  GB: "United Kingdom",
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json; charset=utf-8",
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
].join("; ");

function securityHeaders(contentType) {
  return {
    "content-type": contentType,
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": CONTENT_SECURITY_POLICY,
    "permissions-policy": "camera=(), microphone=(), geolocation=()",
  };
}

function sendJson(response, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    ...securityHeaders("application/json; charset=utf-8"),
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  response.end(body);
}

function sendText(response, status, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    ...securityHeaders(contentType),
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  response.end(body);
}

async function readJsonBody(request) {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY) {
      const error = new Error("Request body is too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const parsed = safeJsonParse(Buffer.concat(chunks).toString("utf8"), null);
  if (parsed === null || typeof parsed !== "object") {
    const error = new Error("Request body must be a JSON object.");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

function authorized(request) {
  return request.headers["x-signal-token"] === APP_TOKEN;
}

function validOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return (
      (url.hostname === "127.0.0.1" || url.hostname === "localhost") &&
      Number(url.port || 80) === PORT
    );
  } catch {
    return false;
  }
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

const EXTERNAL_HOSTS = new Set([
  "reddit.com",
  "www.reddit.com",
  "old.reddit.com",
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "threads.com",
  "www.threads.com",
  "linkedin.com",
  "www.linkedin.com",
  "youtube.com",
  "www.youtube.com",
]);

function isAllowedExternalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && EXTERNAL_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function runToCsv(run) {
  const headers = [
    "rank",
    "relevance_score",
    "relevance",
    "keywords",
    "author",
    "format",
    "posted_at",
    "indexed_at",
    "url",
    "source",
    "likes",
    "comments",
    "views",
    "signals",
    "caption",
  ];
  const rows = [headers.join(",")];
  for (const post of run.results) {
    rows.push(
      [
        post.rank,
        post.score,
        post.label,
        (post.matchedKeywords ?? []).join(" | "),
        post.author ?? "",
        post.format ?? "",
        post.postedAt ?? "",
        post.indexedAt ?? "",
        post.url,
        post.sourceLabel ?? post.source,
        post.metrics?.likes ?? "",
        post.metrics?.comments ?? "",
        post.metrics?.views ?? "",
        (post.reasons ?? []).join(" | "),
        post.caption ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `\uFEFF${rows.join("\r\n")}\r\n`;
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(PUBLIC_DIR, relative);
  if (!pathInside(PUBLIC_DIR, filePath)) {
    sendText(response, 403, "Forbidden");
    return;
  }
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) throw new Error("not a file");
    let body = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    if (relative === "index.html") {
      body = Buffer.from(
        body.toString("utf8").replaceAll("__SIGNAL_TOKEN__", APP_TOKEN),
        "utf8",
      );
    }
    response.writeHead(200, {
      ...securityHeaders(MIME[extension] ?? "application/octet-stream"),
      "cache-control": relative === "index.html" ? "no-store" : "public, max-age=3600",
      "content-length": body.length,
    });
    response.end(body);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function serveMedia(request, response, url) {
  const remote = url.searchParams.get("u");
  if (!remote) {
    sendText(response, 400, "Missing media URL");
    return;
  }
  let parsed;
  try {
    parsed = new URL(remote);
  } catch {
    sendText(response, 400, "Invalid media URL");
    return;
  }
  if (parsed.protocol !== "https:" || !isAllowedImageHost(parsed.hostname)) {
    sendText(response, 403, "Media host not allowed");
    return;
  }
  const extensionFromType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/gif": "gif",
  };
  const key = sha1(parsed.toString());
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  const existing = (await fs.readdir(MEDIA_DIR)).find((name) => name.startsWith(`${key}.`));
  if (existing) {
    const body = await fs.readFile(path.join(MEDIA_DIR, existing));
    const extension = path.extname(existing).slice(1);
    const type = extension === "jpg" ? "image/jpeg" : `image/${extension}`;
    response.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "cache-control": "public, max-age=604800",
      "x-content-type-options": "nosniff",
    });
    response.end(body);
    return;
  }
  try {
    const { buffer, contentType } = await fetchMediaBuffer(parsed.toString());
    const extension = extensionFromType[contentType.split(";")[0]] ?? "jpg";
    await fs.writeFile(path.join(MEDIA_DIR, `${key}.${extension}`), buffer);
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": buffer.length,
      "cache-control": "public, max-age=604800",
      "x-content-type-options": "nosniff",
    });
    response.end(buffer);
  } catch (error) {
    sendText(response, error.statusCode ?? 502, "Image unavailable");
  }
}

async function main() {
  const store = await createStore({ dataDir: DATA_DIR });
  store.pruneCache();
  await fs.mkdir(MEDIA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, "server.pid"), String(process.pid), "utf8");

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? `${HOST}:${PORT}`}`);
    const pathname = decodeURIComponent(url.pathname);

    if (request.method === "GET" && pathname === "/api/health") {
      sendJson(response, 200, { ok: true, app: APP_NAME, version: APP_VERSION, time: nowIso(), pid: process.pid });
      return;
    }

    if (request.method === "GET" && pathname === "/api/media") {
      await serveMedia(request, response, url);
      return;
    }

    if (pathname.startsWith("/api/")) {
      if (!authorized(request)) {
        sendJson(response, 401, { error: "This dashboard session is not authorized. Reload the app." });
        return;
      }
      if (request.method !== "GET" && !validOrigin(request)) {
        sendJson(response, 403, { error: "Cross-origin request rejected." });
        return;
      }
    }

    try {
      if (request.method === "GET" && pathname === "/api/bootstrap") {
        const latest = store.latestRun();
        const posts = Object.fromEntries(
          Object.entries(store.state.posts).map(([key, value]) => [
            key,
            {
              saved: Boolean(value.saved),
              contacted: Boolean(value.contacted),
              hidden: Boolean(value.hidden),
              note: value.note ?? "",
            },
          ]),
        );
        sendJson(response, 200, {
          app: APP_NAME,
          version: APP_VERSION,
          serverTime: nowIso(),
          settings: publicSettings(store.getSettings()),
          latestRun: latest,
          runs: store.latestRuns(8),
          posts,
          stats: store.stats(),
          sourceStatus: store.state.sourceStatus,
          markets: MARKETS,
          limits: { maxResults: [12, 60], windowHours: [24, 48, 72, 168] },
        });
        return;
      }

      if (request.method === "POST" && pathname === "/api/search") {
        const body = await readJsonBody(request);
        const run = await runSearch({
          store,
          input: body,
          onProgress: (event) => {
            if (process.env.SIGNAL_VERBOSE) console.log(JSON.stringify({ event }));
          },
        });
        sendJson(response, 200, {
          run,
          settings: publicSettings(store.getSettings()),
          stats: store.stats(),
          sourceStatus: store.state.sourceStatus,
        });
        return;
      }

      if (request.method === "GET" && pathname === "/api/run") {
        const id = String(url.searchParams.get("id") ?? "");
        const run = store.getRun(id);
        if (!run) {
          sendJson(response, 404, { error: "That search is not in local history." });
          return;
        }
        sendJson(response, 200, { run });
        return;
      }

      if (request.method === "POST" && pathname === "/api/settings") {
        const body = await readJsonBody(request);
        const patch = {};
        for (const key of [
          "market",
          "windowHours",
          "maxResults",
          "sourceGoogle",
          "enrichInstagram",
          "apifyEnabled",
          "apifyActor",
          "apifyMaxPostsPerSource",
          "apifyMaxChargeUsd",
          "apifyCooldownSeconds",
          "defaultKeywords",
        ]) {
          if (body[key] !== undefined) patch[key] = body[key];
        }
        if (body.apifyToken !== undefined) patch.apifyToken = String(body.apifyToken).trim();
        const settings = await store.updateSettings(patch);
        sendJson(response, 200, { ok: true, settings: publicSettings(settings) });
        return;
      }

      if (request.method === "POST" && pathname === "/api/apify/test") {
        const body = await readJsonBody(request);
        const token = String(body.token || store.getSettings().apifyToken || "").trim();
        if (!token) {
          sendJson(response, 400, { ok: false, error: "Enter an Apify API token first." });
          return;
        }
        try {
          const result = await testApifyToken(token);
          sendJson(response, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(response, 200, { ok: false, error: error.message, status: error.status ?? null });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/post") {
        const body = await readJsonBody(request);
        const shortcode = String(body.shortcode ?? "").trim();
        if (!/^[A-Za-z0-9_-]{5,40}$/.test(shortcode)) {
          sendJson(response, 400, { error: "Invalid post id." });
          return;
        }
        const action = String(body.action ?? "");
        const update = {};
        if (action === "save") update.saved = true;
        else if (action === "unsave") update.saved = false;
        else if (action === "contact") update.contacted = true;
        else if (action === "uncontact") update.contacted = false;
        else if (action === "hide") update.hidden = true;
        else if (action === "unhide") update.hidden = false;
        else if (action === "note") update.note = String(body.note ?? "").slice(0, 600);
        else {
          sendJson(response, 400, { error: "Unknown post action." });
          return;
        }
        const state = await store.updatePost(shortcode, update);
        sendJson(response, 200, { ok: true, post: state, stats: store.stats() });
        return;
      }

      if (request.method === "POST" && pathname === "/api/open") {
        const body = await readJsonBody(request);
        const target = String(body.url ?? "").trim();
        if (!isAllowedExternalUrl(target)) {
          sendJson(response, 400, { error: "That external URL is not on the manual-lane allowlist." });
          return;
        }
        if (body.dryRun === true) {
          sendJson(response, 200, { ok: true, target });
          return;
        }
        try {
          const child = spawn("rundll32.exe", ["url.dll,FileProtocolHandler", target], {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
          child.unref();
          sendJson(response, 200, { ok: true });
        } catch (error) {
          sendJson(response, 500, { error: `Could not open the browser: ${error.message}` });
        }
        return;
      }

      if (request.method === "POST" && pathname === "/api/clear") {
        store.state.runs = [];
        store.state.posts = {};
        store.state.cache = { decoded: {}, oembed: {} };
        store.state.counters = { searches: 0, apifyRuns: 0, apifyItems: 0 };
        store.state.sourceStatus = {
          google: { status: "idle", lastAt: null, message: "Not queried yet" },
          instagram: { status: "idle", lastAt: null, message: "Public oEmbed enrichment" },
          apify: { status: "idle", lastAt: null, message: "Optional connection" },
        };
        await store.save();
        sendJson(response, 200, { ok: true, stats: store.stats() });
        return;
      }

      if (request.method === "GET" && pathname === "/api/export") {
        const latest = store.latestRun();
        if (!latest) {
          sendText(response, 404, "No search results to export yet.");
          return;
        }
        const csv = runToCsv(latest);
        const filename = `keyword-deck-${new Date().toISOString().slice(0, 10)}.csv`;
        response.writeHead(200, {
          ...securityHeaders("text/csv; charset=utf-8"),
          "content-disposition": `attachment; filename="${filename}"`,
          "cache-control": "no-store",
          "content-length": Buffer.byteLength(csv),
        });
        response.end(csv);
        return;
      }

      if ((request.method === "GET" || request.method === "HEAD") && !pathname.startsWith("/api/")) {
        await serveStatic(request, response, pathname);
        return;
      }

      if (request.method === "POST" && pathname === "/api/shutdown") {
        sendJson(response, 200, { ok: true, message: "Keyword Deck is closing." });
        setTimeout(() => {
          server.close(() => process.exit(0));
          setTimeout(() => process.exit(0), 1500).unref();
        }, 120);
        return;
      }

      sendJson(response, 404, { error: "Unknown API route." });
    } catch (error) {
      console.error(`[${request.method} ${pathname}]`, error);
      sendJson(response, error.statusCode ?? 500, { error: error.message ?? "Unexpected server error." });
    }
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Keyword Deck may already be running.`);
    } else {
      console.error(error);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`${APP_NAME} ${APP_VERSION}`);
    console.log(`Local dashboard: http://${HOST}:${PORT}`);
    console.log("Press Ctrl+C to stop.");
  });

  const shutdown = async () => {
    await store.save();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1200).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
