# Changelog

All notable changes to UL Mod Buddy are documented here. Format loosely
follows [Keep a Changelog](https://keepachangelog.com/).

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
