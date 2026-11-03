import { MODULE_ID, t, escapeHTML, sceneName } from "./util.js";
import { TRANSITIONS, knownIds } from "./transitions.js";
import { sanitizeBinding, phaseDurations, ease, INHERIT, NONE, TITLE_WHEN } from "./bindings.js";
import { previewOnScreen } from "./player.js";

/**
 * The transition picker: a transition dropdown, duration, title card, sound and two preview buttons.
 * Used by the manager, the Activate dialog and the Stairways config tab. Built as an escaped HTML string.
 */

const PREVIEW_W = 192;
const GROUPS = ["classic", "stairs", "cinematic", "custom"];
const PREVIEW_H = 108;

function label(def) {
  const text = game.i18n.localize(def.label);
  return text || def.id;
}

/**
 * @param {object} raw            the binding to show
 * @param {object} [opts]
 * @param {string} [opts.key]      what the picker edits (data-dxst-key)
 * @param {string} [opts.inherit]  label of the "inherit" choice; without it there is none
 */
export function pickerHTML(raw, { key = "", inherit = null } = {}) {
  const b = sanitizeBinding(raw, knownIds());
  const options = [];
  if (inherit) options.push(`<option value="${INHERIT}"${b.transition === INHERIT ? " selected" : ""}>${escapeHTML(inherit)}</option>`);
  options.push(`<option value="${NONE}"${b.transition === NONE ? " selected" : ""}>${escapeHTML(t("None"))}</option>`);
  // Grouped: classic, stairs, cinematic, then any added by other modules
  const groups = new Map(GROUPS.map(g => [g, []]));
  for (const def of TRANSITIONS.values()) {
    const g = groups.has(def.group) ? def.group : "custom";
    groups.get(g).push(`<option value="${escapeHTML(def.id)}"${b.transition === def.id ? " selected" : ""}>${escapeHTML(label(def))}</option>`);
  }
  for (const [g, list] of groups) {
    if (list.length) options.push(`<optgroup label="${escapeHTML(t(`Group.${g}`))}">${list.join("")}</optgroup>`);
  }
  if (!inherit && b.transition === INHERIT) options[0] = options[0].replace("<option", "<option selected");
  const seconds = (b.duration / 1000).toFixed(1).replace(/\.0$/, "");
  const off = b.transition === INHERIT || b.transition === NONE;
  return `
<div class="dxst-picker${off ? " dxst-off" : ""}" data-dxst-picker data-dxst-key="${escapeHTML(key)}">
  <div class="dxst-picker-row">
    <select data-dxst-field="transition" aria-label="${escapeHTML(t("Field.Transition"))}">${options.join("")}</select>
    <label class="dxst-duration" data-tooltip="${escapeHTML(t("Field.DurationHint"))}">
      <input type="number" data-dxst-field="duration" min="0.2" max="10" step="0.1" value="${seconds}" aria-label="${escapeHTML(t("Field.Duration"))}">
      <span>s</span>
    </label>
    <button type="button" class="dxst-icon" data-dxst-action="thumb" data-tooltip="${escapeHTML(t("Preview"))}"><i class="fa-solid fa-play"></i></button>
    <button type="button" class="dxst-icon" data-dxst-action="screen" data-tooltip="${escapeHTML(t("PlayOnScreen"))}"><i class="fa-solid fa-display"></i></button>
    <button type="button" class="dxst-icon${b.title || b.sound ? " dxst-active" : ""}" data-dxst-action="more" data-tooltip="${escapeHTML(t("MoreOptions"))}"><i class="fa-solid fa-sliders"></i></button>
  </div>
  <div class="dxst-picker-more" hidden>
    <div class="dxst-title-row">
      <label class="dxst-check"><input type="checkbox" data-dxst-field="title"${b.title ? " checked" : ""}> ${escapeHTML(t("Field.Title"))}</label>
      <select data-dxst-field="titleWhen" aria-label="${escapeHTML(t("Field.TitleWhen"))}" data-tooltip="${escapeHTML(t("Field.TitleWhen"))}">
        ${TITLE_WHEN.map(w => `<option value="${w}"${b.titleWhen === w ? " selected" : ""}>${escapeHTML(t(`TitleWhen.${w}`))}</option>`).join("")}
      </select>
    </div>
    <input type="text" class="dxst-title-text" data-dxst-field="titleText" maxlength="120" value="${escapeHTML(b.titleText)}" placeholder="${escapeHTML(t("Field.TitlePlaceholder"))}">
    <div class="dxst-sound">
      <span>${escapeHTML(t("Field.Sound"))}</span>
      <file-picker type="audio" data-dxst-field="sound" value="${escapeHTML(b.sound)}"></file-picker>
    </div>
  </div>
</div>`;
}

/** The binding a picker element shows now. */
export function readPicker(root) {
  const q = f => root.querySelector(`[data-dxst-field="${f}"]`);
  const soundEl = q("sound");
  return sanitizeBinding({
    transition: q("transition")?.value ?? INHERIT,
    duration: Number(q("duration")?.value) * 1000,
    title: !!q("title")?.checked,
    titleText: q("titleText")?.value ?? "",
    titleWhen: q("titleWhen")?.value ?? "during",
    sound: soundEl?.value ?? soundEl?.querySelector?.("input")?.value ?? ""
  }, knownIds());
}

/**
 * Wires every picker inside root.
 * @param {HTMLElement} root
 * @param {object} opts
 * @param {(key: string, binding: object) => any} [opts.onChange]  called with the picker's key and new binding
 * @param {(key: string) => [Scene|null, Scene|null]} [opts.scenes] the two scenes the thumbnail preview uses
 */
export function wirePickers(root, { onChange, scenes } = {}) {
  for (const el of root.querySelectorAll("[data-dxst-picker]")) {
    if (el.dataset.dxstWired) continue;
    el.dataset.dxstWired = "1";
    // Some containers (DialogV2 content) strip <canvas>: add the preview canvas here
    if (!el.querySelector(".dxst-thumb")) {
      const cv = document.createElement("canvas");
      cv.className = "dxst-thumb";
      cv.width = PREVIEW_W;
      cv.height = PREVIEW_H;
      cv.hidden = true;
      el.append(cv);
    }
    const key = el.dataset.dxstKey ?? "";
    const changed = () => {
      const b = readPicker(el);
      el.classList.toggle("dxst-off", b.transition === INHERIT || b.transition === NONE);
      el.querySelector('[data-dxst-action="more"]')?.classList.toggle("dxst-active", b.title || !!b.sound);
      onChange?.(key, b);
    };
    el.addEventListener("change", event => {
      if (event.target.closest("[data-dxst-field]")) changed();
    });
    el.addEventListener("click", event => {
      const btn = event.target.closest("[data-dxst-action]");
      if (!btn || !el.contains(btn)) return;
      event.preventDefault();
      event.stopPropagation();
      const action = btn.dataset.dxstAction;
      if (action === "more") {
        const more = el.querySelector(".dxst-picker-more");
        more.hidden = !more.hidden;
      } else if (action === "thumb") {
        const [from, to] = scenes?.(key) ?? [null, null];
        playThumb(el.querySelector(".dxst-thumb"), readPicker(el), from, to);
      } else if (action === "screen") {
        const b = readPicker(el);
        const [, to] = scenes?.(key) ?? [null, null];
        if (b.transition === INHERIT || b.transition === NONE) return ui.notifications.info(t("NothingToPreview"));
        previewOnScreen(b, sceneName(to), to);
      }
    });
  }
}

/* ---------------------------------------- */
/*  Thumbnail preview                        */
/* ---------------------------------------- */

const imageCache = new Map();

function loadImage(src) {
  if (!src) return Promise.resolve(null);
  if (imageCache.has(src)) return imageCache.get(src);
  const promise = new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  imageCache.set(src, promise);
  return promise;
}

const PLACEHOLDER_HUES = [210, 25, 140, 280, 0, 50];

async function sceneThumb(scene, w, h, index) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  const img = await loadImage(scene?.thumb ?? null);
  if (img) {
    const scale = Math.max(w / img.width, h / img.height);
    const iw = img.width * scale, ih = img.height * scale;
    x.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
  } else {
    const hue = PLACEHOLDER_HUES[index % PLACEHOLDER_HUES.length];
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue} 45% 35%)`);
    g.addColorStop(1, `hsl(${hue + 40} 50% 18%)`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,255,255,0.85)";
    x.font = `bold ${Math.round(h / 7)}px sans-serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText(scene ? sceneName(scene).slice(0, 22) : (index ? "B" : "A"), w / 2, h / 2, w - 12);
  }
  return c;
}

/** Plays a binding in a small canvas, from scene A's thumbnail to scene B's. */
export async function playThumb(cv, binding, fromScene, toScene) {
  if (!cv) return;
  cv.hidden = false;
  const token = (cv.__dxstToken = (cv.__dxstToken ?? 0) + 1);
  const ctx = cv.getContext("2d");
  const w = cv.width, h = cv.height;
  const [A, B] = await Promise.all([sceneThumb(fromScene, w, h, 0), sceneThumb(toScene ?? fromScene, w, h, toScene && toScene !== fromScene ? 1 : 0)]);
  const def = TRANSITIONS.get(binding.transition);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(A, 0, 0);
  if (!def) {
    await new Promise(r => setTimeout(r, 500));
    if (cv.__dxstToken === token) ctx.drawImage(B, 0, 0);
    return;
  }
  const state = {};
  const d = phaseDurations(binding.duration, def.split);
  const t0 = performance.now();
  const run = (phase, ms, fixed = null) => new Promise(resolve => {
    const start = performance.now();
    const step = now => {
      if (cv.__dxstToken !== token) return resolve(false);
      const raw = fixed ?? (ms ? Math.min(1, (now - start) / ms) : 1);
      ctx.save();
      ctx.clearRect(0, 0, w, h);
      try { def.draw(ctx, { phase, p: ease(raw), raw, A, B, w, h, state, t: now - t0 }); } catch (err) { console.error(`${MODULE_ID} | preview`, err); return resolve(false); }
      ctx.restore();
      if ((fixed === null && raw >= 1) || (fixed !== null && now - start >= ms)) return resolve(true);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await new Promise(r => setTimeout(r, 250));
  if (def.split && !(await run("out", d.out))) return;
  // A short pause between the phases (where the new scene would load); "hold" transitions keep moving
  if (def.hold) { if (!(await run("out", binding.title ? 500 : 300, 1))) return; }
  else await new Promise(r => setTimeout(r, binding.title ? 500 : 150));
  await run("in", d.in);
}
