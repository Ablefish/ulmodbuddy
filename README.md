# UL Mod Buddy

A browsable recipe/research/workstation reference for the [Undead Legacy](http://ul.subquake.com)
mod for *7 Days to Die*. Search for any craftable item, research topic, or
workstation, and see its full "Total Requirements Report" -- a cascading,
click-to-expand cost tree covering crafting ingredients, research
prerequisites, workstations, tools, and where to find things via harvesting
or recycling.

This is an unofficial fan-made tool. It is not affiliated with The Fun
Pimps, Subquake, or the Undead Legacy team.

## No mod content is bundled

This repository contains only the tool itself. **No game files, mod files,
or extracted images are included or ever committed.** On first run, the app
asks you to point it at your own, legally-owned *7 Days to Die* install
(with Undead Legacy installed as a mod) and builds a local dataset directly
from those files. Nothing is uploaded anywhere -- the build happens
entirely on your own machine, and the generated data never leaves it unless
you choose to share it yourself.

## Requirements

- Python 3 (no extra packages -- everything here is standard library only)
- Your own copy of *7 Days to Die* with the Undead Legacy mod installed,
  e.g. `C:\7D2D\Custom\Undead_22` (the folder should contain both
  `Mods\UndeadLegacy` and `Data`)

## Setup

1. Download or clone this repository.
2. Run the local server:
   ```
   python app/server.py
   ```
3. Open <http://localhost:8420> in your browser.
4. The app will ask for your install folder the first time -- paste the
   path and click **Build**. This reads your local install and generates
   `app/data.js` plus the icons the app needs; it takes a few seconds.

That's it -- the app takes over once the build finishes. If Undead Legacy
updates later, click **Rebuild data** in the header to regenerate against
your updated install.

## Notes

- Every warning about the mod's own data (unresolved references, likely
  typos, missing localization) is visible in-app via the "N build
  warning(s)" link in the header, not just in a terminal.
- The tool never modifies your game install -- it only reads from it.
