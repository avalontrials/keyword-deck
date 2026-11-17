import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Google web search through the user's own Chrome, because Google blocks
 * scripted requests and every free proxy (DuckDuckGo, Bing RSS, SearXNG) either
 * captchas or returns nothing.
 *
 * This launches Chrome with a real profile, loads the exact URL a person would
 * type, and reads the anchor list out of the page. The profile is the whole
 * trick: a fresh profile gets challenged and returns nothing.
 */

const DEFAULT_PORT = 9333;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function chromeCandidates() {
  const local = process.env.LOCALAPPDATA ?? "";
  return [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
}

export function findChrome(explicit) {
  const candidates = explicit ? [explicit, ...chromeCandidates()] : chromeCandidates();
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

export function defaultProfileDir() {
  const local = process.env.LOCALAPPDATA ?? "";
  const candidate = path.join(local, "Google", "Chrome", "User Data");
  return fs.existsSync(candidate) ? candidate : null;
}

export function searchUrl(phrase, { windowHours = 24 } = {}) {
  const days = Number(windowHours) >= 168 ? "w" : "d";
  const q = `site:instagram.com "${phrase}"`;
  const params = new URLSearchParams({
    q,
    hl: "en",
    gl: "us",
    num: "20",
    tbs: `qdr:${days},sbd:1`,
  });
  return `https://www.google.com/search?${params.toString()}`;
}

/** Pull Instagram post links out of a rendered Google results page. */
export function parseInstagramLinks(anchors = []) {
  const found = [];
  for (const raw of anchors) {
    if (!raw) continue;
    let href = String(raw);
    try {
      href = decodeURIComponent(href);
    } catch {}
    const direct = href.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|tv)\/[A-Za-z0-9_-]+/);
    if (direct) {
      found.push(`https://www.instagram.com/${direct[0].split("instagram.com/")[1]}/`);
      continue;
    }
    const wrapped = href.match(/[?&](?:q|url)=([^&]+)/);
    if (wrapped) {
      try {
        const inner = decodeURIComponent(wrapped[1]);
        const m = inner.match(/https?:\/\/(?:www\.)?instagram\.com\/(p|reel|tv)\/([A-Za-z0-9_-]+)/);
        if (m) found.push(`https://www.instagram.com/${m[1]}/${m[2]}/`);
      } catch {}
    }
  }
  return [...new Set(found)];
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.next = 0;
    this.pending = new Map();
    this.waiters = new Map();
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        message.error ? reject(new Error(message.error.message)) : resolve(message.result);
      } else if (message.method) {
        const list = this.waiters.get(message.method) ?? [];
        this.waiters.set(message.method, []);
        list.forEach((fn) => fn(message.params));
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.next;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  once(method) {
    return new Promise((resolve) => {
      const list = this.waiters.get(method) ?? [];
      list.push(resolve);
      this.waiters.set(method, list);
    });
  }
}

async function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome did not open its debugging port.");
}

/**
 * Run one or more phrases through Google in a single Chrome session.
 * Returns { links, blocked, empty } and never throws on a Google challenge.
 */
export async function searchGoogleWeb({
  phrases = [],
  profileDir,
  chromePath,
  port = DEFAULT_PORT,
  timeoutMs = 25_000,
  windowHours = 24,
} = {}) {
  const chrome = findChrome(chromePath);
  if (!chrome) throw new Error("Google Chrome was not found. Install Chrome, or set the path in Settings.");
  const profile = profileDir || defaultProfileDir();
  if (!profile) throw new Error("Chrome profile folder not found. Set it in Settings.");

  const child = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--lang=en-US",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let chromeError = "";
  child.stderr?.on("data", (chunk) => {
    chromeError += chunk.toString();
    if (chromeError.length > 4000) chromeError = chromeError.slice(-4000);
  });
  child.on("error", (error) => {
    chromeError += `\n${error.message}`;
  });

  const links = [];
  let blocked = false;
  let empty = false;
  let ws;

  try {
    let version;
    try {
      version = await waitForPort(port, 20_000);
    } catch {
      const detail = chromeError.trim().split("\n").slice(-2).join(" ").slice(0, 200);
      throw new Error(
        "Chrome could not open your profile. Close Chrome completely, then search again." +
          (detail ? ` (${detail})` : ""),
      );
    }
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const cdp = new CDP(ws);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    await cdp.send("Page.enable", {}, sessionId);

    for (const phrase of phrases) {
      const loaded = cdp.once("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: searchUrl(phrase, { windowHours }) }, sessionId);
      await Promise.race([loaded, sleep(timeoutMs)]);
      await sleep(2500);

      const probe = await cdp.send("Runtime.evaluate", {
        expression: `JSON.stringify({
          blocked: /unusual traffic|recaptcha|before you continue/i.test(document.body.innerText || ""),
          empty: /did not match any documents/i.test(document.body.innerText || ""),
          anchors: [...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter(Boolean)
        })`,
        returnByValue: true,
      }, sessionId);

      const data = JSON.parse(probe.result.value);
      blocked = blocked || data.blocked;
      empty = empty || data.empty;
      links.push(...parseInstagramLinks(data.anchors));
    }

    await cdp.send("Target.closeTarget", { targetId });
    return { links: [...new Set(links)], blocked, empty };
  } finally {
    try { ws?.close(); } catch {}
    try { child.kill(); } catch {}
  }
}
