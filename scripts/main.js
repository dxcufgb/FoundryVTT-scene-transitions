/**
 * Dxcufgb's Scene Transitions — entry point.
 *
 * Plays a transition when the view changes from one scene to another. The GM binds transitions to scene pairs
 * (A → B), to scenes ("entering this scene"), to Stairways stairway ends, and sets a world default; and picks one in a
 * dialog when activating a scene.
 *
 * API: game.modules.get("dxcufgbs-scene-transitions").api
 *   transitions                    → [{id, label, icon, split, hold, group}] the registered transitions
 *   register(id, definition)       → adds a transition: {label, icon, split, hold?, group?, draw(ctx, frame)} (see scripts/transitions.js)
 *   resolve({from, to, explicit?}) → {binding, source} the binding a change from → to uses on this client
 *   activate(scene, binding?)      → GM: activates a scene for everyone with this binding (no dialog); without a
 *                                    binding each client uses its bound transition; {transition: "none"} for none
 *   view(scene, binding?)          → this client views a scene with this binding (or its bound one)
 *   preview(binding, toScene?)     → plays a binding over the current view on this client (toScene's thumbnail as the
 *                                    "new scene", or a recoloured copy of the view)
 *   sanitize(binding)              → a clean binding
 *   openManager(sceneId?)          → GM: opens the Transitions manager
 * A binding is {transition, duration (ms), title (bool), titleText, titleWhen ("before" | "during" | "after"), sound};
 * transition "" = inherit, "none" = none.
 *
 * Hooks:
 *   dxcufgbsPreSceneTransition(context)   → return false to cancel; context.binding can be changed
 *   dxcufgbsSceneTransitionStart(context) / dxcufgbsSceneTransitionEnd(context)
 *   context = {binding, kind ("scene" | "local" | "preview"), from, to, source, stairway?}
 */
import { MODULE_ID, t, sceneName, isResponsibleGM, stairwaysActive } from "./util.js";
import { TRANSITIONS, knownIds, registerTransition, warmTints } from "./transitions.js";
import { sanitizeBinding, NONE } from "./bindings.js";
import { patchCanvasDraw, onCanvasReady, bindingFor, setPending, previewOnScreen, playerDebugState } from "./player.js";
import { patchActivate, activateWith, onPreUpdateScene, onUpdateScene, activateDebugState } from "./activate.js";
import { registerStairways, stairwaysDebugState } from "./stairways.js";
import { loadTextures, textureStats } from "./textures.js";
import { TransitionManager, stairwaysOn } from "./apps/manager.js";
import { registerDebugRecorder, issueSummary, transitionKey } from "./debug-recorder.js";

let originalActivate = null;
let canvasDrawPatched = false;
let activatePatched = false;

/**
 * Runtime state for Dxcufgb's Debug Recorder (optional, see scripts/debug-recorder.js). Counts, booleans and this
 * module's own ids only: no scene, stairway or user names, no title texts, no sound paths.
 */
function debugSnapshot() {
  const known = knownIds();
  const defs = [...TRANSITIONS.values()];
  const byGroup = {};
  for (const d of defs) byGroup[d.group ?? "custom"] = (byGroup[d.group ?? "custom"] ?? 0) + 1;

  const bindings = { scenesWithEnter: 0, scenesWithAny: 0, pair: 0, stairway: 0, stairwaySameScene: 0, withTitle: 0, withSound: 0, unknownTransition: 0, orphanPair: 0 };
  const byTransition = {};
  const count = raw => {
    if (!raw || typeof raw !== "object") return;
    const id = typeof raw.transition === "string" ? raw.transition.trim() : "";
    if (id && id !== NONE && !known.has(id)) bindings.unknownTransition++;
    const b = sanitizeBinding(raw, known);
    const key = transitionKey(b.transition);
    byTransition[key] = (byTransition[key] ?? 0) + 1;
    if (b.title) bindings.withTitle++;
    if (b.sound) bindings.withSound++;
  };
  let stairwaysPlaced = 0;
  for (const scene of game.scenes ?? []) {
    const flags = scene.flags?.[MODULE_ID];
    if (stairwaysActive()) stairwaysPlaced += stairwaysOn(scene).length;
    if (!flags || typeof flags !== "object") continue;
    let any = false;
    if (flags.enter) { bindings.scenesWithEnter++; count(flags.enter); any = true; }
    for (const [fromId, raw] of Object.entries(flags.from ?? {})) {
      bindings.pair++;
      if (!game.scenes.has(fromId)) bindings.orphanPair++;
      count(raw);
      any = true;
    }
    const placed = new Map(stairwaysOn(scene).map(s => [s._id, s]));
    for (const [stairId, raw] of Object.entries(flags.stairways ?? {})) {
      bindings.stairway++;
      const s = placed.get(stairId);
      if (s && (!s.scene || s.scene === scene.id)) bindings.stairwaySameScene++;
      count(raw);
      any = true;
    }
    if (any) bindings.scenesWithAny++;
  }

  return {
    role: { isGM: !!game.user?.isGM, responsibleGM: isResponsibleGM() },
    patches: { canvasDraw: canvasDrawPatched, sceneActivate: activatePatched },
    transitions: { total: defs.length, custom: defs.filter(d => transitionKey(d.id) === "custom").length, byGroup },
    integrations: { stairways: stairwaysActive(), ...stairwaysDebugState(), stairwaysPlaced },
    bindings: { ...bindings, byTransition },
    canvas: { ready: !!canvas?.ready, hasScene: !!canvas?.scene, viewingActiveScene: !!canvas?.scene?.active },
    textures: textureStats(),
    activate: activateDebugState(),
    ...playerDebugState(),
    issues: issueSummary()
  };
}

registerDebugRecorder(debugSnapshot);

Hooks.once("init", () => {
  game.settings.registerMenu(MODULE_ID, "manager", {
    name: "DXST.Settings.Manager.Name",
    label: "DXST.Settings.Manager.Label",
    hint: "DXST.Settings.Manager.Hint",
    icon: "fa-solid fa-film",
    type: TransitionManager,
    restricted: true
  });
  game.settings.register(MODULE_ID, "askOnActivate", {
    name: "DXST.Settings.AskOnActivate.Name",
    hint: "DXST.Settings.AskOnActivate.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "enabled", {
    name: "DXST.Settings.Enabled.Name",
    hint: "DXST.Settings.Enabled.Hint",
    scope: "client", config: true, type: Boolean, default: true
  });
  game.settings.register(MODULE_ID, "gmView", {
    name: "DXST.Settings.GmView.Name",
    hint: "DXST.Settings.GmView.Hint",
    scope: "client", config: true, type: Boolean, default: false
  });
  game.settings.register(MODULE_ID, "defaultBinding", {
    scope: "world", config: false, type: Object,
    default: { transition: "fade", duration: 1500, title: false, titleText: "", sound: "" }
  });
  game.settings.register(MODULE_ID, "sameSceneBinding", {
    scope: "world", config: false, type: Object,
    default: { transition: NONE, duration: 800, title: false, titleText: "", sound: "" }
  });

  patchCanvasDraw();
  canvasDrawPatched = true;
  originalActivate = patchActivate();
  activatePatched = true;
  registerDebugRecorder(debugSnapshot);
});

Hooks.once("setup", () => {
  registerStairways();
  loadTextures().then(warmTints);
});

Hooks.on("canvasReady", onCanvasReady);
Hooks.on("preUpdateScene", onPreUpdateScene);
Hooks.on("updateScene", onUpdateScene);

// "Transitions…" in the scene directory and scene navigation right-click menus (GM)
Hooks.on("getSceneContextOptions", (app, options) => {
  options.push({
    name: "DXST.Manager.Menu",
    icon: '<i class="fa-solid fa-film"></i>',
    condition: () => game.user.isGM,
    callback: li => {
      const id = li?.dataset?.entryId ?? li?.dataset?.sceneId ?? li?.[0]?.dataset?.entryId;
      TransitionManager.open(id);
    }
  });
});

// The GM-only client setting is hidden from players
Hooks.on("renderSettingsConfig", (app, html) => {
  if (game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  root?.querySelector(`[name="${MODULE_ID}.gmView"]`)?.closest(".form-group")?.remove();
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  mod.api = {
    get transitions() {
      return [...TRANSITIONS.values()].map(d => ({ id: d.id, label: game.i18n.localize(d.label), icon: d.icon, split: d.split, hold: !!d.hold, group: d.group }));
    },
    register: (id, definition) => registerTransition(id, definition),
    resolve: ({ from, to, explicit = null } = {}) => {
      const f = typeof from === "string" ? game.scenes.get(from) : from;
      const s = typeof to === "string" ? game.scenes.get(to) : to;
      return bindingFor(f ?? null, s ?? null, explicit);
    },
    activate: async (scene, binding = null) => {
      const s = typeof scene === "string" ? game.scenes.get(scene) : scene;
      if (!s || !game.user.isGM) return null;
      if (s.active) return s;
      return activateWith(s, { binding: binding ? sanitizeBinding(binding, knownIds()) : null }, originalActivate);
    },
    view: async (scene, binding = null) => {
      const s = typeof scene === "string" ? game.scenes.get(scene) : scene;
      if (!s) return null;
      setPending(s.id, { binding: binding ? sanitizeBinding(binding, knownIds()) : null });
      return s.view();
    },
    preview: (binding, toScene = null) => {
      const s = typeof toScene === "string" ? game.scenes.get(toScene) : toScene;
      return previewOnScreen(sanitizeBinding(binding, knownIds()), sceneName(canvas?.scene), s ?? null);
    },
    sanitize: binding => sanitizeBinding(binding, knownIds()),
    openManager: sceneId => TransitionManager.open(sceneId)
  };
  if (game.user.isGM && !game.settings.get(MODULE_ID, "enabled")) {
    console.log(`${MODULE_ID} | ${t("DisabledHere")}`);
  }
  registerDebugRecorder(debugSnapshot);
});
