# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Ballistic Workbench: an offline-first PWA ballistics calculator for precision rifle shooters (RK4
point-mass solver with standard G1/G7 drag and modified point mass (the solver still accepts '4DOF',
but the UI doesn't offer it: without per-bullet aerodynamic data it equals MPM); reticle and turret simulation;
truing; hit-probability Monte Carlo; printable DOPE cards). Vanilla JavaScript ES modules, no
framework, no build step, no runtime dependencies. Public repo (MIT).

## Commands

```sh
npm start                      # node scripts/serve.mjs: serve at http://localhost:8080 (not python http.server: it resets parallel module loads)
npm install                    # dev tooling only (ESLint)
npm test                       # verify.mjs (physics + reference checks), features.mjs, helpers, version, sw-assets
npm run test:browser           # headless Chrome E2E: every view, both themes, 390 px (CHROME_PATH to override)
npm run lint
```

## Layout

- `index.html`: Låda app shell (lg-app: a sticky top bar with the brand, the menu, Search and a cogwheel
  that opens the Settings dialog with the Units/Theme radio switches and the version; strict CSP). `src/ui/app.js`
  bootstraps, hash-routes between views, owns theme (System/Light/Dark → always sets
  `<html data-theme>`), units button and the Låda command palette.
- Views (`src/ui/`): `guide.js` (Guide), `workspace.js` (Solver), `field.js` (Field mode: a fixed
  full-screen layer, `body.is-field-mode` hides the top bar), `match.js` (Match), `logbook.js`
  (Logbook), `solverLab.js` (Compare models), `dopeStudio.js` (DOPE cards), `tools.js` (incl.
  Hunting), `libraryManager.js`, plus `rifleBuilderModal.js` (rifle dialog) and `shareDialog.js`
  (share dialog with QR code; confirmation before a shared item is added). In-app links: dispatch `navigate-view` with `{ view, tool?, panel?, format?, tab?, anchor? }`.
- Help: `help.js` adds an i button next to every control whose id (or radio-group name) has an entry
  in `helpContent.js`; boxes link to guide sections (`GuideView.showSection(id)`). New inputs need a
  help entry.
  **View contract:** constructor(container) renders; `refresh()` rebuilds everything (theme change);
  `destroy()` removes subscriptions, observers and listeners. Views render template strings.
- UI helpers: `icons.js` (`icon(name)` from `assets/icons.svg`), `fields.js` (`bindNumber` validated
  number inputs with inline errors, `parseNumber` accepts comma decimals), `notify.js` (`toast`).
- Core: `state.js` (reactive `appState`, localStorage, import/export; angle units follow the active
  scope via `_syncAngleUnits`; `solverAlgorithm()` gives the solver algorithm: MPM or the bullet's
  drag table), `targets.js` (target catalogue), `sanitize.js` (validates every
  stored/imported object against templates), `escape.js` (`esc`, `num`), `units.js`,
  `trajectory.js` (`interpolateAt`), `solve.js` (`solveExact`: one solution at an exact distance),
  `share.js` (share envelope and `#share=` link codec, with size caps). State also holds `matches`,
  `logbook` and `hunting`, each validated in `sanitize.js`; `importShared` merges a shared rifle or
  match without overwriting.
- Physics (`src/physics/`): `solvers.js`, `atmosphere.js`, `truing.js`, `wez.js`, `hunting.js`
  (point-blank range, energy/velocity limits), `fit.js` (logbook least-squares fit of MV and drag). Pure, SI units,
  tested in Node. Drag tables in `src/data/dragTables.js` are the standard JBM G1/G7 tables; don't
  edit values without a reference test.
- Canvases (`src/canvas/`): chart, reticle, turret, wind clock; colours from `palette.js`
  (`getPalette()` reads the Låda tokens), so they follow the theme.
- Vendored: `vendor/qrcode-generator/2.0.4/qrcode.mjs` (MIT, unchanged) for QR codes.
- Styles: Låda Glass in `vendor/lada-glass/2.2.0/`; `styles/main.css` (tokens mapping, header,
  shared components, Solver); `styles/views/*.css` per view; `styles/print.css` (DOPE cards only).
- `sw.js`: network-first service worker; `STATIC_ASSETS` must list every app file
  (`tests/sw-assets.mjs` fails otherwise).

## Version

`manifest.json` `"version"` is the single source. The footer reads it at runtime; `package.json`,
`sw.js`'s `CACHE_NAME`, the README "**Version:**" line and the newest CHANGELOG section repeat it.
`tests/version.mjs` fails if they disagree, so bump them all in the same commit.

## Working agreements

- This repo follows the app standards in `~/Desktop/code/tools/standards/STANDARDS.md` (rule IDs,
  severities). `claude-check --repo .` checks it; decisions and reasoned waivers go in `.claude-standards`.
- Design: Låda Glass (`design=family`): use the real `lg-` components and `LadaGlass.chart` for data
  charts; custom canvases use `src/canvas/palette.js`. Colours only from `--lg-*` tokens (no hex in app CSS; the
  printed DOPE cards have fixed paper/ink tokens on purpose). Icons from the sprite; no emoji.
  Plain-language, sentence-case copy; explain jargon once.
- Security: any string from user input, storage or an import goes through `esc()` before it is put
  into a template; reviewed `innerHTML` sinks carry an `eslint-disable-next-line
  no-unsanitized/property -- reviewed: …` comment. No inline styles or handlers (CSP); dynamic sizes
  via the CSSOM. No third-party requests.
- Units: physics is SI; every displayed number follows `appState.state.displayUnits`; clicks come
  from the scope's `clickValueRad`, not the unit system.
- Plan before building: agree on goals, scope and approach first, then implement in small, tested
  steps. Physics changes need a reference test in `tests/verify.mjs`; UI changes keep
  `npm run test:browser` green (zero console errors).
- Record user-visible changes under "Unreleased" in `CHANGELOG.md`. Bump the version on every push
  that changes the app (patch: fixes, minor: features, major: breaking changes), and in the same
  commit move "Unreleased" under the new version and update the README's version and "What's new".
- The README stays detailed (features, installation, every setting with its default, how-tos,
  screenshots in a grid with captions). Screenshots live in `docs/screenshots/`.
- `PRODUCT_RESEARCH_AND_FEATURE_ROADMAP.md` (feature research) is gitignored; don't commit it.
- There is no GitHub remote yet. Don't push or create repos unless asked.
