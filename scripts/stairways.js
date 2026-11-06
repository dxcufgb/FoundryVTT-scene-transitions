import { MODULE_ID, t, escapeHTML, stairwaysActive, sleep } from "./util.js";
import { knownIds } from "./transitions.js";
import { sanitizeBinding, resolveSameScene, isSet, NONE } from "./bindings.js";
import { startRun, clientEnabled, bindingFor, titleFor } from "./player.js";
import { pickerHTML, wirePickers } from "./picker.js";
import { stairwayTarget } from "./apps/manager.js";
import { StairwayTransitionEditor, describeStairwayBinding } from "./apps/stair-editor.js";
import { crumb, noteIssue, transitionKey, sourceKey, errorName } from "./debug-recorder.js";

/**
 * Stairways integration. Each stairway end can have its own binding, kept on its scene in
 * flags.dxcufgbs-scene-transitions.stairways.<stairwayId>. Only the user who uses the stairway sees the transition,
 * because only their view changes.
 */

/** The same-scene transition waiting for its teleport: {run, ts}. */
let localRun = null;

function stairwayBinding(scene, stairwayId) {
  return scene?.flags?.[MODULE_ID]?.stairways?.[stairwayId] ?? null;
}

function onPreTeleport(data) {
  if (!data || data.userId !== game.userId || !clientEnabled()) return;
  const source = game.scenes.get(data.sourceSceneId);
  const stairId = data.sourceData?.id ?? data.sourceData?._id;
  const own = stairwayBinding(source, stairId);
  if (data.targetSceneId) {
    // Another scene: start right away, before the GM removes the teleported tokens from this scene, so the overlay
    // already covers the view while the tokens move. The canvas wrapper keeps this run when the view changes.
    const target = game.scenes.get(data.targetSceneId);
    if (!target) {
      noteIssue("stairway", "targetMissing", {});
      return;
    }
    const { binding, source: from } = bindingFor(source ?? canvas.scene, target, own);
    crumb("stairway.teleport", { crossScene: true, source: from === "explicit" ? "stairway" : sourceKey(from), transition: transitionKey(binding.transition) });
    if (binding.transition === NONE) return;
    startRun(binding, {
      kind: "scene",
      title: titleFor(binding, target),
      claimFor: target.id,
      context: { from: data.sourceSceneId, to: target.id, stairway: stairId, source: from === "explicit" ? "stairway" : from }
    });
    return;
  }
  const { binding } = resolveSameScene({
    stairway: own,
    sameSceneDefault: game.settings.get(MODULE_ID, "sameSceneBinding"),
    knownIds: knownIds()
  });
  crumb("stairway.teleport", { crossScene: false, source: isSet(sanitizeBinding(own, knownIds())) ? "stairway" : "default", transition: transitionKey(binding.transition) });
  if (binding.transition === NONE) return;
  const title = binding.title ? (binding.titleText || data.targetData?.label || "") : "";
  const run = startRun(binding, {
    kind: "local",
    title,
    context: { from: data.sourceSceneId, to: data.sourceSceneId, stairway: stairId, source: "stairway" }
  });
  if (run) localRun = { run, ts: Date.now() };
}

function onTeleport(data) {
  if (!data || data.targetSceneId || data.userId !== game.userId || !localRun) return;
  const { run, ts } = localRun;
  localRun = null;
  crumb("stairway.arrive", { waitedMs: Date.now() - ts });
  run.arrive(async () => {
    const x = Number(data.targetData?.x), y = Number(data.targetData?.y);
    if (Number.isFinite(x) && Number.isFinite(y)) canvas.pan({ x, y });
    await sleep(250);
  });
}

/** Adds a Transition tab to the Stairways config sheet. */
function onRenderStairwayConfig(app, html) {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  const doc = app.document ?? app.object;
  const scene = doc?.parent ?? canvas.scene;
  if (!root || !doc?.id || !scene) return;
  const form = root.querySelector("form") ?? root;
  const nav = form.querySelector("nav.tabs, nav.sheet-tabs");
  if (!nav || form.querySelector('.tab[data-tab="dxst"]')) return;
  const same = !doc.scene || doc.scene === scene.id;
  nav.insertAdjacentHTML("beforeend",
    `<a class="item" data-tab="dxst"><i class="fa-solid fa-film"></i> ${escapeHTML(t("Stairway.Tab"))}</a>`);
  // Fit the window to whichever tab is shown
  nav.addEventListener("click", () => setTimeout(() => app.setPosition?.({ height: "auto" }), 0));
  const tab = document.createElement("div");
  tab.className = "tab dxst-stairway-tab";
  tab.dataset.tab = "dxst";
  tab.innerHTML = `
    <p class="hint">${escapeHTML(t(same ? "Stairway.HintSame" : "Stairway.Hint"))}</p>
    ${pickerHTML(stairwayBinding(scene, doc.id), { key: "stair", inherit: same ? t("InheritSameScene") : t("InheritScene") })}`;
  const lastTab = [...form.querySelectorAll(":scope > .tab")].pop();
  if (lastTab) lastTab.after(tab);
  else form.append(tab);
  wirePickers(tab, {
    onChange: async (key, binding) => {
      try {
        await scene.update({ [`flags.${MODULE_ID}.stairways.${doc.id}`]: sanitizeBinding(binding, knownIds()) });
      } catch (err) {
        console.error(`${MODULE_ID} | save failed`, err);
        ui.notifications.error(t("SaveFailed"));
      }
    },
    scenes: () => [scene, stairwayTarget(scene, doc) ?? scene]
  });
}


/* ---------------------------------------- */
/*  Film badges on stairway icons (GM)       */
/* ---------------------------------------- */

const BADGE_ON = 0xff6400;
const BADGE_OFF = 0x1b1b1b;
let badgeLayer = null;
let tipEl = null;

function tooltip(text, x, y) {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "dxst-badge-tip";
    document.body.append(tipEl);
  }
  tipEl.style.left = `${x}px`;
  tipEl.style.top = `${y}px`;
  game.tooltip?.activate?.(tipEl, { text, direction: "UP" });
}

function hideTooltip() {
  if (tipEl && game.tooltip?.element && game.tooltip.element === tipEl) game.tooltip.deactivate();
  else game.tooltip?.deactivate?.();
}

/** One badge: a round button with a little film strip. */
function makeBadge(placeable, binding) {
  const doc = placeable.document;
  const w = placeable.controlIcon?.width ?? 40;
  const h = placeable.controlIcon?.height ?? 40;
  const r = Math.max(8, Math.min(16, w * 0.24));
  const bound = isSet(binding);
  const g = new PIXI.Graphics();
  g.beginFill(bound ? BADGE_ON : BADGE_OFF, bound ? 1 : 0.8).lineStyle(1.5, 0xffffff, bound ? 0.95 : 0.55).drawCircle(0, 0, r).endFill();
  // film strip
  const fw = r * 1.15, fh = r * 0.8;
  g.lineStyle(0).beginFill(0xffffff, bound ? 1 : 0.7).drawRoundedRect(-fw / 2, -fh / 2, fw, fh, r * 0.12).endFill();
  const hole = r * 0.16;
  g.beginFill(bound ? BADGE_ON : BADGE_OFF, 1);
  for (let i = 0; i < 3; i++) {
    const hx = -fw / 2 + fw * (0.2 + i * 0.3) - hole / 2;
    g.drawRect(hx, -fh / 2 + hole * 0.5, hole, hole);
    g.drawRect(hx, fh / 2 - hole * 1.5, hole, hole);
  }
  g.endFill();
  g.position.set(doc.x + w * 0.5 - r * 0.2, doc.y - h * 0.5 + r * 0.2);
  g.eventMode = "static";
  g.cursor = "pointer";
  g.hitArea = new PIXI.Circle(0, 0, r + 2);
  g.dxstStairway = placeable;
  g.on("pointerover", event => {
    const text = `${describeStairwayBinding(binding)} · ${t("Badge.Click")}`;
    tooltip(text, event.client?.x ?? event.clientX ?? 0, (event.client?.y ?? event.clientY ?? 0) - r);
  });
  g.on("pointerout", hideTooltip);
  g.on("pointerdown", event => {
    event.stopPropagation();
    hideTooltip();
    if (event.button !== undefined && event.button !== 0) return;
    const x = event.client?.x ?? event.clientX ?? 200;
    const y = event.client?.y ?? event.clientY ?? 200;
    StairwayTransitionEditor.open(canvas.scene.id, doc.id, { left: Math.max(10, x + 24), top: Math.max(10, y - 60) });
  });
  return g;
}

function drawBadges() {
  if (!game.user.isGM || !canvas?.ready || !canvas.stairways || !canvas.controls) return;
  if (!badgeLayer || badgeLayer.destroyed || badgeLayer.parent !== canvas.controls) {
    badgeLayer = new PIXI.Container();
    badgeLayer.name = "dxstStairwayBadges";
    badgeLayer.eventMode = "passive";
    canvas.controls.addChild(badgeLayer);
  }
  for (const child of badgeLayer.removeChildren()) child.destroy();
  const own = canvas.scene.flags?.[MODULE_ID]?.stairways ?? {};
  for (const placeable of canvas.stairways.placeables ?? []) {
    if (!placeable.document?.id) continue;
    badgeLayer.addChild(makeBadge(placeable, sanitizeBinding(own[placeable.document.id], knownIds())));
  }
  syncBadgeVisibility();
}

/** A badge shows only while its stairway's own icon does. */
function syncBadgeVisibility() {
  if (!badgeLayer || badgeLayer.destroyed) return;
  for (const badge of badgeLayer.children) {
    const control = badge.dxstStairway?.stairwayControl;
    badge.visible = control ? control.visible !== false : true;
  }
}

const redrawBadges = foundry.utils.debounce(() => {
  try { drawBadges(); } catch (err) { console.error(`${MODULE_ID} | stairway badges`, err); }
}, 50);

let stairwaysHooked = false;

/** Stairways state for the debug recorder's snapshot. */
export function stairwaysDebugState() {
  return {
    hooksRegistered: stairwaysHooked,
    localRunWaiting: !!localRun,
    badgeCount: badgeLayer && !badgeLayer.destroyed ? badgeLayer.children.length : 0
  };
}

export function registerStairways() {
  if (!stairwaysActive()) return;
  stairwaysHooked = true;
  Hooks.on("PreStairwayTeleport", data => {
    try { onPreTeleport(data); } catch (err) { console.error(`${MODULE_ID} | stairway`, err); noteIssue("stairway", "error", { hook: "PreStairwayTeleport", error: errorName(err) }); }
    // never return false: that would stop the teleport
  });
  Hooks.on("StairwayTeleport", data => {
    try { onTeleport(data); } catch (err) { console.error(`${MODULE_ID} | stairway`, err); noteIssue("stairway", "error", { hook: "StairwayTeleport", error: errorName(err) }); }
  });
  Hooks.on("renderStairwayConfig", (app, html) => {
    try { onRenderStairwayConfig(app, html); } catch (err) { console.error(`${MODULE_ID} | stairway config`, err); }
  });
  // Film badges (GM): redrawn when the canvas, a stairway or this module's flags change
  Hooks.on("canvasReady", redrawBadges);
  Hooks.on("refreshStairway", (placeable, flags) => {
    if (!flags || flags.refreshPosition || flags.refreshField || flags.redraw) redrawBadges();
  });
  Hooks.on("destroyStairway", redrawBadges);
  Hooks.on("updateScene", (scene, changed) => {
    if (scene.id !== canvas.scene?.id) return;
    if (changed?.flags?.[MODULE_ID] || changed?.flags?.stairways || Object.keys(changed?.flags ?? {}).some(k => k.startsWith(`-=${MODULE_ID}`))) redrawBadges();
  });
  Hooks.on("sightRefresh", syncBadgeVisibility);
}

