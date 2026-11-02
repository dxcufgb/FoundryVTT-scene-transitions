# Dxcufgb's Scene Transitions

FoundryVTT v13 module (id `dxcufgbs-scene-transitions`, the install folder must have the same name). Plays a
transition when the view changes from one scene to another. The GM binds transitions to scene pairs, to scenes, to
Stairways stairway ends and sets a world default, and picks one in a dialog when activating a scene.
System-agnostic. No build step and no npm dependencies. Stairways is optional.

## Layout
- `scripts/main.js` – entry: settings, hooks, the "Transitions…" scene context menu entry (hook
  `getSceneContextOptions`, used by both the scene directory and scene navigation), the module API (documented in
  its header comment).
- `scripts/util.js` – `MODULE_ID`, `t()` (keys under `DXST.`), `escapeHTML`, small helpers.
- `scripts/bindings.js` – pure logic, no Foundry globals (unit tested in `tests/`): `sanitizeBinding`,
  `resolveBinding` (explicit → pair → enter → world default), `resolveSameScene`, `phaseDurations`, `ease`.
- `scripts/transitions.js` – the transition definitions `{id, label, icon, split, draw(ctx, frame)}` and the
  registry (`TRANSITIONS`, `registerTransition`). They draw on a 2D canvas from snapshot A (old scene) and B (new
  scene); every size is relative to w/h so the same code draws the full screen and the small previews.
- `scripts/player.js` – the player. Wraps `foundry.canvas.Canvas.prototype.draw`: before the canvas draws another
  scene it snapshots the old one (render the stage, `drawImage` the WebGL view in the same task), puts it on an
  overlay inserted right after `#board` (above the canvas, below the UI, `pointer-events: none`), plays the "out"
  phase, waits for `canvasReady`, snapshots the new scene and plays the "in" phase. One run at a time; a new one
  cancels the old. Explicit choices wait in `pending` (one, per target scene, 20 s).
- `scripts/activate.js` – wraps `Scene#activate` (GM): the Activate dialog (DialogV2), Shift skips it. The choice
  rides in the update options (`preUpdateScene` puts it in `options[MODULE_ID]`, every client's `updateScene` reads
  it), so there is no socket. Payload `{binding}`; `binding: null` means "each client uses its bound transition".
- `scripts/picker.js` – the picker used everywhere (escaped HTML string + `wirePickers`), and the thumbnail preview
  (scene thumbs, or a placeholder).
- `scripts/stairways.js` – Stairways: `PreStairwayTeleport` (never returns false) sets the pending choice and
  snapshot for a cross-scene teleport, or starts a "local" run for a same-scene one that `StairwayTeleport` finishes
  (pans to the target). The Transition tab in the Stairways config sheet (`renderStairwayConfig`, AppV1).
- `scripts/apps/manager.js` + `templates/manager.hbs` – the Transitions manager (ApplicationV2): world defaults,
  a scene's "entering" binding, its "coming from" rows and its stairways.
- `styles/scene-transitions.css`, `lang/en.json`.

## Data
- A binding is `{transition, duration (ms), title, titleText, sound}`. `transition`: `""` inherit, `"none"`, or a
  registered id. Always passed through `sanitizeBinding` when read or received.
- Scene flags (GM writes, one dot-path key per update):
  `flags.dxcufgbs-scene-transitions.enter`, `.from.<sourceSceneId>` (on the scene being entered),
  `.stairways.<stairwayId>` (on the stairway's own scene).
- World settings (hidden, edited in the manager): `defaultBinding`, `sameSceneBinding`. World `askOnActivate`.
  Client `enabled`, `gmView` (GM only, hidden from players in the settings window).

## Never change
- The flag paths and binding field names, the API members and the hook names
  (`dxcufgbsPreSceneTransition`, `dxcufgbsSceneTransitionStart`, `dxcufgbsSceneTransitionEnd`), the built-in
  transition ids.
- The PreStairwayTeleport handler must never return false.

## Tests
`node --test tests/*.test.mjs` (also run by CI through `.github/foundry-module.json`).
