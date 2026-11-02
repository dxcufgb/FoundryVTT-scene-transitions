# Changelog

## 0.1.0

- First version.
- 14 transitions: fade through black, fade through white, crossfade, iris, wipe, slide, curtain, blur, pixelate, zoom, tiles, dissolve, stairs down and stairs up. Each binding has a duration, an optional title card (the scene name or your own text) and an optional sound.
- Bind transitions to a scene ("entering this scene"), to a scene pair (from A to B) and to every Stairways stairway end, plus a world default and a default for same-scene stairways, in the new **Transitions** manager (scene right-click menu or module settings).
- Activating a scene opens a dialog with the bound transition picked, a preview, and "always use this from A to B". Shift-click Activate skips it.
- Stairways: a **Transition** tab in the stairway config. Only the user who takes the stairway sees it; same-scene stairways pan to the target.
- Per-client switch to turn transitions off; GMs choose whether just viewing a scene plays transitions.
- API and hooks for other modules.
