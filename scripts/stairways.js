import { MODULE_ID, t, escapeHTML, stairwaysActive, sleep } from "./util.js";
import { knownIds } from "./transitions.js";
import { sanitizeBinding, resolveSameScene, NONE } from "./bindings.js";
import { setPending, snapshotCanvas, startRun, clientEnabled } from "./player.js";
import { pickerHTML, wirePickers } from "./picker.js";
import { stairwayTarget } from "./apps/manager.js";

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
    // Another scene: the canvas wrapper plays it when this user's view changes. The snapshot is taken now, because
    // the GM removes the teleported tokens from this scene before the view changes.
    setPending(data.targetSceneId, { binding: own, snapshot: snapshotCanvas() });
    return;
  }
  const { binding } = resolveSameScene({
    stairway: own,
    sameSceneDefault: game.settings.get(MODULE_ID, "sameSceneBinding"),
    knownIds: knownIds()
  });
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
  const { run } = localRun;
  localRun = null;
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

export function registerStairways() {
  if (!stairwaysActive()) return;
  Hooks.on("PreStairwayTeleport", data => {
    try { onPreTeleport(data); } catch (err) { console.error(`${MODULE_ID} | stairway`, err); }
    // never return false: that would stop the teleport
  });
  Hooks.on("StairwayTeleport", data => {
    try { onTeleport(data); } catch (err) { console.error(`${MODULE_ID} | stairway`, err); }
  });
  Hooks.on("renderStairwayConfig", (app, html) => {
    try { onRenderStairwayConfig(app, html); } catch (err) { console.error(`${MODULE_ID} | stairway config`, err); }
  });
}

