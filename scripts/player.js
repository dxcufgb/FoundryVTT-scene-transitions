import { MODULE_ID, sceneName, nextFrame, sleep } from "./util.js";
import { TRANSITIONS, knownIds } from "./transitions.js";
import { resolveBinding, phaseDurations, ease, NONE, TITLE_WHEN } from "./bindings.js";
import { crumb, noteIssue, transitionKey, sourceKey, errorName } from "./debug-recorder.js";

/**
 * The transition player. When the canvas is about to draw another scene, it snapshots the old one onto an overlay
 * above the board (below the UI), plays the "out" phase while the new scene loads underneath, snapshots the new
 * scene once it is ready and plays the "in" phase from the overlay, then removes the overlay.
 */

const TITLE_HOLD = 1600;       // ms the title card stays
const TITLE_FADE = 600;        // ms the title card takes to fade (styles: .dxst-title transition)
const SCENE_TIMEOUT = 30000;   // ms to wait for the new scene before giving up
const LOCAL_TIMEOUT = 3000;    // ms to wait for a same-scene teleport
const PENDING_TTL = 20000;     // ms an explicit choice waits for its scene change
const CLAIM_TIMEOUT = 5000;    // ms a run started ahead of a scene change (stairways) waits for that change
const WATCHDOG_SLACK = 10000;  // ms past a run's longest possible length before its overlay is removed regardless
// The overlay is drawn at most this many pixels (4K). A HiDPI 4K screen would otherwise need canvases of ~130 MB
// each, which can run the GPU out of memory: the WebGL context is lost and the view goes blank (white).
const MAX_PIXELS = 3840 * 2160;

/** An explicit choice for the next change to a scene: {sceneId, binding|null, snapshot|null, ts}. */
let pending = null;
/** The transition that is playing now. */
let current = null;
/** Why a run was cancelled, as recorded for the debug recorder; any other reason is recorded as "cancelled". */
const CANCEL_REASONS = new Set(["cancelled", "superseded", "canvasCleared", "watchdog", "contextLost", "error", "startFailed"]);
/** Run counts for the debug recorder's snapshot. */
const stats = { started: 0, finished: 0, cancelled: 0, skipped: 0, byKind: {}, cancelReasons: {} };

export function setPending(sceneId, { binding = null, snapshot = null } = {}) {
  pending = { sceneId, binding, snapshot, ts: Date.now() };
}

function takePending(sceneId) {
  const p = pending;
  if (!p) return null;
  if (Date.now() - p.ts > PENDING_TTL) { pending = null; return null; }
  if (p.sceneId !== sceneId) return null;
  pending = null;
  return p;
}

export function clientEnabled() {
  try { return game.settings.get(MODULE_ID, "enabled") !== false; } catch { return true; }
}

/** The size the overlay draws at for a view of w × h pixels: the same, or scaled down to MAX_PIXELS. */
export function overlaySize(w, h) {
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, w * h)));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function contextLost(app) {
  try { return !!(app?.renderer?.context?.isLost || app?.renderer?.gl?.isContextLost?.()); } catch { return false; }
}

/** True when a picture came out fully transparent (the browser handed back an empty WebGL buffer). */
function isEmpty(c) {
  try {
    const probe = document.createElement("canvas");
    probe.width = probe.height = 8;
    const x = probe.getContext("2d", { willReadFrequently: true });
    x.drawImage(c, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

/** A 2D copy of what the canvas shows right now, or null. */
export function snapshotCanvas() {
  const app = canvas?.app;
  const view = app?.view;
  if (!view || !view.width || !view.height || !canvas.ready || contextLost(app)) return null;
  try {
    app.renderer.render(app.stage);
    const { w, h } = overlaySize(view.width, view.height);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const x = c.getContext("2d");
    if (!x) throw new Error(`no 2D context for a ${w}×${h} canvas`);
    x.drawImage(view, 0, 0, w, h);
    if (isEmpty(c)) {
      console.warn(`${MODULE_ID} | snapshot came out empty (the browser did not hand back the WebGL picture)`);
      noteIssue("run", "snapshotEmpty", { w, h });
      return null;
    }
    return c;
  } catch (err) {
    console.warn(`${MODULE_ID} | snapshot failed`, err);
    noteIssue("run", "snapshotFailed", { error: errorName(err) });
    return null;
  }
}

/** Frees a canvas's pixels now instead of whenever it is garbage collected. */
function release(c) {
  if (c instanceof HTMLCanvasElement) { c.width = 0; c.height = 0; }
}

function blank(w, h) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#000";
  x.fillRect(0, 0, w, h);
  return c;
}

/** Runs onFrame(raw 0..1) every animation frame for ms milliseconds. */
function animate(ms, onFrame, isCancelled) {
  return new Promise(resolve => {
    const start = performance.now();
    const step = now => {
      if (isCancelled()) return resolve(false);
      const raw = ms > 0 ? Math.min(1, (now - start) / ms) : 1;
      try { onFrame(raw); } catch (err) { console.error(`${MODULE_ID} | frame failed`, err); return resolve(false); }
      if (raw >= 1) return resolve(true);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function playSound(src) {
  if (!src) return;
  try {
    const volume = game.settings.get("core", "globalInterfaceVolume") ?? 0.5;
    foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
  } catch (err) {
    console.warn(`${MODULE_ID} | sound failed`, err);
  }
}

class Run {
  constructor(def, binding, A, { kind, title, context, claimFor = null, previewB = null }) {
    this.def = def;
    this.previewB = previewB;
    this.claimFor = claimFor;
    this.binding = binding;
    this.kind = kind;
    this.context = context;
    this.title = title;
    this.state = {};
    this.cancelled = false;
    this.arrived = false;
    const view = canvas.app?.view;
    const size = overlaySize(view?.width || window.innerWidth, view?.height || window.innerHeight);
    this.w = A?.width || size.w;
    this.h = A?.height || size.h;
    this.hadA = !!A;
    this.A = A ?? blank(this.w, this.h);
    this.durations = phaseDurations(binding.duration, def.split);
  }

  start() {
    this.t0 = performance.now();
    const el = document.createElement("div");
    el.id = "dxst-overlay";
    el.className = "dxst-overlay";
    el.innerHTML = `<canvas></canvas><div class="dxst-title"><span></span></div>`;
    const board = document.getElementById("board");
    if (board?.parentElement) board.after(el);
    else document.body.append(el);
    this.el = el;
    this.cv = el.querySelector("canvas");
    this.cv.width = this.w;
    this.cv.height = this.h;
    this.ctx = this.cv.getContext("2d");
    this.ctx.drawImage(this.A, 0, 0, this.w, this.h);
    if (this.title) el.querySelector(".dxst-title span").textContent = this.title;
    playSound(this.binding.sound);
    Hooks.callAll("dxcufgbsSceneTransitionStart", this.context);

    // When the title card shows: "before" (from the start, over the old scene), "during" (around the middle) or
    // "after" (over the new scene once it is live). Before and during never hold the transition up.
    this.titleWhen = this.title ? (this.binding.titleWhen ?? "during") : null;
    if (this.titleWhen === "before") this.scheduleTitle(0);
    else if (this.titleWhen === "during" && this.def.split) this.scheduleTitle(this.durations.out * 0.6);
    this.outDone = this.def.split
      ? animate(this.durations.out, raw => this.frame("out", raw), () => this.cancelled).then(() => this.hold())
      : Promise.resolve();

    const timeout = this.kind === "local" ? LOCAL_TIMEOUT : SCENE_TIMEOUT;
    this.timer = setTimeout(() => {
      if (!this.arrived && !this.cancelled) noteIssue("run", "timeout", { kind: this.kind, ms: timeout });
      this.arrive();
    }, timeout);
    // Started ahead of a scene change (a stairway): if the change doesn't come, play back into the current view
    if (this.claimFor) this.claimTimer = setTimeout(() => {
      if (!this.arrived && !this.cancelled) noteIssue("run", "claimTimeout", { ms: CLAIM_TIMEOUT });
      this.arrive();
    }, CLAIM_TIMEOUT);
    // Whatever goes wrong, the overlay never stays up past the longest a run can take
    const longest = timeout + CLAIM_TIMEOUT + this.durations.out + this.durations.in + TITLE_HOLD + TITLE_FADE;
    this.watchdog = setTimeout(() => {
      console.warn(`${MODULE_ID} | the transition did not finish in time, removing it`);
      noteIssue("run", "watchdog", { kind: this.kind, transition: transitionKey(this.def.id) });
      this.cancel("watchdog");
    }, longest + WATCHDOG_SLACK);
    // The game canvas lost its WebGL context (GPU reset or out of memory): get out of the way
    this.onContextLost = () => {
      console.warn(`${MODULE_ID} | the canvas lost its WebGL context, stopping the transition`);
      noteIssue("run", "contextLost", { kind: this.kind });
      this.cancel("contextLost");
    };
    canvas.app?.view?.addEventListener?.("webglcontextlost", this.onContextLost);
    stats.started++;
    stats.byKind[this.kind] = (stats.byKind[this.kind] ?? 0) + 1;
    crumb("run.start", {
      kind: this.kind,
      transition: transitionKey(this.def.id),
      source: sourceKey(this.context?.source),
      stairway: !!this.context?.stairway,
      split: !!this.def.split,
      hold: !!this.def.hold,
      durationMs: Number.isFinite(this.binding.duration) ? this.binding.duration : null,
      title: !!this.title,
      titleWhen: TITLE_WHEN.includes(this.titleWhen) ? this.titleWhen : null,
      sound: !!this.binding.sound,
      aheadOfChange: !!this.claimFor,
      snapshotA: this.hadA
    });
    if (this.kind === "preview") this.arrive();
  }

  frame(phase, raw) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    const t = performance.now() - this.t0;
    this.def.draw(ctx, { phase, p: ease(raw), raw, A: this.A, B: this.B, w, h, state: this.state, t });
    ctx.restore();
  }

  /** Transitions with hold: true keep moving (p = 1) while the new scene loads, until the "in" phase starts. */
  hold() {
    if (!this.def.hold || this.cancelled) return;
    const loop = () => {
      if (this.cancelled || this.inStarted) return;
      try { this.frame("out", 1); } catch (err) { console.error(`${MODULE_ID} | frame failed`, err); return; }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** The scene change this run was started for has begun: keep waiting for canvasReady. */
  claim() {
    clearTimeout(this.claimTimer);
    this.claimFor = null;
    this.claimed = true;
  }

  /** The new view is ready (or we stop waiting): snapshot it and play the "in" phase. */
  arrive(prepare) {
    if (this.arrived || this.cancelled) return;
    this.arrived = true;
    clearTimeout(this.timer);
    clearTimeout(this.claimTimer);
    this.finish(prepare).catch(err => {
      console.error(`${MODULE_ID} | transition failed`, err);
      noteIssue("run", "failed", { kind: this.kind, transition: transitionKey(this.def.id), error: errorName(err) });
      // cancel(), not just remove(): it also stops the hold loop and the title timers
      this.cancel("error");
    });
  }

  async finish(prepare) {
    await this.outDone;
    if (this.cancelled) return;
    if (prepare) await prepare();
    // Let the new scene render a couple of frames (textures, lighting) before taking its picture
    await nextFrame();
    await nextFrame();
    if (this.cancelled) return;
    this.B = (this.kind === "preview" ? (this.previewB ?? this.A) : snapshotCanvas()) ?? blank(this.w, this.h);
    crumb("run.in", { kind: this.kind, transition: transitionKey(this.def.id), waitedMs: Math.round(performance.now() - this.t0) });
    this.inStarted = true;
    if (this.titleWhen === "during" && !this.def.split) this.scheduleTitle(this.durations.in * 0.3);
    await animate(this.durations.in, raw => this.frame("in", raw), () => this.cancelled);
    if (this.cancelled) return;
    this.outcome = "finished";
    if (this.titleWhen === "after") this.scheduleTitle(0);
    // A title card still on screen stays over the live scene until it has faded
    const left = this.titleWhen === "after" ? TITLE_HOLD : (this.titleUntil ?? 0) - performance.now();
    if (left > -TITLE_FADE) {
      this.cv.remove();
      await sleep(left + TITLE_FADE);
    }
    this.remove();
  }

  /** Shows the title card after delay ms, for TITLE_HOLD ms, without holding the transition up. */
  scheduleTitle(delay) {
    if (!this.title) return;
    this.titleUntil = performance.now() + delay + TITLE_HOLD;
    this.titleTimers = [
      setTimeout(() => { if (!this.cancelled) this.el?.classList.add("dxst-title-on"); }, delay),
      setTimeout(() => this.el?.classList.remove("dxst-title-on"), delay + TITLE_HOLD)
    ];
  }

  /** Stops the run and removes the overlay. reason (for the debug recorder): one of this module's fixed reasons. */
  cancel(reason = "cancelled") {
    if (!this.removed && !this.outcome) this.cancelReason ??= CANCEL_REASONS.has(reason) ? reason : "cancelled";
    this.cancelled = true;
    for (const timer of this.titleTimers ?? []) clearTimeout(timer);
    clearTimeout(this.timer);
    clearTimeout(this.claimTimer);
    this.remove();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.cancelled = true;
    clearTimeout(this.watchdog);
    clearTimeout(this.timer);
    clearTimeout(this.claimTimer);
    canvas.app?.view?.removeEventListener?.("webglcontextlost", this.onContextLost);
    this.el?.remove();
    for (const c of [this.cv, this.A, this.B, this.previewB, ...Object.values(this.state)]) release(c);
    if (current === this) current = null;
    const outcome = this.outcome ?? "cancelled";
    if (outcome === "finished") stats.finished++;
    else {
      stats.cancelled++;
      const reason = this.cancelReason ?? "cancelled";
      stats.cancelReasons[reason] = (stats.cancelReasons[reason] ?? 0) + 1;
    }
    crumb("run.end", {
      kind: this.kind,
      transition: transitionKey(this.def.id),
      outcome,
      reason: outcome === "finished" ? null : (this.cancelReason ?? "cancelled"),
      ms: Math.round(performance.now() - (this.t0 ?? performance.now()))
    });
    Hooks.callAll("dxcufgbsSceneTransitionEnd", this.context);
  }
}

/**
 * Starts a transition now. kind: "scene" (waits for canvasReady), "local" (the caller calls run.arrive()) or "preview".
 * claimFor: a scene id when the run starts ahead of the change to that scene (a stairway); the canvas wrapper then
 * keeps this run instead of starting a new one.
 * Returns the run, or null when nothing plays.
 */
export function startRun(binding, { A = null, kind = "scene", title = "", context = {}, claimFor = null, previewB = null } = {}) {
  if (!binding || binding.transition === NONE) return null;
  const skip = reason => {
    stats.skipped++;
    crumb("run.skip", { kind, reason, transition: transitionKey(binding?.transition) });
    return null;
  };
  // A hidden tab gets no animation frames, so the overlay would hang there until the user comes back
  if (document.hidden) return skip("hiddenTab");
  const def = TRANSITIONS.get(binding.transition);
  if (!def) return skip("unknownTransition");
  const ctx = { ...context, binding, kind };
  if (Hooks.call("dxcufgbsPreSceneTransition", ctx) === false) return skip("hookCancelled");
  const finalDef = TRANSITIONS.get(ctx.binding?.transition) ?? def;
  if (ctx.binding?.transition === NONE) return skip("hookNone");
  current?.cancel("superseded");
  const run = new Run(finalDef, ctx.binding ?? binding, A ?? snapshotCanvas(), { kind, title, context: ctx, claimFor, previewB });
  current = run;
  try {
    run.start();
  } catch (err) {
    console.error(`${MODULE_ID} | could not start the transition`, err);
    noteIssue("run", "startFailed", { kind, transition: transitionKey(finalDef.id), error: errorName(err) });
    run.cancel("startFailed");
    return null;
  }
  return run;
}

export function currentRun() {
  return current;
}

/** Player state for the debug recorder's snapshot: counts, booleans and fixed ids only. */
export function playerDebugState() {
  const run = current;
  const pend = pending && Date.now() - pending.ts <= PENDING_TTL ? pending : null;
  return {
    runs: { ...stats, byKind: { ...stats.byKind }, cancelReasons: { ...stats.cancelReasons } },
    current: run ? {
      kind: run.kind,
      transition: transitionKey(run.def?.id),
      split: !!run.def?.split,
      hold: !!run.def?.hold,
      arrived: !!run.arrived,
      inStarted: !!run.inStarted,
      claimed: !!run.claimed,
      waitingForClaim: !!run.claimFor,
      cancelled: !!run.cancelled,
      textured: typeof run.state?.textured === "boolean" ? run.state.textured : null,
      ageMs: run.t0 ? Math.round(performance.now() - run.t0) : 0
    } : null,
    overlayInDom: !!document.getElementById("dxst-overlay"),
    pending: pend ? {
      explicit: !!pend.binding,
      transition: pend.binding ? transitionKey(pend.binding.transition) : null,
      hasSnapshot: !!pend.snapshot,
      ageMs: Date.now() - pend.ts,
      forViewedScene: pend.sceneId === canvas?.scene?.id
    } : null
  };
}

/** The binding a scene change from → to uses on this client, with an optional explicit one. */
export function bindingFor(from, to, explicit = null) {
  return resolveBinding({
    fromId: from?.id ?? null,
    toFlags: to?.flags?.[MODULE_ID] ?? null,
    explicit,
    worldDefault: game.settings.get(MODULE_ID, "defaultBinding"),
    knownIds: knownIds()
  });
}

function titleFor(binding, scene) {
  if (!binding.title) return "";
  return binding.titleText || sceneName(scene);
}

/** Called right before the canvas draws a scene. Starts a transition when the view changes to another scene. */
function beforeDraw(cnv, scene) {
  const from = cnv.scene;
  // draw(null) clears the canvas: there is no scene to go to, and a transition still playing has nothing to land on
  if (scene === null) {
    if (current) crumb("canvas.draw", { decision: "cleared" });
    current?.cancel("canvasCleared");
    return;
  }
  const to = scene ?? game.scenes.current;
  if (!from || !to || from.id === to.id || !cnv.ready || cnv.loading) return;
  // A run already started for this change (a stairway) carries on
  if (current && !current.arrived && !current.cancelled && current.claimFor === to.id) {
    current.claim();
    takePending(to.id);
    crumb("canvas.draw", { decision: "claimed" });
    return;
  }
  const p = takePending(to.id);
  if (!clientEnabled()) {
    crumb("canvas.draw", { decision: "disabled", pending: !!p });
    return;
  }
  // A GM just looking at another scene gets no transition, unless they asked for it or chose one
  if (!p && game.user.isGM && !game.settings.get(MODULE_ID, "gmView")) {
    crumb("canvas.draw", { decision: "gmView" });
    return;
  }
  const { binding, source } = bindingFor(from, to, p?.binding ?? null);
  crumb("canvas.draw", {
    decision: binding.transition === NONE ? "none" : "start",
    pending: !!p,
    explicit: !!p?.binding,
    source: sourceKey(source),
    transition: transitionKey(binding.transition)
  });
  if (binding.transition === NONE) return;
  startRun(binding, {
    A: p?.snapshot ?? null,
    kind: "scene",
    title: titleFor(binding, to),
    context: { from: from.id, to: to.id, source }
  });
}

/** Wraps Canvas#draw so the old scene can be captured before it is torn down. */
export function patchCanvasDraw() {
  const proto = foundry.canvas.Canvas.prototype;
  const original = proto.draw;
  proto.draw = function (scene, ...rest) {
    try {
      beforeDraw(this, scene);
    } catch (err) {
      console.error(`${MODULE_ID} | could not start the transition`, err);
    }
    return original.call(this, scene, ...rest);
  };
}

export function onCanvasReady() {
  // A run still waiting for its scene change to begin (claimFor) belongs to a later draw
  if (current?.kind === "scene" && !current.claimFor) current.arrive();
}

/** Loads an image, or resolves null. */
function loadImage(src) {
  if (!src) return Promise.resolve(null);
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * The "new scene" picture for an on-screen preview: the target scene's thumbnail, scaled to cover the view, or else
 * a recoloured copy of the current view, so one-phase transitions (crossfade, wipe…) visibly change something.
 */
async function previewPicture(A, toScene) {
  const w = A.width, h = A.height;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  const img = toScene && toScene.id !== canvas.scene?.id ? await loadImage(toScene.thumb) : null;
  if (img) {
    const scale = Math.max(w / img.width, h / img.height);
    x.drawImage(img, (w - img.width * scale) / 2, (h - img.height * scale) / 2, img.width * scale, img.height * scale);
  } else {
    x.filter = "hue-rotate(150deg) saturate(1.3) brightness(0.85)";
    x.drawImage(A, 0, 0);
    x.filter = "none";
  }
  return c;
}

/**
 * Plays a binding over the current view, for trying it out. The "new scene" is toScene's thumbnail when given (and
 * not the scene on screen), otherwise a recoloured copy of the view.
 */
export async function previewOnScreen(binding, title = "", toScene = null) {
  if (!canvas?.ready) return null;
  const A = snapshotCanvas();
  if (!A) return null;
  const previewB = await previewPicture(A, toScene);
  const name = sceneName(toScene) || title || sceneName(canvas.scene);
  return startRun(binding, {
    A,
    previewB,
    kind: "preview",
    title: binding.title ? (binding.titleText || name) : "",
    context: { preview: true }
  });
}

export { titleFor };
