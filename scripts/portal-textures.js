/**
 * Textures for the Magic portal transition: white shapes (in the alpha channel) from Kenney's Particle Pack (CC0,
 * see assets/portal/LICENSE.txt), tinted here into coloured sprites. They load in the background when the module
 * starts; until they are ready (or if one fails) the portal draws its plain procedural look instead.
 */

const BASE = new URL("../assets/portal/", import.meta.url);

export const PORTAL_TEXTURES = [
  "twirl_01", "twirl_02", "twirl_03", "smoke_10", "light_03", "magic_02", "spark_02", "star_07", "circle_05"
];

/**
 * Where each ring texture's ring sits, as a fraction of half its width, so a ring of radius r is drawn
 * r / ringRadius * 2 wide.
 */
export const RING_RADIUS = { light_03: 0.72, smoke_10: 0.46, magic_02: 0.48 };

const images = new Map();
const tinted = new Map();
let loading = null;

/** Starts loading the textures (once). Resolves when all have loaded or failed. */
export function loadPortalTextures() {
  if (loading) return loading;
  loading = Promise.all(PORTAL_TEXTURES.map(name => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { images.set(name, img); resolve(); };
    img.onerror = () => { console.warn(`dxcufgbs-scene-transitions | portal texture ${name} failed to load`); resolve(); };
    img.src = new URL(`${name}.webp`, BASE).href;
  })));
  return loading;
}

/** True when every portal texture is ready. */
export function portalTexturesReady() {
  return images.size === PORTAL_TEXTURES.length;
}

/** A texture tinted with a colour (cached), or null while it isn't loaded. */
export function tint(name, color) {
  const key = `${name}|${color}`;
  if (tinted.has(key)) return tinted.get(key);
  const img = images.get(name);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  x.globalCompositeOperation = "source-in";
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  tinted.set(key, c);
  return c;
}
