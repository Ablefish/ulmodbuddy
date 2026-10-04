# UL Mod Buddy -- User Guide

This guide (and the app itself) assumes a desktop browser -- it hasn't
been tested on phones or tablets, and setup in particular relies on a
browser API mobile browsers largely don't support yet.

## Building your dataset

The app ships with no data of its own -- the very first thing it does on
a fresh page load is ask you to point it at your own *7 Days to Die* +
Undead Legacy install, so it can build its reference data straight from
the files you actually have installed. See the
**[README](README.md#which-setup-do-i-need)** for the three ways to run
the app (Zero download, Zero install, or Python) and which fits your
browser; whichever you pick, the first-run experience is the same:

1. The app opens a **Build UL Mod Buddy Data** modal automatically --
   there's nothing to look at yet, so it can't be dismissed until a build
   succeeds.

   ![Build UL Mod Buddy Data modal on a first run, showing just the "Choose your install folder..." button](docs/screenshots/build-data-modal.png)

2. In Chrome or Edge, click **Choose your install folder...** and pick
   the folder containing both `Mods\UndeadLegacy` and `Data`; your browser
   will ask you to confirm read access. In the Python setup, paste that
   same folder's path into the form instead and click **Build**.
3. The app reads your install and builds its entire dataset -- recipes,
   research, icons, and everything else this guide covers -- in a few
   seconds, then takes over automatically.

The build only reads XML config files, localization text, icon images,
and POI prefab block data from your install -- nothing else. (POI
thumbnails are only read later, one at a time, when you hover a POI.) It's also only been tested
against a clean Undead Legacy install with no other mods, so a heavily
modded install may give odd or missing results.

Your install folder and the built dataset are both remembered for next
time, so a returning visit skips straight to the app with no need to
repeat this. If you ever update the mod yourself, click **Rebuild data**
in the header to regenerate against your updated install -- see
[Keeping the data current](#keeping-the-data-current) below.

## Searching and filtering

Type in the search box to find any recipe, research topic, or workstation
by name. The filter chips (**All / Recipes / Research / Workstations /
Items**) narrow the list to just one kind of entry -- useful once a search
term matches a lot of different things.

![Search box showing results for "Knife", with filter chips above the list](docs/screenshots/search-and-filters.png)

Note that the same item name can show up twice in results -- once as a
**Recipe** and once as **Research**. These are two different pages: the
recipe page is "what does it cost to build this," the research page is
"what does it cost to unlock the ability to build this." Click whichever
one you actually want.

## Item Detail Page

Selecting an item opens its detail page -- everything needed to make it,
all the way down to raw materials, in one place.

![Iron Knife's detail page: crafting cost tree, research required, workstations, and what it recycles into](docs/screenshots/item-detail-page.png)

A few things worth knowing about this page:

- **The quantity box** at the top scales every number on the page --
  set it to 20 and every ingredient count updates to "what it costs to
  make 20 of these."
- **The chips next to every ingredient** (Craft / Loot / Buy / Harvest /
  Recycle / Scrap / Quest) show every way that item can be obtained. Craft
  always means "look up its own recipe" -- the other chips are described
  below.

  ![Close-up of an ingredient row's chips: Scrap, Recycle, Quest, Harvest, Craft, Loot, Buy](docs/screenshots/chips-all-types.png)

- **The ▶ triangle** next to any craftable ingredient, workstation, or
  research step expands it into its *own* cost tree. Left collapsed, an
  ingredient is assumed to already be in hand (bought, looted, harvested,
  or already built) -- expanding it says "no, I want to make this myself
  too," and its own ingredients get folded into the totals.
- **Research Required** shows the full research chain needed to unlock
  the recipe, including anything it cascades from. Here, the pistol
  round needs its own research, which itself needs an earlier research
  step first:

  ![7.92mm Round (HP)'s research section, showing one research step cascading from an earlier one, and its own recycle yield](docs/screenshots/item-detail-research-cascade.png)

- **Opens Into**, shown for the handful of items with an "Open" action of
  their own (an ammo box, a quest-reward bundle) -- what you get for using
  it. Some bundles also roll a random pick from a pool on top of their
  fixed contents; that part is clearly marked as inferred from the mod's
  own data, not confirmed by play-testing.
- **Scraps Into**, followed by **Recycles Into**, cover the two separate
  ways to break an item back down: Scraps Into is the in-inventory "Scrap"
  action (always one fixed resource, no Recycler needed); Recycles Into is
  what you get back for feeding a copy of the item through a Recycler.

### One-time totals

As you expand ingredients down through a few levels, a running
**One-Time Totals** panel keeps a flattened, deduplicated shopping list
of everything currently expanded -- so you don't have to add up the same
ingredient appearing under three different sub-trees by hand.

![One-Time Totals panel listing 5 distinct ingredients with combined counts](docs/screenshots/one-time-totals.png)

## Where to find things: Harvest, Recycle, and Scrap sources

Three of the chips shown next to an ingredient open a popup instead of
jumping to another page -- shown filled in solidly (rather than outlined,
like the others) so they read as clickable at a glance:

![Close-up of the Harvest and Recycle chips](docs/screenshots/chips-harvest-recycle.png)

- **Harvest** -- every block/entity in the world that drops this item,
  with expected drop counts.
- **Recycle** -- every other item you could break down at a Recycler to
  get this one back as a yield.
- **Scrap** -- every other item you could break down with the in-inventory
  Scrap action to get this one back.

All three are grouped into **High / Medium / Low yield** tiers, relative to
the best source for that specific item -- so the top of the list is
always where you should actually go looking first.

![Harvest Sources popup for Iron Plating, grouped into High/Medium/Low yield tiers](docs/screenshots/harvest-sources.png)

![Recycle Sources popup for Iron Plating, showing which items to break down and their yield tiers](docs/screenshots/recycle-sources.png)

![Scrap Sources popup for Handgun Parts, showing the pistols that scrap into it, all in the High Yield tier](docs/screenshots/scrap-sources.png)

## Loot Sources

The fourth clickable chip, **Loot**, opens a different kind of popup --
every real container and kill that can actually drop the item, at a loot
stage you pick:

![Loot Sources popup for Falcon, showing the loot-stage picker and High/Medium Chance sections with Found In and Dropped By sublists](docs/screenshots/loot-sources.png)

The **Loot stage** buttons jump straight to the real in-game stages where
the next weapon/tool/armor tier switches on (not an even 0/50/100/150/200
split) -- picking a later stage can turn "not obtainable" into a real
source, since most loot tables are gated off entirely below their own
tier's threshold. Sources are grouped the same **High / Medium / Low
Chance** way Harvest/Recycle/Scrap group by yield, with **Found In** and
**Dropped By** sub-lists under each tier.

This is the single most complex calculation in the app -- a container's
odds can depend on a whole chain of nested loot-group gates, each one
checked independently for the stage you picked, multiplied together for
the combined number shown. Treat it as a rough guide to where to look, not
verified drop odds.

## Found in POIs

A placed block -- a desktop PC, a monitor, a generator -- gets a **Found in
POIs** section at the bottom of its page, below **Recycles Into**: every
point of interest that contains one, grouped **High / Medium / Low Count**
(relative to the POI holding the most). Each row reads `3x Name (prefab_id)`
-- the prefab id is handy for searching in the in-game Prefab Editor -- with
the POI's difficulty tier shown on the right as that many skulls (none for
Tier 0 Remnants). Within each group the easiest POIs come first (lowest
tier, then most copies, then name). **Hover a row** to see that POI's own
thumbnail, read on demand from your install -- nothing is copied or stored.
With the browser-only setups your browser may need to re-confirm read access
to your install folder on a return visit; if so, the popup says to click
the row once to allow it. It's counted straight from each POI's own prefab data, so
it also covers UL's own POIs. Only blocks that physically sit in a POI get the section; a
random-spawn placeholder block is counted as its most likely real variant.

## The Research Tree

The **Research Tree** button (header, top right) opens a full visual map
of one research category at a time -- pick a category from the dropdown
to switch trees. A **Research tree / Recipe grid** toggle picks which of
two views you're looking at:

- **Research tree** is the connected node map: each node's ring color
  shows which Research Station tier you need to conduct that specific
  research (see the legend at the top); it's not related to the tier of
  whatever workstation the unlocked recipe itself needs to craft with.
- **Recipe grid** drops the research connections entirely and instead
  shows every recipe the category unlocks, one icon each, packed into a
  compact block per workstation -- useful for seeing everything one
  station can make at a glance instead of following its research chain
  node by node. Each workstation's own header icon carries two pieces of
  information too: its ring shows whether it's a tiered station family at
  all, and its background tint shows how early you can research building
  it in the first place.

![Research Tree for the "Cooking" category in Research tree mode, showing the Research tree/Recipe grid toggle, tier-colored ring icons, the category dropdown, and a hover popup listing what Spaghetti unlocks](docs/screenshots/research-tree.png)

In Recipe grid mode, each recipe icon itself carries two independent
tiers, both spelled out in the legend once you switch: the **ring** color
is the tier of the *workstation* the recipe needs to craft, while a
subtle **background tint** shows the tier of the *research* that unlocked
it -- a different axis that doesn't always agree, since nothing stops an
early research node from unlocking something that needs a late-game
station. A **Sort: workstation tier / research tier** toggle picks which
of the two orders the icons within each block; switch to research tier to
make exactly that kind of mismatch jump out -- a recipe you can research
early floats to the top of its block while its ring still shows the high
station tier it actually requires, instead of sinking to the bottom
sorted by that same station tier.

![Recipe grid for the "Cooking" category, showing workstation blocks with tier-tinted header icons, the sort toggle, and the ring/fill legend](docs/screenshots/recipe-grid.png)

Getting around a tree/grid bigger than the window:

- **Click-drag** anywhere on the canvas to pan around. Panning stops at
  the tree's own edges -- you can't drag it off into empty space forever.
- **Scroll wheel** zooms in/out, centered on wherever your cursor is.
- The **−** / **+** buttons in the corner zoom in fixed steps, centered
  on the middle of the view; **Fit** snaps back to the default overview
  of the whole category, scaled to fill the available space on whichever
  axis is more constraining (so a small category fills the view rather
  than sitting tiny in the middle of it).
- **Hovering a research node** pops up what it unlocks -- Spaghetti's own
  node, shown above, unlocks just the one recipe; some research nodes
  unlock several at once. **Hovering a recipe icon** in Recipe grid mode
  instead pops up that recipe's full ingredient list, so you can compare
  two recipes' cost without clicking into either one.
- **Clicking a node or recipe icon** jumps straight to that item/research's
  own detail page, same as clicking it in the search results.

## Vehicles

Selecting a vehicle's own recipe/item page shows its stats up top, plus
its full world-repair cost broken down by damage tier:

![Ambulance's stats and tiered world-repair costs](docs/screenshots/vehicle-stats-and-repair.png)

Below that, an **All Vehicles** table compares every vehicle's cargo
capacity, top speed, weight, mod slots, durability, and repair kit tier
side by side, grouped by vehicle class:

![All Vehicles comparison table, grouped by class, sorted by cargo capacity](docs/screenshots/vehicle-comparison-table.png)

Click the column headers to re-sort by a different stat.

## Keeping the data current

If you've updated the mod, or reinstalled it to a new location, click
**Rebuild data** in the header to have the app pick that up.

If you're using Zero download or Zero install (Chrome or Edge either way),
you get two choices, with a "Current folder: \<name\>" line above them
once one's been picked before -- just the folder's own name, since
browsers never hand a page its full path, but enough to tell two
similarly-named install folders apart:

![Rebuild data modal offering "Rebuild from current folder" or "Choose a different folder..."](docs/screenshots/rebuild-data-modal.png)

- **Rebuild from current folder** re-reads the same install folder you
  picked before (just re-confirming the browser's read permission --
  no need to click through the folder picker again).
- **Choose a different folder...** opens a fresh picker, for switching
  to a different install entirely (e.g. comparing a live install against
  a test/clone one).

If you're using Python instead, **Rebuild data** brings back the same
install-path form from setup -- edit the path if needed (or leave it
as-is to rebuild from the same install) and click **Build**.

The "built \<timestamp\> from UndeadLegacy X.Y.Z" line in the header shows
the mod's own declared version, per its `ModInfo.xml` -- the mod's author
doesn't always update that file on every release, so this number can lag
behind whatever version the game itself displays. Hover over the line for
a reminder of this.

## Build warnings

If you see an "N build warning(s)" link next to the header's summary
line, click it to see exactly what it found -- things like a likely typo
in the mod's own data, an item with no traceable unlock path, or a name
that had to be guessed from a related item because it has no
localization entry of its own. These are gaps or oddities in the mod's
own source data, surfaced for visibility -- never silently patched over.
