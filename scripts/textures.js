/**
 * Textures for the textured transitions (Magic portal, Burn away, Smoke, Lightning strike, Sandstorm): white shapes in the alpha
 * channel from Kenney's Particle Pack (CC0, see assets/textures/LICENSE.txt), tinted here into coloured sprites.
 * They load in the background when the module starts; a transition whose textures aren't ready (or failed) draws a
 * plainer procedural look instead.
 */

const BASE = new URL("../assets/textures/", import.meta.url);

export const TEXTURES = [
  "twirl_01", "twirl_02", "twirl_03", "smoke_10", "light_03", "magic_02", "spark_02", "star_07", "circle_05",
  "smoke_04", "smoke_07", "smoke_08", "flame_05", "flame_06", "muzzle_01", "muzzle_04", "spark_05", "spark_06"
];

const images = new Map();
const tinted = new Map();
let loading = null;

/** Starts loading the textures (once). Resolves when all have loaded or failed. */
export function loadTextures() {
  if (loading) return loading;
  loading = Promise.all(TEXTURES.map(name => new Promise(resolve => {
    const img = new Image();
    img.onload = () => { images.set(name, img); resolve(); };
    img.onerror = () => { console.warn(`dxcufgbs-scene-transitions | texture ${name} failed to load`); resolve(); };
    img.src = new URL(`${name}.webp`, BASE).href;
  })));
  return loading;
}

/** True when every named texture is ready. */
export function texturesReady(names) {
  return names.every(name => images.has(name));
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
