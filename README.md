# UL Mod Buddy

[Undead Legacy](http://ul.subquake.com) is a complete overhaul of *7 Days
to Die*: crafting, harvesting, repairs and upgrades are all reworked around
new research, workstation and maintenance systems, and it adds new vehicles
and weapons on top. That depth means a lot of resources to keep track of.

**UL Mod Buddy** is a searchable crafting, research, and loot reference that
guides you to what you need and how to get it. It's built straight from your
own install, so it's always current with whatever version you're actually
running. It can also generate your own custom **Tweaks** mod, which overrides
some of Undead Legacy's grindier recipes to cut (or raise) the Old Book and
research-data costs.

New here? The **[User Guide](GUIDE.md)** walks through all of this with
screenshots.

## Highlights

- **How do I get \_\_\_\_?** -- every ingredient shows every way to acquire it:
  Craft, Loot, Buy, Harvest, Recycle, Scrap, or Quest.
- **What can I get from \_\_\_\_?** -- the reverse question, answered too:
  **Opens Into**, **Scraps Into**, and **Recycles Into** show what a
  bundle, ammo box, or breakdown actually yields.
- **Full cost tree** -- search any item, research topic, or workstation
  and expand a click-to-expand chain all the way down to raw materials.
- **Research Tree** -- a visual map of each research category, or a
  compact Recipe grid of everything one workstation can make.
- **Vehicles** -- stats, repair costs, and a sortable comparison table.
- **Tweaks: tune the book and research grind** -- generates a separate,
  standalone mod that overrides Undead Legacy's recipes to lower (or raise)
  how many Old Books and research-data items research, workstation upgrades
  and maintenance upgrades cost. Set the sliders, download the zip, extract
  it into `Mods`. Your install and the Undead Legacy files are never edited;
  delete the mod's folder to undo it.
- **Build warnings** -- gaps or typos in the mod's own data, surfaced
  in-app instead of buried in a log.

This is a hobby project, built and maintained in spare time -- not an
official tool, and not affiliated with The Fun Pimps or Subquake.

## Which setup do I need?

- **[Zero download](#zero-download-chrome-or-edge)** -- just open the hosted
  link. Chrome or Edge only.
- **[Zero install](#zero-install)** -- download this repo and open a file.
  Still Chrome or Edge only, but nothing ever talks to the hosted site.
- **[Python](#python)** -- for Firefox, Safari, or Brave without a flag
  flipped. A few extra steps, but only needs Python (already on most
  systems).

Either way, the app needs to read your own *7 Days to Die* + Undead
Legacy install to build its data -- there's no bundled copy of the mod
(see [Privacy & security](#privacy--security) below).

### Zero download (Chrome or Edge)

1. Open **<https://ablefish.github.io/ulmodbuddy/>**.
2. Click **Choose your install folder...** and pick your *7 Days to Die*
   install -- the folder containing both `Mods\UndeadLegacy` and `Data`
   (e.g. the default Steam location, or a modpack-specific folder if you
   used a mod launcher). Your browser will ask you to confirm read access.
3. The app builds its dataset right there in the page -- a few seconds,
   then it takes over.

Your folder and the built dataset are both remembered for next time, so a
returning visit loads instantly. Click **Rebuild data** in the header any
time you update the mod.

---

### Zero install

Same mechanism as above, just from your own local copy instead of the
hosted page -- handy if you'd rather not point a hosted site at your
install folder at all, even though nothing ever actually leaves your
browser either way.

1. Download or clone this repository somewhere on your computer.
2. Open `[PATH TO THE REPOSITORY DOWNLOAD]/app/index.html` directly in
   Chrome or Edge -- replace the bracketed part with wherever you saved it
   in step 1 (e.g. `C:\Users\You\Downloads\ulmodbuddy-main\app\index.html`).
3. Same as steps 2-3 above.

Chrome and Edge support the underlying browser API out of the box.
**Brave** ships the same engine but disables it by default -- flip it on
at `brave://flags/#file-system-access-api`, or just use Chrome/Edge.
Firefox and Safari don't support it at all -- use Python below instead.

---

### Python

Requirements: Python 3 (standard library only, nothing to install) and
the same install described above.

1. Download or clone this repository somewhere on your computer.
2. Run `python [PATH TO THE REPOSITORY DOWNLOAD]/app/server.py` --
   replace the bracketed part with wherever you saved it in step 1.
3. Open <http://localhost:8420>, paste your install path, and click
   **Build**.

Click **Rebuild data** in the header any time you update the mod.

## Privacy & security

- **No mod content is bundled.** This repository contains only the tool
  itself -- no game files, mod files, or extracted images are included or
  ever committed. You grant the app read access to your own, legally-owned
  install, and everything is built from those files on your own machine.
- **It only reads config, icons, and POI layouts.** The build reads the
  game's and the mod's XML config files, localization text, icon images,
  and each POI's prefab block data (to count what's inside it) -- plus a
  POI's own thumbnail, only when you hover it -- that's it. No saves, no executables, nothing else in your install is touched.
- **Nothing is ever uploaded anywhere.** Zero download and zero install
  both run entirely in your browser; Python runs entirely on `localhost`.
  None of the three ever talks to any server other than the one serving
  the app's own static files.
- **Access is read-only and explicitly granted.** In the browser-based
  flows, your browser shows a permission prompt before the app can read
  your install folder, and the tool never writes to it. The Python flow
  copies icon files into a local `app/icons` folder so your own browser
  can display them -- that folder stays on your machine, is never
  committed (see `.gitignore`), and is never sent anywhere.

## Notes & Caveats

- **This is 100% a hobby project!**
- **The Tweaks mod is the one thing this tool produces.** Everything else
  is read-only. Tweaks generates a standalone mod that overrides Undead
  Legacy's research and upgrade recipes (to reduce or increase the
  book/research grind); you choose to download it and extract it into your
  own `Mods` folder -- see
  [Tweaks](GUIDE.md#tweaks-scale-book-and-research-costs) in the guide.
  Regenerate it after updating Undead Legacy.
- **Tested on a clean install and the Tweaks mod only.** It's only been
  tried against a clean Undead Legacy install, with or without the Tweaks
  mod this tool generates. Other third-party mods that change the same XML
  files may give odd or missing results.
- **Desktop only.** The app builds its data from the game files in your own
  *7 Days to Die* install, so it's meant for the computer the game is installed
  on, not for phones or tablets.
- Every warning about the mod's own data (unresolved references, likely
  typos, missing localization) is visible in-app via the "N build
  warning(s)" link in the header, not just in a terminal.
- **Loot odds are inferred, not verified.** The numbers behind Loot
  Sources are reverse-engineered from the mod's own loot-group data, not
  confirmed by play-testing -- treat them as a guide to where to look,
  not gospel.
- See [CHANGELOG.md](CHANGELOG.md) for release history.
