/**
 * Drawing helpers shared by the transitions (scripts/transitions.js, scripts/cinematic.js). No Foundry globals.
 */

export const TAU = Math.PI * 2;

/** Fills the whole frame with a colour at some opacity. */
export function fill(ctx, color, alpha, w, h) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Draws a full-frame picture, optionally moved, scaled around the centre, or faded. */
export function draw(ctx, img, w, h, { x = 0, y = 0, scale = 1, alpha = 1 } = {}) {
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const sw = w * scale, sh = h * scale;
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
  ctx.restore();
}

/** Draws a full-frame picture turned around the centre, never so small that a corner shows. */
export function drawRot(ctx, img, w, h, { scale = 1, angle = 0, alpha = 1 } = {}) {
  if (!img) return;
  const cover = Math.abs(Math.cos(angle)) + Math.max(w / h, h / w) * Math.abs(Math.sin(angle));
  scale = Math.max(scale, cover);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** A scratch canvas kept in the run's state, resized when needed. */
export function scratch(state, key, w, h) {
  let c = state[key];
  if (!c) c = state[key] = document.createElement("canvas");
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Seeded pseudo-random numbers, so a preview and the real thing can share a layout. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** Smoothstep from edge0 to edge1. */
export function smooth(edge0, edge1, x) {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
}

/** Draws a square texture centred at (x, y), size px wide, turned by angle. */
export function sprite(ctx, tex, x, y, size, angle = 0, alpha = 1) {
  if (!tex || size <= 0.5 || alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  ctx.drawImage(tex, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/**
 * Smooth fractal noise (0..1) on an nw × nh grid, kept in the run's state. Bilinear value noise in a few octaves:
 * cheap enough to build once per run, and good for burn fronts, ink edges and the like.
 */
export function noiseField(state, key, nw, nh, seed = 1, octaves = 4) {
  const cached = state[key];
  if (cached && cached.nw === nw && cached.nh === nh) return cached.data;
  const rand = rng(seed);
  const data = new Float32Array(nw * nh);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.max(2, Math.round(4 * 2 ** o * nw / Math.max(nw, nh)) + 1);
    const gh = Math.max(2, Math.round(4 * 2 ** o * nh / Math.max(nw, nh)) + 1);
    const grid = new Float32Array(gw * gh).map(() => rand());
    for (let y = 0; y < nh; y++) {
      const fy = y / (nh - 1) * (gh - 1), y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < nw; x++) {
        const fx = x / (nw - 1) * (gw - 1), x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * gw + x0] * (1 - sx) + grid[y0 * gw + x1] * sx;
        const b = grid[y1 * gw + x0] * (1 - sx) + grid[y1 * gw + x1] * sx;
        data[y * nw + x] += (a * (1 - sy) + b * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < data.length; i++) data[i] /= total;
  state[key] = { nw, nh, data };
  return data;
}

/**
 * Turns a per-cell alpha function into a small nw × nh canvas, white or in a colour ([r, g, b], or a function of the
 * cell returning one). Drawn scaled up to
 * the frame (smoothing on) it gives soft edges: use a coloured one directly as a glow or shadow layer, or a white one
 * as the mask for maskedLayer. Returns the small canvas.
 */
export function maskCanvas(state, key, nw, nh, alphaAt, rgb = [255, 255, 255]) {
  const c = scratch(state, key, nw, nh);
  const x = c.getContext("2d");
  const img = x.createImageData(nw, nh);
  const d = img.data;
  const perCell = typeof rgb === "function";
  let [r, g, b] = perCell ? [255, 255, 255] : rgb;
  for (let i = 0, n = nw * nh; i < n; i++) {
    if (perCell) [r, g, b] = rgb(i);
    d[i * 4] = r; d[i * 4 + 1] = g; d[i * 4 + 2] = b;
    d[i * 4 + 3] = Math.max(0, Math.min(255, alphaAt(i) * 255));
  }
  x.putImageData(img, 0, 0);
  return c;
}

/** Draws a small canvas stretched over the whole frame, smoothly. */
export function stretch(ctx, small, w, h, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "low";
  ctx.drawImage(small, 0, 0, w, h);
  ctx.restore();
}

/** Draws `source` (a picture or a colour) onto a full-frame layer, keeps only where `mask` is, and returns the layer. */
export function maskedLayer(state, key, w, h, source, mask) {
  const layer = scratch(state, key, w, h);
  const lx = layer.getContext("2d");
  lx.globalCompositeOperation = "source-over";
  lx.globalAlpha = 1;
  lx.clearRect(0, 0, w, h);
  if (typeof source === "string") { lx.fillStyle = source; lx.fillRect(0, 0, w, h); }
  else lx.drawImage(source, 0, 0, w, h);
  lx.globalCompositeOperation = "destination-in";
  lx.imageSmoothingEnabled = true;
  lx.drawImage(mask, 0, 0, w, h);
  lx.globalCompositeOperation = "source-over";
  return layer;
}
