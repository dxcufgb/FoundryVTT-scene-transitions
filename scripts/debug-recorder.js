import { MODULE_ID } from "./util.js";
import { BUILTIN_TRANSITIONS } from "./transitions.js";
import { CINEMATIC_TRANSITIONS } from "./cinematic.js";

/**
 * Optional integration with Dxcufgb's Debug Recorder (dxcufgbs-debug-recorder). Not a dependency: without the
 * recorder installed every function here does nothing, and nothing here may ever throw into the module.
 *
 * - registerDebugRecorder(snapshot) hands the recorder a snapshot() of this module's runtime state, once, whichever
 *   loads first (the recorder's ready hook, or this module's init/ready when the recorder's API already exists).
 * - crumb(key, data) leaves a breadcrumb ("area.action", small flat data) while the recorder is recording.
 * - noteIssue(area, reason, data) counts a fallback / error (shown in the snapshot) and leaves an "<area>.fallback"
 *   breadcrumb for it.
 *
 * Snapshot and breadcrumb data must never contain names, free text, image or sound paths, or URLs: only counts,
 * booleans, numbers and this module's own fixed ids (built-in transition ids, kinds, sources). Transitions that
 * other modules registered are reported as "custom" (transitionKey).
 */

const RECORDER_ID = "dxcufgbs-debug-recorder";
/** This module's own transition ids; anything else (registered by another module) is reported as "custom". */
const BUILTIN_IDS = new Set([...BUILTIN_TRANSITIONS, ...CINEMATIC_TRANSITIONS].map(d => d.id));

let recorderApi = null;
let snapshotFn = null;
let registered = false;
const issues = {};
let lastIssue = null;

/** The recorder's API, or null when it isn't installed (or reading it fails). */
function recorder() {
  try {
    return recorderApi ?? globalThis.game?.modules?.get?.(RECORDER_ID)?.api ?? null;
  } catch {
    return null;
  }
}

/** The snapshot handed to the recorder: never throws, returns {snapshotFailed: true} when building it fails. */
function safeSnapshot() {
  try {
    return snapshotFn ? snapshotFn() : {};
  } catch (err) {
    console.warn(`${MODULE_ID} | debug recorder snapshot failed`, err);
    return { snapshotFailed: true };
  }
}

/**
 * Registers with the recorder when both it and the snapshot are there, once. Only a successful register() (it
 * returns false on failure) counts, so a later call tries again.
 */
function tryRegister() {
  if (registered || !snapshotFn) return;
  try {
    const rec = recorder();
    if (typeof rec?.register !== "function") return;
    if (rec.register(MODULE_ID, { snapshot: safeSnapshot }) !== false) registered = true;
  } catch (err) {
    console.warn(`${MODULE_ID} | could not register with the debug recorder`, err);
  }
}

Hooks.once(`${RECORDER_ID}.ready`, rec => {
  recorderApi = rec ?? null;
  tryRegister();
});

/** Registers this module's snapshot with the recorder (safe to call more than once; registers only once). */
export function registerDebugRecorder(snapshot) {
  if (typeof snapshot === "function") snapshotFn = snapshot;
  tryRegister();
}

/** A breadcrumb while the recorder is recording; otherwise nothing. */
export function crumb(key, data) {
  try {
    const rec = recorder();
    if (!rec?.isRecording?.()) return;
    rec.breadcrumb(MODULE_ID, key, data);
  } catch {
    // a recorder problem must never break the module
  }
}

/** A transition id that is safe to record: a built-in id, "" (inherit), "none", or "custom". */
export function transitionKey(id) {
  if (id === "" || id === "none" || BUILTIN_IDS.has(id)) return id;
  return id == null ? null : "custom";
}

const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "EvalError",
  "URIError", "AggregateError", "DOMException", "AbortError", "NotFoundError", "NotAllowedError", "NotSupportedError",
  "InvalidStateError", "SecurityError", "QuotaExceededError"]);
/** An error's class name when it is a standard one, else "Error" (never the message, which can hold names). */
export function errorName(err) {
  try {
    const name = err?.name;
    return typeof name === "string" && ERROR_NAMES.has(name) ? name : "Error";
  } catch {
    return "Error";
  }
}

const SOURCES = new Set(["explicit", "pair", "enter", "default", "stairway"]);
/** Where a binding came from, when it is one of this module's own sources; otherwise null. */
export function sourceKey(source) {
  return SOURCES.has(source) ? source : null;
}

/**
 * Counts a fallback or error (for the snapshot) and leaves an "<area>.fallback" breadcrumb with its reason.
 * area and reason are this module's own fixed words (e.g. "run", "watchdog").
 */
export function noteIssue(area, reason, data) {
  const key = `${area}.${reason}`;
  issues[key] = (issues[key] ?? 0) + 1;
  lastIssue = key;
  crumb(`${area}.fallback`, { reason, ...data });
}

/** The fallback / error counts so far ("area.reason" → count) and the last one, for the snapshot. */
export function issueSummary() {
  return { counts: { ...issues }, last: lastIssue };
}
