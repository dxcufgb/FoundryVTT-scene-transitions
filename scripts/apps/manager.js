import { MODULE_ID, TEMPLATE_PATH, t, sceneName, stairwaysActive } from "../util.js";
import { knownIds } from "../transitions.js";
import { sanitizeBinding } from "../bindings.js";
import { pickerHTML, wirePickers } from "../picker.js";
import { crumb, noteIssue, transitionKey, errorName } from "../debug-recorder.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** The stairways placed on a scene (Stairways keeps them in flags.stairways.data). */
export function stairwaysOn(scene) {
  const list = scene?.flags?.stairways?.data;
  return Array.isArray(list) ? list.filter(s => s && s._id) : [];
}

/** Where a stairway leads: its partner (same name) on its target scene. */
export function stairwayTarget(scene, stairway) {
  const targetScene = stairway.scene ? game.scenes.get(stairway.scene) : scene;
  return targetScene ?? null;
}

/**
 * The Transitions manager: world defaults, plus one scene's "entering" binding, its "coming from" bindings and its
 * stairways' bindings. Every change is saved at once (one dot-path key per update).
 */
export class TransitionManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "dxst-manager",
    classes: ["dxst-manager"],
    tag: "div",
    window: { title: "DXST.Manager.Title", icon: "fa-solid fa-film", resizable: true },
    position: { width: 620, height: "auto" },
    actions: {
      addFrom: TransitionManager.#onAddFrom,
      removeFrom: TransitionManager.#onRemoveFrom
    }
  };

  static PARTS = {
    main: { template: `${TEMPLATE_PATH}/manager.hbs`, scrollable: [".dxst-body"] }
  };

  /** Opens the manager (one window), optionally on a scene. */
  static open(sceneId) {
    if (!game.user.isGM) return null;
    const existing = foundry.applications.instances.get("dxst-manager");
    if (existing) {
      if (sceneId) existing.sceneId = sceneId;
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new TransitionManager({ sceneId });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.sceneId = options.sceneId ?? canvas.scene?.id ?? game.scenes.contents[0]?.id ?? null;
  }

  get scene() {
    return game.scenes.get(this.sceneId) ?? null;
  }

  async _prepareContext() {
    const scene = this.scene;
    const flags = scene?.flags?.[MODULE_ID] ?? {};
    const scenes = game.scenes.contents
      .map(s => ({ id: s.id, name: sceneName(s), selected: s.id === this.sceneId }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const fromRows = Object.entries(flags.from ?? {})
      .filter(([id]) => game.scenes.has(id))
      .map(([id, raw]) => ({
        id,
        name: sceneName(game.scenes.get(id)),
        picker: pickerHTML(raw, { key: `from.${id}`, inherit: t("InheritEnter") })
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const used = new Set(fromRows.map(r => r.id));
    const addOptions = scenes.filter(s => s.id !== this.sceneId && !used.has(s.id)).map(s => ({ id: s.id, name: s.name }));

    const stairways = stairwaysActive() && scene
      ? stairwaysOn(scene).map(s => {
        const target = stairwayTarget(scene, s);
        const same = !s.scene || s.scene === scene.id;
        return {
          id: s._id,
          name: s.label || s.name || "?",
          target: same ? t("Manager.SameScene") : sceneName(target) || t("Manager.UnknownScene"),
          picker: pickerHTML(flags.stairways?.[s._id], {
            key: `stair.${s._id}`,
            inherit: same ? t("InheritSameScene") : t("InheritScene")
          })
        };
      }).sort((a, b) => a.name.localeCompare(b.name))
      : [];

    return {
      scenes,
      scene: scene ? { id: scene.id, name: sceneName(scene) } : null,
      defaultPicker: pickerHTML(game.settings.get(MODULE_ID, "defaultBinding"), { key: "default" }),
      sameScenePicker: pickerHTML(game.settings.get(MODULE_ID, "sameSceneBinding"), { key: "same" }),
      enterPicker: scene ? pickerHTML(flags.enter, { key: "enter", inherit: t("InheritDefault") }) : "",
      fromRows,
      addOptions,
      stairwaysActive: stairwaysActive(),
      stairways
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    crumb("manager.render", {
      first: !!options?.isFirstRender,
      hasScene: !!context?.scene,
      fromRows: context?.fromRows?.length ?? 0,
      stairways: context?.stairways?.length ?? 0
    });
    const root = this.element;
    root.querySelector('[data-dxst="scene"]')?.addEventListener("change", event => {
      this.sceneId = event.target.value;
      this.render();
    });
    wirePickers(root, {
      onChange: (key, binding) => this.#save(key, binding),
      scenes: key => this.#previewScenes(key)
    });
  }

  #previewScenes(key) {
    const scene = this.scene;
    if (key.startsWith("from.")) return [game.scenes.get(key.slice(5)) ?? null, scene];
    if (key.startsWith("stair.")) {
      const s = stairwaysOn(scene).find(x => x._id === key.slice(6));
      return [scene, s ? stairwayTarget(scene, s) : scene];
    }
    if (key === "same") return [scene, scene];
    if (key === "default") return [canvas.scene ?? scene, scene];
    return [canvas.scene && canvas.scene !== scene ? canvas.scene : null, scene];
  }

  async #save(key, raw) {
    const binding = sanitizeBinding(raw, knownIds());
    const area = ["default", "same", "enter", "from", "stair"].find(a => key === a || key.startsWith(`${a}.`)) ?? "other";
    crumb("manager.save", { area, transition: transitionKey(binding.transition) });
    try {
      if (key === "default") return await game.settings.set(MODULE_ID, "defaultBinding", binding);
      if (key === "same") return await game.settings.set(MODULE_ID, "sameSceneBinding", binding);
      const scene = this.scene;
      if (!scene) return;
      if (key === "enter") return await scene.update({ [`flags.${MODULE_ID}.enter`]: binding });
      const m = /^(from|stair)\.([A-Za-z0-9]{1,32})$/.exec(key);
      if (!m) return;
      const path = m[1] === "from" ? "from" : "stairways";
      await scene.update({ [`flags.${MODULE_ID}.${path}.${m[2]}`]: binding });
    } catch (err) {
      console.error(`${MODULE_ID} | save failed`, err);
      noteIssue("manager", "saveFailed", { area, error: errorName(err) });
      ui.notifications.error(t("SaveFailed"));
    }
  }

  static async #onAddFrom(event, target) {
    const select = this.element.querySelector('[data-dxst="add-from"]');
    const id = select?.value;
    const scene = this.scene;
    if (!id || !scene || !game.scenes.has(id)) return;
    await scene.update({ [`flags.${MODULE_ID}.from.${id}`]: sanitizeBinding({ transition: "fade" }, knownIds()) });
    this.render();
  }

  static async #onRemoveFrom(event, target) {
    const id = target.closest("[data-from-id]")?.dataset.fromId;
    const scene = this.scene;
    if (!id || !scene) return;
    await scene.update({ [`flags.${MODULE_ID}.from.-=${id}`]: null });
    this.render();
  }
}

