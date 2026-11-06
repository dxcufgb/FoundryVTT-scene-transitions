import { MODULE_ID, t, escapeHTML, sceneName } from "./util.js";
import { knownIds } from "./transitions.js";
import { sanitizeBinding, NONE } from "./bindings.js";
import { pickerHTML, readPicker, wirePickers, playThumb } from "./picker.js";
import { bindingFor, setPending } from "./player.js";
import { crumb, noteIssue, transitionKey, errorName } from "./debug-recorder.js";

/**
 * Activating a scene with a transition. The GM's choice is put into the scene update's options, so every client
 * gets it together with the activation (no socket). A payload is {binding} (an explicit binding) or {binding: null}
 * (each client uses its bound transition).
 */

/** sceneId → payload, waiting for the GM's own activation update. */
const outgoing = new Map();

function shiftHeld() {
  try { return !!game.keyboard?.isModifierActive?.("Shift"); } catch { return false; }
}

/** Shows the Activate dialog. Resolves to a payload, or null when cancelled. */
export async function activationDialog(scene) {
  const from = game.scenes.active ?? null;
  const { binding } = bindingFor(from, scene);
  const bindHtml = from && from.id !== scene.id
    ? `<label class="dxst-check dxst-bind"><input type="checkbox" data-dxst-bind> ${escapeHTML(t("Dialog.Bind", { from: sceneName(from), to: sceneName(scene) }))}</label>`
    : "";
  const content = `
<div class="dxst-dialog">
  <p>${escapeHTML(t("Dialog.Intro", { name: sceneName(scene) }))}</p>
  ${pickerHTML(binding, { key: "activate" })}
  ${bindHtml}
</div>`;
  let root = null;
  const result = await foundry.applications.api.DialogV2.wait({
    window: { title: t("Dialog.Title", { name: sceneName(scene) }), icon: "fa-solid fa-film" },
    classes: ["dxst-activate-dialog"],
    position: { width: 480 },
    content,
    rejectClose: false,
    render: (event, dialog) => {
      root = dialog.element ?? event?.target?.element ?? null;
      if (!root) return;
      wirePickers(root, { scenes: () => [from, scene] });
      const thumb = root.querySelector(".dxst-thumb");
      if (thumb) playThumb(thumb, readPicker(root.querySelector("[data-dxst-picker]")), from, scene);
    },
    buttons: [
      {
        action: "activate",
        label: t("Dialog.Activate"),
        icon: "fa-solid fa-bullseye",
        default: true,
        callback: (event, button) => {
          const form = button.form ?? root;
          const picker = form.querySelector("[data-dxst-picker]");
          return { binding: readPicker(picker), bind: !!form.querySelector("[data-dxst-bind]")?.checked };
        }
      },
      {
        action: "plain",
        label: t("Dialog.NoTransition"),
        icon: "fa-solid fa-forward",
        callback: () => ({ binding: sanitizeBinding({ transition: NONE }, knownIds()), bind: false })
      },
      { action: "cancel", label: t("Dialog.Cancel"), icon: "fa-solid fa-xmark", callback: () => null }
    ]
  });
  if (!result || typeof result !== "object") {
    crumb("activate.dialog", { result: "cancel" });
    return null;
  }
  crumb("activate.dialog", {
    result: result.binding?.transition === NONE ? "plain" : "activate",
    transition: transitionKey(result.binding?.transition),
    bindPair: !!(result.bind && from)
  });
  if (result.bind && from) {
    try {
      await scene.update({ [`flags.${MODULE_ID}.from.${from.id}`]: result.binding });
    } catch (err) {
      console.error(`${MODULE_ID} | could not save the binding`, err);
      noteIssue("activate", "bindFailed", { error: errorName(err) });
    }
  }
  return { binding: result.binding };
}

/** Activation state for the debug recorder's snapshot. */
export function activateDebugState() {
  return { outgoing: outgoing.size };
}

/** Activates a scene with a payload, without the dialog. */
export async function activateWith(scene, payload, original) {
  outgoing.set(scene.id, payload);
  try {
    return await original.call(scene);
  } finally {
    outgoing.delete(scene.id);
  }
}

/** Wraps Scene#activate so the GM can pick a transition. */
export function patchActivate() {
  const proto = foundry.documents.Scene.prototype;
  const original = proto.activate;
  proto.activate = async function (...args) {
    const opts = args[0];
    if (this.active || !game.user.isGM) return original.apply(this, args);
    let payload = opts && typeof opts === "object" && opts[MODULE_ID] ? opts[MODULE_ID] : null;
    if (!payload) {
      const ask = game.settings.get(MODULE_ID, "askOnActivate") && !shiftHeld();
      if (ask) {
        payload = await activationDialog(this);
        if (!payload) return this;
      } else {
        payload = { binding: null };
      }
    }
    return activateWith(this, payload, original);
  };
  return original;
}

/** preUpdateScene (GM's client): put the chosen transition into the activation update. */
export function onPreUpdateScene(scene, changed, options) {
  if (changed?.active !== true || !outgoing.has(scene.id)) return;
  const payload = outgoing.get(scene.id);
  options[MODULE_ID] = { binding: payload?.binding ? sanitizeBinding(payload.binding, knownIds()) : null };
  crumb("activate.send", { explicit: !!options[MODULE_ID].binding, transition: transitionKey(options[MODULE_ID].binding?.transition ?? null) });
}

/** updateScene (every client): remember the transition chosen for this activation. */
export function onUpdateScene(scene, changed, options) {
  if (changed?.active !== true) return;
  const payload = options?.[MODULE_ID];
  if (!payload || typeof payload !== "object") return;
  const binding = payload.binding ? sanitizeBinding(payload.binding, knownIds()) : null;
  setPending(scene.id, { binding });
  crumb("activate.receive", { explicit: !!binding, transition: transitionKey(binding?.transition ?? null), viewedScene: scene.id === canvas?.scene?.id });
}
