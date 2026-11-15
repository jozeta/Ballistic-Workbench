# Changelog

All notable changes to Ballistic Workbench. Newest first; versions follow
[semantic versioning](https://semver.org/).

## Unreleased

## 0.1.0 - 2026-11-15

### Added

- Version number in the app footer, read from `manifest.json` (the single version source).
- `tests/version.mjs`: checks the version agrees across manifest, service worker, README and CHANGELOG.
- README, CHANGELOG, CLAUDE.md, SECURITY.md and an MIT license.

### Changed

- The service worker cache name now follows the app version, so each release replaces the old cache.
