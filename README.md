# UL Mod Buddy

New here? See the **[User Guide](GUIDE.md)** for a walkthrough of what it
can do, with screenshots.

A browsable recipe/research/workstation reference for the [Undead Legacy](http://ul.subquake.com)
mod for *7 Days to Die*. Search for any craftable item, research topic, or
workstation, and see its full "Total Requirements Report" -- a cascading,
click-to-expand cost tree covering crafting ingredients, research
prerequisites, workstations, tools, and where to find things via harvesting
or recycling.

This is an unofficial fan-made tool. It is not affiliated with The Fun
Pimps, Subquake, or the Undead Legacy team.

## Which setup do I need?

The app needs to read your own *7 Days to Die* + Undead Legacy install to
build its data -- there's no bundled copy of the mod (see
[Privacy & security](#privacy--security) below). How you point it at that
install depends on your browser:

- **Using Chrome or Edge?** Use **[zero-install setup](#setup-zero-install----chrome-or-edge)** --
  no download, no Python, just a link.
- **Using Firefox, Safari, or Brave?** Use the **[Python fallback](#setup-fallback----firefox-safari-brave-without-the-flag-or-local-python)** --
  a few extra steps, but only needs Python (already installed on most
  systems).

## Setup (zero install -- Chrome or Edge)

1. Open **<https://ablefish.github.io/ulmodbuddy/>** -- or, if you'd rather
   run it from a local copy, clone this repository and open `app/index.html`
   directly in your browser. Either way, no server or Python is needed.
2. Click **Choose your install folder...** and pick your *7 Days to Die*
   install -- the default vanilla Steam location, e.g.
   `D:\SteamInstall\steamapps\common\7 Days To Die`, if you installed Undead
   Legacy directly into it, or a separate folder like
   `C:\7D2D\Custom\Undead_22` if you used a mod launcher (e.g. ModLauncherV5)
   that clones a fresh install per modpack. Either way, the folder should
   contain both `Mods\UndeadLegacy` and `Data`. Your browser will ask you to
   confirm read access to it.
3. The app reads your local install and builds the dataset right there in
   the page; it takes a few seconds. That's it -- the app takes over once
   the build finishes.

Your picked folder and the built dataset are both remembered (via your
browser's local storage) for next time, so a returning visit loads
instantly without repeating this. If you update the mod yourself later,
click **Rebuild data** in the header to regenerate against your updated
install.

Chrome and Edge support this out of the box; Firefox and Safari currently
don't. **Brave** ships the same engine as Chrome but disables it by
default -- enable it at `brave://flags/#file-system-access-api` and
relaunch the browser, or just use Chrome/Edge instead. If none of that
works for you, use the Python fallback below.

## Setup (fallback -- Firefox, Safari, Brave without the flag, or local Python)

Requirements: Python 3 (no extra packages -- everything here is standard
library only), and the same *7 Days to Die* + Undead Legacy install
described above.

1. Download or clone this repository.
2. Run the local server:
   ```
   python app/server.py
   ```
3. Open <http://localhost:8420> in your browser.
4. The app will ask for your install folder the first time -- paste the
   path and click **Build**. This reads your local install and generates
   the data plus icons the app needs; it takes a few seconds.

That's it -- the app takes over once the build finishes. If you update
the mod yourself later, click **Rebuild data** in the header to
regenerate against your updated install.

## Privacy & security

- **No mod content is bundled.** This repository contains only the tool
  itself -- no game files, mod files, or extracted images are included or
  ever committed. You grant the app read access to your own, legally-owned
  install, and everything is built from those files on your own machine.
- **Nothing is ever uploaded anywhere.** The zero-install flow runs
  entirely in your browser; the Python fallback runs entirely on
  `localhost`. Neither one talks to any server other than the one serving
  the app's own static files.
- **Access is read-only and explicitly granted.** In the zero-install flow,
  your browser shows a permission prompt before the app can read your
  install folder, and the tool never writes to it. The Python fallback
  copies icon files into a local `app/icons` folder so your own browser can
  display them -- that folder stays on your machine, is never committed
  (see `.gitignore`), and is never sent anywhere.

## Notes

- Only tested on desktop, with Chrome or Edge; the Python fallback is
  needed for other browsers -- see above.
- Every warning about the mod's own data (unresolved references, likely
  typos, missing localization) is visible in-app via the "N build
  warning(s)" link in the header, not just in a terminal.
- See [CHANGELOG.md](CHANGELOG.md) for release history.
