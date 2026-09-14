# Changelog

All notable changes to UL Mod Buddy are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

## [1.0.2] - 2026-09-14

### Changed

- **Reverts v1.0.1's DLL-reading approach for the mod version.** It
  turned out to be a dead end, not just an untested edge case: Chromium's
  File System Access API hard-blocks reading `.dll` files at all (a fixed
  security restriction, confirmed via the exact browser error --
  `"Name is not allowed"` -- against two real installs), so it could never
  have worked for anyone. The header now shows `ModInfo.xml`'s version
  plainly labeled "(per ModInfo.xml)", with a hover tooltip noting the
  mod's author doesn't always update it on every release, rather than
  presenting a number that can't actually be kept current as if it were
  authoritative.

### Added

- A small **`vX.Y.Z` badge** next to the app's own title (not the mod's
  version) -- static markup, visible immediately on any page load
  regardless of cache state, so "which build am I actually looking at" is
  answerable at a glance. This is what surfaced the v1.0.1 problem in the
  first place: without it, a stale cached build and a genuinely broken
  fix looked identical from the outside.
- A short explanation under **One-Time Totals** clarifying that expanding
  a workstation, tool, or research step (not just an ingredient) adds its
  own cost to the running total too -- leaving something collapsed is what
  marks it "I already have this."

## [1.0.1] - 2026-09-14

### Fixed

- **The version shown in the header now reflects the mod's real release**,
  not a stale number. `ModInfo.xml`'s `<Version>` is maintained by hand and
  had drifted out of date (it read 2.7.01 against an actual 2.7.24
  install). The real version turns out to be readable from a different
  source: `UndeadLegacy.dll` embeds it as three length-prefixed strings in
  the compiled assembly, evidently written by the mod's own build tooling
  on every release. The app now reads that instead, falling back to
  `ModInfo.xml` if a future build ever lays it out differently.

### Added

- A **desktop-only** disclaimer in the README and User Guide -- neither
  has been tested on mobile, and the zero-install setup flow's File
  System Access API dependency means it likely won't work on most mobile
  browsers yet regardless.

## [1.0.0] - 2026-09-14

First tagged release. UL Mod Buddy started as a local-only Python tool;
this release brings it to a public, zero-install, browser-hosted state.

### Added

- Full recipe/research/workstation reference: search any item and see its
  **Total Requirements Report** -- a cascading, click-to-expand cost tree
  covering crafting ingredients, research prerequisites, workstations,
  tools, and every way to acquire something (Craft / Loot / Buy / Harvest
  / Recycle / Quest).
- **Harvest Sources** and **Recycle Sources** popups, ranked into
  High/Medium/Low yield tiers relative to the best source for that item.
- A browsable **item** page kind for anything with no recipe, research, or
  workstation of its own -- loot-only items, vehicle parts, weapon/armor
  mods, quest reward bundles -- so nothing acquirable is invisible to
  search.
- **Vehicles**: per-vehicle stats, tiered world-repair costs, and an All
  Vehicles comparison table grouped by unlock progression (bicycle to
  helicopter).
- **Research Tree**: a visual, per-category tree of research nodes with
  tier-colored rings and real in-game edge routing, now with full pan/zoom
  navigation -- click-drag panning, scroll-wheel zoom, +/-/Fit buttons,
  and panning clamped to the tree's own edges.
- **Zero-install setup**: point the app at your own *7 Days to Die* install
  (via the browser's File System Access API) and it builds its entire
  dataset client-side, in your browser -- no Python, no server, nothing
  installed. Works in Chrome and Edge out of the box; Brave needs one
  flag flipped (`brave://flags/#file-system-access-api`).
- Hosted on GitHub Pages at <https://ablefish.github.io/ulmodbuddy/>,
  auto-deployed via GitHub Actions on every push.
- A local Python fallback (`build/build.py` + `app/server.py`) for
  Firefox/Safari, or anyone who'd rather run it locally.
- This user guide ([GUIDE.md](GUIDE.md)) and a rewritten
  [README.md](README.md) leading with the zero-install flow.

### Fixed

- **Icons now persist correctly across reloads.** They were previously
  stored as `blob:` object URLs, which only stay valid for the exact page
  load that created them -- so icons would render right after a build,
  then go blank across the board on the very next visit. Icons are now
  stored as real image bytes and re-materialized into a fresh URL on
  every load.
- **Research tree pan/zoom reliability**: browser pointer-capture behavior
  was silently swallowing clicks on both the zoom buttons and on tree
  nodes themselves. Both now work correctly via a pointerup-based
  approach that doesn't depend on the browser's click-retargeting
  behavior during a drag gesture.
- A handful of data-accuracy fixes carried forward from the original
  local-only version: weapon/armor mod attachments and their icons
  (previously missing entirely), base-game icon/name inheritance through
  the mod's `Extends` chains, research nodes showing their own in-game
  symbol instead of a same-named item's icon, and vehicle paint recolors
  no longer cluttering search results with a dozen identical,
  content-less entries.
