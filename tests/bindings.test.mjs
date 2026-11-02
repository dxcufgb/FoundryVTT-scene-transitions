import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeBinding, resolveBinding, resolveSameScene, phaseDurations, ease,
  DEFAULT_DURATION, MIN_DURATION, MAX_DURATION
} from "../scripts/bindings.js";

const known = new Set(["fade", "iris", "crossfade"]);

test("sanitize: defaults and clamping", () => {
  assert.deepEqual(sanitizeBinding(null, known),
    { transition: "", duration: DEFAULT_DURATION, title: false, titleText: "", titleWhen: "during", sound: "" });
  assert.equal(sanitizeBinding({ duration: 5 }, known).duration, MIN_DURATION);
  assert.equal(sanitizeBinding({ duration: 1e9 }, known).duration, MAX_DURATION);
  assert.equal(sanitizeBinding({ duration: "abc" }, known).duration, DEFAULT_DURATION);
  assert.equal(sanitizeBinding({ title: "yes" }, known).title, false);
  assert.equal(sanitizeBinding({ title: true }, known).title, true);
  assert.equal(sanitizeBinding({ titleText: "  a \n b  " }, known).titleText, "a b");
  assert.equal(sanitizeBinding({ titleText: "x".repeat(500) }, known).titleText.length, 120);
});

test("sanitize: title timing", () => {
  assert.equal(sanitizeBinding({ titleWhen: "before" }, known).titleWhen, "before");
  assert.equal(sanitizeBinding({ titleWhen: "after" }, known).titleWhen, "after");
  assert.equal(sanitizeBinding({ titleWhen: "sometime" }, known).titleWhen, "during");
  assert.equal(sanitizeBinding({}, known).titleWhen, "during");
});

test("sanitize: unknown transitions inherit, none stays", () => {
  assert.equal(sanitizeBinding({ transition: "nope" }, known).transition, "");
  assert.equal(sanitizeBinding({ transition: "none" }, known).transition, "none");
  assert.equal(sanitizeBinding({ transition: "iris" }, known).transition, "iris");
  assert.equal(sanitizeBinding({ transition: 7 }, known).transition, "");
});

test("sanitize: sound paths", () => {
  assert.equal(sanitizeBinding({ sound: "sounds/door.ogg" }, known).sound, "sounds/door.ogg");
  assert.equal(sanitizeBinding({ sound: "https://example.com/a.ogg" }, known).sound, "https://example.com/a.ogg");
  assert.equal(sanitizeBinding({ sound: "javascript:alert(1)" }, known).sound, "");
  assert.equal(sanitizeBinding({ sound: "data:audio/ogg;base64,AAA" }, known).sound, "");
});

const flags = {
  enter: { transition: "iris", duration: 900 },
  from: { A: { transition: "crossfade" }, B: { transition: "" }, C: { transition: "none" } }
};

test("resolve: explicit wins", () => {
  const r = resolveBinding({ fromId: "A", toFlags: flags, explicit: { transition: "fade" }, worldDefault: null, knownIds: known });
  assert.equal(r.source, "explicit");
  assert.equal(r.binding.transition, "fade");
});

test("resolve: explicit none wins too", () => {
  const r = resolveBinding({ fromId: "A", toFlags: flags, explicit: { transition: "none" }, worldDefault: { transition: "fade" }, knownIds: known });
  assert.equal(r.binding.transition, "none");
});

test("resolve: inherit explicit falls through to pair", () => {
  const r = resolveBinding({ fromId: "A", toFlags: flags, explicit: { transition: "" }, worldDefault: null, knownIds: known });
  assert.equal(r.source, "pair");
  assert.equal(r.binding.transition, "crossfade");
});

test("resolve: inherit pair falls through to enter", () => {
  const r = resolveBinding({ fromId: "B", toFlags: flags, worldDefault: null, knownIds: known });
  assert.equal(r.source, "enter");
  assert.equal(r.binding.duration, 900);
});

test("resolve: pair none stops", () => {
  const r = resolveBinding({ fromId: "C", toFlags: flags, worldDefault: { transition: "fade" }, knownIds: known });
  assert.equal(r.binding.transition, "none");
});

test("resolve: world default, and none when unset", () => {
  assert.equal(resolveBinding({ fromId: "X", toFlags: {}, worldDefault: { transition: "fade" }, knownIds: known }).binding.transition, "fade");
  assert.equal(resolveBinding({ fromId: "X", toFlags: null, worldDefault: null, knownIds: known }).binding.transition, "none");
  assert.equal(resolveBinding({ fromId: "X", toFlags: { from: "junk", enter: 5 }, worldDefault: { transition: "bad" }, knownIds: known }).binding.transition, "none");
});

test("same scene: own, default, none", () => {
  assert.equal(resolveSameScene({ stairway: { transition: "iris" }, sameSceneDefault: { transition: "fade" }, knownIds: known }).binding.transition, "iris");
  assert.equal(resolveSameScene({ stairway: { transition: "" }, sameSceneDefault: { transition: "fade" }, knownIds: known }).binding.transition, "fade");
  assert.equal(resolveSameScene({ stairway: null, sameSceneDefault: null, knownIds: known }).binding.transition, "none");
});

test("phases and easing", () => {
  assert.deepEqual(phaseDurations(1501, true), { out: 751, in: 750 });
  assert.deepEqual(phaseDurations(1500, false), { out: 0, in: 1500 });
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  assert.equal(ease(0.5), 0.5);
  assert.equal(ease(-1), 0);
});
