export const MODULE_ID = "dxcufgbs-scene-transitions";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
export const STAIRWAYS_ID = "stairways";

/** Localize a DXST.* key, formatting when data is given. */
export function t(key, data) {
  const full = `DXST.${key}`;
  return data ? game.i18n.format(full, data) : game.i18n.localize(full);
}

export function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The one GM client that does world-level work. */
export function isResponsibleGM() {
  return game.user.isGM && !!game.users.activeGM?.isSelf;
}

export function stairwaysActive() {
  return !!game.modules.get(STAIRWAYS_ID)?.active;
}

export function sceneName(scene) {
  return scene ? (scene.navName || scene.name || "") : "";
}

/** Waits for the next animation frame. */
export function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
