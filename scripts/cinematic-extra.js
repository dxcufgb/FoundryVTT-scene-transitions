/**
 * More cinematic transitions: Frost, Page turn, Old film, Sandstorm, Rain on glass.
 * Same definition format as scripts/transitions.js; added to the registry through scripts/cinematic.js.
 */
import { tint, texturesReady } from "./textures.js";
import { TAU, fill, draw, rng, smooth, sprite, scratch, noiseField, maskCanvas, maskedLayer, stretch } from "./fx.js";

/* ---------------------------------------- */
/*  Frost                                    */
/* ---------------------------------------- */

/** A frosted-glass picture: pale ice with needles of frost growing in from the edges. Made once per run. */
function frostTexture(state, w, h) {
  const key = `${w}x${h}`;
  if (state.frostTex?.key === key) return state.frostTex.canvas;
  const scale = Math.min(1, 1280 / Math.max(w, h));
  const cw = Math.max(64, Math.round(w * scale)), ch = Math.max(36, Math.round(h * scale));
  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const x = c.getContext("2d");
  const g = x.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, Math.hypot(cw, ch) / 2);
  g.addColorStop(0, "rgb(200, 224, 242)");
  g.addColorStop(1, "rgb(236, 246, 255)");
  x.fillStyle = g;
  x.fillRect(0, 0, cw, ch);
  // Feathery frost: branching needles, most of them starting near the edges
  const rand = rng(1717);
  const m = Math.min(cw, ch);
  const needle = (sx, sy, angle, len, depth) => {
    const ex = sx + Math.cos(angle) * len, ey = sy + Math.sin(angle) * len;
    x.strokeStyle = `rgba(255, 255, 255, ${0.25 + rand() * 0.35})`;
    x.lineWidth = Math.max(0.6, (depth + 1) * 0.6);
    x.beginPath();
    x.moveTo(sx, sy);
    x.lineTo(ex, ey);
    x.stroke();
    if (depth <= 0) return;
    for (let i = 1; i <= 3; i++) {
      const f = i / 4;
      const bx = sx + (ex - sx) * f, by = sy + (ey - sy) * f;
      needle(bx, by, angle + 0.9, len * 0.35, depth - 1);
      needle(bx, by, angle - 0.9, len * 0.35, depth - 1);
    }
  };
  for (let i = 0; i < 70; i++) {
    const side = Math.floor(rand() * 4);
    const along = rand();
    const [sx, sy, toward] = [
      [along * cw, 0, Math.PI / 2], [cw, along * ch, Math.PI], [along * cw, ch, -Math.PI / 2], [0, along * ch, 0]
    ][side];
    needle(sx, sy, toward + (rand() - 0.5) * 1.4, m * (0.12 + rand() * 0.25), 2);
  }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(255, 255, 255, ${rand() * 0.5})`;
    x.fillRect(rand() * cw, rand() * ch, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }
  state.frostTex = { key, canvas: c };
  return c;
}

/** Cracks spreading from the centre, as polylines laid out once per run (fractions of w and h). */
function frostCracks(state) {
  if (state.cracks) return state.cracks;
  const rand = rng(2323);
  const cracks = [];
  const grow = (x, y, angle, len, depth) => {
    const pts = [[x, y]];
    let px = x, py = y, a = angle;
    const steps = 6;
    for (let i = 0; i < steps; i++) {
      a += (rand() - 0.5) * 0.7;
      px += Math.cos(a) * len / steps;
      py += Math.sin(a) * len / steps;
      pts.push([px, py]);
      if (depth > 0 && rand() < 0.25) grow(px, py, a + (rand() < 0.5 ? 0.8 : -0.8), len * 0.5, depth - 1);
    }
    cracks.push({ pts, start: depth === 2 ? 0 : 0.15 + rand() * 0.2 });
  };
  for (let i = 0; i < 9; i++) grow(0.5, 0.5, (i / 9) * TAU + rand() * 0.4, 0.45 + rand() * 0.25, 2);
  return (state.cracks = cracks);
}

function frostGrid(w, h) {
  const nw = 128;
  return { nw, nh: Math.max(16, Math.round(nw * h / w)) };
}

function drawFrost(ctx, { phase, raw, A, B, w, h, state }) {
  const { nw, nh } = frostGrid(w, h);
  const n = noiseField(state, "frostNoise", nw, nh, 4040, 5);
  const tex = frostTexture(state, w, h);
  const m = Math.min(w, h);
  if (phase === "out") {
    // Ice creeps in from the edges
    if (!state.frostEdge || state.frostEdge.length !== nw * nh) {
      const v = new Float32Array(nw * nh);
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const fx = x / (nw - 1), fy = y / (nh - 1);
          const edge = Math.min(fx, 1 - fx, fy, 1 - fy) * 2;   // 0 at the border, 1 in the middle
          v[y * nw + x] = edge * 0.75 + n[y * nw + x] * 0.25;
        }
      }
      state.frostEdge = v;
    }
    const v = state.frostEdge;
    const L = raw * 1.1;
    const mask = maskCanvas(state, "frostMask", nw, nh, i => (L - v[i]) / 0.08);
    draw(ctx, A, w, h);
    fill(ctx, "#bcd8ff", raw * 0.25, w, h);
    ctx.drawImage(maskedLayer(state, "frostLayer", w, h, tex, mask), 0, 0);
  } else {
    // Cracks race out from the middle, then the ice falls away from the middle outwards
    if (!state.frostMid || state.frostMid.length !== nw * nh) {
      const v = new Float32Array(nw * nh);
      const aspect = w / h;
      for (let y = 0; y < nh; y++) {
        for (let x = 0; x < nw; x++) {
          const d = Math.hypot((x / (nw - 1) - 0.5) * aspect, y / (nh - 1) - 0.5) / Math.hypot(aspect / 2, 0.5);
          v[y * nw + x] = d * 0.8 + n[y * nw + x] * 0.2;
        }
      }
      state.frostMid = v;
    }
    const v = state.frostMid;
    const L = smooth(0.3, 1, raw) * 1.05;
    const keep = maskCanvas(state, "frostKeep", nw, nh, i => (v[i] - L) / 0.05);
    draw(ctx, B, w, h);
    ctx.drawImage(maskedLayer(state, "frostLayer", w, h, tex, keep), 0, 0);
    const grow = smooth(0, 0.3, raw), fade = 1 - smooth(0.35, 0.65, raw);
    if (fade > 0) {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const c of frostCracks(state)) {
        const k = Math.min(1, Math.max(0, (grow - c.start) / (1 - c.start)));
        if (k <= 0) continue;
        const count = Math.max(2, Math.ceil(c.pts.length * k));
        ctx.beginPath();
        c.pts.slice(0, count).forEach(([px, py], i) => (i ? ctx.lineTo(px * w, py * h) : ctx.moveTo(px * w, py * h)));
        ctx.strokeStyle = `rgba(120, 170, 220, ${0.55 * fade})`;
        ctx.lineWidth = Math.max(2, m * 0.006);
        ctx.stroke();
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * fade})`;
        ctx.lineWidth = Math.max(1, m * 0.002);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
}

/* ---------------------------------------- */
/*  Page turn                                */
/* ---------------------------------------- */

function halfPlane(ctx, mx, my, nx, ny, side, far) {
  // The half of the plane on `side` (+1 / -1) of the line through (mx, my) with normal (nx, ny)
  const dx = -ny, dy = nx;
  ctx.beginPath();
  ctx.moveTo(mx + dx * far, my + dy * far);
  ctx.lineTo(mx + dx * far + nx * far * side, my + dy * far + ny * far * side);
  ctx.lineTo(mx - dx * far + nx * far * side, my - dy * far + ny * far * side);
  ctx.lineTo(mx - dx * far, my - dy * far);
  ctx.closePath();
}

function drawPageTurn(ctx, { p, A, B, w, h }) {
  draw(ctx, B, w, h);
  if (p >= 1) return;
  // The bottom-right corner is lifted and pulled up and over to the top left
  const cx = w, cy = h;
  const px = w - 2.1 * w * p, py = h - 2.1 * h * Math.pow(p, 1.15);
  let nx = cx - px, ny = cy - py;
  const len = Math.hypot(nx, ny);
  if (len < 0.5) { draw(ctx, A, w, h); return; }
  nx /= len; ny /= len;
  const mx = (cx + px) / 2, my = (cy + py) / 2;
  const far = (w + h) * 3;
  const m = Math.min(w, h);

  // The part of the page still lying flat
  ctx.save();
  halfPlane(ctx, mx, my, nx, ny, -1, far);
  ctx.clip();
  ctx.drawImage(A, 0, 0, w, h);
  ctx.restore();

  // The shadow the lifted page throws on the new scene
  ctx.save();
  halfPlane(ctx, mx, my, nx, ny, 1, far);
  ctx.clip();
  const sg = ctx.createLinearGradient(mx, my, mx + nx * m * 0.12, my + ny * m * 0.12);
  sg.addColorStop(0, "rgba(0, 0, 0, 0.45)");
  sg.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = sg;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // The flap: the lifted part of the page, folded over the line (its back shows, paler)
  const dx = -ny, dy = nx;
  const a = dx * dx - dy * dy, b = 2 * dx * dy;
  ctx.save();
  ctx.transform(a, b, b, -a, mx - (a * mx + b * my), my - (b * mx - a * my));
  halfPlane(ctx, mx, my, nx, ny, 1, far);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.drawImage(A, 0, 0, w, h);
  fill(ctx, "#f4ecdc", 0.62, w, h);
  // Darker near the fold, where the paper bends
  const fg = ctx.createLinearGradient(mx, my, mx + nx * m * 0.25, my + ny * m * 0.25);
  fg.addColorStop(0, "rgba(60, 45, 30, 0.45)");
  fg.addColorStop(0.3, "rgba(255, 255, 255, 0.12)");
  fg.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = fg;
  ctx.fillRect(-w, -h, w * 3, h * 3);
  ctx.restore();
}

/* ---------------------------------------- */
/*  Old film                                 */
/* ---------------------------------------- */

/** A few tiles of film grain, made once per run. */
function grainTiles(state) {
  if (state.grain) return state.grain;
  const rand = rng(1895);
  state.grain = Array.from({ length: 4 }, () => {
    const c = document.createElement("canvas");
    c.width = c.height = 192;
    const x = c.getContext("2d");
    const img = x.createImageData(192, 192);
    for (let i = 0; i < 192 * 192; i++) {
      const v = rand() * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255 * Math.pow(rand(), 3);
    }
    x.putImageData(img, 0, 0);
    return c;
  });
  return state.grain;
}

/** Sepia picture with grain, scratches, dust, flicker and a vignette; amount 0..1. */
function oldFilm(ctx, img, w, h, amount, t, state, jitter = 0) {
  const frame = Math.floor(t / 42); // about 24 frames a second
  const r = rng(frame * 7919 + 13);
  const flicker = 1 + (r() - 0.5) * 0.18 * amount;
  ctx.save();
  ctx.filter = `sepia(${(0.85 * amount).toFixed(2)}) contrast(${(1 + 0.15 * amount).toFixed(2)}) brightness(${flicker.toFixed(2)})`;
  ctx.drawImage(img, 0, (r() - 0.5) * h * 0.012 * jitter, w, h);
  ctx.restore();
  if (amount <= 0.01) return;
  const m = Math.min(w, h);
  // Grain
  const tile = grainTiles(state)[frame % 4];
  ctx.save();
  ctx.globalAlpha = 0.35 * amount;
  ctx.globalCompositeOperation = "overlay";
  ctx.fillStyle = ctx.createPattern(tile, "repeat");
  ctx.translate(-r() * 192, -r() * 192);
  ctx.fillRect(0, 0, w + 192, h + 192);
  ctx.restore();
  // Scratches and dust
  ctx.save();
  ctx.globalAlpha = amount;
  for (let i = 0; i < 3; i++) {
    if (r() < 0.5) continue;
    const sx = r() * w;
    ctx.strokeStyle = `rgba(250, 240, 220, ${0.25 + r() * 0.35})`;
    ctx.lineWidth = Math.max(1, m * 0.0015);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx + (r() - 0.5) * w * 0.02, h);
    ctx.stroke();
  }
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = r() < 0.5 ? "rgba(20, 14, 8, 0.7)" : "rgba(250, 245, 230, 0.6)";
    ctx.beginPath();
    ctx.arc(r() * w, r() * h, Math.max(1, m * 0.003 * (0.5 + r())), 0, TAU);
    ctx.fill();
  }
  ctx.restore();
  // Vignette
  const g = ctx.createRadialGradient(w / 2, h / 2, m * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
  g.addColorStop(0, "rgba(0, 0, 0, 0)");
  g.addColorStop(1, `rgba(20, 10, 0, ${0.65 * amount})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawFilm(ctx, { phase, raw, A, B, w, h, state, t = 0 }) {
  const { nw, nh } = frostGrid(w, h);
  if (phase === "out") {
    // The film ages, then the frame jams and burns through from a hot spot
    oldFilm(ctx, A, w, h, smooth(0, 0.4, raw), t, state, smooth(0.3, 0.6, raw));
    const burn = smooth(0.55, 1, raw);
    if (burn <= 0) return;
    const n = noiseField(state, "filmNoise", nw, nh, 1927, 4);
    const aspect = w / h;
    const hx = 0.58, hy = 0.42;
    const L = burn * 1.25;
    const dist = i => {
      const x = (i % nw) / (nw - 1), y = Math.floor(i / nw) / (nh - 1);
      return Math.hypot((x - hx) * aspect, y - hy) * 0.8 + n[i] * 0.35;
    };
    const hole = maskCanvas(state, "filmHole", nw, nh, i => (L - dist(i)) / 0.04, [255, 250, 235]);
    const rim = maskCanvas(state, "filmRim", nw, nh, i => 1 - Math.abs(dist(i) - L - 0.04) / 0.06, [255, 140, 40]);
    const scorch = maskCanvas(state, "filmScorch", nw, nh, i => 1 - (dist(i) - L - 0.06) / 0.12, [60, 25, 5]);
    stretch(ctx, scorch, w, h, 0.8);
    stretch(ctx, hole, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    stretch(ctx, rim, w, h);
    ctx.restore();
  } else {
    // The new reel starts: overexposed and old, settling into the real picture
    oldFilm(ctx, B, w, h, 1 - smooth(0.2, 1, raw), t, state, 1 - smooth(0, 0.5, raw));
    fill(ctx, "#fffaf0", 1 - smooth(0, 0.35, raw), w, h);
  }
}

/* ---------------------------------------- */
/*  Sandstorm                                */
/* ---------------------------------------- */

const SAND = "#c9a46b";

function sandGrains(state) {
  if (state.sand) return state.sand;
  const rand = rng(1001);
  return (state.sand = Array.from({ length: 260 }, () => ({
    x: rand(), y: rand(), speed: 0.6 + rand() * 1.2, len: 0.02 + rand() * 0.05, wob: rand() * TAU, a: 0.2 + rand() * 0.5
  })));
}

function sandGusts(state) {
  if (state.gusts) return state.gusts;
  const rand = rng(1002);
  return (state.gusts = Array.from({ length: 16 }, (_, i) => ({
    x: rand(), y: (i + rand()) / 16, size: 0.5 + rand() * 0.5, speed: 0.4 + rand() * 0.6, tex: ["smoke_04", "smoke_07", "smoke_08"][i % 3], rot: rand() * TAU
  })));
}

function drawSandstorm(ctx, { phase, raw, A, B, w, h, state, t = 0 }) {
  // Storm strength: rises over the "out" phase, stays up while loading, dies down over the "in" phase
  const storm = phase === "out" ? smooth(0, 1, raw) : 1 - smooth(0, 1, raw);
  draw(ctx, phase === "out" ? A : B, w, h);
  fill(ctx, SAND, Math.min(1, storm * 1.05), w, h);
  const m = Math.max(w, h);
  // Big gusts of dust
  if (texturesReady(["smoke_04", "smoke_07", "smoke_08"])) {
    for (const g of sandGusts(state)) {
      const x = ((g.x + t * 0.00025 * g.speed) % 1.4 - 0.2) * w;
      sprite(ctx, tint(g.tex, "#d9b77f"), x, g.y * h, g.size * m * 0.6, g.rot + t * 0.0002, storm * 0.55);
    }
  }
  // Streaking sand
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, m * 0.0012);
  for (const s of sandGrains(state)) {
    const x = ((s.x + t * 0.0006 * s.speed) % 1.2 - 0.1) * w;
    const y = (s.y + Math.sin(t * 0.002 + s.wob) * 0.01) * h;
    ctx.strokeStyle = `rgba(240, 214, 160, ${s.a * Math.min(1, storm * 1.5)})`;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - s.len * w, y - s.len * h * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/* ---------------------------------------- */
/*  Rain on glass                            */
/* ---------------------------------------- */

function rainDrops(state) {
  if (state.drops) return state.drops;
  const rand = rng(777);
  const still = Array.from({ length: 140 }, () => ({ x: rand(), y: rand(), r: 0.006 + rand() * 0.016, appear: rand() * 0.4 }));
  const running = Array.from({ length: 26 }, () => ({ x: rand(), y: rand(), r: 0.009 + rand() * 0.01, speed: 0.3 + rand() * 0.6, wob: rand() * TAU }));
  return (state.drops = { still, running });
}

/** One drop: the scene seen upside down through it, with a dark rim and a highlight. */
function drop(ctx, bg, x, y, r, alpha) {
  if (alpha <= 0 || r < 1) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 1.15, 0, 0, TAU);
  ctx.save();
  ctx.clip();
  // The view through a drop is a small, flipped, magnified patch of what is behind it
  ctx.translate(x, y);
  ctx.scale(1, -1);
  ctx.drawImage(bg, x - r * 3, y - r * 3, r * 6, r * 6, -r * 1.2, -r * 1.4, r * 2.4, r * 2.8);
  ctx.restore();
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = Math.max(0.8, r * 0.18);
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.45, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawRain(ctx, { p, raw, A, B, w, h, state, t = 0 }) {
  const m = Math.min(w, h);
  const wet = Math.sin(Math.PI * Math.min(1, raw * 1.1)); // the rain comes, peaks, and goes
  // Behind the glass: the old scene runs into the new one, blurred most in the middle
  const bg = scratch(state, "rainBg", w, h);
  const bx = bg.getContext("2d");
  bx.save();
  bx.clearRect(0, 0, w, h);
  const blur = wet * m * 0.006;
  bx.filter = blur > 0.5 ? `blur(${blur.toFixed(1)}px)` : "none";
  bx.drawImage(A, 0, 0, w, h);
  bx.globalAlpha = smooth(0.25, 0.75, raw);
  bx.drawImage(B, 0, 0, w, h);
  bx.restore();
  ctx.drawImage(bg, 0, 0);
  fill(ctx, "#2a3646", wet * 0.3, w, h);
  const { still, running } = rainDrops(state);
  for (const d of still) {
    const a = smooth(d.appear, d.appear + 0.15, raw) * (1 - smooth(0.75, 1, raw));
    drop(ctx, bg, d.x * w, d.y * h, d.r * m, a);
  }
  // Drops running down, leaving a trail
  ctx.save();
  for (const d of running) {
    const a = wet;
    if (a <= 0.02) continue;
    const y = ((d.y + t * 0.00035 * d.speed) % 1.15) * h - h * 0.05;
    const x = d.x * w + Math.sin(t * 0.003 + d.wob + y * 0.01) * m * 0.004;
    const tg = ctx.createLinearGradient(x, y - m * 0.18, x, y);
    tg.addColorStop(0, "rgba(220, 235, 255, 0)");
    tg.addColorStop(1, `rgba(220, 235, 255, ${0.5 * a})`);
    ctx.strokeStyle = tg;
    ctx.lineWidth = Math.max(1, d.r * m * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, y - m * 0.18);
    ctx.lineTo(x, y);
    ctx.stroke();
    drop(ctx, bg, x, y, d.r * m, a);
  }
  ctx.restore();
}

/* ---------------------------------------- */

export const EXTRA_TRANSITIONS = [
  { id: "frost", label: "DXST.Transition.frost", icon: "fa-solid fa-snowflake", split: true, draw: drawFrost },
  { id: "pageTurn", label: "DXST.Transition.pageTurn", icon: "fa-solid fa-book-open", split: false, draw: drawPageTurn },
  { id: "film", label: "DXST.Transition.film", icon: "fa-solid fa-film", split: true, draw: drawFilm },
  { id: "sandstorm", label: "DXST.Transition.sandstorm", icon: "fa-solid fa-wind", split: true, hold: true, draw: drawSandstorm },
  { id: "rain", label: "DXST.Transition.rain", icon: "fa-solid fa-cloud-rain", split: false, draw: drawRain }
];

export const EXTRA_TINTS = [["smoke_04", "#d9b77f"], ["smoke_07", "#d9b77f"], ["smoke_08", "#d9b77f"]];
