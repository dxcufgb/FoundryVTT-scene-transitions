# Dxcufgb's Scene Transitions

[![Foundry v13](https://img.shields.io/github/v/release/dxcufgb/FoundryVTT-scene-transitions?label=Foundry%20v13&logo=foundryvirtualtabletop&color=ff6400)](https://github.com/dxcufgb/FoundryVTT-scene-transitions/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/dxcufgb/FoundryVTT-scene-transitions/module.zip?label=downloads&color=blue)](https://github.com/dxcufgb/FoundryVTT-scene-transitions/releases)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=kofi&logoColor=white)](https://ko-fi.com/dxcufgb)\
[![CI](https://img.shields.io/github/actions/workflow/status/dxcufgb/FoundryVTT-scene-transitions/ci.yml?branch=main&label=CI)](https://github.com/dxcufgb/FoundryVTT-scene-transitions/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/dxcufgb/FoundryVTT-scene-transitions)](LICENSE)
[![Works with Stairways](https://img.shields.io/badge/works%20with-Stairways-6f42c1)](https://foundryvtt.com/packages/stairways)

<a href="https://dxcufgb.github.io/FVTT-dev-showcase/"><img src="https://dxcufgb.github.io/FVTT-dev-showcase/assets/img/workshop-badge.png" alt="Dxcufgb's Workshop: every Foundry VTT project, video and changelog in one place" width="650"></a>

Cinematic transitions between scenes. When the view changes to another scene, the old one fades, wipes, irises or dissolves into the new one, with an optional title card and sound, and the loading is hidden behind it. The GM binds transitions to scenes, to pairs of scenes and to every stairway of the Stairways module, and picks one when activating a scene.

**Foundry VTT:** v13 · **System:** any

## Installation

In Foundry: **Add-on Modules → Install Module**, paste this link into **Manifest URL** at the bottom, and click **Install**:

```
https://github.com/dxcufgb/FoundryVTT-scene-transitions/releases/latest/download/module.json
```

## Features

### Transitions

| Transition | What it does |
|---|---|
| Fade through black | The old scene fades to black, the new one fades in. |
| Fade through white | The same through white: a flash, for magic or teleports. |
| Crossfade | The old scene fades straight into the new one. |
| Iris | A circle closes on the old scene and opens on the new one. |
| Wipe | The new scene sweeps in from the left with a soft edge. |
| Slide | The old scene slides out to the left as the new one slides in. |
| Curtain | The old scene opens like two doors onto the new one. |
| Blur | The old scene blurs away and the new one comes into focus. |
| Pixelate | The old scene breaks into blocks, the new one resolves from them. |
| Zoom | Moving forward: the old scene zooms in and fades, the new one settles in. |
| Tiles | The new scene appears tile by tile. |
| Dissolve | The new scene seeps in through drifting blobs. |
| Stairs down / Stairs up | The old scene moves up (or down) into darkness and the new one rises from the other side. |
| Stairs down: pass through | The old scene rushes towards you until it passes your point of view, revealing the new scene below. |
| Magic portal | A glowing portal opens in the scene: a whirlpool of violet and blue light inside, a ring of drifting magic smoke, flickering lightning and sparkles around it. You move into it, and the new scene opens out of its centre as the ring rushes past you. The vortex keeps swirling while the new scene loads. |
| Stairs up: from behind | The new scene comes from behind you, over your head, and settles into view as the old one sinks away. |

Each binding also has a **duration**, an optional **title card** (the scene's name, or your own text) and an optional **sound**. The title card shows **before** (from the start, over the scene you leave), **during** (around the middle) or **after** the transition (over the new scene once it's live). Before and during never pause the transition: the text fades in and out while it plays. The sidebar and other UI stay usable during a transition.

### Which transition plays

The first match wins:

1. **The explicit choice:** the one picked when activating the scene, or the stairway's own transition.
2. **Coming from a particular scene:** a binding for scene A → scene B.
3. **Entering the scene:** scene B's own transition.
4. **The world default** (fade through black to start with). Set it to *None* to have transitions only where you bound them.

### The Transitions manager

Right-click a scene in the Scenes directory or the scene navigation and choose **Transitions…**, or open **Module Settings → Transitions**. It has:

- **World defaults:** the transition for any scene change, and for stairways that teleport within one scene.
- **Entering this scene:** the scene's own transition.
- **Coming from…:** a transition for coming from one particular scene. Add a row per scene.
- **Stairways on this scene:** one transition per stairway end (with Stairways enabled).

Every row has ▶ to preview the transition between the two scenes' thumbnails, and a screen button to play it over your view, from what you see now to the other scene's thumbnail (or a recoloured copy of your view when there's no other scene). Changes are saved at once.

### Activating a scene

Activating a scene, from the Scenes directory or the navigation bar, opens a small dialog with the bound transition already picked, a preview, and **Always use this from A to B** to save the choice as a binding. **Activate** plays it for everyone, and **Without transition** switches without one. Hold **Shift** while clicking *Activate* to skip the dialog and use the bound transition.

### Stairways

With [Stairways](https://foundryvtt.com/packages/stairways) enabled, each end of a stairway can have its own transition: stairs down one way, stairs up the other. The GM sees a small **film badge** on the corner of every stairway icon. It's lit orange when that end has its own transition, and hovering shows which one. Click the badge (it doesn't teleport) to open a small editor for that end, with a preview and an **Edit** button for the other end, wherever it is. The stairway config also has a **Transition** tab. Only the user who takes the stairway sees it, because only their view changes. It starts the moment they click, so the tokens leaving the scene are already covered. Stairways within one scene play their transition too, and the view pans to where you arrive. A stairway left on *inherit* uses the scene bindings (or, within a scene, the same-scene default).

### Who sees what

- **Activating a scene:** everyone who switches to it.
- **Stairways:** the user who takes the stairway.
- **Players pulled to a scene:** their bound transition.
- **A GM just viewing a scene:** no transition unless the GM turns it on (setting below), so you can click through scenes while preparing.

## Settings

| Setting | Scope | What it does |
|---|---|---|
| Transitions | GM | Opens the Transitions manager. |
| Ask when activating a scene | World | Activating a scene opens the transition dialog. Off: the bound transition is used. |
| Play scene transitions | Each user | Turn off to switch scenes without transitions on this computer. |
| Transitions when I only view a scene | Each GM | Play bound transitions when the GM views a scene without activating it. Hidden from players. |

## API / integration

`game.modules.get("dxcufgbs-scene-transitions").api`, ready from the `ready` hook:

| Member | Does |
|---|---|
| `transitions` | `[{id, label, icon, split}]`: the registered transitions. |
| `register(id, definition)` | Adds a transition. `definition = {label, icon, split, hold?, draw(ctx, frame)}`, where `frame = {phase: "out" \| "in", p, raw, A, B, w, h, state, t}` (`t`: ms since the transition started). `A` and `B` are canvases of the old and new scene (`B` only in `"in"`), `p` runs from 0 to 1 eased. `split: true` plays `"out"` while the new scene loads, then `"in"`. `split: false` plays only `"in"` (A → B). `hold: true` (split only) keeps drawing the last `"out"` frame with `t` running while the new scene loads. |
| `resolve({from, to, explicit?})` | `{binding, source}`: the binding a change from → to uses on this client (`source` is `explicit`, `pair`, `enter` or `default`). |
| `activate(scene, binding?)` | GM: activates a scene for everyone with this binding, without the dialog. Without a binding, everyone gets their bound transition. Pass `{transition: "none"}` for none. |
| `view(scene, binding?)` | Views a scene on this client with this binding (or the bound one). |
| `preview(binding, toScene?)` | Plays a binding over the current view on this client, into `toScene`'s thumbnail (a scene or id), or into a recoloured copy of the view. |
| `sanitize(binding)` | Returns a clean binding. |
| `openManager(sceneId?)` | GM: opens the Transitions manager. |

A **binding** is `{transition, duration, title, titleText, titleWhen, sound}`: `transition` is a transition id, `"none"`, or `""` (inherit). `duration` is in milliseconds (200–10000). `titleWhen` is `"before"`, `"during"` (default) or `"after"`.

**Hooks**

- `dxcufgbsPreSceneTransition(context)`: return `false` to cancel. `context.binding` can be changed.
- `dxcufgbsSceneTransitionStart(context)` and `dxcufgbsSceneTransitionEnd(context)`.
- `context = {binding, kind, from, to, source, stairway?}`, where `kind` is `"scene"`, `"local"` (a same-scene stairway) or `"preview"`.

**Flags** (on scenes, written by the GM)

- `flags.dxcufgbs-scene-transitions.enter`: the scene's "entering" binding.
- `flags.dxcufgbs-scene-transitions.from.<sourceSceneId>`: coming from that scene.
- `flags.dxcufgbs-scene-transitions.stairways.<stairwayId>`: a Stairways stairway end on this scene.

Adventures exported with these flags keep their transitions when imported (scene ids are kept).

## Credits

The Magic portal's textures come from Kenney's [Particle Pack](https://kenney.nl/assets/particle-pack) (CC0). See `assets/portal/LICENSE.txt`.

## Compatibility

- Foundry VTT v13, any game system.
- [Stairways](https://foundryvtt.com/packages/stairways) (optional) for stairway transitions.
- With the canvas switched off ("Disable game canvas"), no transitions play.
