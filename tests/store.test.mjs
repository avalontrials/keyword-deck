import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createStore, publicSettings } from "../lib/store.mjs";

test("store starts blank and masks the Apify token", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "signal-store-"));
  const store = await createStore({ dataDir: dir });
  assert.equal(store.getSettings().defaultKeywords, "");
  assert.equal(store.getSettings().market, "US");
  await store.updateSettings({
    apifyToken: "apify_api_1234567890abcdefghij",
    apifyEnabled: true,
    apifyMaxChargeUsd: 5,
    windowHours: 999,
    market: "CA",
  });
  assert.equal(store.getSettings().market, "CA");
  assert.equal(store.getSettings().windowHours, 168);
  assert.equal(store.getSettings().apifyMaxChargeUsd, 1);
  const safe = publicSettings(store.getSettings());
  assert.equal(safe.apifyTokenSet, true);
  assert.equal(Object.hasOwn(safe, "apifyToken"), false);
  assert.match(safe.apifyTokenHint, /^apify_api_12/);

  const reloaded = await createStore({ dataDir: dir });
  assert.equal(reloaded.getSettings().apifyToken, "apify_api_1234567890abcdefghij");
  assert.equal(reloaded.getSettings().apifyEnabled, true);
  await fs.rm(dir, { recursive: true, force: true });
});

test("post flags and runs persist", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "signal-store-"));
  const store = await createStore({ dataDir: dir });
  await store.updatePost("ABC123", { saved: true, note: "good lead" });
  store.addRun({
    id: "run_test",
    keywords: ["cold brew"],
    query: "cold brew",
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    status: "ok",
    stats: { total: 1 },
    results: [],
  });
  await store.save();
  const reloaded = await createStore({ dataDir: dir });
  assert.equal(reloaded.postState("ABC123").saved, true);
  assert.equal(reloaded.latestRun().id, "run_test");
  assert.deepEqual(reloaded.latestRun().keywords, ["cold brew"]);
  assert.equal(reloaded.stats().saved, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
