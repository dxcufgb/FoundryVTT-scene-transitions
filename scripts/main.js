/**
 * Dxcufgb's Scene Transitions — entry point.
 *
 * Plays a transition when the view changes from one scene to another. The GM binds transitions to scene pairs
 * (A → B), to scenes ("entering this scene"), to Stairways stairway ends, and sets a world default; and picks one in a
 * dialog when activating a scene.
 *
 * API: game.modules.get("dxcufgbs-scene-transitions").api
 *   transitions                    → [{id, label, icon, split}] the registered transitions
 *   register(id, definition)       → adds a transition: {label, icon, split, hold?, draw(ctx, frame)} (see scripts/transitions.js)
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
import { MODULE_ID, t, sceneName } from "./util.js";
import { TRANSITIONS, knownIds, registerTransition } from "./transitions.js";
import { sanitizeBinding, NONE } from "./bindings.js";
import { patchCanvasDraw, onCanvasReady, bindingFor, setPending, previewOnScreen } from "./player.js";
import { patchActivate, activateWith, onPreUpdateScene, onUpdateScene } from "./activate.js";
import { registerStairways } from "./stairways.js";
import { TransitionManager } from "./apps/manager.js";

let originalActivate = null;

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
  originalActivate = patchActivate();
});

Hooks.once("setup", () => {
  registerStairways();
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
      return [...TRANSITIONS.values()].map(d => ({ id: d.id, label: game.i18n.localize(d.label), icon: d.icon, split: d.split, hold: !!d.hold }));
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
});
