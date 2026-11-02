import { MODULE_ID, TEMPLATE_PATH, t, sceneName } from "../util.js";
import { knownIds, TRANSITIONS } from "../transitions.js";
import { sanitizeBinding, INHERIT, NONE } from "../bindings.js";
import { pickerHTML, wirePickers, playThumb, readPicker } from "../picker.js";
import { stairwaysOn, stairwayTarget, TransitionManager } from "./manager.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The other end of a stairway: the stairway with the same name on its target scene. */
export function stairwayPartner(scene, stairway) {
  const targetScene = stairwayTarget(scene, stairway);
  if (!targetScene) return null;
  const partner = stairwaysOn(targetScene).find(s => s.name === stairway.name && s._id !== stairway._id);
  return partner ? { scene: targetScene, stairway: partner } : null;
}

/** A short description of a stairway's own binding, for tooltips. */
export function describeStairwayBinding(raw) {
  const b = sanitizeBinding(raw, knownIds());
  if (b.transition === INHERIT) return t("Badge.Inherit");
  if (b.transition === NONE) return t("Badge.None");
  const def = TRANSITIONS.get(b.transition);
  const name = def ? game.i18n.localize(def.label) : b.transition;
  return t("Badge.Bound", { name, seconds: (b.duration / 1000).toFixed(1).replace(/\.0$/, "") });
}

/**
 * A small window for one stairway end's transition, opened from the film badge on the stairway icon.
 */
export class StairwayTransitionEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["dxst-stair-editor"],
    tag: "div",
    window: { title: "DXST.StairEditor.Title", icon: "fa-solid fa-film", resizable: false },
    position: { width: 400, height: "auto" },
    actions: {
      otherEnd: StairwayTransitionEditor.#onOtherEnd,
      openManager: StairwayTransitionEditor.#onOpenManager
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/stair-editor.hbs` }
  };

  /**
   * Opens (or brings forward) the editor for one stairway end.
   * @param {string} sceneId
   * @param {string} stairwayId
   * @param {{left?: number, top?: number}} [position]
   */
  static open(sceneId, stairwayId, position = {}) {
    if (!game.user.isGM) return null;
    const id = `dxst-stair-${sceneId}-${stairwayId}`;
    const existing = foundry.applications.instances.get(id);
    if (existing) {
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new StairwayTransitionEditor({ id, sceneId, stairwayId, position });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId;
    this.stairwayId = options.stairwayId;
  }

  get scene() {
    return game.scenes.get(this.sceneId) ?? null;
  }

  get stairway() {
    return stairwaysOn(this.scene).find(s => s._id === this.stairwayId) ?? null;
  }

  get title() {
    const s = this.stairway;
    return t("StairEditor.Title", { name: s?.label || s?.name || "?" });
  }

  async _prepareContext() {
    const scene = this.scene;
    const s = this.stairway;
    if (!scene || !s) return { missing: true };
    const same = !s.scene || s.scene === scene.id;
    const target = stairwayTarget(scene, s);
    const partner = stairwayPartner(scene, s);
    return {
      missing: false,
      name: s.label || s.name || "?",
      from: sceneName(scene),
      to: same ? t("Manager.SameScene") : sceneName(target) || t("Manager.UnknownScene"),
      hint: t(same ? "Stairway.HintSame" : "Stairway.Hint"),
      picker: pickerHTML(scene.flags?.[MODULE_ID]?.stairways?.[s._id], {
        key: "stair",
        inherit: same ? t("InheritSameScene") : t("InheritScene")
      }),
      partner: partner ? {
        name: partner.stairway.label || partner.stairway.name || "?",
        scene: partner.scene.id === scene.id ? t("Manager.SameScene") : sceneName(partner.scene),
        summary: describeStairwayBinding(partner.scene.flags?.[MODULE_ID]?.stairways?.[partner.stairway._id])
      } : null
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const scene = this.scene;
    const s = this.stairway;
    if (!scene || !s) return;
    const target = stairwayTarget(scene, s) ?? scene;
    wirePickers(this.element, {
      onChange: async (key, binding) => {
        try {
          await scene.update({ [`flags.${MODULE_ID}.stairways.${s._id}`]: sanitizeBinding(binding, knownIds()) });
        } catch (err) {
          console.error(`${MODULE_ID} | save failed`, err);
          ui.notifications.error(t("SaveFailed"));
        }
      },
      scenes: () => [scene, target]
    });
    // Show the current transition straight away
    const picker = this.element.querySelector("[data-dxst-picker]");
    const b = picker ? readPicker(picker) : null;
    if (b && TRANSITIONS.has(b.transition) && options.isFirstRender) playThumb(picker.querySelector(".dxst-thumb"), b, scene, target);
  }

  /** Keeps the "other end" line current when the partner's transition changes elsewhere. */
  refreshPartnerSummary() {
    const scene = this.scene;
    const s = this.stairway;
    const partner = scene && s ? stairwayPartner(scene, s) : null;
    const el = this.element?.querySelector("[data-dxst-partner-summary]");
    if (partner && el) el.textContent = describeStairwayBinding(partner.scene.flags?.[MODULE_ID]?.stairways?.[partner.stairway._id]);
  }

  static #onOtherEnd() {
    const scene = this.scene;
    const s = this.stairway;
    const partner = scene && s ? stairwayPartner(scene, s) : null;
    if (!partner) return;
    const pos = this.position;
    StairwayTransitionEditor.open(partner.scene.id, partner.stairway._id, { left: (pos.left ?? 100) + 30, top: (pos.top ?? 100) + 30 });
  }

  static #onOpenManager() {
    TransitionManager.open(this.sceneId);
  }
}

Hooks.on("updateScene", (scene, changed) => {
  if (!changed?.flags?.[MODULE_ID]) return;
  for (const app of foundry.applications.instances.values()) {
    if (app instanceof StairwayTransitionEditor) app.refreshPartnerSummary();
  }
});
