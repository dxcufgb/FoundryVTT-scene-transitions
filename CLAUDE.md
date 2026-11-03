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
- `scripts/transitions.js` – the transition definitions `{id, label, icon, split, hold?, draw(ctx, frame)}` (plus
  the cinematic ones from `cinematic.js`) and the registry (`TRANSITIONS`, `registerTransition`). They draw on a 2D canvas from snapshot A (old scene) and B (new
  scene); every size is relative to w/h so the same code draws the full screen and the small previews.
- `scripts/player.js` – the player. Wraps `foundry.canvas.Canvas.prototype.draw`: before the canvas draws another
  scene it snapshots the old one (render the stage, `drawImage` the WebGL view in the same task), puts it on an
  overlay inserted right after `#board` (above the canvas, below the UI, `pointer-events: none`), plays the "out"
  phase, waits for `canvasReady`, snapshots the new scene and plays the "in" phase. One run at a time; a new one
  cancels the old. Explicit choices wait in `pending` (one, per target scene, 20 s). Definitions with `hold: true`
  keep drawing the last "out" frame (`t` running) while the new scene loads. Frames get `t` (ms since start).
  `previewOnScreen` plays into the target scene's thumbnail (or a recoloured copy of the view), never A → A.
- `scripts/fx.js` – drawing helpers shared by the transitions (no Foundry globals): fill/draw/drawRot/sprite, seeded
  `rng`, `smooth`, `noiseField` (fractal value noise, cached in the run state), `maskCanvas` (a small per-cell
  alpha/colour canvas, stretched over the frame for soft edges), `maskedLayer` (a picture kept only where a mask is).
- `scripts/cinematic.js` – Burn away, Smoke, Shatter, Lightning strike, Ink wash; `scripts/cinematic-extra.js` – Frost,
  Page turn (fold = perpendicular bisector of corner→pulled point, flap drawn under a reflection), Old film, Sandstorm,
  Rain on glass; added to the registry through `CINEMATIC_TRANSITIONS`. Masks are computed on a small grid
  (~160 wide) and stretched; only the new-scene reveal is a full-size masked layer.
- `scripts/textures.js` + `assets/textures/*.webp` – textures for the portal, burn, smoke, lightning and sandstorm (Kenney
  Particle Pack, CC0, white shapes in alpha), loaded at setup; `tint` makes cached coloured sprites and
  `warmTints` (transitions.js) tints every pair up front. A transition whose textures aren't loaded when it starts draws a
  procedural fallback for the whole run (`state.textured`, decided once). The release zip includes `assets` (`.github/foundry-module.json`).
- `scripts/activate.js` – wraps `Scene#activate` (GM): the Activate dialog (DialogV2), Shift skips it. The choice
  rides in the update options (`preUpdateScene` puts it in `options[MODULE_ID]`, every client's `updateScene` reads
  it), so there is no socket. Payload `{binding}`; `binding: null` means "each client uses its bound transition".
- `scripts/picker.js` – the picker used everywhere (escaped HTML string + `wirePickers`), and the thumbnail preview
  (scene thumbs, or a placeholder).
- `scripts/stairways.js` – Stairways. `PreStairwayTeleport` (never returns false): for a cross-scene teleport it
  starts a "scene" run right away, `claimFor` the target scene, so the overlay covers the tokens leaving and the
  canvas wrapper keeps the run when the view changes (no change within 5 s → it plays back into the current view);
  for a same-scene one it starts a "local" run that `StairwayTeleport` finishes (pans to the target).
  GM film badges live in a container on `canvas.controls` (not in `canvas.controls.stairways`, whose children
  Stairways iterates) and are redrawn on canvasReady / refreshStairway / flag changes. The Transition tab in the
  Stairways config sheet (`renderStairwayConfig`, AppV1).
- `scripts/apps/stair-editor.js` + `templates/stair-editor.hbs` – the small editor for one stairway end, opened from the
  film badge (`stairwayPartner` finds the other end: same name on the target scene).
- `scripts/apps/manager.js` + `templates/manager.hbs` – the Transitions manager (ApplicationV2): world defaults,
  a scene's "entering" binding, its "coming from" rows and its stairways.
- `styles/scene-transitions.css`, `lang/en.json`.

## Data
- A binding is `{transition, duration (ms), title, titleText, titleWhen, sound}` (`titleWhen`: before | during |
  after; before and during never hold the transition up). `transition`: `""` inherit, `"none"`, or a registered id. Always passed through `sanitizeBinding` when read or received.
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
