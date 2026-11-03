/**
 * The transitions. Each one draws a frame onto a 2D canvas context from two pictures:
 *   A = the scene being left, B = the scene being entered (only in the "in" phase).
 *
 * A definition is { id, label, icon, split, draw(ctx, frame) }:
 *   split: true  → two phases: "out" (A goes away, e.g. to black) while B loads, then "in" (B appears).
 *   split: false → one "in" phase from A straight to B, once B is ready (A is held while B loads).
 *   frame = { phase: "out" | "in", p: 0..1 (eased), raw: 0..1, A, B, w, h, state, t }
 *     state is an object kept for the whole run (for random layouts and scratch canvases).
 *     t is the time in ms since the transition started, for things that keep moving (swirls, sparkles).
 *   hold: true (split transitions only) → while the new scene loads, the last "out" frame keeps being drawn
 *     (p = 1, t running) instead of standing still.
 * Every size is relative to w / h, so the same code draws the full screen and the small previews.
 * Other modules can add their own with api.register(id, definition).
 */

const TAU = Math.PI * 2;

function fill(ctx, color, alpha, w, h) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function draw(ctx, img, w, h, { x = 0, y = 0, scale = 1, alpha = 1 } = {}) {
  if (!img) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const sw = w * scale, sh = h * scale;
  ctx.drawImage(img, x + (w - sw) / 2, y + (h - sh) / 2, sw, sh);
  ctx.restore();
}

function scratch(state, key, w, h) {
  let c = state[key];
  if (!c) {
    c = state[key] = document.createElement("canvas");
  }
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Seeded pseudo-random numbers, so a preview and the real thing can share a layout. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function smooth(edge0, edge1, x) {
  const k = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return k * k * (3 - 2 * k);
}

function throughColor(color) {
  return (ctx, f) => {
    const { phase, p, A, B, w, h } = f;
    if (phase === "out") { draw(ctx, A, w, h); fill(ctx, color, p, w, h); }
    else { draw(ctx, B, w, h); fill(ctx, color, 1 - p, w, h); }
  };
}


/* Magic portal helpers */

function drawRot(ctx, img, w, h, { scale = 1, angle = 0, alpha = 1 } = {}) {
  if (!img) return;
  // Never smaller than what still covers the view at this angle, so no corner shows
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

/** Particles that orbit and fly off the portal ring, laid out once per run. */
function portalSparks(state) {
  if (!state.sparks) {
    const rand = rng(777);
    state.sparks = Array.from({ length: 70 }, () => ({
      a: rand() * TAU, speed: 0.6 + rand() * 1.4, size: 0.4 + rand() * 1.1, drift: rand(), hue: rand() < 0.5 ? 280 : 190
    }));
  }
  return state.sparks;
}

/** The swirling inside of the portal, filling a circle of radius r around the centre. */
function drawVortex(ctx, w, h, r, t, spin) {
  const cx = w / 2, cy = h / 2, m = Math.min(w, h);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(0.5, r), 0, TAU);
  ctx.clip();
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
  g.addColorStop(0, "#fff6ff");
  g.addColorStop(0.08, "#e6b3ff");
  g.addColorStop(0.35, "#6a1fb5");
  g.addColorStop(0.75, "#22074a");
  g.addColorStop(1, "#0b0218");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // Spiral arms
  const arms = 7;
  const rot = t * 0.0025 + spin;
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let k = 0; k < arms; k++) {
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      const rr = f * r * 1.05;
      const ang = rot + (k / arms) * TAU + f * 4.2;
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = k % 2 ? "rgba(120, 220, 255, 0.28)" : "rgba(220, 140, 255, 0.32)";
    ctx.lineWidth = Math.max(1, m * 0.018);
    ctx.stroke();
  }
  ctx.restore();
}

/** The glowing ring at radius r, with runes and sparks orbiting it. */
function drawRing(ctx, w, h, r, t, alpha, state, flyOut = 0) {
  if (alpha <= 0 || r <= 0.5) return;
  const cx = w / 2, cy = h / 2, m = Math.min(w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "lighter";
  const lw = Math.max(1.5, m * 0.012);
  for (const [color, width, blur] of [["rgba(160, 80, 255, 0.55)", lw * 4, m * 0.04], ["rgba(120, 220, 255, 0.8)", lw * 1.6, m * 0.02], ["rgba(255, 255, 255, 0.95)", lw * 0.6, 0]]) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  // Runes: short dashes on a second, counter-rotating ring
  const runes = 24, rr = r * 1.06 + lw * 2;
  ctx.strokeStyle = "rgba(200, 160, 255, 0.85)";
  ctx.lineWidth = Math.max(1, lw * 0.7);
  for (let i = 0; i < runes; i++) {
    const a = -t * 0.0012 + (i / runes) * TAU;
    const len = (i % 3 === 0 ? 0.09 : 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a, a + len);
    ctx.stroke();
  }
  // Sparks orbiting the ring, flung outward by flyOut (0..1)
  for (const s of portalSparks(state)) {
    const a = s.a + t * 0.0009 * s.speed;
    const out = r * (1 + 0.05 * Math.sin(t * 0.004 + s.drift * 9)) + flyOut * m * 0.6 * s.speed;
    const x = cx + Math.cos(a) * out, y = cy + Math.sin(a) * out;
    const size = Math.max(0.8, m * 0.004 * s.size * (1 - flyOut * 0.6));
    ctx.fillStyle = `hsla(${s.hue}, 100%, 80%, ${0.9 * (1 - flyOut)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

export const BUILTIN_TRANSITIONS = [
  {
    id: "fade", label: "DXST.Transition.fade", icon: "fa-solid fa-circle-half-stroke", split: true,
    draw: throughColor("#000")
  },
  {
    id: "flash", label: "DXST.Transition.flash", icon: "fa-solid fa-sun", split: true,
    draw: throughColor("#fff")
  },
  {
    id: "crossfade", label: "DXST.Transition.crossfade", icon: "fa-solid fa-clone", split: false,
    draw(ctx, { p, A, B, w, h }) {
      draw(ctx, A, w, h);
      draw(ctx, B, w, h, { alpha: p });
    }
  },
  {
    id: "iris", label: "DXST.Transition.iris", icon: "fa-regular fa-circle-dot", split: true,
    draw(ctx, { phase, p, A, B, w, h }) {
      const R = Math.hypot(w, h) / 2;
      const r = phase === "out" ? (1 - p) * R : p * R;
      fill(ctx, "#000", 1, w, h);
      if (r <= 0.5) return;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, TAU);
      ctx.clip();
      draw(ctx, phase === "out" ? A : B, w, h);
      ctx.restore();
      // A soft dark rim on the edge of the circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r, 0, TAU);
      ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.03);
      ctx.strokeStyle = "rgba(0,0,0,0.6)";
      ctx.filter = `blur(${Math.max(1, Math.min(w, h) * 0.01)}px)`;
      ctx.stroke();
      ctx.restore();
    }
  },
  {
    id: "wipe", label: "DXST.Transition.wipe", icon: "fa-solid fa-arrow-right-long", split: false,
    draw(ctx, { p, A, B, w, h, state }) {
      const edge = w * 0.12;
      const x = p * (w + edge);
      draw(ctx, A, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, Math.max(0, x - edge), h);
      ctx.clip();
      draw(ctx, B, w, h);
      ctx.restore();
      // Feathered edge: B fades in over the last `edge` pixels
      const c = scratch(state, "wipe", Math.ceil(edge) || 1, h);
      const cx = c.getContext("2d");
      cx.clearRect(0, 0, c.width, c.height);
      cx.drawImage(B, Math.round(x - edge), 0, c.width, h, 0, 0, c.width, h);
      cx.globalCompositeOperation = "destination-in";
      const g = cx.createLinearGradient(0, 0, c.width, 0);
      g.addColorStop(0, "rgba(0,0,0,1)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, c.width, h);
      cx.globalCompositeOperation = "source-over";
      ctx.drawImage(c, Math.round(x - edge), 0);
    }
  },
  {
    id: "slide", label: "DXST.Transition.slide", icon: "fa-solid fa-right-left", split: false,
    draw(ctx, { p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      draw(ctx, A, w, h, { x: -p * w });
      draw(ctx, B, w, h, { x: w - p * w });
    }
  },
  {
    id: "curtain", label: "DXST.Transition.curtain", icon: "fa-solid fa-person-booth", split: false,
    draw(ctx, { p, A, B, w, h }) {
      const half = w / 2;
      const off = p * half;
      draw(ctx, B, w, h);
      fill(ctx, "#000", (1 - p) * 0.5, w, h);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.7)";
      ctx.shadowBlur = Math.min(w, h) * 0.05;
      ctx.drawImage(A, 0, 0, half, h, -off, 0, half, h);
      ctx.drawImage(A, half, 0, w - half, h, half + off, 0, w - half, h);
      ctx.restore();
    }
  },
  {
    id: "blur", label: "DXST.Transition.blur", icon: "fa-solid fa-droplet", split: true,
    draw(ctx, { phase, p, A, B, w, h }) {
      const max = Math.max(w, h) * 0.02;
      const k = phase === "out" ? p : 1 - p;
      ctx.save();
      ctx.filter = k > 0.01 ? `blur(${(k * max).toFixed(1)}px)` : "none";
      // Draw a little oversized so the blurred edges never show the background
      draw(ctx, phase === "out" ? A : B, w, h, { scale: 1 + k * 0.06 });
      ctx.restore();
      fill(ctx, "#000", k * 0.55, w, h);
    }
  },
  {
    id: "pixelate", label: "DXST.Transition.pixelate", icon: "fa-solid fa-chess-board", split: true,
    draw(ctx, { phase, p, A, B, w, h, state }) {
      const k = phase === "out" ? p : 1 - p;
      const block = Math.max(1, Math.round(1 + k * Math.max(w, h) / 28));
      const img = phase === "out" ? A : B;
      if (block <= 1) { draw(ctx, img, w, h); return; }
      const sw = Math.max(1, Math.round(w / block)), sh = Math.max(1, Math.round(h / block));
      const c = scratch(state, "pix", sw, sh);
      const cx = c.getContext("2d");
      cx.imageSmoothingEnabled = true;
      cx.drawImage(img, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, 0, 0, sw, sh, 0, 0, w, h);
      ctx.restore();
      fill(ctx, "#000", Math.max(0, k - 0.6) * 1.5, w, h);
    }
  },
  {
    id: "zoom", label: "DXST.Transition.zoom", icon: "fa-solid fa-magnifying-glass-plus", split: true,
    draw(ctx, { phase, p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      if (phase === "out") draw(ctx, A, w, h, { scale: 1 + p * 0.6, alpha: 1 - p });
      else draw(ctx, B, w, h, { scale: 1.25 - p * 0.25, alpha: p });
    }
  },
  {
    id: "tiles", label: "DXST.Transition.tiles", icon: "fa-solid fa-table-cells", split: false,
    draw(ctx, { p, A, B, w, h, state }) {
      const cols = 14;
      const size = w / cols;
      const rows = Math.ceil(h / size);
      if (!state.tiles || state.tiles.cols !== cols || state.tiles.rows !== rows) {
        const rand = rng(1337);
        const order = [];
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const diag = (c / cols + r / rows) / 2;
            order.push({ c, r, t: Math.min(0.85, diag * 0.6 + rand() * 0.4) });
          }
        }
        state.tiles = { cols, rows, order };
      }
      draw(ctx, A, w, h);
      for (const cell of state.tiles.order) {
        const local = (p - cell.t) / 0.15;
        if (local <= 0) continue;
        const k = Math.min(1, local);
        const x = cell.c * size, y = cell.r * size;
        const s = size * (0.4 + 0.6 * k);
        const sx = x + (size - s) / 2, sy = y + (size - s) / 2;
        ctx.save();
        ctx.globalAlpha = k;
        ctx.beginPath();
        ctx.rect(sx, sy, s + 0.5, s + 0.5);
        ctx.clip();
        ctx.drawImage(B, 0, 0, w, h);
        ctx.restore();
      }
    }
  },
  {
    id: "dissolve", label: "DXST.Transition.dissolve", icon: "fa-solid fa-wand-magic-sparkles", split: false,
    draw(ctx, { p, A, B, w, h, state }) {
      // Low-resolution noise, scaled up smoothly, gives soft drifting blobs
      const nw = 96, nh = Math.max(8, Math.round(96 * h / w));
      if (!state.noise || state.noise.length !== nw * nh) {
        const rand = rng(4242);
        const coarse = [];
        const gw = 13, gh = Math.max(3, Math.round(13 * h / w));
        for (let i = 0; i < gw * gh; i++) coarse.push(rand());
        const noise = new Float32Array(nw * nh);
        for (let y = 0; y < nh; y++) {
          for (let x = 0; x < nw; x++) {
            const fx = x / (nw - 1) * (gw - 1), fy = y / (nh - 1) * (gh - 1);
            const x0 = Math.floor(fx), y0 = Math.floor(fy);
            const x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
            const tx = fx - x0, ty = fy - y0;
            const a = coarse[y0 * gw + x0] * (1 - tx) + coarse[y0 * gw + x1] * tx;
            const b = coarse[y1 * gw + x0] * (1 - tx) + coarse[y1 * gw + x1] * tx;
            noise[y * nw + x] = (a * (1 - ty) + b * ty) * 0.75 + rand() * 0.25;
          }
        }
        state.noise = noise;
      }
      const mask = scratch(state, "mask", nw, nh);
      const mx = mask.getContext("2d");
      const data = mx.createImageData(nw, nh);
      const band = 0.08;
      const level = p * (1 + band);
      for (let i = 0; i < state.noise.length; i++) {
        const v = (level - state.noise[i]) / band;
        data.data[i * 4 + 3] = Math.max(0, Math.min(255, v * 255));
      }
      mx.putImageData(data, 0, 0);
      const layer = scratch(state, "layer", w, h);
      const lx = layer.getContext("2d");
      lx.globalCompositeOperation = "source-over";
      lx.clearRect(0, 0, w, h);
      lx.drawImage(B, 0, 0, w, h);
      lx.globalCompositeOperation = "destination-in";
      lx.imageSmoothingEnabled = true;
      lx.drawImage(mask, 0, 0, w, h);
      draw(ctx, A, w, h);
      ctx.drawImage(layer, 0, 0);
    }
  },
  {
    id: "stairsDown", label: "DXST.Transition.stairsDown", icon: "fa-solid fa-person-walking-arrow-loop-left", split: true,
    draw(ctx, { phase, p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      if (phase === "out") draw(ctx, A, w, h, { y: -p * h * 0.35, alpha: 1 - p * 0.9 });
      else draw(ctx, B, w, h, { y: (1 - p) * h * 0.35, alpha: 0.1 + p * 0.9 });
      fill(ctx, "#000", phase === "out" ? p : 1 - p, w, h);
    }
  },
  {
    id: "stairsUp", label: "DXST.Transition.stairsUp", icon: "fa-solid fa-person-walking-arrow-right", split: true,
    draw(ctx, { phase, p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      if (phase === "out") draw(ctx, A, w, h, { y: p * h * 0.35, alpha: 1 - p * 0.9 });
      else draw(ctx, B, w, h, { y: -(1 - p) * h * 0.35, alpha: 0.1 + p * 0.9 });
      fill(ctx, "#000", phase === "out" ? p : 1 - p, w, h);
    }
  },
  {
    // Going down: the current scene rushes towards the viewer until it passes them, revealing the new one below
    id: "stairsDownPass", label: "DXST.Transition.stairsDownPass", icon: "fa-solid fa-person-falling", split: false,
    draw(ctx, { p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      draw(ctx, B, w, h, { scale: 0.82 + 0.18 * p });
      fill(ctx, "#000", (1 - p) * 0.65, w, h);
      const pass = smooth(0.5, 1, p);
      if (pass >= 1) return;
      ctx.save();
      const blur = Math.max(w, h) * 0.012 * p * p;
      if (blur > 0.5) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      draw(ctx, A, w, h, { scale: 1 + 4 * p * p, alpha: 1 - pass });
      ctx.restore();
    }
  },
  {
    // Going up: the new scene comes from behind the viewer, over their head, and settles into view
    id: "stairsUpBehind", label: "DXST.Transition.stairsUpBehind", icon: "fa-solid fa-person-arrow-up-from-line", split: false,
    draw(ctx, { p, A, B, w, h }) {
      fill(ctx, "#000", 1, w, h);
      draw(ctx, A, w, h, { scale: 1 - 0.18 * p });
      fill(ctx, "#000", p * 0.65, w, h);
      const k = 1 - p;
      ctx.save();
      const blur = Math.max(w, h) * 0.012 * k * k;
      if (blur > 0.5) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      draw(ctx, B, w, h, { scale: 1 + 4 * k * k, alpha: smooth(0, 0.5, p) });
      ctx.restore();
    }
  },
  {
    // A glowing portal opens, you step through its swirling vortex, and the new scene opens out of it
    id: "portal", label: "DXST.Transition.portal", icon: "fa-solid fa-ring", split: true, hold: true,
    draw(ctx, { phase, p, raw, A, B, w, h, state, t = 0 }) {
      const R = Math.hypot(w, h) / 2;
      const m = Math.min(w, h);
      if (phase === "out") {
        // Open (first 45%), then move towards it until the vortex fills the view
        const open = smooth(0, 0.45, raw);
        const near = smooth(0.4, 1, raw);
        const pop = open <= 0 ? 0 : 1 + 2.2 * Math.pow(open - 1, 3) + 1.2 * Math.pow(open - 1, 2); // ease out, small overshoot
        const r = m * 0.26 * pop + near * near * (R * 1.15 - m * 0.26);
        drawRot(ctx, A, w, h, { scale: 1 + near * near * 0.8, angle: near * 0.15 });
        fill(ctx, "#0b0218", open * 0.35 + near * 0.4, w, h);
        drawVortex(ctx, w, h, Math.max(0, r), t, 0);
        drawRing(ctx, w, h, Math.max(0, r), t, 1 - smooth(0.85, 1, raw), state);
      } else {
        // The new scene opens out of the vortex centre, the ring rushing past the viewer
        const r = R * 1.2 * p;
        drawVortex(ctx, w, h, R * 1.5, t, 0);
        ctx.save();
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, Math.max(0.5, r), 0, TAU);
        ctx.clip();
        drawRot(ctx, B, w, h, { scale: 1.35 - 0.35 * p, angle: -(1 - p) * 0.5 });
        ctx.restore();
        drawRing(ctx, w, h, r, t, 1 - smooth(0.6, 1, p), state, smooth(0.3, 1, p));
        fill(ctx, "#ffffff", Math.max(0, 1 - Math.abs(p - 0.08) / 0.08) * 0.35, w, h);
      }
    }
  }
];

/** The registry: id → definition. */
export const TRANSITIONS = new Map(BUILTIN_TRANSITIONS.map(d => [d.id, d]));

export function knownIds() {
  return new Set(TRANSITIONS.keys());
}

/** Adds or replaces a transition (api.register). Returns the stored definition. */
export function registerTransition(id, def) {
  const key = String(id ?? "").trim();
  if (!/^[A-Za-z][\w-]{0,40}$/.test(key) || key === "none") throw new Error(`Invalid transition id "${id}"`);
  if (!def || typeof def.draw !== "function") throw new Error(`Transition "${key}" needs a draw(ctx, frame) function`);
  const stored = {
    id: key, label: String(def.label ?? key), icon: String(def.icon ?? "fa-solid fa-film"),
    split: !!def.split, hold: !!def.split && !!def.hold, draw: def.draw
  };
  TRANSITIONS.set(key, stored);
  return stored;
}
