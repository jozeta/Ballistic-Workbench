# Changelog

All notable changes to Ballistic Workbench. Newest first; versions follow
[semantic versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-11-15

The first version: the existing app brought under version control, redesigned and audited
(code bugs, security, ballistics math, UX and copy).

### Ballistics (corrected results)

- Standard JBM G1 (79 points) and G7 (84 points) drag tables. The old tables had far too little
  supersonic drag: 6.5 Creedmoor 140 ELD-M at 1000 m showed 8.5 instead of 10.2 MRAD, .223 77 gr
  11.5 instead of 16.1 MRAD. Results now agree with an independent solver within 0.01 MRAD and with
  Hornady's published 6.5 Creedmoor table.
- The zero is solved level, without wind, cant, Coriolis or jump, so it no longer shifts with field
  conditions.
- Aerodynamic jump from Litz (was about 50× too large); spin drift from Litz; Miller stability
  atmospheric correction un-inverted; cant rotates the launch direction; Coriolis checked against
  py-ballisticcalc; a latitude of 0° is honoured; powder temperature is applied.
- The solution is interpolated at the exact target distance (it snapped to the nearest table row).
- Wind speed and direction now change the solution (stored wind zones overrode them); a 0 wind or
  a 0° direction is no longer replaced by defaults.
- Hit probability: sensitivity derivatives from one consistent solve (up to 8× off before), correct
  range-error term. Truing solves at the exact distance.
- Reticle: the hold mark is on the downwind side (it was mirrored); second-focal-plane holds scale
  with magnification.
- DOPE cards: danger space uses the descent angle; clicks follow the scope's click value.
- Bullet library: 27 G7 BCs corrected to published values (with source); 133 derived ones are
  marked "estimated".

### Guide and help

- Guide: an illustrated step-by-step walkthrough from planning a range day to a printed DOPE chart
  (equipment, sight height, twist, click value, cant, bullet data, zero, chronograph, shooting known
  distances, truing, building and checking the chart), how every view and tool works, and a glossary.
  Progress is saved per step.
- An i next to every setting (126 of them) explains what it is, how to measure or choose it,
  typical values and tips, with a link to the guide. Opens on hover, keyboard focus or tap.

### Interface

- Låda Glass 2.2.0 app shell (sidebar navigation with Search, Units and Theme), Låda components
  and Låda SVG charts throughout; dark and light themes following the system (System / Light / Dark);
  custom ballistics icon set and line-art graphics; no emoji.
- New navigation: Solver, Compare models, DOPE cards, Tools, Library; command palette with keyboard
  support (⌘K / Ctrl+K).
- Solver: setup column with collapsible sections and a firing-solution card (elevation and windage
  with direction and clicks); reticle and turret, trajectory chart and range table in tabs; on a
  phone the answer comes first.
- Validated number inputs with inline messages (comma decimals accepted); solver model chosen
  separately from the bullet's drag model.
- DOPE cards: format picker, true-size preview, prints at exact physical size, ranges from the
  Solver interpolated and capped per card.
- Tools: six tools with a clear input → result flow and a plain verdict; chronograph unit switch.
- Library: edit, duplicate and delete rifles with undo; using a bullet keeps your trued muzzle
  velocity; searchable bullet list.
- Accessible: labelled fields, keyboard-operable tabs, dialogs, turret and wind clock; screen-reader
  text for charts; 44 px touch targets; no horizontal scrolling at 390 px.
- Plain-language copy throughout; units follow the setting everywhere (several tools were
  metric-only; the chronograph saved fps as m/s).
- Version number in the footer.

### Fixed

- Angles follow the scope: an MRAD scope shows MRAD in imperial too (imperial forced MOA next to
  0.1 MRAD clicks); imperial range tables use round yards.
- The firing solution is solved exactly at the target distance (at short range it depended on the
  table step); the bullet's drag model always sets the drag table (it was ignored with point mass).
- Turret follows the solution by default, so the target no longer slides along the drop curve in
  the reticle while changing the distance.
- Target types have their own size and shape (NATO E and plates behaved like an IPSC torso).
- Editing a preset atmosphere no longer changes the preset; altitude now affects the air.
- Compare models: 4DOF removed (it computed the same as MPM); a plain explanation of the
  differences; no crash with extreme rifles.
- The app could fail to start when served with python's http.server (it dropped parallel module
  loads); a small Node server (npm start) replaces it.

- Tools initialised twice (Calibrate Scale did nothing; the simulation ran twice).
- Compare models went blank after a theme change; views went stale after changes elsewhere.
- Window listeners leaked on every re-render.
- Malformed imports could break the app permanently; a zero or tiny table step could hang it.
- The rifle dialog's "Doppler" option silently halved the BC; invalid numbers were replaced with
  defaults.

### Security

- Strict Content-Security-Policy (no inline scripts or styles, no third-party hosts).
- Everything loaded from storage or an imported file is validated; stored strings are HTML-escaped
  wherever they are shown.
- Upload limits for imports (2 MB) and target photos (PNG/JPEG/WebP, 25 MB).
- The offline cache only stores the app's own files.

### Project

- README, CHANGELOG, CLAUDE.md, SECURITY.md, MIT license, ESLint, GitHub Actions CI.
- Tests: physics reference checks (2762), helpers, version, offline cache list, and an end-to-end
  browser test of every view in both themes and at phone width.
