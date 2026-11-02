# Changelog

## 0.1.0

- First version.
- 16 transitions: fade through black, fade through white, crossfade, iris, wipe, slide, curtain, blur, pixelate, zoom, tiles, dissolve, stairs down, stairs up, stairs down: pass through (the old scene rushes past you) and stairs up: from behind (the new scene comes over your head into view). Each binding has a duration, an optional title card (the scene name or your own text, shown before, during or after the transition) and an optional sound.
- Bind transitions to a scene ("entering this scene"), to a scene pair (from A to B) and to every Stairways stairway end, plus a world default and a default for same-scene stairways, in the new **Transitions** manager (scene right-click menu or module settings).
- Activating a scene opens a dialog with the bound transition picked, a preview, and "always use this from A to B". Shift-click Activate skips it.
- Stairways: a **Transition** tab in the stairway config, and a film badge on every stairway icon (GM only, lit when the stairway has its own transition) that opens a small editor for that end, with a button to edit the other end. Only the user who takes the stairway sees the transition, and it starts the moment they click, so the tokens leaving the scene are already covered. Same-scene stairways pan to the target.
- Per-client switch to turn transitions off; GMs choose whether just viewing a scene plays transitions.
- API and hooks for other modules.
