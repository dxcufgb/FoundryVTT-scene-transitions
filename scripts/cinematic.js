/**
 * Cinematic transitions: Burn away, Smoke, Shatter, Lightning strike, Ink wash (and, from cinematic-extra.js, Frost,
 * Page turn, Old film, Sandstorm, Rain on glass).
 * Same definition format as scripts/transitions.js. Textured ones fall back to a procedural look until their
 * textures (scripts/textures.js) have loaded.
 */
import { tint, texturesReady } from "./textures.js";
import { TAU, fill, draw, rng, smooth, sprite, noiseField, maskCanvas, maskedLayer, stretch } from "./fx.js";
import { EXTRA_TRANSITIONS, EXTRA_TINTS } from "./cinematic-extra.js";

/* ---------------------------------------- */
/*  Burn away                                */
/* ---------------------------------------- */

const BURN_TEXTURES = ["flame_05", "flame_06", "muzzle_01", "muzzle_04", "star_07"];
const FLAMES = [["flame_05", "#ff7a1f"], ["muzzle_01", "#ff5a14"], ["flame_06", "#ff9a3a"], ["muzzle_04", "#ffb347"]];

function burnGrid(w, h) {
  const nw = 160;
  return { nw, nh: Math.max(16, Math.round(nw * h / w)) };
}

/** How soon each cell burns: the bottom first, with a ragged noisy front. */
function burnValues(state, nw, nh) {
  if (state.burnVal?.length === nw * nh) return state.burnVal;
  const n = noiseField(state, "burnNoise", nw, nh, 9137, 5);
  const v = new Float32Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) v[y * nw + x] = (1 - y / (nh - 1)) * 0.62 + n[y * nw + x] * 0.38;
  }
  return (state.burnVal = v);
}

function drawBurn(ctx, { raw, A, B, w, h, state, t = 0 }) {
  const { nw, nh } = burnGrid(w, h);
  const v = burnValues(state, nw, nh);
  const L = -0.04 + raw * 1.08;              // the burn level climbs through every value
  const band = 0.03, charW = 0.08;
  const burned = maskCanvas(state, "burnMask", nw, nh, i => (L - v[i]) / 0.012 + 0.5);
  // One glow layer: orange at the edge of the band, yellow-white in its core
  const glow = maskCanvas(state, "burnGlow", nw, nh, i => 1 - Math.abs(v[i] - L) / band, i => {
    const k = Math.max(0, 1 - Math.abs(v[i] - L) / (band * 0.4));
    return [255, Math.round(77 + 150 * k), Math.round(13 + 130 * k)];
  });
  const char = maskCanvas(state, "burnChar", nw, nh, i => { const d = v[i] - L; return d < 0 ? 1 : 1 - d / charW; }, [28, 11, 2]);

  draw(ctx, A, w, h);
  // Scorched paper just ahead of the flames
  stretch(ctx, char, w, h, 0.85);
  // The new scene where it has burnt through
  ctx.drawImage(maskedLayer(state, "burnBL", w, h, B, burned), 0, 0);
  // The glowing edge
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  stretch(ctx, glow, w, h);
  stretch(ctx, glow, w, h, 0.5);
  ctx.restore();

  if (raw >= 0.995 || !texturesReady(BURN_TEXTURES)) return;
  // Where the front is in each column (the topmost burnt cell)
  const frontAt = gx => {
    for (let y = 0; y < nh; y++) if (v[y * nw + gx] < L) return (y / (nh - 1)) * h;
    return null;
  };
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const columns = 18;
  for (let c = 0; c < columns; c++) {
    const gx = Math.round(((c + 0.5) / columns) * (nw - 1));
    const fy = frontAt(gx);
    if (fy === null || fy <= 0) continue;
    const [name, color] = FLAMES[c % FLAMES.length];
    const flicker = 0.75 + 0.25 * Math.sin(t * 0.02 + c * 1.7) + 0.1 * Math.sin(t * 0.047 + c);
    const size = h * 0.2 * flicker;
    const x = ((c + 0.5) / columns) * w + Math.sin(t * 0.003 + c) * w * 0.006;
    sprite(ctx, tint(name, color), x, fy - size * 0.32, size, Math.sin(t * 0.004 + c) * 0.08, 0.85);
    sprite(ctx, tint("flame_05", "#ffe7b0"), x, fy - size * 0.18, size * 0.55, 0, 0.6);
  }
  // Embers drifting up from the front
  if (!state.embers) {
    const rand = rng(31337);
    state.embers = Array.from({ length: 60 }, () => ({ x: rand(), phase: rand(), speed: 0.5 + rand(), size: 0.4 + rand() * 0.8 }));
  }
  const ember = tint("star_07", "#ffae4a");
  for (const e of state.embers) {
    const gx = Math.round(e.x * (nw - 1));
    const fy = frontAt(gx);
    if (fy === null) continue;
    const life = (t * 0.00045 * e.speed + e.phase) % 1;
    const x = e.x * w + Math.sin(t * 0.002 + e.phase * 20) * w * 0.015;
    const y = fy - life * h * 0.4;
    sprite(ctx, ember, x, y, h * 0.03 * e.size, life * 3, (1 - life) * 0.9);
  }
  ctx.restore();
}

/* ---------------------------------------- */
/*  Smoke                                    */
/* ---------------------------------------- */

const SMOKE_TEXTURES = ["smoke_04", "smoke_07", "smoke_08"];
const SMOKE_TINTS = ["#d2d2d8", "#a9abb3", "#e6e6ea", "#8e9098"];

function smokePuffs(state) {
  if (state.puffs) return state.puffs;
  const rand = rng(2024);
  const puffs = [];
  const add = (cols, rows, size) => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = (c + 0.5 + (rand() - 0.5) * 0.9) / cols;
        const y = (r + 0.5 + (rand() - 0.5) * 0.9) / rows;
        puffs.push({
          x, y,
          tex: SMOKE_TEXTURES[puffs.length % SMOKE_TEXTURES.length],
          color: SMOKE_TINTS[(puffs.length * 7) % SMOKE_TINTS.length],
          size: size * (0.8 + rand() * 0.5),
          rot: rand() * TAU,
          spin: (rand() - 0.5) * 0.0005,
          // Rolling in from the bottom; clearing from the middle out
          inAt: (1 - y) * 0.45 + rand() * 0.12,
          outAt: (1 - Math.hypot(x - 0.5, y - 0.5) * 1.4) * 0.3 + rand() * 0.12
        });
      }
    }
  };
  add(6, 4, 0.75);
  add(8, 5, 0.5);
  return (state.puffs = puffs);
}

function puff(ctx, p, x, y, size, angle, alpha, textured) {
  if (textured) return sprite(ctx, tint(p.tex, p.color), x, y, size, angle, alpha);
  if (alpha <= 0 || size <= 1) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, size / 2);
  g.addColorStop(0, p.color);
  g.addColorStop(1, "rgba(140, 142, 150, 0)");
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.restore();
}

function drawSmoke(ctx, { phase, raw, A, B, w, h, state, t = 0 }) {
  const textured = texturesReady(SMOKE_TEXTURES);
  const m = Math.max(w, h);
  const puffs = smokePuffs(state);
  if (phase === "out") {
    draw(ctx, A, w, h);
    fill(ctx, "#7c7e86", smooth(0.55, 1, raw), w, h);
    for (const p of puffs) {
      const k = smooth(p.inAt, p.inAt + 0.45, raw);
      if (k <= 0) continue;
      const rise = (1 - k) * h * 0.25;
      puff(ctx, p, p.x * w, p.y * h + rise, p.size * m * (0.45 + 0.55 * k), p.rot + t * p.spin, k * 0.95, textured);
    }
  } else {
    draw(ctx, B, w, h);
    fill(ctx, "#7c7e86", 1 - smooth(0, 0.45, raw), w, h);
    for (const p of puffs) {
      const k = smooth(p.outAt, p.outAt + 0.5, raw);
      if (k >= 1) continue;
      const dx = p.x - 0.5, dy = p.y - 0.5, len = Math.hypot(dx, dy) || 1;
      const x = (p.x + (dx / len) * k * 0.3) * w;
      const y = (p.y + (dy / len) * k * 0.3) * h - k * h * 0.1;
      puff(ctx, p, x, y, p.size * m * (1 + 0.5 * k), p.rot + t * p.spin, (1 - k) * 0.95, textured);
    }
  }
}

/* ---------------------------------------- */
/*  Shatter                                  */
/* ---------------------------------------- */

function shards(state, w, h) {
  const key = `${w}x${h}`;
  if (state.shards?.key === key) return state.shards.list;
  const rand = rng(4711);
  const cols = 8, rows = Math.max(4, Math.round(cols * h / w));
  const pts = [];
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const inner = r > 0 && r < rows && c > 0 && c < cols;
      pts.push([
        (c + (inner ? (rand() - 0.5) * 0.7 : 0)) / cols * w,
        (r + (inner ? (rand() - 0.5) * 0.7 : 0)) / rows * h
      ]);
    }
  }
  const at = (c, r) => pts[r * (cols + 1) + c];
  const ix = w * 0.5, iy = h * 0.45, diag = Math.hypot(w, h);
  const list = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = at(c, r), b = at(c + 1, r), d = at(c, r + 1), e = at(c + 1, r + 1);
      const tris = rand() < 0.5 ? [[a, b, e], [a, e, d]] : [[a, b, d], [b, e, d]];
      for (const poly of tris) {
        const cx = (poly[0][0] + poly[1][0] + poly[2][0]) / 3, cy = (poly[0][1] + poly[1][1] + poly[2][1]) / 3;
        const dist = Math.hypot(cx - ix, cy - iy) / diag;
        list.push({
          poly, cx, cy,
          delay: dist * 0.5 + rand() * 0.12,
          vx: ((cx - ix) / diag) * (0.8 + rand()),
          vy: -0.15 - rand() * 0.25,
          spin: (rand() - 0.5) * 5
        });
      }
    }
  }
  state.shards = { key, list };
  return list;
}

function shardPath(ctx, poly) {
  ctx.beginPath();
  ctx.moveTo(poly[0][0], poly[0][1]);
  ctx.lineTo(poly[1][0], poly[1][1]);
  ctx.lineTo(poly[2][0], poly[2][1]);
  ctx.closePath();
}

function drawShatter(ctx, { raw, A, B, w, h, state }) {
  const list = shards(state, w, h);
  const m = Math.min(w, h);
  draw(ctx, B, w, h);
  fill(ctx, "#000", (1 - raw) * 0.35, w, h);
  const cracks = 1 - smooth(0.05, 0.3, raw);
  for (const s of list) {
    const k = Math.min(1, Math.max(0, (raw - s.delay) / 0.55));
    if (k >= 1) continue;
    ctx.save();
    if (k > 0) {
      const dx = s.vx * k * w * 0.7;
      const dy = (s.vy * k + 1.7 * k * k) * h;
      const scale = 1 - 0.3 * k;
      ctx.translate(s.cx + dx, s.cy + dy);
      ctx.rotate(s.spin * k);
      ctx.scale(scale, scale);
      ctx.translate(-s.cx, -s.cy);
      ctx.globalAlpha = 1 - smooth(0.55, 1, k);
    }
    shardPath(ctx, s.poly);
    ctx.save();
    ctx.clip();
    ctx.drawImage(A, 0, 0, w, h);
    // A glint on the glass while it tumbles
    if (k > 0) fill(ctx, "#ffffff", Math.abs(Math.sin(s.spin * k * 2)) * 0.18, w, h);
    ctx.restore();
    const edgeAlpha = k > 0 ? 0.45 : cracks * 0.35;
    if (edgeAlpha > 0.01) {
      ctx.strokeStyle = `rgba(255, 255, 255, ${edgeAlpha})`;
      ctx.lineWidth = Math.max(1, m * 0.002);
      ctx.stroke();
    }
    ctx.restore();
  }
  // The flash of the impact
  fill(ctx, "#ffffff", Math.max(0, 1 - raw / 0.06) * 0.5, w, h);
}

/* ---------------------------------------- */
/*  Lightning strike                         */
/* ---------------------------------------- */

const BOLT_TEXTURES = ["spark_05", "spark_06"];
const STRIKES = [
  { at: 0.16, x: 0.28, tex: "spark_05", flip: false },
  { at: 0.4, x: 0.74, tex: "spark_06", flip: true },
  { at: 0.6, x: 0.42, tex: "spark_05", flip: true },
  { at: 0.82, x: 0.55, tex: "spark_06", flip: false, big: true }
];

/** A jagged bolt from the top of the frame down to y, when the bolt textures aren't loaded. */
function boltPath(ctx, x, h, seed, alpha, m) {
  const rand = rng(seed);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = "#e8f3ff";
  ctx.shadowColor = "#8fc0ff";
  ctx.shadowBlur = m * 0.03;
  ctx.lineWidth = Math.max(1.5, m * 0.004);
  ctx.beginPath();
  let px = x, py = 0;
  ctx.moveTo(px, py);
  while (py < h) {
    py += h * (0.05 + rand() * 0.06);
    px += (rand() - 0.5) * m * 0.08;
    ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.restore();
}

function bolt(ctx, s, w, h, alpha, textured) {
  if (alpha <= 0) return;
  const m = Math.min(w, h);
  if (!textured) return boltPath(ctx, s.x * w, h, Math.round(s.at * 1000), alpha, m);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.translate(s.x * w, h / 2);
  if (s.flip) ctx.scale(-1, 1);
  const size = h * (s.big ? 1.25 : 1.05);
  sprite(ctx, tint(s.tex, "#7fb0ff"), 0, 0, size * 1.06, 0, alpha * 0.7);
  sprite(ctx, tint(s.tex, "#eef6ff"), 0, 0, size, 0, alpha);
  ctx.restore();
}

function drawLightning(ctx, { phase, p, raw, A, B, w, h }) {
  const textured = texturesReady(BOLT_TEXTURES);
  if (phase === "out") {
    draw(ctx, A, w, h);
    fill(ctx, "#050a1c", 0.6 * smooth(0, 0.3, raw), w, h);
    let flash = 0;
    for (const s of STRIKES) {
      const life = (raw - s.at) / 0.08;
      if (life < 0 || life > 1) continue;
      const a = 1 - life;
      bolt(ctx, s, w, h, a, textured);
      flash = Math.max(flash, a * (s.big ? 0.6 : 0.3));
    }
    fill(ctx, "#dfe9ff", flash, w, h);
    fill(ctx, "#ffffff", smooth(0.84, 1, raw), w, h);
  } else {
    draw(ctx, B, w, h);
    fill(ctx, "#0a1430", (1 - p) * 0.35, w, h);
    bolt(ctx, STRIKES[STRIKES.length - 1], w, h, (1 - smooth(0, 0.5, raw)) * 0.8, textured);
    fill(ctx, "#ffffff", (1 - p) * (1 - p), w, h);
  }
}

/* ---------------------------------------- */
/*  Ink wash                                 */
/* ---------------------------------------- */

function inkBlots(state) {
  if (state.blots) return state.blots;
  const rand = rng(8086);
  return (state.blots = Array.from({ length: 8 }, (_, i) => ({
    x: 0.12 + rand() * 0.76, y: 0.12 + rand() * 0.76, start: i * 0.07 + rand() * 0.05, grow: 0.9 + rand() * 0.5
  })));
}

function drawInk(ctx, { p, raw, A, B, w, h, state }) {
  const nw = 128, nh = Math.max(16, Math.round(128 * h / w));
  const n = noiseField(state, "inkNoise", nw, nh, 6502, 5);
  const blots = inkBlots(state);
  const aspect = w / h;
  const radii = blots.map(b => Math.max(0, raw - b.start) * b.grow * 0.85);
  const v = state.inkVal?.length === nw * nh ? state.inkVal : (state.inkVal = new Float32Array(nw * nh));
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const fx = x / (nw - 1), fy = y / (nh - 1);
      let best = 99;
      for (let i = 0; i < blots.length; i++) {
        if (radii[i] <= 0) continue;
        const d = Math.hypot((fx - blots[i].x) * aspect, fy - blots[i].y) / radii[i];
        if (d < best) best = d;
      }
      const i = y * nw + x;
      // Ragged, bleeding edges instead of circles
      v[i] = best + (n[i] - 0.5) * 0.7 * Math.min(1, best);
    }
  }
  const finish = smooth(0.85, 1, raw);
  const reveal = maskCanvas(state, "inkReveal", nw, nh, i => Math.max(finish, (1 - v[i]) / 0.05 + 0.5));
  const rim = maskCanvas(state, "inkRim", nw, nh, i => (1 - finish) * (1 - Math.abs(v[i] - 1.04) / 0.1), [13, 10, 24]);
  draw(ctx, A, w, h);
  stretch(ctx, rim, w, h, 0.9);
  ctx.drawImage(maskedLayer(state, "inkBL", w, h, B, reveal), 0, 0);
}

/* ---------------------------------------- */

export const CINEMATIC_TRANSITIONS = [
  { id: "burn", label: "DXST.Transition.burn", icon: "fa-solid fa-fire", split: false, draw: drawBurn },
  { id: "smoke", label: "DXST.Transition.smoke", icon: "fa-solid fa-smog", split: true, hold: true, draw: drawSmoke },
  { id: "shatter", label: "DXST.Transition.shatter", icon: "fa-solid fa-burst", split: false, draw: drawShatter },
  { id: "lightning", label: "DXST.Transition.lightning", icon: "fa-solid fa-bolt-lightning", split: true, draw: drawLightning },
  { id: "ink", label: "DXST.Transition.ink", icon: "fa-solid fa-paintbrush", split: false, draw: drawInk },
  ...EXTRA_TRANSITIONS
];

/** Texture/colour pairs these transitions use, tinted up front (warmTints in scripts/transitions.js). */
export const CINEMATIC_TINTS = [
  ...FLAMES, ["flame_05", "#ffe7b0"], ["star_07", "#ffae4a"],
  ...SMOKE_TEXTURES.flatMap(tex => SMOKE_TINTS.map(color => [tex, color])),
  ["spark_05", "#7fb0ff"], ["spark_05", "#eef6ff"], ["spark_06", "#7fb0ff"], ["spark_06", "#eef6ff"],
  ...EXTRA_TINTS
];
