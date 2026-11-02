import { MODULE_ID, sceneName, nextFrame, sleep } from "./util.js";
import { TRANSITIONS, knownIds } from "./transitions.js";
import { resolveBinding, phaseDurations, ease, NONE } from "./bindings.js";

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

/** An explicit choice for the next change to a scene: {sceneId, binding|null, snapshot|null, ts}. */
let pending = null;
/** The transition that is playing now. */
let current = null;

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

/** A 2D copy of what the canvas shows right now, or null. */
export function snapshotCanvas() {
  const app = canvas?.app;
  const view = app?.view;
  if (!view || !view.width || !view.height || !canvas.ready) return null;
  try {
    app.renderer.render(app.stage);
    const c = document.createElement("canvas");
    c.width = view.width;
    c.height = view.height;
    c.getContext("2d").drawImage(view, 0, 0);
    return c;
  } catch (err) {
    console.warn(`${MODULE_ID} | snapshot failed`, err);
    return null;
  }
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
  constructor(def, binding, A, { kind, title, context, claimFor = null }) {
    this.def = def;
    this.claimFor = claimFor;
    this.binding = binding;
    this.kind = kind;
    this.context = context;
    this.title = title;
    this.state = {};
    this.cancelled = false;
    this.arrived = false;
    const view = canvas.app?.view;
    this.w = A?.width || view?.width || window.innerWidth;
    this.h = A?.height || view?.height || window.innerHeight;
    this.A = A ?? blank(this.w, this.h);
    this.durations = phaseDurations(binding.duration, def.split);
  }

  start() {
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
      ? animate(this.durations.out, raw => this.frame("out", raw), () => this.cancelled)
      : Promise.resolve();

    const timeout = this.kind === "local" ? LOCAL_TIMEOUT : SCENE_TIMEOUT;
    this.timer = setTimeout(() => this.arrive(), timeout);
    // Started ahead of a scene change (a stairway): if the change doesn't come, play back into the current view
    if (this.claimFor) this.claimTimer = setTimeout(() => this.arrive(), CLAIM_TIMEOUT);
    if (this.kind === "preview") this.arrive();
  }

  frame(phase, raw) {
    const { ctx, w, h } = this;
    ctx.save();
    ctx.clearRect(0, 0, w, h);
    this.def.draw(ctx, { phase, p: ease(raw), raw, A: this.A, B: this.B, w, h, state: this.state });
    ctx.restore();
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
      this.remove();
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
    this.B = (this.kind === "preview" ? this.A : snapshotCanvas()) ?? blank(this.w, this.h);
    if (this.titleWhen === "during" && !this.def.split) this.scheduleTitle(this.durations.in * 0.3);
    await animate(this.durations.in, raw => this.frame("in", raw), () => this.cancelled);
    if (this.cancelled) return;
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

  cancel() {
    this.cancelled = true;
    for (const timer of this.titleTimers ?? []) clearTimeout(timer);
    clearTimeout(this.timer);
    clearTimeout(this.claimTimer);
    this.remove();
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.el?.remove();
    if (current === this) current = null;
    Hooks.callAll("dxcufgbsSceneTransitionEnd", this.context);
  }
}

/**
 * Starts a transition now. kind: "scene" (waits for canvasReady), "local" (the caller calls run.arrive()) or "preview".
 * claimFor: a scene id when the run starts ahead of the change to that scene (a stairway); the canvas wrapper then
 * keeps this run instead of starting a new one.
 * Returns the run, or null when nothing plays.
 */
export function startRun(binding, { A = null, kind = "scene", title = "", context = {}, claimFor = null } = {}) {
  if (!binding || binding.transition === NONE) return null;
  // A hidden tab gets no animation frames, so the overlay would hang there until the user comes back
  if (document.hidden) return null;
  const def = TRANSITIONS.get(binding.transition);
  if (!def) return null;
  const ctx = { ...context, binding, kind };
  if (Hooks.call("dxcufgbsPreSceneTransition", ctx) === false) return null;
  const finalDef = TRANSITIONS.get(ctx.binding?.transition) ?? def;
  if (ctx.binding?.transition === NONE) return null;
  current?.cancel();
  const run = new Run(finalDef, ctx.binding ?? binding, A ?? snapshotCanvas(), { kind, title, context: ctx, claimFor });
  current = run;
  run.start();
  return run;
}

export function currentRun() {
  return current;
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
  const to = scene ?? game.scenes.current;
  if (!from || !to || from.id === to.id || !cnv.ready || cnv.loading) return;
  // A run already started for this change (a stairway) carries on
  if (current && !current.arrived && !current.cancelled && current.claimFor === to.id) {
    current.claim();
    takePending(to.id);
    return;
  }
  const p = takePending(to.id);
  if (!clientEnabled()) return;
  // A GM just looking at another scene gets no transition, unless they asked for it or chose one
  if (!p && game.user.isGM && !game.settings.get(MODULE_ID, "gmView")) return;
  const { binding, source } = bindingFor(from, to, p?.binding ?? null);
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

/** Plays a binding over the current view (A → A), for trying it out. */
export function previewOnScreen(binding, title = "") {
  if (!canvas?.ready) return null;
  return startRun(binding, { kind: "preview", title: binding.title ? (binding.titleText || title || sceneName(canvas.scene)) : "", context: { preview: true } });
}

export { titleFor };
