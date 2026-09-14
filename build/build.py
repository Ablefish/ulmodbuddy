#!/usr/bin/env python3
"""
UL Mod Buddy -- build pipeline.

Parses the mod's source Config/ XML into one JSON dataset (data.js) for the
app, plus a folder of the icon PNGs actually referenced.

Data-fidelity principle (see project spec): stored fields mirror the source
XML attributes exactly (a recipe's `area`, an upgrade's `block`/`next`, ...).
Nothing is rewritten or invented. Anything that looks wrong in the source
(an unresolved reference, a likely typo) is reported in meta.warnings, never
silently corrected here -- normalizing happens later, at export time, scoped
to what's being exported (a Phase 3 feature; out of scope for this script).

Run from the app itself (app/server.py serves a "point me at your install"
form and calls main() in-process), or standalone: python3 build.py [path].
"""
import re
import sys
import csv
import json
import shutil
import datetime
import xml.etree.ElementTree as ET
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
#
# Nothing about the mod or the base game is ever bundled with this repo --
# every one of these is derived, at build time, from a real 7 Days To Die
# install directory the caller supplies (see configure_paths()). Undead
# Legacy overrides/renames/reskins vanilla content, so the mod's own files
# are always read with priority; Data/Config and Data/ItemIcons (pure
# vanilla) are read only as a fallback for names/icons the mod never
# touches -- see load_localization() and resolve_icon_with_variant_fallback().
# ---------------------------------------------------------------------------
BUILD_DIR = Path(__file__).resolve().parent          # ULModBuddy/build
ROOT = BUILD_DIR.parent                                # ULModBuddy/
APP = ROOT / "app"
ICONS_OUT = APP / "icons"
CONFIG_LOCAL_FILE = BUILD_DIR / "config.local.json"    # gitignored; remembers the last install root used

# Set by configure_paths(); left as None so any accidental use before it
# runs fails loudly instead of silently reading some other machine's paths.
SRC = MOD_ROOT = CONFIG = ATLASES = None
RECIPE_FILES = UPGRADE_FILE = RESEARCH_FILE = None
LOCALIZATION_FILE = BASE_LOCALIZATION_FILE = BASE_ICONS_DIR = None
ITEM_FILES = BLOCK_FILES = None
BASE_ITEM_FILE = BASE_BLOCK_FILE = None
MOD_ITEM_MODIFIERS_FILE = BASE_ITEM_MODIFIERS_FILE = None
TRADERS_FILE = QUESTS_FILE = LOOT_CONTAINERS_FILE = LOOT_GROUP_FILES = None
RECYCLE_FILE = None
VEHICLE_ITEMS_FILE = None
MOD_VEHICLES_FILE = BASE_VEHICLES_FILE = None
VEHICLE_BLOCKS_FILE = RECIPE_VEHICLES_FILE = None


class InstallRootError(ValueError):
    """Raised by validate_install_root() -- the message is written to be
    shown verbatim in the app's build-setup UI, so keep it plain and
    actionable, never a stack trace."""


def validate_install_root(install_root):
    """Fast, install-level sanity check before touching any XML: catches
    "wrong folder entirely" up front with one clear message, rather than a
    flood of individual "missing expected file" warnings once parsing
    starts. The per-file existence checks throughout this script still run
    on top of this -- this only guards against the coarse case."""
    root = Path(install_root)
    mod_config = root / "Mods" / "UndeadLegacy" / "Config"
    base_config = root / "Data" / "Config"
    missing = [str(p) for p in (mod_config, base_config) if not p.is_dir()]
    if missing:
        raise InstallRootError(
            "Not a valid 7 Days To Die install with Undead Legacy -- expected to find:\n"
            + "\n".join(missing)
        )
    return root


def configure_paths(install_root):
    """(Re)derives every source-file path constant from a given install
    root. Called once at the top of main() -- lets this whole module be
    safely re-invoked with a different (or the same) root in the same
    process, which app/server.py does every time someone submits the build
    form (initial setup, and any later "Rebuild data")."""
    global SRC, MOD_ROOT, CONFIG, ATLASES
    global RECIPE_FILES, UPGRADE_FILE, RESEARCH_FILE
    global LOCALIZATION_FILE, BASE_LOCALIZATION_FILE, BASE_ICONS_DIR
    global ITEM_FILES, BLOCK_FILES, BASE_ITEM_FILE, BASE_BLOCK_FILE
    global MOD_ITEM_MODIFIERS_FILE, BASE_ITEM_MODIFIERS_FILE
    global TRADERS_FILE, QUESTS_FILE, LOOT_CONTAINERS_FILE, LOOT_GROUP_FILES
    global RECYCLE_FILE
    global VEHICLE_ITEMS_FILE
    global MOD_VEHICLES_FILE, BASE_VEHICLES_FILE
    global VEHICLE_BLOCKS_FILE, RECIPE_VEHICLES_FILE

    SRC = Path(install_root)
    MOD_ROOT = SRC / "Mods" / "UndeadLegacy"
    CONFIG = MOD_ROOT / "Config"
    ATLASES = MOD_ROOT / "UIAtlases"

    RECIPE_FILES = [
        CONFIG / "recipes.xml",
        CONFIG / "Custom" / "recipes_armor.xml",
    ]
    UPGRADE_FILE = CONFIG / "Custom" / "recipes_upgrades.xml"
    RESEARCH_FILE = CONFIG / "Custom" / "recipes_research.xml"
    LOCALIZATION_FILE = CONFIG / "Localization" / "English.txt"
    # The mod's own Localization.txt only covers strings Undead Legacy adds
    # or overrides. Vanilla items the mod never redefines (just patches via
    # xpath) have no entry there -- their display names live in the base
    # game's own Localization.txt instead, read live from the install --
    # see load_localization() for the mod-first merge.
    BASE_LOCALIZATION_FILE = SRC / "Data" / "Config" / "Localization.txt"
    # Same gap, for icons: vanilla items the mod never gives a CustomIcon
    # override have no icon anywhere in the mod's own UIAtlases either. The
    # base game ships each item's icon as an individual PNG (named by
    # internal item name), already extracted, flat, directly under the
    # install -- no caching/copy step needed. When even THAT own-name lookup
    # misses (the mod patches a vanilla item's description/effects but keeps
    # its original Extends-inherited icon, e.g. a renamed perk book), the
    # base game's own items.xml/blocks.xml Extends chain is walked as a
    # last resort -- see load_extends_graph() and the fifth tier in
    # resolve_icon_with_variant_fallback().
    BASE_ICONS_DIR = SRC / "Data" / "ItemIcons"
    BASE_ITEM_FILE = SRC / "Data" / "Config" / "items.xml"
    BASE_BLOCK_FILE = SRC / "Data" / "Config" / "blocks.xml"

    ITEM_FILES = [CONFIG / "items.xml"] + sorted((CONFIG / "Custom").glob("items_*.xml"))
    BLOCK_FILES = [CONFIG / "blocks.xml"] + sorted((CONFIG / "Custom").glob("blocks_*.xml"))
    # Weapon/armor "mods" (attachments) are a completely separate schema
    # (<item_modifier>, not <item>/<block>) in their own file, with their own
    # CustomIcon/Extends properties that need scanning like any other item.
    # Both the mod's own file and the base game's (vanilla mods Undead
    # Legacy doesn't touch) matter.
    MOD_ITEM_MODIFIERS_FILE = CONFIG / "item_modifiers.xml"
    BASE_ITEM_MODIFIERS_FILE = SRC / "Data" / "Config" / "item_modifiers.xml"

    # Acquisition channels beyond crafting -- see load_acquisition_channels().
    TRADERS_FILE = CONFIG / "traders.xml"
    QUESTS_FILE = CONFIG / "quests.xml"
    LOOT_CONTAINERS_FILE = CONFIG / "Custom" / "loot_containers.xml"
    # <lootgroup> definitions are spread across all three of these, not just
    # the main one -- loot_quests_and_airdrops.xml and loot_twitch.xml each
    # define their own groups that containers/rewards can still reference into.
    LOOT_GROUP_FILES = [
        CONFIG / "Custom" / "loot_groups.xml",
        CONFIG / "Custom" / "loot_quests_and_airdrops.xml",
        CONFIG / "Custom" / "loot_twitch.xml",
    ]
    RECYCLE_FILE = CONFIG / "Custom" / "recipes_recycler.xml"
    # Vehicle stats (cargo capacity, repair kit tier, mod slots...) live in
    # their own <item>/<set> blocks here, entirely separate from the
    # recipe/research system -- see load_vehicles().
    VEHICLE_ITEMS_FILE = CONFIG / "Custom" / "items_vehicles.xml"
    # Top speed lives in a completely different file/schema (<vehicle>, not
    # <item>) keyed by an entity name that often differs from the item name
    # (e.g. item "vehicleMinibikePlaceable" spawns entity "vehicleMinibike")
    # -- see load_vehicle_speeds() and load_vehicles()'s entityName join.
    MOD_VEHICLES_FILE = CONFIG / "vehicles.xml"
    BASE_VEHICLES_FILE = SRC / "Data" / "Config" / "vehicles.xml"
    # World-repair costs for a found/damaged vehicle -- a completely separate
    # schema (<vehicle block="...">, not <recipe>) from blocks_vehicles.xml's
    # own block definitions -- see load_vehicle_repairs().
    VEHICLE_BLOCKS_FILE = CONFIG / "Custom" / "blocks_vehicles.xml"
    RECIPE_VEHICLES_FILE = CONFIG / "Custom" / "recipes_vehicles.xml"


def _read_local_config():
    if CONFIG_LOCAL_FILE.exists():
        try:
            return json.loads(CONFIG_LOCAL_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def _write_local_config(data):
    CONFIG_LOCAL_FILE.write_text(json.dumps(data), encoding="utf-8")


def load_mod_version():
    """The mod's own ModInfo.xml carries its real version (e.g. "2.7.01"),
    a far more meaningful "what did this data come from" label than an
    install folder's own name (which is whatever the user happened to name
    their local install, e.g. "Undead_22" -- meaningless to anyone else this
    tool gets shared with). Falls back to the folder name if ModInfo.xml is
    missing or unparseable, rather than failing the whole build over a
    cosmetic label.

    Labeled "(per ModInfo.xml)" because this value is maintained by hand
    by the mod's author and can lag behind the mod's real released
    version. The real version is embedded in UndeadLegacy.dll instead, but
    this reads ModInfo.xml only and does not parse the DLL, matching the
    browser build (which can't read .dll files at all -- Chromium's File
    System Access API hard-blocks them). ModInfo.xml is the mod's own
    declared source, so it's used as-is and labeled by its source rather
    than presented as authoritative."""
    modinfo = MOD_ROOT / "ModInfo.xml"
    if modinfo.exists():
        try:
            el = ET.fromstring(modinfo.read_text(encoding="utf-8", errors="replace"))
            version_el = el.find("Version")
            name_el = el.find("Name")
            if version_el is not None and version_el.attrib.get("value"):
                mod_name = name_el.attrib.get("value") if name_el is not None else "UndeadLegacy"
                return f"{mod_name} {version_el.attrib['value']} (per ModInfo.xml)"
        except ET.ParseError:
            pass
    return SRC.name

# Environmental workstations that need no unlock (found in the world, not built).
ALWAYS_AVAILABLE_STATIONS = {"campfire", "stove", "cementMixer"}

# Known source-data typos: reported, never silently rewritten in storage.
KNOWN_TAG_TYPOS = {"salvsageScrap": "salvageScrap"}

WARNINGS = []


def warn(msg):
    WARNINGS.append(msg)


# ---------------------------------------------------------------------------
# Localization: internal name -> display text
# ---------------------------------------------------------------------------
def _load_localization_csv(path, source_label):
    """Reads a Localization.txt-style CSV, finding the English text column by
    header name (case-insensitive "english") rather than assuming a fixed
    index -- the mod's own file is a simple `Key,English` pair, but the
    base game's file has many more columns."""
    names = {}
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        if not header:
            warn(f"{source_label}: empty or missing header row")
            return names
        english_idx = None
        for i, col in enumerate(header):
            if col.strip().lower() == "english":
                english_idx = i
                break
        if english_idx is None:
            english_idx = 1
        for row in reader:
            if not row or not row[0]:
                continue
            key = row[0].strip()
            val = row[english_idx].strip() if len(row) > english_idx else ""
            if key and key not in names:
                names[key] = val
    return names


def load_localization():
    """Loads the mod's own Localization.txt first (authoritative for
    anything it adds/overrides), then fills in gaps from the base game's own
    Localization.txt -- vanilla items the mod only patches via xpath have no
    entry in the mod's file, so without this merge they'd show as internal
    names in the app. See BASE_LOCALIZATION_FILE comment above."""
    names = _load_localization_csv(LOCALIZATION_FILE, LOCALIZATION_FILE.name)
    if BASE_LOCALIZATION_FILE.exists():
        base_names = _load_localization_csv(BASE_LOCALIZATION_FILE, BASE_LOCALIZATION_FILE.name)
        added = 0
        for k, v in base_names.items():
            if k not in names:
                names[k] = v
                added += 1
        print(f"  +{added} display names from base-game localization")
    else:
        warn(
            f"base-game localization file not found at {BASE_LOCALIZATION_FILE} -- "
            f"vanilla item names will show as internal names until this is fixed "
            f"(double-check the install root points at a real game install)"
        )
    return names


# ---------------------------------------------------------------------------
# Generic block scanning: find every <tag ...>...</tag> / <tag .../> in a
# file's raw text (these schemas never nest same-named tags, so a
# non-greedy regex scan is robust and far simpler than simulating the
# xpath append/set/remove patch directives).
# ---------------------------------------------------------------------------
def scan_blocks(text, tag):
    # The attribute-consuming `[^>]*` MUST be lazy (`*?`), not greedy: with a
    # greedy quantifier, a self-closing tag (<x name="y"/>) lets the engine
    # try the "open tag ... later </x>" alternative before ever backtracking
    # to the correct short self-closing match, silently gobbling everything
    # up to some unrelated LATER </x> (e.g. a self-closing <lootgroup
    # name="empty"/> would otherwise be captured as one giant fragment
    # spanning into the next several lootgroups).
    pattern = re.compile(r"<" + tag + r"\b[^>]*?(?:/>|>.*?</" + tag + r">)", re.S)
    return pattern.findall(text)


def parse_fragment(fragment, source_label):
    """Parse one XML fragment (a single element, self-closing or not)."""
    try:
        return ET.fromstring(fragment)
    except ET.ParseError as e:
        warn(f"{source_label}: could not parse fragment ({e}): {fragment[:100]!r}")
        return None


# Every scanner in this file works on raw text via regex, not a real XML
# parse -- so without stripping comments first, a <!-- DEPRECATED --> block
# would read as live content exactly like the real thing next to it (e.g. a
# commented-out entry would still show up as if it were live data). Safe
# here even though it's not a general-purpose XML-comment stripper: this
# source never nests comments or puts "-->" inside a literal attribute value.
_XML_COMMENT_RE = re.compile(r"<!--.*?-->", re.S)


def read_text(path):
    text = path.read_text(encoding="utf-8", errors="replace")
    return _XML_COMMENT_RE.sub("", text)


# ---------------------------------------------------------------------------
# Recipes (crafting) -- <recipe> in recipes.xml / Custom/recipes_armor.xml
# ---------------------------------------------------------------------------
def load_recipes():
    """
    Returns (recipes, recipes_by_name).

    IMPORTANT: the source XML legitimately defines *multiple* <recipe> entries
    sharing the same `name` attribute -- these are alternate recipes for the
    same item (e.g. resourceLeather can be made from scrap leather + a sewing
    kit, OR from raw hide, OR is always_unlocked as a salvage byproduct). This
    is the exact "alternate recipe" concept the UL Mod Buddy app is built around,
    so every variant must be kept, never collapsed to "last one wins".

    Each recipe gets a unique storage id: the bare name for the first
    occurrence, then "<name>#2", "<name>#3", ... for later ones. The `name`
    field on every record stays the original, unmodified source name (used
    for research/unlock matching and ingredient references) -- only the
    dict/storage key is disambiguated.
    """
    recipes = {}
    recipes_by_name = {}
    seen_counts = {}
    for path in RECIPE_FILES:
        if not path.exists():
            warn(f"missing expected file: {path}")
            continue
        text = read_text(path)
        for frag in scan_blocks(text, "recipe"):
            el = parse_fragment(frag, path.name)
            if el is None:
                continue
            name = el.attrib.get("name")
            if not name:
                warn(f"{path.name}: <recipe> with no name attribute, skipped")
                continue
            tags_raw = el.attrib.get("tags", "")
            tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
            for t in tags:
                if t in KNOWN_TAG_TYPOS:
                    warn(
                        f"recipe '{name}': tag '{t}' looks like a typo for "
                        f"'{KNOWN_TAG_TYPOS[t]}' (stored as-is)"
                    )
            ingredients = []
            outputs = []
            for child in el:
                if child.tag == "ingredient":
                    ingredients.append(
                        {"name": child.attrib.get("name"), "count": child.attrib.get("count", "1")}
                    )
                elif child.tag == "output":
                    outputs.append(
                        {"name": child.attrib.get("name"), "count": child.attrib.get("count", "1")}
                    )

            seen_counts[name] = seen_counts.get(name, 0) + 1
            n = seen_counts[name]
            recipe_id = name if n == 1 else f"{name}#{n}"

            recipes[recipe_id] = {
                "id": recipe_id,
                "name": name,
                "source": path.name,
                "time": el.attrib.get("time"),
                "area": el.attrib.get("area"),          # None => Backpack (no station)
                "tool": el.attrib.get("tool"),
                "tags": tags,
                "always_unlocked": el.attrib.get("always_unlocked") == "true",
                "count": el.attrib.get("count", "1"),
                "ingredients": ingredients,
                "outputs": outputs,
            }
            recipes_by_name.setdefault(name, []).append(recipe_id)

    variant_counts = {n: len(ids) for n, ids in recipes_by_name.items() if len(ids) > 1}
    if variant_counts:
        total_variants = sum(variant_counts.values())
        warn(
            f"{len(variant_counts)} item name(s) have multiple alternate recipes "
            f"({total_variants} recipe entries total) -- all kept, see recipesByName"
        )
    return recipes, recipes_by_name


# ---------------------------------------------------------------------------
# Workstation tier upgrades -- <upgrade block next tools> in recipes_upgrades.xml
# ---------------------------------------------------------------------------
def load_upgrades():
    upgrades = {}
    if not UPGRADE_FILE.exists():
        warn(f"missing expected file: {UPGRADE_FILE}")
        return upgrades
    text = read_text(UPGRADE_FILE)
    for frag in scan_blocks(text, "upgrade"):
        el = parse_fragment(frag, UPGRADE_FILE.name)
        if el is None:
            continue
        block = el.attrib.get("block")
        if not block:
            warn(f"{UPGRADE_FILE.name}: <upgrade> with no block attribute, skipped")
            continue
        tools_raw = el.attrib.get("tools", "")
        tools = [t.strip() for t in tools_raw.split(",") if t.strip()]
        ingredients = [
            {"name": c.attrib.get("name"), "count": c.attrib.get("count", "1")}
            for c in el if c.tag == "ingredient"
        ]
        upgrades[block] = {
            "block": block,
            "next": el.attrib.get("next"),
            "tools": tools,
            "ingredients": ingredients,
        }
    return upgrades


# ---------------------------------------------------------------------------
# Research tree -- <research> in recipes_research.xml
# ---------------------------------------------------------------------------
def load_research():
    research = {}
    if not RESEARCH_FILE.exists():
        warn(f"missing expected file: {RESEARCH_FILE}")
        return research
    text = read_text(RESEARCH_FILE)
    for frag in scan_blocks(text, "research"):
        el = parse_fragment(frag, RESEARCH_FILE.name)
        if el is None:
            continue
        name = el.attrib.get("name")
        if not name:
            warn(f"{RESEARCH_FILE.name}: <research> with no name attribute, skipped")
            continue
        ingredients = []
        unlocks = []
        for child in el:
            if child.tag == "ingredient":
                ingredients.append(
                    {"name": child.attrib.get("name"), "count": child.attrib.get("count", "1")}
                )
            elif child.tag == "unlocks":
                unlocks.append(
                    {
                        "name": child.attrib.get("name"),
                        "craftable": child.attrib.get("craftable"),
                        "display_only": child.attrib.get("display_only"),
                    }
                )
        if name in research:
            warn(f"duplicate research node name '{name}', later one kept")
        research[name] = {
            "name": name,
            "area": el.attrib.get("area"),
            "pos": el.attrib.get("pos"),
            "parent": el.attrib.get("parent"),
            "category": el.attrib.get("category"),
            "icon": el.attrib.get("icon"),
            "size": el.attrib.get("size"),
            "link_type": el.attrib.get("link_type"),
            "unlocked": el.attrib.get("unlocked") == "true",
            "requires": el.attrib.get("requires"),
            "ingredients": ingredients,
            "unlocks": unlocks,
        }
    return research


# ---------------------------------------------------------------------------
# Unlock pathway -- the resolved 3-rule model from the spec
# ---------------------------------------------------------------------------
def compute_unlocks(recipes, research, upgrades):
    research_node_names = set(research.keys())
    unlock_children = set()
    for node in research.values():
        for u in node["unlocks"]:
            if u["name"]:
                unlock_children.add(u["name"])
    directly_named = research_node_names | unlock_children

    # Station availability: fixpoint over the upgrade chain, seeded by
    # anything directly named by research, plus known environmental fixtures.
    available_stations = set(directly_named) | set(ALWAYS_AVAILABLE_STATIONS)
    changed = True
    while changed:
        changed = False
        for block, up in upgrades.items():
            nxt = up["next"]
            if block in available_stations and nxt and nxt not in available_stations:
                available_stations.add(nxt)
                changed = True

    unresolved = []
    for recipe_id, r in recipes.items():
        name = r["name"]          # match research/unlocks by the item name, not the storage id
        if r["always_unlocked"]:
            r["unlock"] = {"type": "always", "via": None}
            continue
        if name in directly_named:
            r["unlock"] = {"type": "direct", "via": name}
            continue
        area = r["area"]
        if area and area in available_stations:
            r["unlock"] = {"type": "station", "via": area}
            continue
        r["unlock"] = {"type": "unknown", "via": None}
        if "learnable" in r["tags"]:
            unresolved.append(recipe_id)

    if unresolved:
        warn(
            f"{len(unresolved)} learnable recipe(s) with no traceable unlock path: "
            + ", ".join(unresolved[:20])
            + (" ..." if len(unresolved) > 20 else "")
        )
    return available_stations


# ---------------------------------------------------------------------------
# Acquisition channels -- purchasable / lootable / rewardable
#
# Presence-only: the question this answers is just "can this item ever come
# from this channel at all", never "how likely" -- so every prob/count/
# stage/quality attribute along the way is deliberately ignored. Three
# source families, each shaped the same way
# (a named group whose <item> children are either name="X", a leaf, or
# group="Y", a reference to another group in the same family) rooted from a
# different kind of "real" entry point:
#   - purchasable: every <trader_info>'s own <trader_items> is a root into
#     the <trader_item_group> family (traders.xml).
#   - lootable: every <lootcontainer>'s own <item> children are a root into
#     the <lootgroup> family, which is itself spread across three files (see
#     LOOT_GROUP_FILES).
#   - rewardable: <reward type="Item" id="X"> names X directly; <reward
#     type="LootItem" id="groupX"> is a root into that same <lootgroup>
#     family -- quest rewards can be "glorified loot tables".
# Harvestable (block drop tables) is a separate, not-yet-built pass.
# ---------------------------------------------------------------------------
def _parse_named_group_family(files, group_tag):
    """Parses the trader_item_group / lootgroup shape: named groups whose
    <item> children are either a leaf (name="X") or a reference to another
    group in the same family (group="Y"). Returns {group_name: [(kind, ref)]}
    where kind is "item" or "group"."""
    groups = {}
    for path in files:
        if not path.exists():
            warn(f"missing expected file: {path}")
            continue
        text = read_text(path)
        for frag in scan_blocks(text, group_tag):
            el = parse_fragment(frag, path.name)
            if el is None:
                continue
            name = el.attrib.get("name")
            if not name:
                continue
            children = []
            for child in el.iter("item"):
                if child.attrib.get("name"):
                    children.append(("item", child.attrib["name"]))
                elif child.attrib.get("group"):
                    children.append(("group", child.attrib["group"]))
            groups[name] = children
    return groups


def _flatten_group(name, groups, visited, out):
    """Recursively resolves one group reference down to leaf item names,
    accumulating into `out`. `visited` guards against a cyclical group
    reference (not expected, but the source data is hand-authored)."""
    if name in visited:
        return
    visited.add(name)
    for kind, ref in groups.get(name, []):
        if kind == "item":
            out.add(ref)
        else:
            _flatten_group(ref, groups, visited, out)


def _roots_from_blocks(path, root_tag, groups):
    """Scans every <root_tag>...</root_tag> fragment in `path` and flattens
    each <item> found anywhere inside it (name="X" direct, or group="Y" into
    `groups`) into one combined set -- used for both trader_info and
    lootcontainer, which shape their own <item> entries identically."""
    out = set()
    if not path.exists():
        warn(f"missing expected file: {path}")
        return out
    text = read_text(path)
    for frag in scan_blocks(text, root_tag):
        el = parse_fragment(frag, path.name)
        if el is None:
            continue
        visited = set()
        for item_el in el.iter("item"):
            if item_el.attrib.get("name"):
                out.add(item_el.attrib["name"])
            elif item_el.attrib.get("group"):
                _flatten_group(item_el.attrib["group"], groups, visited, out)
    return out


def load_acquisition_channels():
    """Returns (purchasable, lootable, rewardable) as sets of internal
    item/block names."""
    trader_groups = _parse_named_group_family([TRADERS_FILE], "trader_item_group")
    loot_groups = _parse_named_group_family(LOOT_GROUP_FILES, "lootgroup")

    purchasable = _roots_from_blocks(TRADERS_FILE, "trader_info", trader_groups)
    lootable = _roots_from_blocks(LOOT_CONTAINERS_FILE, "lootcontainer", loot_groups)

    rewardable = set()
    if QUESTS_FILE.exists():
        text = read_text(QUESTS_FILE)
        visited = set()
        for frag in scan_blocks(text, "reward"):
            el = parse_fragment(frag, QUESTS_FILE.name)
            if el is None:
                continue
            rid = el.attrib.get("id")
            if not rid:
                continue
            if el.attrib.get("type") == "Item":
                rewardable.add(rid)
            elif el.attrib.get("type") == "LootItem":
                _flatten_group(rid, loot_groups, visited, rewardable)
    else:
        warn(f"missing expected file: {QUESTS_FILE}")

    return purchasable, lootable, rewardable


def _parse_count_range(count_attr):
    """"3,5" -> (3, 5); "1" -> (1, 1). Every count attribute seen in the
    source is either a bare integer or a comma-separated min,max pair --
    never a dash range -- so this is deliberately not more permissive."""
    parts = count_attr.split(",")
    lo = int(float(parts[0]))
    hi = int(float(parts[-1]))
    return lo, hi


def _expected_yield(s):
    """A single "how much do I actually get" number that blends chance and
    count -- prob=1 count=3 should outrank prob=1 count="1,3" (a guaranteed
    3x should read as better than a 1-3x roll), and a guaranteed small drop
    should still be weighable against a rare big one. Just the mean of a
    straightforward model (roll `prob`, then a uniform count in range),
    nothing fancier."""
    return s["prob"] * (s["countMin"] + s["countMax"]) / 2.0


# Matches the "_<N>" / "_<N><letters>" suffix convention this mod uses for
# both real crafting-upgrade tiers (ulmStationCarpenter_2), pure quality/skin
# variants with no crafting path at all (ulmGeneratorGasoline_2, _2b, ...),
# and a powered/unpowered pair sharing a tier number (ulmStationSawbench_1
# vs _1Powered) -- trailing letters after the digits are part of the variant
# tag, not the tier, so they're stripped along with the number rather than
# just a single disambiguator letter. See _collapse_tier_variants below.
TIER_VARIANT_SUFFIX_RE = re.compile(r"^(.*)_(\d+)[A-Za-z]*$")


def _collapse_tier_variants(sources, key="block"):
    """A block/item family that only differs by tier/quality number (see
    TIER_VARIANT_SUFFIX_RE) often yields the exact same materials regardless
    of tier -- e.g. every one of ulmGeneratorGasoline_1..7 drops identical
    192 Scrap Iron despite very different power stats. Listing all 7 as
    separate sources would just be noise, so this collapses any group that
    shares both a name root AND identical (event, countMin,
    countMax, prob) down to one representative row (the lowest tier number,
    since that's the one most likely to have a plain, suffix-free display
    name/icon). A family whose tiers genuinely yield different amounts is
    left alone -- collapsing is opt-in via an exact match, never assumed.
    `key` names the field holding the block/item's own internal name (harvest
    sources use "block", recycle sources use "item") -- shared between both
    features since the pattern and the fix are identical."""
    groups = {}
    order = []
    for s in sources:
        m = TIER_VARIANT_SUFFIX_RE.match(s[key])
        root = m.group(1) if m else s[key]
        group_key = (root, s.get("event"), s["countMin"], s["countMax"], s["prob"])
        if group_key not in groups:
            groups[group_key] = []
            order.append(group_key)
        groups[group_key].append(s)

    def suffix_num(s):
        m = TIER_VARIANT_SUFFIX_RE.match(s[key])
        return int(m.group(2)) if m else 0

    return [group[0] if len(group) == 1 else min(group, key=suffix_num) for group in (groups[k] for k in order)]


def _collapse_same_block_events(sources):
    """The same physical block often declares more than one <drop> event
    (Harvest/Destroy/Fall) for the SAME item -- e.g. a Dew Collector drops
    10-15 Scrap Polymers whether you harvest it properly or destroy it some
    other way (explosives, gunfire, ...). Harvest/Destroy/Fall are
    alternative outcomes for one break event, never stacked -- so listing
    them as two separate rows would read as "get this twice" when it's
    really "get this either way". Collapses rows sharing the same block
    AND identical (countMin, countMax, prob) regardless of event into one,
    preferring the "Harvest" label when there's a choice since that's this
    app's default/no-annotation case. A block whose events genuinely differ
    in amount (e.g. a bonus item only via one event) keeps its rows
    separate -- that distinction is real information."""
    groups = {}
    order = []
    for s in sources:
        key = (s["block"], s["countMin"], s["countMax"], s["prob"])
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(s)
    out = []
    for key in order:
        group = groups[key]
        if len(group) == 1:
            out.append(group[0])
        else:
            out.append(next((s for s in group if s["event"] == "Harvest"), group[0]))
    return out


def collapse_source_lookalikes(sources_map, names, icons, key="block"):
    """Second, broader dedup pass -- run after icons are resolved, unlike
    _collapse_tier_variants which runs during extraction. Some duplicate
    block/item pairs share no name-root at all (cementMixer vs the
    unrelated-looking ulmStationCementMixerPowered), so the tier-suffix
    regex above never groups them -- but they still render as the exact
    same "Cement Mixer" row with the same icon and the same yield, which
    reads as a bug ("why is this here twice?") even though it technically
    isn't one. Any group sharing (display name, icon, event, count, prob)
    collapses to one row; two icon-less entries only merge this way if
    their display names ALSO match, so it's still a tight match despite the
    weaker key. Shared between harvest and recycle sources -- same pattern,
    same fix. Mutates `sources_map` in place and returns it, purely for
    chaining."""
    for sources in sources_map.values():
        seen = {}
        order = []
        for s in sources:
            dedup_key = (names.get(s[key], s[key]), icons.get(s[key]), s.get("event"), s["countMin"], s["countMax"], s["prob"])
            if dedup_key not in seen:
                seen[dedup_key] = s
                order.append(dedup_key)
        sources[:] = [seen[k] for k in order]
    return sources_map


def load_harvest_sources():
    """Returns (harvestable, harvest_sources):
      - harvestable: the set of internal item names ever produced by a
        block's <drop event="Harvest"/"Destroy"/"Fall"> entry, across all
        block files -- unchanged presence-only behavior (see the exclusion
        rule below), still what the acquisition map's "harvestable" flag is
        built from.
      - harvest_sources: {item_name: [{block, event, countMin, countMax,
        prob, tier}, ...]} -- the actual per-block detail behind that flag,
        surfaced on demand when the user clicks an item's Harvest badge
        rather than computed at click time. Unlike the loot/trader channels,
        every <drop> is directly authored on its own block with a real,
        non-nested count/prob -- no weighted-group resolution needed -- so
        this is a straightforward one-pass extraction, keyed off the same
        BLOCK_TAG_RE used for CustomIcon/variant-helper scanning to know
        which block a given <drop> belongs to. Same-family tier/quality
        variants that drop identically are collapsed to one row (see
        _collapse_tier_variants). Rows are pre-sorted by expected yield,
        descending (see _expected_yield), and bucketed into a "tier" of
        "high"/"medium"/"low" *relative to the best source for that same
        item* (a flat percentage cutoff would be meaningless across items
        whose drops range from single digits to the thousands), so the app
        can render three sections without computing anything itself, just
        grouping by this field.
        count="0" is excluded: it means "explicitly does not drop here",
        not a real source; a name
        that's ALSO positively dropped by some other block still ends up in
        the set via that other <drop>, so this only ever removes rows that
        are exclusively zero everywhere.
    """
    harvestable = set()
    harvest_sources = {}
    for path in BLOCK_FILES:
        if not path.exists():
            warn(f"missing expected file: {path}")
            continue
        text = read_text(path)
        for tag, name_a, name_b, body in BLOCK_TAG_RE.findall(text):
            block_name = name_a or name_b
            if not block_name:
                continue
            for frag in scan_blocks(body, "drop"):
                el = parse_fragment(frag, path.name)
                if el is None:
                    continue
                name = el.attrib.get("name")
                count_attr = el.attrib.get("count", "1")
                if not name or count_attr == "0":
                    continue
                harvestable.add(name)
                count_min, count_max = _parse_count_range(count_attr)
                harvest_sources.setdefault(name, []).append({
                    "block": block_name,
                    "event": el.attrib.get("event", "Harvest"),
                    "countMin": count_min,
                    "countMax": count_max,
                    "prob": float(el.attrib.get("prob", "1")),
                })
    for name, sources in harvest_sources.items():
        collapsed = _collapse_same_block_events(sources)
        harvest_sources[name] = _collapse_tier_variants(collapsed)
    _sort_and_tier_sources(harvest_sources, "block")
    return harvestable, harvest_sources


def _sort_and_tier_sources(sources_map, key):
    """Sorts each item's source list by expected yield (descending, higher
    prob as tiebreak) and buckets each row into a "tier" of high/medium/low
    *relative to the best source for that same item* (a flat percentage
    cutoff would be meaningless across items whose yields range from single
    digits to the thousands), so the app can render three sections without
    computing anything itself, just grouping by this field.
    Shared by harvest and recycle sources; mutates in place."""
    for sources in sources_map.values():
        sources.sort(key=lambda s: (-_expected_yield(s), -s["prob"], s[key]))
        best = _expected_yield(sources[0]) if sources else 0
        for s in sources:
            ratio = (_expected_yield(s) / best) if best > 0 else 0
            s["tier"] = "high" if ratio >= 0.5 else "medium" if ratio >= 0.15 else "low"
    return sources_map


def load_recycle_data():
    """Returns (recycle_yields, recycle_sources):
      - recycle_yields: {item_name: [{name, countMin, countMax, prob}, ...]}
        -- what THIS item breaks down into at a Recycler, straight off the
        <recycle time="T" name="a,b,c"><output name="X" count="m,n"
        prob="p"/>...</recycle> schema in recipes_recycler.xml. One
        <recycle> entry lists several input items sharing an identical
        output profile (e.g. every tire size recycles the same way), so
        this expands that comma-separated list to one entry per input name.
        Shown directly on an item's own page: there's exactly one such
        list per item, no "best source" question,
        so unlike recycle_sources these rows are left in source order.
      - recycle_sources: {output_item: [{item: input_name, countMin,
        countMax, prob, tier}, ...]} -- the reverse index (what can I
        recycle to GET this), built and shaped exactly like harvest_sources:
        same tier-variant collapsing, same expected-yield sort, same
        high/medium/low bucketing -- so it renders through the identical
        modal component. No same-block-event collapse here (recycle has no
        Harvest/Destroy/Fall concept, just one profile per item).
    """
    recycle_yields = {}
    recycle_sources = {}
    if not RECYCLE_FILE.exists():
        warn(f"missing expected file: {RECYCLE_FILE}")
        return recycle_yields, recycle_sources
    text = read_text(RECYCLE_FILE)
    for frag in scan_blocks(text, "recycle"):
        el = parse_fragment(frag, RECYCLE_FILE.name)
        if el is None:
            continue
        input_names = [n.strip() for n in el.attrib.get("name", "").split(",") if n.strip()]
        outputs = []
        for out_el in el.findall("output"):
            out_name = out_el.attrib.get("name")
            if not out_name:
                continue
            count_attr = out_el.attrib.get("count")
            prob_attr = out_el.attrib.get("prob", "1")
            if count_attr is None and "," in prob_attr:
                # Source typo (a handful of entries, e.g. RC_RocketSledge):
                # prob is never a comma-range in this schema, so prob="1,2"
                # sitting alongside real sibling counts like count="60,90"
                # is unambiguously a count the author meant to write, not a
                # probability -- stored as such, flagged rather than crashed
                # on or silently misread as a real probability.
                warn(f"{RECYCLE_FILE.name}: <output name=\"{out_name}\"> has prob=\"{prob_attr}\" "
                     f"(a comma-range, never valid for a probability) -- treated as the count "
                     f"attribute the author meant, prob=1")
                count_attr, prob_attr = prob_attr, "1"
            count_min, count_max = _parse_count_range(count_attr or "1")
            outputs.append({
                "name": out_name,
                "countMin": count_min,
                "countMax": count_max,
                "prob": float(prob_attr),
            })
        if not input_names or not outputs:
            continue
        for input_name in input_names:
            recycle_yields.setdefault(input_name, []).extend(outputs)
            for o in outputs:
                recycle_sources.setdefault(o["name"], []).append({
                    "item": input_name,
                    "countMin": o["countMin"],
                    "countMax": o["countMax"],
                    "prob": o["prob"],
                })
    for name, sources in recycle_sources.items():
        recycle_sources[name] = _collapse_tier_variants(sources, key="item")
    _sort_and_tier_sources(recycle_sources, "item")
    return recycle_yields, recycle_sources


# ---------------------------------------------------------------------------
# Vehicles -- <item>/<set xpath="...item[@name='X']"> in items_vehicles.xml
# ---------------------------------------------------------------------------
# Vehicle stats live entirely outside the recipe/research/acquisition
# system, in their own file. Neither the five buildable vehicles (which DO
# have real recipes, e.g. ulmVehicleMinibikeOld) nor the dozen-plus "find it
# broken down in the world and repair it" cars (which have no recipe/
# research/acquisition entry of their own at all -- a wrecked Sedan is
# placed directly in POI prefabs, a channel this tool doesn't model) surface
# a Cargo Capacity, Repair Kit tier, or Weight through that system, so those
# stats are read from here instead.
_VEHICLE_STAT_FIELDS = ("cargoCapacity", "repairTool", "weight", "param1",
                        "maintenanceGroup", "modSlots", "degradationMax", "entityName")


def load_vehicle_speeds():
    """Returns {entity_name: topSpeed} -- the un-boosted "hold forward, no
    sprint" speed (the first of the four velocityMax_turbo values: forward,
    backward, turbo-forward, turbo-backward).

    The base game's own vehicles.xml is read first (every entity, mod-
    touched or not, is fully defined there), then the mod's is layered on
    top -- as either a full <vehicle> replacement/addition or an xpath
    <set> patch, both handled the same way here, plus one narrower
    attribute-only <set xpath=".../@value">newValue</set> shape (used for
    just the minibike/motorcycle) that isn't a real XML element and needs
    its own regex. Matches the mod-wins-over-base precedence used
    throughout this file. A vehicle the mod never touches at all (e.g. the
    plain Bicycle) correctly keeps its base-game value."""
    speeds = {}

    def scan(path):
        if not path.exists():
            warn(f"missing expected file: {path}")
            return
        text = read_text(path)
        for tag in ("vehicle", "set"):
            for frag in scan_blocks(text, tag):
                el = parse_fragment(frag, path.name)
                if el is None:
                    continue
                name = el.attrib.get("name")
                if not name:
                    m = re.search(r"@name='([^']+)'", el.attrib.get("xpath", ""))
                    if not m:
                        continue
                    name = m.group(1)
                for prop in el.iter("property"):
                    if prop.attrib.get("name") == "velocityMax_turbo":
                        speeds[name] = prop.attrib.get("value")

    scan(BASE_VEHICLES_FILE)
    scan(MOD_VEHICLES_FILE)

    if MOD_VEHICLES_FILE.exists():
        attr_set_re = re.compile(
            r"<set xpath=\"/vehicles/vehicle\[@name='([^']+)'\]/property\[@name='velocityMax_turbo'\]/@value\">"
            r"([^<]+)</set>"
        )
        for name, value in attr_set_re.findall(read_text(MOD_VEHICLES_FILE)):
            speeds[name] = value.strip()

    top_speed = {}
    for name, value in speeds.items():
        first = value.split(",")[0].strip()
        try:
            top_speed[name] = float(first)
        except ValueError:
            warn(f"vehicles.xml: '{name}' has an unparseable velocityMax_turbo value: {value!r}")
    return top_speed


def load_vehicles():
    """Returns (vehicles, color_variant_of):
      - vehicles: {name: {cargoCapacity, repairTool, weight, param1,
        maintenanceGroup, modSlots, degradationMax, topSpeed}} for every
        vehicle body style that has its own Tags/RepairTools/etc (a
        "representative"). `param1` is CarryWeight's second attribute,
        exposed under its raw XML name rather than a guessed label -- see
        the comment where it's read.
      - color_variant_of: {recolor_name: representative_name} for every
        paint-swap variant, so app.js can hide them from the browsable
        index and redirect straight to the representative instead -- see
        the comment where it's built, below.

    Paint-swap variants (e.g. 13 recolors of the same Sedan, all sharing one
    localization string) never define
    these stats themselves; they just <property name="Extends" value="..."/>
    the first-listed color and add a paint-only Meshfile/VehicleWheels
    tweak. Rather than show 13 indistinguishable rows, only names that
    declare their own Tags (the tell for "this is a real definition, not a
    recolor") are kept -- a recolor's stats are identical to its
    representative's by construction, so nothing is lost."""
    vehicles = {}
    if not VEHICLE_ITEMS_FILE.exists():
        warn(f"missing expected file: {VEHICLE_ITEMS_FILE}")
        return vehicles
    text = read_text(VEHICLE_ITEMS_FILE)

    entries = {}
    for tag in ("item", "set"):
        for frag in scan_blocks(text, tag):
            el = parse_fragment(frag, VEHICLE_ITEMS_FILE.name)
            if el is None:
                continue
            name = el.attrib.get("name")
            if not name:
                # <set xpath="/items/item[@name='vehicleMinibikePlaceable']">
                # -- the five base-game vehicles are patched this way, not
                # declared fresh, so their name lives in the xpath instead.
                m = re.search(r"@name='([^']+)'", el.attrib.get("xpath", ""))
                if not m:
                    continue
                name = m.group(1)
            d = entries.setdefault(name, {})
            for prop in el.iter("property"):
                pname = prop.attrib.get("name")
                if pname == "Tags":
                    d["tags"] = prop.attrib.get("value", "")
                elif pname == "RepairTools":
                    d["repairTool"] = prop.attrib.get("value")
                elif pname == "MaintenanceGroup":
                    d["maintenanceGroup"] = prop.attrib.get("value")
                elif pname == "Extends":
                    d["extends"] = prop.attrib.get("value")
                elif pname == "CarryWeight":
                    d["weight"] = prop.attrib.get("value")
                    # This is genuinely unconfirmed -- CarryWeight's param1
                    # is never used anywhere in the base game (only here, on
                    # vehicles), so there's no vanilla precedent for what it
                    # means. Ratio to `weight` is a clean 2-4x for the
                    # simple vehicles (bicycle/minibike/motorcycle) but 10-30x
                    # for cars/trucks/aircraft, which rules out both "tow
                    # capacity" and "inventory slot count" as explanations --
                    # a slot count of 6000 for a Military Truck isn't
                    # plausible under any grid size. Exposed as the raw
                    # attribute name rather than a confident but
                    # possibly-wrong label.
                    d["param1"] = prop.attrib.get("param1")
                elif pname == "Vehicle":
                    # <property class="Action1"><property name="Vehicle"
                    # value="X"/></property> -- the spawned entity name, used
                    # to join against load_vehicle_speeds() below. Usually
                    # identical to the item name, except for the five
                    # base-game-derived vehicles (e.g. item
                    # "vehicleMinibikePlaceable" spawns entity
                    # "vehicleMinibike").
                    d["entityName"] = prop.attrib.get("value")
            for eff in el.iter("passive_effect"):
                ename = eff.attrib.get("name")
                if ename == "VehicleCargoCapacity":
                    d["cargoCapacity"] = eff.attrib.get("value")
                elif ename == "ModSlots":
                    d["modSlots"] = eff.attrib.get("value")
                elif ename == "DegradationMax":
                    d["degradationMax"] = eff.attrib.get("value")

    def resolve(name, field, seen=None):
        seen = seen or set()
        if name in seen or name not in entries:
            return None
        seen.add(name)
        d = entries[name]
        if field in d:
            return d[field]
        ext = d.get("extends")
        return resolve(ext, field, seen) if ext else None

    speeds = load_vehicle_speeds()
    for name, d in entries.items():
        if "tags" not in d or "vehicle" not in d["tags"].split(","):
            continue  # a recolor (or an unrelated Extends target), not a representative
        v = {field: resolve(name, field) for field in _VEHICLE_STAT_FIELDS}
        entity_name = v.pop("entityName", None) or name
        v["topSpeed"] = speeds.get(entity_name)
        vehicles[name] = v

    # Every recolor is independently purchasable/lootable in its own right
    # (a trader can roll any paint job), so without this it would surface as
    # its own separate, data-less "item" page sharing the exact same display
    # name as its representative -- e.g. 14 different
    # ulmVehicleMotorcycle03<Color> names are all independently purchasable
    # and all display as "Renegade", and only one of them is the
    # ulmVehicleMotorcycle03White representative actually in `vehicles`
    # above. app.js uses this to hide recolors from the browsable index and
    # redirect any direct reference straight to the representative instead.
    def resolve_representative(name, seen=None):
        seen = seen or set()
        if name in seen or name not in entries:
            return None
        seen.add(name)
        if name in vehicles:
            return name
        ext = entries[name].get("extends")
        return resolve_representative(ext, seen) if ext else None

    color_variant_of = {}
    for name in entries:
        if name in vehicles:
            continue
        rep = resolve_representative(name)
        if rep:
            color_variant_of[name] = rep

    return vehicles, color_variant_of


def _index_vehicle_block_join_keys():
    """Returns {block_name: ("exact", item_name) | ("prefix", item_prefix)}
    -- every world vehicle block's own link to the item it spawns once
    repaired, straight off its <property class="DynamicVehicle"> (ItemName
    for a single fixed item, e.g. the Ambulance; ItemPrefix for one of
    several paint-variant items sharing that prefix, e.g. "ulmVehicleSedan03"
    + whichever color the world roll picked). This is the mod's own
    authoritative join key, so load_vehicle_repairs() below never has to
    guess a name mapping."""
    keys = {}
    if not VEHICLE_BLOCKS_FILE.exists():
        warn(f"missing expected file: {VEHICLE_BLOCKS_FILE}")
        return keys
    text = read_text(VEHICLE_BLOCKS_FILE)
    for frag in scan_blocks(text, "block"):
        el = parse_fragment(frag, VEHICLE_BLOCKS_FILE.name)
        if el is None:
            continue
        name = el.attrib.get("name")
        if not name:
            continue
        item_name = None
        item_prefix = None
        for prop in el.iter("property"):
            pname = prop.attrib.get("name")
            if pname == "ItemName":
                item_name = prop.attrib.get("value")
            elif pname == "ItemPrefix" and prop.attrib.get("value"):
                # Some blocks declare this twice, once as a blank placeholder
                # then the real value (e.g. ulmVehicleMotorcycle03Fallen) --
                # scanning every match and only keeping truthy ones means the
                # real value always wins regardless of which copy comes last.
                item_prefix = prop.attrib.get("value")
        if item_name:
            keys[name] = ("exact", item_name)
        elif item_prefix:
            keys[name] = ("prefix", item_prefix)
    return keys


def load_vehicle_repairs(vehicle_names):
    """Returns {vehicle_name: [{damage, learnable, tools, ingredients}, ...]}
    -- the material cost to repair a found, already-broken-down copy of that
    vehicle in the world, straight off <vehicle block="a,b,c" damage="N"
    learnable="..." tools="...">, in recipes_vehicles.xml. This is a
    schema completely separate from (and, for most "find it and repair it"
    cars, the ONLY path to obtaining) the recipes.xml crafting system.

    A repair entry's block= list names WORLD BLOCKS, not vehicle items, so
    each is resolved via _index_vehicle_block_join_keys(): an exact
    ItemName match, or an ItemPrefix matched by PREFIX against the known
    vehicle names -- not by re-deriving one specific color suffix, since a
    world spawn's own paint-color pool doesn't always happen to include
    whichever color this tool picked as the representative (e.g. the
    vanilla "Sedan 03 Classic" wreck never rolls white, even though the
    Sedan 03 body style obviously still repairs the same way regardless of
    paint). Tiers are sorted by damage ascending (least to most damaged).
    """
    repairs = {}
    if not RECIPE_VEHICLES_FILE.exists():
        warn(f"missing expected file: {RECIPE_VEHICLES_FILE}")
        return repairs
    block_keys = _index_vehicle_block_join_keys()
    text = read_text(RECIPE_VEHICLES_FILE)
    for frag in scan_blocks(text, "vehicle"):
        el = parse_fragment(frag, RECIPE_VEHICLES_FILE.name)
        if el is None:
            continue
        block_list = [b.strip() for b in el.attrib.get("block", "").split(",") if b.strip()]
        matched = set()
        for b in block_list:
            join = block_keys.get(b)
            if not join:
                continue
            kind, value = join
            if kind == "exact":
                if value in vehicle_names:
                    matched.add(value)
            else:
                matched.update(n for n in vehicle_names if n.startswith(value))
        if not matched:
            warn(f"{RECIPE_VEHICLES_FILE.name}: repair entry for block(s) "
                 f"'{el.attrib.get('block')}' didn't match any known vehicle")
            continue
        ingredients = [
            {"name": ing.attrib.get("name"), "count": ing.attrib.get("count", "1")}
            for ing in el.findall("ingredient") if ing.attrib.get("name")
        ]
        tier = {
            "damage": el.attrib.get("damage"),
            "learnable": el.attrib.get("learnable"),
            "tools": [t.strip() for t in el.attrib.get("tools", "").split(",") if t.strip()],
            "ingredients": ingredients,
        }
        for name in matched:
            repairs.setdefault(name, []).append(tier)
    for tiers in repairs.values():
        tiers.sort(key=lambda t: float(t["damage"]) if t["damage"] else 0)
    return repairs


# ---------------------------------------------------------------------------
# CustomIcon overrides -- lightweight regex scan of items/blocks files
# (a full xpath-patch simulation isn't needed just to resolve icon names)
#
# Must include "block" alongside "item"/"set"/"append": a full <block
# name="X"> definition (not just a patch) can carry its own CustomIcon too --
# e.g. ulmElectricWireRelayVariantHelper is a full <block> with
# CustomIcon="ulmElectricWireRelay". Omitting "block" here would silently
# drop ~369 CustomIcon overrides across the dataset.
#
# "item_modifier" (weapon/armor mods -- a completely different tag, not a
# kind of <item>) is included too: the backreference `</\1>` still closes
# correctly whichever alternative actually matched, so this one addition
# covers <item_modifier> everywhere ITEM_BLOCK_RE is used (CustomIcon AND
# Extends scanning both, since load_extends_graph() reuses this same regex).
# ---------------------------------------------------------------------------
ITEM_BLOCK_RE = re.compile(
    r"<(item_modifier|item|set|append|block)\s+"
    r"(?:name=\"([^\"]+)\"|xpath=\"[^\"]*\[@name='([^']+)'\][^\"]*\")"
    r"[^>]*>(.*?)</\1>",
    re.S,
)


def load_custom_icons():
    custom_icons = {}
    # Base game files scanned FIRST, mod files LAST -- a later dict write
    # wins on the same key, so a CustomIcon the mod itself declares always
    # overrides the base game's (the "mod has final say" precedence used
    # everywhere else). Base game files are included at all because the mod
    # frequently patches a vanilla item without touching its icon setup --
    # the real CustomIcon (e.g. quest-reward bundles sharing one "bundleBooks"
    # icon) then only exists in the base game's own items.xml/blocks.xml,
    # which nothing here read before.
    for path in [BASE_ITEM_FILE, BASE_BLOCK_FILE, BASE_ITEM_MODIFIERS_FILE, MOD_ITEM_MODIFIERS_FILE] + ITEM_FILES + BLOCK_FILES:
        if not path.exists():
            continue
        text = read_text(path)
        for tag, name_a, name_b, body in ITEM_BLOCK_RE.findall(text):
            name = name_a or name_b
            if not name:
                continue
            m = re.search(r'<property name="CustomIcon" value="([^"]*)"', body)
            if m:
                custom_icons[name] = m.group(1)
    return custom_icons


# ---------------------------------------------------------------------------
# Icon index -- every PNG under UIAtlases, keyed by filename stem
# ---------------------------------------------------------------------------
def index_icons():
    index = {}  # stem -> Path, first folder wins in FOLDER_PRIORITY order
    folder_priority = [
        "ItemIconAtlas", "UIAltAtlas", "UIActiveItems", "UIAtlas",
        "ItemIconAtlasGrey", "UIStack", "UIBackground", "UIScrollTab", "UISkills",
    ]
    for folder in folder_priority:
        base = ATLASES / folder
        if not base.exists():
            continue
        for p in base.rglob("*.png"):
            stem = p.stem
            if stem not in index:
                index[stem] = p
    return index


def resolve_icon(name, icon_index, custom_icons, used_icons):
    if not name:
        return None
    lookup = custom_icons.get(name, name)
    lookup = lookup.split(";")[0]  # strip "name;color;alpha" suffixes (skill-tree icons)
    p = icon_index.get(lookup)
    if p is None:
        return None
    rel = f"icons/{p.name}"
    used_icons[lookup] = p
    return rel


# ---------------------------------------------------------------------------
# Variant-helper icon fallback
#
# Some crafted items aren't a single visible block -- the recipe/research
# produces an abstract "<name>VariantHelper" token, and the player picks a
# visual skin from a matching set of real blocks at placement time (storage
# crates, doors, lighting fixtures, ...). The helper token itself was never
# assigned an icon in the source; the closest real icon belongs to whichever
# block(s) declare `CanPickup value="true" param1="<helper name>"`. This is
# a genuine source-data gap, not a build bug -- flagged in meta.warnings,
# never silently treated as if the helper had its own canonical icon.
# ---------------------------------------------------------------------------
BLOCK_TAG_RE = re.compile(
    r"<(block|set|append)\s+"
    r"(?:name=\"([^\"]+)\"|xpath=\"[^\"]*\[@name='([^']+)'\][^\"]*\")"
    r"[^>]*>(.*?)</\1>",
    re.S,
)


def load_variant_helper_candidates():
    helper_to_candidates = {}
    for path in BLOCK_FILES:
        if not path.exists():
            continue
        text = read_text(path)
        for tag, name_a, name_b, body in BLOCK_TAG_RE.findall(text):
            name = name_a or name_b
            if not name:
                continue
            cp = re.search(r'CanPickup" value="true" param1="([^"]+)"', body)
            if not cp:
                continue
            helper = cp.group(1)
            ci = re.search(r'CustomIcon" value="([^"]+)"', body)
            candidate = ci.group(1) if ci else name
            helper_to_candidates.setdefault(helper, []).append(candidate)
    return helper_to_candidates


# ---------------------------------------------------------------------------
# Extends graph + display-name fallback
#
# Two kinds of block never get their own Localization entry, but sit right
# next to one that does, in the block hierarchy itself (`Extends`):
#   - a specialized, unlocalized variant of something real and named -- e.g.
#     a player-placed crop-growth-stage block (plantedBlueberry3HarvestPlayer)
#     Extends the vanilla POI stage that IS named ("Blueberry Plant 3 (POI)");
#   - an abstract template that's never itself placed, only Extended FROM --
#     e.g. cntCar03SedanDamage2Master owns the real <drop> table, but only
#     its ~10 differently-skinned, individually-named v01..v08 variants are
#     ever actually spawned.
# Without this, raw internal names can show up anywhere a display name is
# expected (not just the harvest sources modal) -- any consumer of `names`
# benefits from this fallback. Genuine gaps with no resolvable Extends chain
# either way (e.g. ulmTrashBin01Black_C_Open) are left as-is: this fills
# real gaps from real nearby data, it doesn't invent names.
# ---------------------------------------------------------------------------
def load_extends_graph():
    """Returns (extends_map, children_map): every item/block's own `Extends`
    property target, and the reverse (parent -> children). Scans items too,
    not just blocks (ITEM_BLOCK_RE, not the block-only BLOCK_TAG_RE) --
    Undead Legacy often patches a vanilla ITEM's description/effects without
    touching its icon, so the icon-inheriting Extends link (e.g. a renamed
    perk book Extending the vanilla book whose icon it actually uses) lives
    on an <item>, not a <block>. Scans the base game's own items.xml/
    blocks.xml too, alongside the mod's -- that vanilla Extends link is
    exactly what's missing when the mod itself never re-declares it."""
    extends_map = {}
    children_map = {}
    for path in [BASE_ITEM_FILE, BASE_BLOCK_FILE, BASE_ITEM_MODIFIERS_FILE, MOD_ITEM_MODIFIERS_FILE] + ITEM_FILES + BLOCK_FILES:
        if not path.exists():
            continue
        text = read_text(path)
        for tag, name_a, name_b, body in ITEM_BLOCK_RE.findall(text):
            entry_name = name_a or name_b
            if not entry_name:
                continue
            m = re.search(r'<property name="Extends" value="([^"]*)"', body)
            if not m or not m.group(1):
                continue
            extends_map[entry_name] = m.group(1)
            children_map.setdefault(m.group(1), []).append(entry_name)
    return extends_map, children_map


def load_item_modifier_names():
    """Every <item_modifier name="X" ...> in both the mod's and the base
    game's item_modifiers.xml -- weapon/armor mods (attachments) like "Ball
    Cap Mod" or "Launcher Damage Boost". Some have no acquisition data at
    all in the sense load_acquisition_channels() tracks (no trader/loot/
    quest path we parse), so without this they wouldn't be in `all_names`
    (no icon attempted) or browsable in the app at all -- this is their own
    dedicated source of truth for "this exists", independent of how you get
    one."""
    names = set()
    for path in (MOD_ITEM_MODIFIERS_FILE, BASE_ITEM_MODIFIERS_FILE):
        if not path.exists():
            warn(f"missing expected file: {path}")
            continue
        text = read_text(path)
        for frag in scan_blocks(text, "item_modifier"):
            el = parse_fragment(frag, path.name)
            if el is None:
                continue
            name = el.attrib.get("name")
            if name:
                names.add(name)
    return names


def _shared_prefix_len(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


def resolve_name_fallback(block, names, extends_map, children_map):
    """Best-effort display name for a block with no localization of its
    own, walking the Extends graph toward whichever direction reaches a real
    name first: UP to a named ancestor, then DOWN to a named descendant.
    Down isn't just "whichever comes first" -- an abstract template can be
    Extended by both its real family of skins (cntCar03SedanDamage2v01..v08)
    AND completely unrelated blocks that merely reuse it as a base class for
    shared mechanics (armyTruckOpen, which extends the sedan wreck purely
    for its damage/wreck behavior, not because it reads as "a sedan"). Among
    every named descendant, this prefers whichever shares the longest name
    prefix with `block` itself -- true siblings in the same naming family
    share almost the whole name, an unrelated reuse shares none of it.
    Returns None if neither direction finds anything."""
    seen = {block}
    cur = block
    while cur in extends_map:
        cur = extends_map[cur]
        if cur in seen:
            break  # cyclical Extends chain -- not expected, but guard anyway
        seen.add(cur)
        if cur in names:
            return names[cur]
    found = []
    seen_down = {block}
    queue = list(children_map.get(block, []))
    while queue:
        child = queue.pop(0)
        if child in seen_down:
            continue
        seen_down.add(child)
        if child in names:
            found.append(child)
        queue.extend(children_map.get(child, []))
    if not found:
        return None
    best = max(found, key=lambda c: (_shared_prefix_len(block, c), -len(c)))
    return names[best]


def index_base_icons():
    """Indexes the base game's own flat, already-extracted icon folder
    (see BASE_ICONS_DIR comment) -- read live from the install, no local
    cache or copy step."""
    index = {}
    if not BASE_ICONS_DIR.exists():
        return index
    for p in BASE_ICONS_DIR.glob("*.png"):
        index[p.stem] = p
    return index


VARIANT_HELPER_SUFFIX = "VariantHelper"


def _variant_candidates(name, variant_helper_candidates):
    """CanPickup-derived skin candidates (authoritative -- a real placed
    block declares it produces this helper), plus, for any name following
    the "<X>VariantHelper" convention with no CanPickup-registered skin, a
    same-convention guess: strip the suffix and try that as an icon name
    directly. Found via "Tall Wire Relay" (ulmElectricWireRelayTallVariantHelper):
    the mod ships ulmElectricWireRelayTall.png in its own atlas and never
    wires it up via CustomIcon or a CanPickup skin block -- just an
    omission, evidenced by the sibling ulmElectricWireRelayVariantHelper
    following the exact same naming pattern deliberately. CanPickup
    candidates are tried first since they're a stronger signal."""
    candidates = list(variant_helper_candidates.get(name, []))
    if name.endswith(VARIANT_HELPER_SUFFIX):
        guess = name[: -len(VARIANT_HELPER_SUFFIX)]
        if guess and guess not in candidates:
            candidates.append(guess)
    return candidates


def resolve_icon_with_variant_fallback(name, icon_index, custom_icons, used_icons,
                                        variant_helper_candidates, base_icon_index,
                                        extends_map=None, _seen=None):
    """Returns (rel_path_or_None, source) where source is "variant" (a
    representative placeable skin, or a same-naming-convention guess --
    shown with a transparency note in the app), "base_game" (the item's own
    real icon, just sourced from the base game rather than the mod -- no
    caveat needed), or "extends" (borrowed from a named Extends ancestor --
    see tier 5), or None if resolved directly from the mod's own atlases /
    not resolved at all.

    Five tiers, in order: (1) this item's own mod icon; (2) a variant-helper
    skin's mod icon (CanPickup-registered, or a "<X>VariantHelper" naming
    guess -- see _variant_candidates); (3) this item's own base-game icon;
    (4) a variant-helper skin's base-game icon -- needed for helpers whose
    real skin is itself a vanilla item the mod never gave an icon override
    (e.g. the Bedroll: the "bedrollBlockVariantHelper" token's real skin is
    the "bedroll" block, which has no mod icon of its own either, only a
    base-game one); (5) nothing of its own anywhere, but it Extends a named
    ancestor whose icon it actually renders with in-game -- e.g. Undead
    Legacy patches a vanilla perk book's description/effects without ever
    touching its icon, so the book keeps using its Extends-inherited vanilla
    icon, which only load_extends_graph() (now scanning the base game's own
    items.xml/blocks.xml too) can find. Recurses up the chain, since an
    ancestor can itself need any of tiers 1-4 to resolve."""
    rel = resolve_icon(name, icon_index, custom_icons, used_icons)
    if rel is not None:
        return rel, None
    candidates = _variant_candidates(name, variant_helper_candidates)
    for candidate in candidates:
        rel = resolve_icon(candidate, icon_index, custom_icons, used_icons)
        if rel is not None:
            return rel, "variant"
    rel = resolve_icon(name, base_icon_index, custom_icons, used_icons)
    if rel is not None:
        return rel, "base_game"
    for candidate in candidates:
        rel = resolve_icon(candidate, base_icon_index, custom_icons, used_icons)
        if rel is not None:
            return rel, "variant_base_game"
    if extends_map:
        seen = _seen or {name}
        parent = extends_map.get(name)
        if parent and parent not in seen:
            rel, _source = resolve_icon_with_variant_fallback(
                parent, icon_index, custom_icons, used_icons,
                variant_helper_candidates, base_icon_index, extends_map, seen | {parent}
            )
            if rel is not None:
                return rel, "extends"
    return None, None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main(install_root):
    """Builds app/data.js (+ copies referenced icons) from a live 7 Days To
    Die install directory. Safe to call more than once in the same process
    (app/server.py does, once per "Build"/"Rebuild data" click) -- WARNINGS
    is cleared up front so a later build's warnings don't pile onto an
    earlier one's."""
    WARNINGS.clear()
    root = validate_install_root(install_root)
    configure_paths(root)

    print("Loading localization...")
    names = load_localization()

    print("Loading recipes...")
    recipes, recipes_by_name = load_recipes()
    variant_names = sum(1 for ids in recipes_by_name.values() if len(ids) > 1)
    print(f"  {len(recipes)} recipe entries ({len(recipes_by_name)} distinct item names, "
          f"{variant_names} with 2+ alternate recipes)")

    print("Loading workstation tier upgrades...")
    upgrades = load_upgrades()
    print(f"  {len(upgrades)} upgrades")

    print("Loading research tree...")
    research = load_research()
    print(f"  {len(research)} research nodes")

    print("Computing unlock pathways...")
    available_stations = compute_unlocks(recipes, research, upgrades)
    unlock_counts = {}
    for r in recipes.values():
        t = r["unlock"]["type"]
        unlock_counts[t] = unlock_counts.get(t, 0) + 1
    print(f"  unlock breakdown: {unlock_counts}")

    print("Loading acquisition channels (purchasable/lootable/rewardable)...")
    purchasable, lootable, rewardable = load_acquisition_channels()
    print(f"  {len(purchasable)} purchasable, {len(lootable)} lootable, "
          f"{len(rewardable)} rewardable distinct name(s)")

    print("Loading harvestable (block drop tables)...")
    harvestable, harvest_sources = load_harvest_sources()
    print(f"  {len(harvestable)} harvestable distinct name(s), "
          f"{sum(len(v) for v in harvest_sources.values())} source row(s)")

    print("Loading recycler data...")
    recycle_yields, recycle_sources = load_recycle_data()
    recyclable = set(recycle_sources.keys())
    print(f"  {len(recycle_yields)} recyclable item(s), {len(recyclable)} distinct recycle output(s), "
          f"{sum(len(v) for v in recycle_sources.values())} source row(s)")

    print("Resolving icons...")
    custom_icons = load_custom_icons()
    icon_index = index_icons()
    base_icon_index = index_base_icons()
    variant_helper_candidates = load_variant_helper_candidates()
    used_icons = {}

    icons = {}
    all_names = set(recipes_by_name.keys()) | set(research.keys()) | set(upgrades.keys())
    for r in recipes.values():
        for ing in r["ingredients"] + r["outputs"]:
            if ing["name"]:
                all_names.add(ing["name"])
    for up in upgrades.values():
        # data.upgrades is keyed by `block` (the FROM tier), already covered
        # by upgrades.keys() above -- but `next` (the TO tier) is never a key
        # itself unless something later upgrades FROM it too. A family's
        # topmost tier is only ever a `next`, never a `block`, so without
        # this it would never get its own icon resolved even when the
        # source atlas has one.
        if up["next"]:
            all_names.add(up["next"])
        for ing in up["ingredients"]:
            if ing["name"]:
                all_names.add(ing["name"])
        for t in up["tools"]:
            all_names.add(t)
    for node in research.values():
        for ing in node["ingredients"]:
            if ing["name"]:
                all_names.add(ing["name"])
        if node["icon"]:
            all_names.add(node["icon"].split(";")[0])
    for sources in harvest_sources.values():
        for s in sources:
            all_names.add(s["block"])
    for name, sources in recycle_yields.items():
        all_names.add(name)
        for o in sources:
            all_names.add(o["name"])
    # Anything ONLY ever reachable by buying/looting/quest-reward (never a
    # recipe ingredient/output, harvest source, or recycle name) needs to be
    # folded into all_names explicitly -- otherwise vehicles, perk books, and
    # loot bundles (all mostly purchasable/lootable/rewardable-only) would
    # never get an icon lookup attempted at all, even when a perfectly good
    # one exists in an atlas.
    all_names |= purchasable | lootable | rewardable

    print("Loading weapon/armor mods (item_modifiers.xml)...")
    item_mods = load_item_modifier_names()
    all_names |= item_mods
    print(f"  {len(item_mods)} distinct mod name(s)")

    print("Loading vehicles (items_vehicles.xml)...")
    vehicles, vehicle_color_variants = load_vehicles()
    all_names |= set(vehicles.keys())
    print(f"  {len(vehicles)} vehicle body style(s), "
          f"{len(vehicle_color_variants)} color-variant name(s) mapped to them")

    print("Loading vehicle world-repair costs (recipes_vehicles.xml)...")
    vehicle_repairs = load_vehicle_repairs(set(vehicles.keys()))
    for name, tiers in vehicle_repairs.items():
        vehicles[name]["repairRecipes"] = tiers
        for tier in tiers:
            for ing in tier["ingredients"]:
                all_names.add(ing["name"])
            if tier["learnable"]:
                all_names.add(tier["learnable"])
            all_names.update(tier["tools"])
    print(f"  {sum(len(t) for t in vehicle_repairs.values())} repair recipe(s) "
          f"across {len(vehicle_repairs)} vehicle(s)")

    print("Backfilling display names via Extends chain...")
    extends_map, children_map = load_extends_graph()
    name_fallback_used = []
    for nm in all_names:
        if nm not in names:
            resolved = resolve_name_fallback(nm, names, extends_map, children_map)
            if resolved:
                names[nm] = resolved
                name_fallback_used.append(nm)
    if name_fallback_used:
        print(f"  {len(name_fallback_used)} name(s) backfilled from a named Extends ancestor/descendant")
        warn(
            f"{len(name_fallback_used)} name(s) have no localization of their own -- shown using a "
            f"related block's name via the Extends chain (an ancestor's name, or a real placeable "
            f"variant's, for an abstract template that's never itself placed): "
            + ", ".join(name_fallback_used[:10])
            + (" ..." if len(name_fallback_used) > 10 else "")
        )

    fallback_used = []
    base_game_used = []
    extends_used = []
    for nm in all_names:
        rel, source = resolve_icon_with_variant_fallback(
            nm, icon_index, custom_icons, used_icons, variant_helper_candidates, base_icon_index, extends_map
        )
        if rel:
            icons[nm] = rel
            if source in ("variant", "variant_base_game"):
                fallback_used.append(nm)
            elif source == "base_game":
                base_game_used.append(nm)
            elif source == "extends":
                extends_used.append(nm)
    print(f"  {len(icons)} icons resolved of {len(all_names)} distinct names "
          f"({len(fallback_used)} via variant-skin fallback, {len(base_game_used)} via base-game icon, "
          f"{len(extends_used)} via Extends ancestor)")
    if fallback_used:
        warn(
            f"{len(fallback_used)} name(s) have no icon of their own -- they are "
            f"\"variant helper\" tokens (the recipe/research produces an abstract item "
            f"that the player skins as one of several real blocks at placement); shown "
            f"using one variant's icon as a representative: "
            + ", ".join(fallback_used[:10])
            + (" ..." if len(fallback_used) > 10 else "")
        )
    if base_game_used:
        print(
            f"  {len(base_game_used)} icon(s) resolved from the base game's own "
            f"Data/ItemIcons (vanilla items the mod never gives a CustomIcon override)"
        )
    if extends_used:
        print(
            f"  {len(extends_used)} icon(s) borrowed from a named Extends ancestor "
            f"(the mod patches the item without touching its inherited icon)"
        )

    print("Copying referenced icon files...")
    ICONS_OUT.mkdir(parents=True, exist_ok=True)
    # Unconditional, not "if not dest.exists()": a rebuild after a mod update
    # should refresh an icon whose filename is unchanged but content isn't.
    # Cheap enough at this file count either way.
    for stem, p in used_icons.items():
        shutil.copyfile(p, ICONS_OUT / p.name)
    print(f"  {len(used_icons)} icon files copied to {ICONS_OUT}")

    before = sum(len(v) for v in harvest_sources.values())
    collapse_source_lookalikes(harvest_sources, names, icons, key="block")
    after = sum(len(v) for v in harvest_sources.values())
    if before != after:
        print(f"  collapsed {before - after} look-alike harvest source row(s) "
              f"(same display name/icon/drop under a different internal block name)")

    before = sum(len(v) for v in recycle_sources.values())
    collapse_source_lookalikes(recycle_sources, names, icons, key="item")
    after = sum(len(v) for v in recycle_sources.values())
    if before != after:
        print(f"  collapsed {before - after} look-alike recycle source row(s) "
              f"(same display name/icon/yield under a different internal item name)")

    # craftable duplicates recipes_by_name membership rather than reading it
    # at the point of use -- so every "how can I get this" question has one
    # place to look (the acquisition map) instead of two.
    craftable = set(recipes_by_name.keys())

    # Sparse: only names with at least one true flag get an entry. Absence
    # from this dict means none of the five channels apply -- e.g. a
    # workstation block you build and place, never bought/looted/rewarded/
    # harvested/crafted as an item in its own right.
    acquisition = {}
    for nm in sorted(craftable | harvestable | purchasable | lootable | rewardable | recyclable):
        entry = {}
        if nm in craftable:
            entry["craftable"] = True
        if nm in harvestable:
            entry["harvestable"] = True
        if nm in purchasable:
            entry["purchasable"] = True
        if nm in lootable:
            entry["lootable"] = True
        if nm in rewardable:
            entry["rewardable"] = True
        if nm in recyclable:
            entry["recyclable"] = True
        acquisition[nm] = entry

    dataset = {
        "meta": {
            "builtAt": datetime.datetime.now().isoformat(timespec="seconds"),
            "sourceVersion": load_mod_version(),
            "counts": {
                "recipes": len(recipes),
                "recipeItemNames": len(recipes_by_name),
                "upgrades": len(upgrades),
                "research": len(research),
                "icons": len(icons),
                "craftable": len(craftable),
                "harvestable": len(harvestable),
                "harvestSourceRows": sum(len(v) for v in harvest_sources.values()),
                "nameFallbackUsed": len(name_fallback_used),
                "iconExtendsFallbackUsed": len(extends_used),
                "purchasable": len(purchasable),
                "lootable": len(lootable),
                "rewardable": len(rewardable),
                "recyclable": len(recyclable),
                "recycleYieldItems": len(recycle_yields),
                "recycleSourceRows": sum(len(v) for v in recycle_sources.values()),
                "itemMods": len(item_mods),
                "vehicles": len(vehicles),
                "vehicleRepairRecipes": sum(len(t) for t in vehicle_repairs.values()),
                "vehicleColorVariants": len(vehicle_color_variants),
            },
            "unlockBreakdown": unlock_counts,
            "warnings": WARNINGS,
        },
        "names": names,
        "icons": icons,
        "acquisition": acquisition,
        "harvestSources": harvest_sources,
        "recycleYields": recycle_yields,
        "recycleSources": recycle_sources,
        "itemMods": sorted(item_mods),
        "vehicles": vehicles,
        "vehicleColorVariants": vehicle_color_variants,
        "alwaysAvailableStations": sorted(ALWAYS_AVAILABLE_STATIONS),
        "iconFallbackNames": fallback_used,  # names whose icon is a representative variant, not their own
        "recipes": recipes,
        "recipesByName": recipes_by_name,
        "upgrades": upgrades,
        "research": research,
    }

    APP.mkdir(parents=True, exist_ok=True)
    out_path = APP / "data.js"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write("// Generated by build.py -- do not edit by hand.\n")
        f.write("window.ULMODBUDDY_DATA = ")
        json.dump(dataset, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print(f"Wrote {out_path} ({out_path.stat().st_size:,} bytes)")

    if WARNINGS:
        print(f"\n{len(WARNINGS)} warning(s) -- see meta.warnings in data.js, or below:")
        for w in WARNINGS[:30]:
            print(f"  - {w}")
        if len(WARNINGS) > 30:
            print(f"  ... and {len(WARNINGS) - 30} more")


if __name__ == "__main__":
    # Secondary, CLI-only convenience path -- the app's own build-setup UI
    # (app/server.py -> POST /api/build) is the primary flow and calls
    # main(install_root) directly, never touching argv/stdin/config.local.json
    # itself. This just lets `python build.py [path]` still work standalone.
    if len(sys.argv) > 1:
        root_arg = sys.argv[1]
    else:
        root_arg = _read_local_config().get("installRoot")
        if not root_arg:
            root_arg = input(
                "Path to your 7 Days To Die install (the folder containing "
                "Mods\\UndeadLegacy and Data): "
            ).strip()
    try:
        main(root_arg)
    except InstallRootError as e:
        print(f"\n{e}")
        raise SystemExit(1)
    _write_local_config({"installRoot": str(Path(root_arg).resolve())})
