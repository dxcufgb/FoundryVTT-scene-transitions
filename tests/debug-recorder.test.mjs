import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// The module registers a Hooks.once listener when it loads, so every test loads a fresh copy (query string) after
// setting up a mocked Foundry: `hooks` holds the listeners, `modules` what game.modules.get returns.
const RECORDER_ID = "dxcufgbs-debug-recorder";
const MODULE_ID = "dxcufgbs-scene-transitions";
let hooks;
let modules;
let copy = 0;

beforeEach(() => {
  hooks = new Map();
  modules = new Map();
  globalThis.Hooks = { once: (name, fn) => hooks.set(name, fn) };
  globalThis.game = { modules: { get: id => modules.get(id) } };
});

async function load() {
  return import(`../scripts/debug-recorder.js?copy=${++copy}`);
}

/** A stand-in for the recorder's API that records register() calls. */
function fakeRecorder({ result = true, throws = false } = {}) {
  const calls = [];
  return {
    calls,
    register(moduleId, options) {
      calls.push({ moduleId, options });
      if (throws) throw new Error("boom");
      return result;
    },
    breadcrumb() {},
    isRecording: () => false
  };
}

test("registers at once when the recorder's api already exists (recorder loaded first)", async () => {
  const rec = fakeRecorder();
  modules.set(RECORDER_ID, { api: rec });
  const dr = await load();
  dr.registerDebugRecorder(() => ({ a: 1 }));
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].moduleId, MODULE_ID);
  assert.deepEqual(rec.calls[0].options.snapshot(), { a: 1 });
  // later calls (init, ready) and the recorder's ready hook don't register again
  dr.registerDebugRecorder(() => ({ a: 2 }));
  hooks.get(`${RECORDER_ID}.ready`)(rec);
  assert.equal(rec.calls.length, 1);
});

test("registers on the recorder's ready hook when its api isn't there yet", async () => {
  const dr = await load();
  dr.registerDebugRecorder(() => ({ b: 1 }));
  assert.ok(hooks.has(`${RECORDER_ID}.ready`), "listens for the recorder's ready hook");
  const rec = fakeRecorder();
  hooks.get(`${RECORDER_ID}.ready`)(rec);
  assert.equal(rec.calls.length, 1);
  assert.equal(rec.calls[0].moduleId, MODULE_ID);
  assert.deepEqual(rec.calls[0].options.snapshot(), { b: 1 });
});

test("the ready hook before the snapshot is known registers on the next registerDebugRecorder", async () => {
  const dr = await load();
  const rec = fakeRecorder();
  hooks.get(`${RECORDER_ID}.ready`)(rec);
  assert.equal(rec.calls.length, 0);
  dr.registerDebugRecorder(() => ({ c: 1 }));
  assert.equal(rec.calls.length, 1);
});

test("does nothing without the recorder", async () => {
  const dr = await load();
  assert.doesNotThrow(() => dr.registerDebugRecorder(() => ({})));
  modules.set(RECORDER_ID, { active: false }); // installed but not active: no api
  assert.doesNotThrow(() => dr.registerDebugRecorder(() => ({})));
  assert.doesNotThrow(() => dr.crumb("run.start", { n: 1 }));
  assert.doesNotThrow(() => dr.noteIssue("run", "error"));
});

test("a failed register (false or throwing) is retried on the next call and never throws", async () => {
  const failing = fakeRecorder({ result: false });
  modules.set(RECORDER_ID, { api: failing });
  const dr = await load();
  dr.registerDebugRecorder(() => ({}));
  dr.registerDebugRecorder(() => ({}));
  assert.equal(failing.calls.length, 2);

  const throwing = fakeRecorder({ throws: true });
  modules.set(RECORDER_ID, { api: throwing });
  const dr2 = await load();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.doesNotThrow(() => dr2.registerDebugRecorder(() => ({})));
  } finally {
    console.warn = warn;
  }
  const ok = fakeRecorder();
  modules.set(RECORDER_ID, { api: ok });
  dr2.registerDebugRecorder(() => ({}));
  assert.equal(ok.calls.length, 1);
});

test("a throwing snapshot gives {snapshotFailed: true} instead of throwing into the recorder", async () => {
  const rec = fakeRecorder();
  modules.set(RECORDER_ID, { api: rec });
  const dr = await load();
  dr.registerDebugRecorder(() => { throw new Error("nope"); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(rec.calls[0].options.snapshot(), { snapshotFailed: true });
  } finally {
    console.warn = warn;
  }
});
