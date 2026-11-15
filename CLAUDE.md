# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballistic Workbench: an offline-first PWA for precision rifle external ballistics (RK4 trajectory
solver with G1/G7/MPM/4DOF models, reticle and turret simulation, truing, WEZ Monte Carlo, printable
DOPE cards). Vanilla JavaScript ES modules, no framework, no build step, no runtime dependencies.
Public repo (MIT).

## Commands

```sh
python3 -m http.server 8080    # serve the app at http://localhost:8080 (must be HTTP, not file://)
node tests/verify.mjs          # physics/solver/unit suite (~2600 assertions)
node tests/version.mjs         # version consistency
node tests/browser_check.mjs   # headless Chrome via CDP: all views, interactions, zero console errors
```

## Layout

- `index.html`: app shell (header, nav, footer, command palette). `src/ui/app.js` bootstraps
  and hash-routes between the five views.
- `src/ui/`: one class per view (`workspace`, `solverLab`, `dopeStudio`, `tools`,
  `libraryManager`) plus `rifleBuilderModal`. Views render with template strings into their container.
- `src/core/state.js`: the reactive store (`appState`), persisted to `localStorage`, JSON
  import/export. `src/core/units.js`: all unit conversion; physics works in SI internally.
- `src/physics/`: `solvers.js` (RK4 integrator, zeroing), `atmosphere.js`, `truing.js`, `wez.js`.
  Pure functions, tested in Node by `tests/verify.mjs`.
- `src/data/`: drag tables, 177 projectiles, default rifle and environment profiles.
- `src/canvas/`: canvas renderers (charts, reticle, turret, wind rose).
- `styles/main.css` (themes via `[data-theme="light"]`), `styles/print.css` (card printing).
- `sw.js`: network-first service worker; its asset list must include every new file.

## Version

`manifest.json` `"version"` is the single source. The footer reads it at runtime; `sw.js`'s
`CACHE_NAME` repeats it, and so do the README "**Version:**" line and the newest CHANGELOG section.
`tests/version.mjs` fails if they disagree, so bump them all in the same commit.

## Working agreements

- This repo follows the app standards in `~/Desktop/code/tools/standards/STANDARDS.md` (rule IDs,
  severities). `claude-check --repo .` checks it; decisions and reasoned waivers go in `.claude-standards`.
- Design decision: move to the Låda Glass family look (`design=family`), done as its own step.
- Plan before building: agree on goals, scope and approach first, then implement in small,
  tested steps (failing test first).
- Untrusted data (imported JSON, `localStorage`, user input, URLs) is rendered with `textContent`
  or escaped, never raw into `innerHTML`. No `eval`, no third-party requests (self-host anything in `vendor/`).
- Physics changes need a test in `tests/verify.mjs`; UI changes must keep `browser_check.mjs` at zero console errors.
- Record user-visible changes under "Unreleased" in `CHANGELOG.md`. Bump the version on every push
  that changes the app (patch: fixes, minor: features, major: breaking changes), and in the same
  commit move "Unreleased" under the new version and update the README's version and "What's new".
- The README stays detailed (features, installation, every setting with its default, how-tos,
  screenshots in a grid with captions). Screenshots live in `docs/screenshots/`.
- There is no GitHub remote yet. Don't push or create repos unless asked.
