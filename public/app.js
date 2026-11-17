const TOKEN = document.querySelector('meta[name="signal-token"]')?.content ?? "";
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const dom = {
  searchForm: $("#searchForm"),
  searchInput: $("#searchInput"),
  searchButton: $("#searchButton"),
  newSearchButton: $("#newSearchButton"),
  windowControl: $("#windowControl"),
  regionSelect: $("#regionSelect"),
  apifyToggle: $("#apifyToggle"),
  apifyState: $("#apifyState"),
  historyList: $("#historyList"),
  historyCount: $("#historyCount"),
  sourceList: $("#sourceList"),
  googleRow: $('.source-row[data-source="google"]'),
  statusPulse: $("#statusPulse"),
  statusText: $("#statusText"),
  todayLabel: $("#todayLabel"),
  regionLabel: $("#regionLabel"),
  clock: $("#clock"),
  progressPanel: $("#progressPanel"),
  progressTitle: $("#progressTitle"),
  progressDetail: $("#progressDetail"),
  progressSteps: $("#progressSteps"),
  resultsSection: $("#resultsSection"),
  resultKicker: $("#resultKicker"),
  resultTitle: $("#resultTitle"),
  resultMeta: $("#resultMeta"),
  viewControl: $("#viewControl"),
  sortControl: $("#sortControl"),
  shuffleButton: $("#shuffleButton"),
  traceButton: $("#traceButton"),
  statsRow: $("#statsRow"),
  featuredCard: $("#featuredCard"),
  queueList: $("#queueList"),
  queueCounter: $("#queueCounter"),
  traceTime: $("#traceTime"),
  tracePanel: $("#tracePanel"),
  queryTrace: $("#queryTrace"),
  traceWarnings: $("#traceWarnings"),
  emptyState: $("#emptyState"),
  exportButton: $("#exportButton"),
  refreshButton: $("#refreshButton"),
  focusButton: $("#focusButton"),
  textSmaller: $("#textSmaller"),
  textLarger: $("#textLarger"),
  textSizeLabel: $("#textSizeLabel"),
  settingsButton: $("#settingsButton"),
  footerSettings: $("#footerSettings"),
  aboutButton: $("#aboutButton"),
  footerMethod: $("#footerMethod"),
  settingsModal: $("#settingsModal"),
  aboutModal: $("#aboutModal"),
  saveSettingsButton: $("#saveSettingsButton"),
  testApifyButton: $("#testApifyButton"),
  clearDataButton: $("#clearDataButton"),
  apifyTestResult: $("#apifyTestResult"),
  settingsStatus: $("#settingsStatus"),
  toastStack: $("#toastStack"),
  mainScroll: $("#mainScroll"),
  aboutVersion: $("#aboutVersion"),
  settingRegion: $("#settingRegion"),
  settingWindow: $("#settingWindow"),
  settingKeywords: $("#settingKeywords"),
  settingApifyEnabled: $("#settingApifyEnabled"),
  settingApifyToken: $("#settingApifyToken"),
  settingApifyActor: $("#settingApifyActor"),
  settingApifyMaxPosts: $("#settingApifyMaxPosts"),
  settingApifyCap: $("#settingApifyCap"),
  settingApifyCooldown: $("#settingApifyCooldown"),
  manualLanes: $(".manual-lanes"),
};

const state = {
  settings: null,
  bootstrap: null,
  run: null,
  displayPosts: [],
  deck: [],
  index: 0,
  sort: "priority",
  view: "high",
  traceOpen: false,
  textScale: 110,
  focus: false,
  window: 168,
  region: "US",
  posts: {},
  runs: [],
  busy: false,
  progressTimer: null,
  progressStarted: 0,
};

const TEXT_STEPS = [100, 110, 120, 130];

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function relativeTime(iso) {
  if (!iso) return "unknown";
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function hoursSince(iso) {
  if (!iso) return 9999;
  return Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
}

function displayDate(post) {
  return post.postedAt || post.indexedAt;
}

function timeLabel(post) {
  return `${post.postedAt ? "Posted" : "Indexed"} ${relativeTime(displayDate(post))}`;
}

function compact(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 0 : 1)}m`;
  if (number >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 0 : 1)}k`;
  return String(number);
}

function authorHandle(post) {
  if (!post.authorUrl) return null;
  try {
    const path = new URL(post.authorUrl).pathname.replace(/^\/|\/$/g, "");
    return path ? `@${path}` : null;
  } catch {
    return null;
  }
}

function initialFor(post) {
  const value = (post.author || post.caption || "O").trim();
  return escapeHtml(value.charAt(0).toUpperCase() || "O");
}

function currentPost() {
  return state.deck[state.index] ?? null;
}

function postState(post) {
  return state.posts[post.shortcode] ?? {};
}

function visiblePosts() {
  if (!state.run) return [];
  const base = state.run.results.filter((post) => !postState(post).hidden);
  const high = base.filter((post) => post.priority === "high");
  const list = state.view === "high" ? high : base;
  if (state.sort === "newest") {
    return list.slice().sort((a, b) => new Date(displayDate(b) || 0) - new Date(displayDate(a) || 0));
  }
  return list.slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function weightedShuffle(posts) {
  const pool = posts.slice();
  const output = [];
  while (pool.length) {
    let total = 0;
    const weights = pool.map((post) => {
      const weight = Math.max(0.35, Math.min(7, Math.exp(((post.score ?? 45) - 58) / 16)));
      total += weight;
      return weight;
    });
    let cursor = Math.random() * total;
    let chosen = 0;
    for (let index = 0; index < pool.length; index += 1) {
      cursor -= weights[index];
      if (cursor <= 0) {
        chosen = index;
        break;
      }
    }
    output.push(pool.splice(chosen, 1)[0]);
  }
  if (output.length > 1 && output[0].shortcode === currentPost()?.shortcode) {
    [output[0], output[1]] = [output[1], output[0]];
  }
  return output;
}

async function api(path, options = {}) {
  const headers = {
    "x-signal-token": TOKEN,
    ...(options.body ? { "content-type": "application/json" } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function toast(message, type = "info", duration = 3800) {
  const element = document.createElement("div");
  element.className = `toast ${type === "error" ? "error" : ""}`;
  element.textContent = message;
  dom.toastStack.append(element);
  while (dom.toastStack.children.length > 3) dom.toastStack.firstElementChild.remove();
  window.setTimeout(() => {
    element.classList.add("leaving");
    window.setTimeout(() => element.remove(), 220);
  }, duration);
}

function setStatus(text, busy = false) {
  dom.statusText.textContent = text;
  dom.statusPulse.classList.toggle("busy", busy);
}

function setClock() {
  const now = new Date();
  dom.clock.textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  dom.todayLabel.textContent = now.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

function applyTextScale(scale) {
  const next = TEXT_STEPS.includes(Number(scale)) ? Number(scale) : 110;
  state.textScale = next;
  document.documentElement.style.fontSize = `${(16 * next) / 100}px`;
  document.documentElement.style.removeProperty("zoom");
  document.body.classList.toggle("scale-large", next >= 120);
  dom.textSizeLabel.textContent = `${next}%`;
  try {
    window.localStorage.setItem("signal-text-scale", String(next));
  } catch {
    // Ignore storage failures.
  }
}

function changeTextScale(direction) {
  const index = TEXT_STEPS.indexOf(state.textScale);
  applyTextScale(TEXT_STEPS[Math.max(0, Math.min(TEXT_STEPS.length - 1, index + direction))]);
}

function applyFocus(enabled) {
  state.focus = Boolean(enabled);
  document.body.classList.toggle("focus-mode", state.focus);
  dom.focusButton.classList.toggle("active", state.focus);
  dom.focusButton.textContent = state.focus ? "Exit focus" : "Focus";
  try {
    window.localStorage.setItem("signal-focus", state.focus ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

function toggleFocus() {
  applyFocus(!state.focus);
  if (state.focus) dom.mainScroll.scrollTo({ top: 0, behavior: "smooth" });
}

function setRegion(region) {
  state.region = ["US", "CA", "GB"].includes(region) ? region : "US";
  dom.regionSelect.value = state.region;
  dom.regionLabel.textContent = state.bootstrap?.markets?.[state.region] ?? "United States";
}

function setGoogleSource(enabled, { persist = true } = {}) {
  const row = dom.googleRow;
  if (!row) return;
  row.dataset.enabled = String(enabled);
  row.setAttribute("aria-checked", String(enabled));
  $(".source-state", row).textContent = enabled ? "On" : "Off";
  if (state.settings) state.settings.sourceGoogle = enabled;
  if (!persist) return;
  api("/api/settings", { method: "POST", body: JSON.stringify({ sourceGoogle: enabled }) })
    .then((response) => {
      if (response.settings && state.settings) {
        state.settings.sourceGoogle = response.settings.sourceGoogle !== false;
      }
      toast(
        enabled
          ? "Google index on. Instagram posts will be found again."
          : "Google index off. Only Apify can search now.",
        "info",
      );
    })
    .catch((error) => {
      toast(error.message, "error");
      setGoogleSource(!enabled, { persist: false });
    });
}

function applySettings(settings, { updateInput = true } = {}) {
  state.settings = settings;
  state.window = Number(settings.windowHours) || 168;
  setRegion(settings.market || "US");
  if (updateInput && !dom.searchInput.value && settings.defaultKeywords) {
    dom.searchInput.value = settings.defaultKeywords;
  }
  $$("#windowControl button").forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.window) === state.window);
  });
  dom.apifyToggle.checked = Boolean(settings.apifyEnabled && settings.apifyTokenSet);
  setGoogleSource(settings.sourceGoogle !== false, { persist: false });
  updateSearchButton();
  renderSources(state.bootstrap?.sourceStatus ?? {});
}

function updateSearchButton() {
  dom.searchButton.disabled = state.busy || !dom.searchInput.value.trim();
}

function renderHistory() {
  dom.historyCount.textContent = pad(state.runs.length);
  if (!state.runs.length) {
    dom.historyList.innerHTML = '<p class="rail-empty">Your keyword searches will collect here.</p>';
    return;
  }
  dom.historyList.innerHTML = state.runs
    .slice(0, 7)
    .map(
      (run) => `
      <button type="button" class="history-item ${run.id === state.run?.id ? "active" : ""}" data-run-id="${escapeHtml(run.id)}">
        <span class="history-query">${escapeHtml(run.keywords?.join(", ") ?? run.query)}</span>
        <span class="history-meta">${run.stats?.total ?? 0} · ${relativeTime(run.completedAt)}</span>
      </button>`,
    )
    .join("");
}

function sourceStatusLabel(name, sourceStatus) {
  if (name === "apify") {
    if (state.settings?.apifyTokenSet && state.settings?.apifyEnabled) return "armed";
    if (state.settings?.apifyTokenSet) return "ready";
    return "off";
  }
  const status = sourceStatus?.[name]?.status ?? "idle";
  if (status === "ok") return "live";
  if (status === "error") return "issue";
  if (status === "empty") return "empty";
  return "ready";
}

function renderSources(sourceStatus = {}) {
  const rows = $$(".source-row", dom.sourceList);
  for (const row of rows) {
    const name = row.dataset.source;
    if (name === "google" && state.settings?.sourceGoogle === false) {
      row.dataset.state = "idle";
      $(".source-state", row).textContent = "Off";
      continue;
    }
    const label = sourceStatusLabel(name, sourceStatus);
    const status = sourceStatus?.[name]?.status ?? "idle";
    row.dataset.state =
      label === "live" || label === "armed" ? "ok" : label === "issue" ? "error" : label === "empty" ? "warn" : "idle";
    $(".source-state", row).textContent = label;
  }
  if (state.settings) {
    dom.apifyState.textContent = !state.settings.apifyTokenSet
      ? "not connected"
      : dom.apifyToggle.checked
        ? "armed"
        : "connected";
  }
}

function statBlock(number, label, note) {
  return `<div class="stat"><span class="stat-number">${number}</span><span class="stat-copy"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-note">${escapeHtml(note)}</span></span></div>`;
}

function renderStats() {
  const all = state.run?.results.filter((post) => !postState(post).hidden) ?? [];
  const fresh = all.filter((post) => hoursSince(displayDate(post)) <= 24).length;
  const high = all.filter((post) => post.priority === "high").length;
  dom.statsRow.innerHTML = [
    statBlock(all.length, "public posts", "after hidden filters"),
    statBlock(fresh, "fresh 24h", "published or indexed today"),
    statBlock(high, "high relevance", "strong keyword match"),
  ].join("");
}

function penaltyReasons(post) {
  const output = [];
  if (post.flags?.includes("giveaway")) output.push("Giveaway penalty");
  if (post.flags?.includes("promo-language")) output.push("Promo-language penalty");
  if (post.flags?.includes("cta")) output.push("CTA penalty");
  if (post.flags?.includes("weak-keyword-match")) output.push("Weak keyword match");
  if (post.flags?.includes("outside-window")) output.push("Outside selected window");
  return output;
}

function renderFeatured() {
  const post = currentPost();
  if (!post) {
    dom.featuredCard.innerHTML = `<div class="card-media"><div class="media-fallback"><span class="fallback-kicker">No post selected</span><span class="fallback-letter">O</span><span class="fallback-copy">The desk is clear.</span></div></div><div class="card-body"><p class="kicker">Nothing to show</p><h2 class="card-empty-title">Run another search or reset hidden posts.</h2></div>`;
    return;
  }
  const saved = Boolean(postState(post).saved);
  const contacted = Boolean(postState(post).contacted);
  const metrics = post.metrics ?? {};
  const metricBits = [];
  if (metrics.likes !== null && metrics.likes !== undefined) metricBits.push(`${compact(metrics.likes)} likes`);
  if (metrics.comments !== null && metrics.comments !== undefined) metricBits.push(`${compact(metrics.comments)} comments`);
  if (metrics.views !== null && metrics.views !== undefined) metricBits.push(`${compact(metrics.views)} views`);
  const metricLine = metricBits.length ? metricBits.join(" · ") : "No public engagement metrics";
  const handle = authorHandle(post);
  const sourceLine =
    post.sources?.length > 1
      ? "Google index + Apify"
      : post.source === "apify"
        ? "Apify actor"
        : "Google News index";
  const reasons = [...(post.reasons ?? []), ...penaltyReasons(post)];
  const caption = post.caption || "No caption was available for this public post.";
  const thumb = post.thumbnailUrl
    ? `<img src="${escapeHtml(post.thumbnailUrl)}" alt="Preview of ${escapeHtml(post.author || "public post")}" loading="eager" />`
    : "";
  const fresh = hoursSince(displayDate(post)) <= 24;
  const formatLabel = post.format || "Post";

  dom.featuredCard.innerHTML = `
    <div class="card-media">
      <div class="media-fallback"><span class="fallback-kicker">${escapeHtml(sourceLine)}</span><span class="fallback-letter">${initialFor(post)}</span><span class="fallback-copy">${escapeHtml(caption.slice(0, 110))}</span></div>
      ${thumb}
      <div class="media-top"><div style="display:flex;gap:5px;flex-wrap:wrap"><span class="media-tag">${escapeHtml(formatLabel)}</span><span class="media-tag ${fresh ? "fresh" : ""}">${fresh ? "Fresh" : "Indexed"}</span></div><div class="score-ring" style="--score:${post.score ?? 0}" title="Relevance ${post.score ?? 0} of 99"><span><strong>${post.score ?? "–"}</strong><small>score</small></span></div></div>
      <div class="media-bottom"><span class="media-source">${escapeHtml(timeLabel(post))}</span><span class="media-author">${escapeHtml(post.author || "Public account")}</span></div>
    </div>
    <div class="card-body">
      <div class="card-topline"><span class="priority-badge" data-priority="${post.priority ?? "low"}">${escapeHtml(post.label || "Low relevance")}</span><span class="card-index">${pad(state.index + 1)} / ${pad(state.deck.length)}</span></div>
      <div class="author-block"><span class="author-avatar">${initialFor(post)}</span><span class="author-copy"><span class="author-name">${escapeHtml(post.author || "Public account")}</span><span class="author-meta">${handle ? `${escapeHtml(handle)} · ` : ""}${escapeHtml(formatLabel)} · ${escapeHtml(timeLabel(post))}</span></span></div>
      <div class="caption-wrap"><p class="caption-text ${caption.length > 500 ? "is-long" : ""}">${escapeHtml(caption)}</p></div>
      <div class="card-reasons">${reasons.map((reason) => `<span class="reason ${penaltyReasons(post).includes(reason) ? "penalty" : ""}">${escapeHtml(reason)}</span>`).join("")}</div>
      <div class="card-actions"><a class="primary-link" href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer">Open on Instagram <span aria-hidden="true">↗</span></a><button type="button" class="card-action ${saved ? "active" : ""}" data-action="save">${saved ? "Saved" : "Save"}</button><button type="button" class="card-action ${contacted ? "active" : ""}" data-action="contact">${contacted ? "Contacted" : "Contact"}</button><button type="button" class="card-action icon-only" data-action="hide" title="Hide from this desk" aria-label="Hide from this desk">×</button></div>
      <div class="author-meta" style="margin-top:9px">${escapeHtml(metricLine)}</div>
    </div>`;
}

function renderQueue() {
  const total = state.deck.length;
  dom.queueCounter.textContent = total ? `${pad(state.index + 1)} / ${pad(total)}` : "00 / 00";
  if (total <= 1) {
    dom.queueList.innerHTML = '<p class="queue-empty">This is the only post in the current deck.</p>';
    return;
  }
  const count = Math.min(7, total - 1);
  const items = [];
  for (let offset = 1; offset <= count; offset += 1) {
    items.push({ post: state.deck[(state.index + offset) % total], deckIndex: (state.index + offset) % total });
  }
  dom.queueList.innerHTML = items
    .map(({ post, deckIndex }) => {
      const thumb = post.thumbnailUrl ? `<img src="${escapeHtml(post.thumbnailUrl)}" alt="" loading="lazy" />` : "";
      return `<button type="button" class="queue-item ${post.priority === "high" ? "is-high" : ""}" data-deck-index="${deckIndex}"><span class="queue-rank">${pad(deckIndex + 1)}</span><span class="queue-thumb">${thumb}<span>${initialFor(post)}</span></span><span class="queue-copy"><span class="queue-caption">${escapeHtml(post.caption || "Public post")}</span><span class="queue-meta">${escapeHtml(post.author || "public")} · ${escapeHtml(timeLabel(post))}</span></span><span class="queue-score">${post.score ?? "–"}</span></button>`;
    })
    .join("");
  const allCount = state.run?.results.filter((post) => !postState(post).hidden).length ?? 0;
  if (state.view === "high" && total < 4 && allCount > total) {
    dom.queueList.innerHTML += `<div class="queue-hint"><strong>Only ${total} high-relevance ${total === 1 ? "post" : "posts"} here.</strong><span>Try a wider window or read the full index.</span><button type="button" data-view-hint="all">Show all ${allCount} posts</button></div>`;
  }
}

function renderTrace() {
  if (!state.run) return;
  const queries = state.run.queries ?? [];
  const traceCards = queries.map(
    (query) => `<div class="trace-query"><div class="trace-query-top"><span class="trace-label">${escapeHtml(query.label)}</span><span class="trace-count">${query.count ?? 0}</span></div><p class="trace-q">${escapeHtml(query.q)}</p><span class="trace-status ${query.status === "error" ? "error" : ""}">${escapeHtml(query.status)}</span></div>`,
  );
  if (state.run.apify?.requested) {
    traceCards.push(`<div class="trace-query"><div class="trace-query-top"><span class="trace-label">Apify deep read</span><span class="trace-count">${state.run.apify.items ?? 0}</span></div><p class="trace-q">${escapeHtml(state.run.apify.ok ? `Run ${state.run.apify.runId ?? "complete"} · cap $${state.run.apify.capUsd}` : state.run.apify.error || "Not completed")}</p><span class="trace-status ${state.run.apify.ok ? "" : "error"}">${state.run.apify.ok ? "complete" : "skipped"}</span></div>`);
  }
  dom.queryTrace.innerHTML = traceCards.join("") || '<div class="trace-query"><p class="trace-q">No queries were run.</p></div>';
  const warnings = [...(state.run.warnings ?? [])];
  if (state.run.apify?.error && !warnings.includes(state.run.apify.error)) warnings.push(state.run.apify.error);
  dom.traceWarnings.innerHTML = warnings.map((warning) => `<div class="trace-warning">${escapeHtml(warning)}</div>`).join("");
  dom.traceTime.textContent = `Completed ${relativeTime(state.run.completedAt)} · ${((state.run.timing?.totalMs ?? 0) / 1000).toFixed(1)}s · ${queries.length} queries`;
}

function renderResultHeader() {
  if (!state.run) return;
  const all = state.run.results.filter((post) => !postState(post).hidden);
  const high = all.filter((post) => post.priority === "high").length;
  const showing = state.displayPosts.length;
  dom.resultKicker.textContent = `Your desk · ${high} high-relevance post${high === 1 ? "" : "s"}`;
  dom.resultTitle.textContent = `“${state.run.query}”`;
  dom.resultMeta.textContent = `${showing} shown · ${high} high relevance from ${all.length} public posts · ${state.run.windowHours / 24}d window · ${state.bootstrap?.markets?.[state.run.market] ?? state.run.market}`;
  dom.exportButton.hidden = false;
  dom.refreshButton.hidden = false;
}

function renderAll() {
  renderStats();
  renderFeatured();
  renderQueue();
  renderTrace();
  renderResultHeader();
  renderHistory();
}

function showResults() {
  dom.resultsSection.hidden = false;
  dom.emptyState.hidden = true;
  document.body.classList.add("has-results");
}

function showEmpty(message) {
  dom.resultsSection.hidden = true;
  dom.emptyState.hidden = false;
  document.body.classList.remove("has-results");
  if (message) {
    const heading = $("h2", dom.emptyState);
    if (heading) heading.textContent = message;
  }
}

function loadRun(run, { restored = false } = {}) {
  state.run = run;
  if (run.keywords?.length) {
    dom.searchInput.value = run.keywords.join(", ");
    updateSearchButton();
  }
  state.sort = "priority";
  state.view = (run.stats?.highPriority ?? 0) > 0 ? "high" : "all";
  state.traceOpen = false;
  dom.tracePanel.hidden = true;
  dom.traceButton.classList.remove("active");
  $$("#sortControl button").forEach((button) => button.classList.toggle("active", button.dataset.sort === "priority"));
  $$("#viewControl button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  state.displayPosts = visiblePosts();
  state.deck = state.displayPosts.slice();
  state.index = 0;
  if (!state.deck.length) {
    showEmpty("Nothing matched those keywords yet.");
    setStatus("No usable public posts");
    renderHistory();
    return;
  }
  showResults();
  renderAll();
  const allVisible = state.run.results.filter((post) => !postState(post).hidden);
  const high = allVisible.filter((post) => post.priority === "high").length;
  setStatus(`${restored ? "Desk restored" : "Desk ready"} · ${high} high / ${allVisible.length} posts`);
  if (!restored) {
    window.setTimeout(() => dom.resultsSection.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
}

function updateHistoryFromRun(run) {
  const summary = {
    id: run.id,
    keywords: run.keywords,
    query: run.query,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    status: run.status,
    stats: run.stats,
    windowHours: run.windowHours,
    market: run.market,
  };
  state.runs = [summary, ...state.runs.filter((entry) => entry.id !== run.id)].slice(0, 8);
}

function setBusy(busy) {
  state.busy = busy;
  updateSearchButton();
  dom.searchButton.querySelector(".search-button-label").textContent = busy ? "Reading…" : "Search";
  dom.searchButton.querySelector(".search-button-arrow").textContent = busy ? "·" : "↗";
  dom.progressPanel.hidden = !busy;
  if (busy) {
    dom.progressStarted = Date.now();
    setStatus("Reading the public index", true);
    setProgressStage(0);
    window.clearInterval(state.progressTimer);
    state.progressTimer = window.setInterval(() => {
      const seconds = (Date.now() - state.progressStarted) / 1000;
      if (seconds < 4) setProgressStage(0);
      else if (seconds < 9) setProgressStage(1);
      else if (seconds < 15) setProgressStage(2);
      else setProgressStage(3);
    }, 700);
  } else {
    window.clearInterval(state.progressTimer);
    state.progressTimer = null;
  }
}

function setProgressStage(index) {
  const steps = $$(".progress-steps span", dom.progressPanel);
  steps.forEach((step, stepIndex) => {
    step.classList.toggle("active", stepIndex === index);
    step.classList.toggle("done", stepIndex < index);
  });
  const titles = [
    ["Reading the public index", "Google News → signed links → public posts"],
    ["Resolving Instagram links", "Turning index entries into direct post URLs"],
    ["Opening post previews", "Public oEmbed captions and preview images"],
    ["Ranking relevance", "Freshness, keyword match, questions and promo penalties"],
  ];
  const [title, detail] = titles[Math.min(index, titles.length - 1)];
  dom.progressTitle.textContent = title;
  dom.progressDetail.textContent = detail;
}

async function doSearch(rawKeywords) {
  if (state.busy) return;
  const keywords = String(rawKeywords ?? "").trim();
  if (!keywords) {
    toast("Enter at least one keyword or phrase.", "error");
    dom.searchInput.focus();
    return;
  }
  if (dom.apifyToggle.checked && !state.settings?.apifyTokenSet) {
    toast("Add an Apify token first, or turn off the deep read.", "error");
    openSettings();
    return;
  }
  const useGoogle = state.settings?.sourceGoogle !== false;
  const useApify = dom.apifyToggle.checked;
  if (!useGoogle && !useApify) {
    toast("Turn the Google index back on, or arm Apify. A search needs one source.", "error");
    return;
  }
  setBusy(true);
  try {
    const response = await api("/api/search", {
      method: "POST",
      body: JSON.stringify({
        keywords,
        windowHours: state.window,
        market: state.region,
        useGoogle,
        useApify,
        limit: state.settings?.maxResults ?? 30,
      }),
    });
    if (response.settings) {
      state.settings = response.settings;
      state.settings.apifyEnabled = useApify;
      applySettings(response.settings, { updateInput: false });
      dom.apifyToggle.checked = useApify;
      renderSources(response.sourceStatus ?? state.bootstrap?.sourceStatus ?? {});
    }
    if (response.sourceStatus) {
      state.bootstrap.sourceStatus = response.sourceStatus;
      renderSources(response.sourceStatus);
    }
    state.runs = state.runs.filter((run) => run.id !== response.run.id);
    updateHistoryFromRun(response.run);
    loadRun(response.run);
    const count = response.run.stats?.total ?? 0;
    const high = response.run.stats?.highPriority ?? 0;
    if (!count) toast("No usable public posts came back. Try broader keywords or 7 days.", "error", 5000);
    else toast(`${count} posts ranked · ${high} high relevance`, "info");
  } catch (error) {
    toast(error.message, "error", 6000);
    setStatus("Search needs attention");
    if (!state.run) showEmpty("The desk is clear.");
  } finally {
    setBusy(false);
  }
}

function nextPost() {
  if (!state.deck.length) return;
  if (state.index + 1 >= state.deck.length) {
    state.index = 0;
    toast("Back to the top of the deck.");
  } else state.index += 1;
  renderFeatured();
  renderQueue();
  dom.featuredCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function previousPost() {
  if (!state.deck.length) return;
  state.index = state.index === 0 ? state.deck.length - 1 : state.index - 1;
  renderFeatured();
  renderQueue();
}

function shuffleDeck() {
  if (!state.deck.length) return;
  state.deck = weightedShuffle(state.displayPosts);
  state.index = 0;
  renderFeatured();
  renderQueue();
  toast(`Shuffled ${state.deck.length} posts.`);
}

function setSort(mode) {
  state.sort = mode;
  $$("#sortControl button").forEach((button) => button.classList.toggle("active", button.dataset.sort === mode));
  state.displayPosts = visiblePosts();
  state.deck = state.displayPosts.slice();
  state.index = 0;
  renderAll();
}

function setView(mode) {
  state.view = mode;
  $$("#viewControl button").forEach((button) => button.classList.toggle("active", button.dataset.view === mode));
  state.displayPosts = visiblePosts();
  state.deck = state.displayPosts.slice();
  state.index = 0;
  if (!state.deck.length) {
    showEmpty(mode === "high" ? "No high-relevance posts left in this deck." : "Nothing left in this deck.");
    return;
  }
  showResults();
  renderAll();
  toast(mode === "high" ? "Showing high-relevance posts." : "Showing all public posts in the deck.");
}

function toggleTrace(force) {
  if (!state.run) return;
  state.traceOpen = typeof force === "boolean" ? force : !state.traceOpen;
  dom.tracePanel.hidden = !state.traceOpen;
  dom.traceButton.classList.toggle("active", state.traceOpen);
  if (state.traceOpen) dom.tracePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function updatePost(post, action) {
  if (!post) return;
  const mapping = { save: postState(post).saved ? "unsave" : "save", contact: postState(post).contacted ? "uncontact" : "contact", hide: "hide" };
  const nextAction = mapping[action];
  if (!nextAction) return;
  try {
    const response = await api("/api/post", { method: "POST", body: JSON.stringify({ shortcode: post.shortcode, action: nextAction }) });
    state.posts[post.shortcode] = {
      ...(state.posts[post.shortcode] ?? {}),
      saved: Boolean(response.post?.saved),
      contacted: Boolean(response.post?.contacted),
      hidden: Boolean(response.post?.hidden),
    };
    if (action === "hide") {
      const removedIndex = state.index;
      state.deck = state.deck.filter((item) => item.shortcode !== post.shortcode);
      state.displayPosts = state.displayPosts.filter((item) => item.shortcode !== post.shortcode);
      if (!state.deck.length) {
        showEmpty("Every post in this deck is hidden.");
        return;
      }
      state.index = Math.min(removedIndex, state.deck.length - 1);
      renderAll();
      const allVisible = state.run.results.filter((item) => !postState(item).hidden);
      setStatus(`Desk ready · ${allVisible.filter((item) => item.priority === "high").length} high / ${allVisible.length} posts`);
      toast("Hidden from this desk.");
      return;
    }
    renderFeatured();
    renderQueue();
    renderStats();
    toast(action === "save" ? (postState(post).saved ? "Saved to your shortlist." : "Removed from saved.") : postState(post).contacted ? "Marked contacted." : "Contacted mark removed.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function openCurrentPost() {
  const post = currentPost();
  if (post) window.open(post.url, "_blank", "noopener,noreferrer");
}

async function openExternal(url, label) {
  try {
    await api("/api/open", { method: "POST", body: JSON.stringify({ url }) });
    toast(`Opened ${label} in your default browser.`);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
    toast(`Opened ${label}.`);
  }
}

function openManualLane(kind) {
  const query = dom.searchInput.value.trim() || "your keywords";
  const encoded = encodeURIComponent(query);
  const urls = {
    reddit: `https://www.reddit.com/search/?q=${encoded}&sort=new&t=week`,
    facebook: `https://www.facebook.com/search/posts?q=${encoded}`,
    threads: `https://www.threads.com/search?q=${encoded}`,
    linkedin: `https://www.linkedin.com/search/results/content/?keywords=${encoded}`,
  };
  const labels = { reddit: "Reddit search", facebook: "Facebook search", threads: "Threads search", linkedin: "LinkedIn search" };
  if (urls[kind]) openExternal(urls[kind], labels[kind]);
}

function showModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
  window.setTimeout(() => $("input, select, button, textarea", modal)?.focus(), 40);
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function populateSettings() {
  if (!state.settings) return;
  const settings = state.settings;
  dom.settingRegion.value = settings.market;
  dom.settingWindow.value = String(settings.windowHours);
  dom.settingKeywords.value = settings.defaultKeywords ?? "";
  dom.settingApifyEnabled.checked = Boolean(settings.apifyEnabled);
  dom.settingApifyToken.value = "";
  dom.settingApifyToken.placeholder = settings.apifyTokenSet ? `Stored: ${settings.apifyTokenHint}` : "apify_api_…";
  dom.settingApifyActor.value = settings.apifyActor;
  dom.settingApifyMaxPosts.value = settings.apifyMaxPostsPerSource;
  dom.settingApifyCap.value = settings.apifyMaxChargeUsd;
  dom.settingApifyCooldown.value = settings.apifyCooldownSeconds;
  dom.apifyTestResult.textContent = settings.apifyTokenSet ? "A token is stored locally. Leave the field blank to keep it." : "Stored only in this app's local data folder.";
  dom.apifyTestResult.style.color = "";
  dom.settingsStatus.textContent = "Changes apply to the next search.";
}

function openSettings() {
  populateSettings();
  showModal("settingsModal");
}

async function saveSettings() {
  const patch = {
    market: dom.settingRegion.value,
    windowHours: Number(dom.settingWindow.value),
    defaultKeywords: dom.settingKeywords.value.trim(),
    apifyEnabled: dom.settingApifyEnabled.checked,
    apifyActor: dom.settingApifyActor.value,
    apifyMaxPostsPerSource: Number(dom.settingApifyMaxPosts.value),
    apifyMaxChargeUsd: Number(dom.settingApifyCap.value),
    apifyCooldownSeconds: Number(dom.settingApifyCooldown.value),
  };
  if (dom.settingApifyToken.value.trim()) patch.apifyToken = dom.settingApifyToken.value.trim();
  dom.saveSettingsButton.disabled = true;
  dom.saveSettingsButton.textContent = "Saving…";
  try {
    const response = await api("/api/settings", { method: "POST", body: JSON.stringify(patch) });
    applySettings(response.settings);
    dom.settingsStatus.textContent = "Saved locally.";
    toast("Settings saved.");
    window.setTimeout(() => closeModal("settingsModal"), 250);
  } catch (error) {
    dom.settingsStatus.textContent = error.message;
    toast(error.message, "error");
  } finally {
    dom.saveSettingsButton.disabled = false;
    dom.saveSettingsButton.textContent = "Save settings";
  }
}

async function testApify() {
  const token = dom.settingApifyToken.value.trim() || undefined;
  dom.testApifyButton.disabled = true;
  dom.testApifyButton.textContent = "Testing…";
  dom.apifyTestResult.style.color = "";
  dom.apifyTestResult.textContent = "Calling Apify /users/me…";
  try {
    const response = await api("/api/apify/test", { method: "POST", body: JSON.stringify({ token }) });
    if (response.ok) {
      dom.apifyTestResult.style.color = "var(--evergreen)";
      dom.apifyTestResult.textContent = `Connected as ${response.username ?? "Apify user"} · plan ${response.plan ?? "free"}.`;
    } else {
      dom.apifyTestResult.style.color = "var(--red)";
      dom.apifyTestResult.textContent = response.error || "Connection failed.";
    }
  } catch (error) {
    dom.apifyTestResult.style.color = "var(--red)";
    dom.apifyTestResult.textContent = error.message;
  } finally {
    dom.testApifyButton.disabled = false;
    dom.testApifyButton.textContent = "Test";
  }
}

async function clearData() {
  if (!window.confirm("Clear local search history, saved posts and caches? Settings and your Apify token stay.")) return;
  try {
    await api("/api/clear", { method: "POST", body: "{}" });
    state.run = null;
    state.runs = [];
    state.posts = {};
    state.deck = [];
    state.displayPosts = [];
    if (state.bootstrap) {
      state.bootstrap.sourceStatus = {
        google: { status: "idle", lastAt: null, message: "Not queried yet" },
        instagram: { status: "idle", lastAt: null, message: "Public oEmbed enrichment" },
        apify: { status: "idle", lastAt: null, message: "Optional connection" },
      };
    }
    showEmpty("The desk is clear.");
    renderHistory();
    renderSources(state.bootstrap?.sourceStatus ?? {});
    setStatus("Local desk ready");
    dom.exportButton.hidden = true;
    dom.refreshButton.hidden = true;
    closeModal("settingsModal");
    toast("Local history cleared.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function exportCsv() {
  try {
    const response = await fetch("/api/export", { headers: { "x-signal-token": TOKEN } });
    if (!response.ok) throw new Error("Export failed.");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `keyword-deck-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast("CSV exported.");
  } catch (error) {
    toast(error.message, "error");
  }
}

async function openHistory(runId) {
  if (runId === state.run?.id) return;
  try {
    const response = await api(`/api/run?id=${encodeURIComponent(runId)}`);
    loadRun(response.run, { restored: true });
    dom.mainScroll.scrollTo({ top: 0, behavior: "smooth" });
    toast("Desk restored from local history.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function bindEvents() {
  dom.searchInput.addEventListener("input", updateSearchButton);
  dom.searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    doSearch(dom.searchInput.value);
  });
  dom.newSearchButton.addEventListener("click", () => {
    dom.searchInput.value = "";
    updateSearchButton();
    dom.searchInput.focus();
    dom.mainScroll.scrollTo({ top: 0, behavior: "smooth" });
  });
  dom.emptyState.addEventListener("click", (event) => {
    const button = event.target.closest("[data-example]");
    if (!button) return;
    dom.searchInput.value = button.dataset.example;
    updateSearchButton();
    dom.searchInput.focus();
  });
  dom.windowControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-window]");
    if (!button) return;
    state.window = Number(button.dataset.window);
    $$("#windowControl button").forEach((item) => item.classList.toggle("active", item === button));
    if (state.run) toast("Window changed. Run Search to apply it.");
  });
  dom.regionSelect.addEventListener("change", () => {
    setRegion(dom.regionSelect.value);
    if (state.run) toast("Region changed. Run Search to apply it.");
  });
  dom.apifyToggle.addEventListener("change", () => {
    if (dom.apifyToggle.checked && !state.settings?.apifyTokenSet) {
      dom.apifyToggle.checked = false;
      toast("Add an Apify token in Settings first.", "error");
      openSettings();
      return;
    }
    renderSources(state.bootstrap?.sourceStatus ?? {});
    if (state.settings) state.settings.apifyEnabled = dom.apifyToggle.checked;
    if (state.run) toast("Apify setting changed. Run Search to apply it.");
  });
  dom.manualLanes.addEventListener("click", (event) => {
    const button = event.target.closest("[data-manual]");
    if (button) openManualLane(button.dataset.manual);
  });
  if (dom.googleRow) {
    const toggleGoogle = () => {
      const enabled = dom.googleRow.dataset.enabled !== "false";
      setGoogleSource(!enabled);
    };
    dom.googleRow.addEventListener("click", toggleGoogle);
    dom.googleRow.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        toggleGoogle();
      }
    });
  }
  dom.textSmaller.addEventListener("click", () => changeTextScale(-1));
  dom.textLarger.addEventListener("click", () => changeTextScale(1));
  dom.focusButton.addEventListener("click", toggleFocus);
  dom.traceButton.addEventListener("click", () => toggleTrace());
  dom.sortControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort]");
    if (button) setSort(button.dataset.sort);
  });
  dom.viewControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) setView(button.dataset.view);
  });
  dom.shuffleButton.addEventListener("click", shuffleDeck);
  dom.exportButton.addEventListener("click", exportCsv);
  dom.refreshButton.addEventListener("click", () => doSearch(state.run?.keywords?.join(", ") ?? dom.searchInput.value));
  dom.featuredCard.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (button) updatePost(currentPost(), button.dataset.action);
  });
  dom.queueList.addEventListener("click", (event) => {
    const hint = event.target.closest("[data-view-hint]");
    if (hint) {
      setView(hint.dataset.viewHint);
      return;
    }
    const button = event.target.closest("[data-deck-index]");
    if (!button) return;
    state.index = Number(button.dataset.deckIndex);
    renderFeatured();
    renderQueue();
  });
  dom.historyList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-run-id]");
    if (button) openHistory(button.dataset.runId);
  });
  dom.settingsButton.addEventListener("click", openSettings);
  dom.footerSettings.addEventListener("click", openSettings);
  dom.aboutButton.addEventListener("click", () => showModal("aboutModal"));
  dom.footerMethod.addEventListener("click", () => showModal("aboutModal"));
  dom.saveSettingsButton.addEventListener("click", saveSettings);
  dom.testApifyButton.addEventListener("click", testApify);
  dom.clearDataButton.addEventListener("click", clearData);
  $$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
  $$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closeModal(backdrop.id);
  }));
  document.addEventListener("keydown", (event) => {
    const openModal = $(".modal-backdrop:not([hidden])");
    if (event.key === "Escape" && openModal) {
      closeModal(openModal.id);
      return;
    }
    if (openModal) return;
    const target = event.target;
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
    if (event.key === "/" && !typing) {
      event.preventDefault();
      dom.searchInput.focus();
      dom.searchInput.select();
      return;
    }
    if (typing) return;
    if (event.code === "Space" && target?.closest?.("button, a, [role='button']")) return;
    if (event.code === "Space") {
      event.preventDefault();
      nextPost();
    } else if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      updatePost(currentPost(), "save");
    } else if (event.key.toLowerCase() === "o") {
      event.preventDefault();
      openCurrentPost();
    } else if (event.key.toLowerCase() === "x") {
      event.preventDefault();
      updatePost(currentPost(), "hide");
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      shuffleDeck();
    } else if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFocus();
    } else if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTrace();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      nextPost();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      previousPost();
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      dom.newSearchButton.click();
    }
  });
  document.addEventListener("error", (event) => {
    if (event.target?.tagName === "IMG") event.target.remove();
  }, true);
}

async function init() {
  let savedScale = 110;
  let savedFocus = false;
  try {
    savedScale = Number(window.localStorage.getItem("signal-text-scale")) || 110;
    savedFocus = window.localStorage.getItem("signal-focus") === "1";
  } catch {
    // Use defaults.
  }
  applyTextScale(savedScale);
  applyFocus(savedFocus);
  setClock();
  window.setInterval(setClock, 15_000);
  bindEvents();
  try {
    if (!TOKEN || TOKEN === "__SIGNAL_TOKEN__") throw new Error("The local app token was not injected. Restart Keyword Deck.");
    const data = await api("/api/bootstrap");
    state.bootstrap = data;
    state.runs = data.runs ?? [];
    state.posts = data.posts ?? {};
    applySettings(data.settings, { updateInput: true });
    renderHistory();
    renderSources(data.sourceStatus ?? {});
    dom.aboutVersion.textContent = data.version ?? "1.0.0";
    updateSearchButton();
    if (data.latestRun) loadRun(data.latestRun, { restored: true });
    else {
      showEmpty("Start with a few keywords.");
      setStatus("Local desk ready");
    }
  } catch (error) {
    setStatus("Local server offline");
    toast(error.message, "error", 8000);
    showEmpty("Keyword Deck could not reach its local server.");
  }
}

init();
