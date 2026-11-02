/**
 * Pure binding logic (no Foundry globals), so it can be unit tested in Node.
 *
 * A binding says which transition plays and how:
 *   { transition, duration, title, titleText, titleWhen, sound }
 * transition: ""      = inherit (use the next fallback)
 *             "none"  = no transition
 *             <id>    = one of the registered transitions
 */

export const INHERIT = "";
export const NONE = "none";
export const DEFAULT_DURATION = 1500;
export const MIN_DURATION = 200;
export const MAX_DURATION = 10000;
export const MAX_TITLE = 120;
export const MAX_SOUND = 500;
/** When the title card shows: over the old scene, halfway through, or over the new scene. */
export const TITLE_WHEN = ["before", "during", "after"];

/** A clean binding from any stored or received value. Unknown transition ids become "inherit". */
export function sanitizeBinding(raw, knownIds) {
  const src = raw && typeof raw === "object" ? raw : {};
  let transition = typeof src.transition === "string" ? src.transition.trim() : INHERIT;
  if (transition !== INHERIT && transition !== NONE && knownIds && !knownIds.has(transition)) transition = INHERIT;
  let duration = Number(src.duration);
  if (!Number.isFinite(duration)) duration = DEFAULT_DURATION;
  duration = Math.round(Math.min(MAX_DURATION, Math.max(MIN_DURATION, duration)));
  const titleText = typeof src.titleText === "string" ? src.titleText.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
  let sound = typeof src.sound === "string" ? src.sound.trim().slice(0, MAX_SOUND) : "";
  // Only plain relative or http(s) paths; no javascript:, data: or other schemes.
  if (sound && /^[a-z][a-z0-9+.-]*:/i.test(sound) && !/^https?:\/\//i.test(sound)) sound = "";
  const titleWhen = TITLE_WHEN.includes(src.titleWhen) ? src.titleWhen : "during";
  return { transition, duration, title: src.title === true, titleText, titleWhen, sound };
}

/** True when the binding decides something (not "inherit"). */
export function isSet(binding) {
  return !!binding && typeof binding.transition === "string" && binding.transition !== INHERIT;
}

/**
 * Picks the binding for a scene change. First match wins:
 *   explicit (activate dialog / stairway) → pair (to.from[fromId]) → to.enter → world default.
 * @param {object} ctx
 * @param {string|null} ctx.fromId      the scene being left
 * @param {object|null} ctx.toFlags     the module flags of the scene being entered ({enter, from})
 * @param {object|null} [ctx.explicit]  an explicit binding, used when it is set
 * @param {object|null} ctx.worldDefault
 * @param {Set<string>} [ctx.knownIds]
 * @returns {{binding: object, source: string}} the binding (transition never "inherit") and where it came from
 */
export function resolveBinding({ fromId, toFlags, explicit, worldDefault, knownIds }) {
  const clean = raw => sanitizeBinding(raw, knownIds);
  if (explicit) {
    const b = clean(explicit);
    if (isSet(b)) return { binding: b, source: "explicit" };
  }
  const flags = toFlags && typeof toFlags === "object" ? toFlags : {};
  if (fromId && flags.from && typeof flags.from === "object" && flags.from[fromId]) {
    const b = clean(flags.from[fromId]);
    if (isSet(b)) return { binding: b, source: "pair" };
  }
  if (flags.enter) {
    const b = clean(flags.enter);
    if (isSet(b)) return { binding: b, source: "enter" };
  }
  const b = clean(worldDefault);
  if (!isSet(b)) b.transition = NONE;
  return { binding: b, source: "default" };
}

/** The same-scene stairway binding: the stairway's own one, else the same-scene default, else none. */
export function resolveSameScene({ stairway, sameSceneDefault, knownIds }) {
  const own = sanitizeBinding(stairway, knownIds);
  if (isSet(own)) return { binding: own, source: "stairway" };
  const b = sanitizeBinding(sameSceneDefault, knownIds);
  if (!isSet(b)) b.transition = NONE;
  return { binding: b, source: "default" };
}

/** Splits a total duration into the out / in phases of a transition. */
export function phaseDurations(duration, split) {
  if (!split) return { out: 0, in: duration };
  const half = Math.round(duration / 2);
  return { out: half, in: duration - half };
}

/** Cubic ease-in-out. */
export function ease(p) {
  const x = Math.min(1, Math.max(0, p));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
