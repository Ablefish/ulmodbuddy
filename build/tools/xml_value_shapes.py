"""Dev tool -- NOT part of the shipped build. Scans the mod's own XML (base
game + Undead Legacy) for every <TAG>'s attributes and <property name=X
value=Y> children, buckets each value into a coarse "shape" (bare int, bare
float, comma pair, comma list, dash range, semicolon list, identifier,
freeform...), and reports any key where more than one shape shows up.

Why: build.py's own parsers routinely assume one fixed shape for a given
attribute/property (e.g. "count is always a bare int, or a comma min,max
pair" / "Create_item_count is always a bare int"). Two real bugs were found
this way already: Create_item_count uses a DASH range ("1-4") the original
parser silently truncated, and ScrapMaterial/Weight patches applied via
<set>/<append> were invisible to a scan that only looked at literal <item>
blocks. This tool exists to catch the next one BEFORE it ships wrong data,
by surfacing every value shape actually present in the source -- not just
the shape whichever example was eyeballed when the parser was written.

Usage:
    python build/tools/xml_value_shapes.py <install_root> [preset ...]

    Presets (default: all): items, recipes, research, recycler, harvest,
    materials, vehicles, upgrades, loot, traders, quests, modifiers

    python build/tools/xml_value_shapes.py "C:\\7D2D\\Custom\\UndeadLegacy2.7.32" items recipes

Output is grouped by preset, then by key, mixed-shape keys first (sorted so
the keys with the rarest, easiest-to-miss minority shape sort near the top
of each preset's list) -- a "MIXED" key is real cross-checking work; a
single-shape key is only listed for completeness at the end of that preset.
"""
import re
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import build as B  # noqa: E402  (reuse configure_paths/read_text/scan_blocks/parse_fragment)


# ---------------------------------------------------------------------------
# Shape classification
# ---------------------------------------------------------------------------
_INT_RE = re.compile(r"-?\d+")
_FLOAT_RE = re.compile(r"-?\d+\.\d+")
_DASH_RANGE_RE = re.compile(r"\d+(?:\.\d+)?-\d+(?:\.\d+)?")
_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_:]*")


def _numeric_token_shape(tok):
    if _INT_RE.fullmatch(tok):
        return "int"
    if _FLOAT_RE.fullmatch(tok):
        return "float"
    if _DASH_RANGE_RE.fullmatch(tok):
        return "dash_range"
    return None


def classify(value):
    v = value.strip()
    if v == "":
        return "empty"
    if v.lower() in ("true", "false"):
        return "bool"
    single = _numeric_token_shape(v)
    if single:
        return single
    if "," in v:
        parts = [p.strip() for p in v.split(",")]
        token_shapes = [_numeric_token_shape(p) for p in parts]
        if all(token_shapes):
            uniform = len(set(token_shapes)) == 1
            base = token_shapes[0] if uniform else "mixed_numeric"
            if len(parts) == 2 and uniform and base in ("int", "float"):
                return f"comma_pair_{base}"
            if uniform and base == "dash_range":
                return f"comma_list_of_dash_ranges({len(parts)})"
            return f"comma_list_{base}({len(parts)})"
        return f"comma_list_text({len(parts)})"
    if ";" in v:
        return f"semicolon_list({len(v.split(';'))})"
    if _IDENT_RE.fullmatch(v):
        return "identifier"
    return "freeform"


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------
class KeyStats:
    def __init__(self):
        self.shape_counts = defaultdict(int)
        self.examples = defaultdict(list)  # shape -> [(file, owner_name, raw_value), ...]

    def add(self, shape, file_name, owner, raw_value):
        self.shape_counts[shape] += 1
        if len(self.examples[shape]) < 4:
            self.examples[shape].append((file_name, owner, raw_value))


def collect(tags, files, attr_keys_to_skip=("name", "xpath")):
    """files: iterable of Path. tags: element tag names to scan for (each
    scanned across every file -- callers pass the right file set for what
    they're profiling). Returns {key: KeyStats}, key is "@attr" for an
    element's own attribute or the bare property name for a nested
    <property name=X value=Y>."""
    stats = defaultdict(KeyStats)
    parse_failures = 0
    for path in files:
        if not path or not path.exists():
            continue
        text = B.read_text(path)
        for tag in tags:
            for frag in B.scan_blocks(text, tag):
                el = B.parse_fragment(frag, path.name)
                if el is None:
                    parse_failures += 1
                    continue
                owner = el.attrib.get("name") or el.attrib.get("xpath") or "?"
                for aname, aval in el.attrib.items():
                    if aname in attr_keys_to_skip:
                        continue
                    stats[f"@{aname}"].add(classify(aval), path.name, owner, aval)
                for prop in el.iter("property"):
                    if prop is el:
                        continue
                    pname = prop.attrib.get("name")
                    pval = prop.attrib.get("value")
                    if pname is None or pval is None:
                        continue
                    stats[pname].add(classify(pval), path.name, owner, pval)
    return stats, parse_failures


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------
def report(title, stats, parse_failures, min_total=2):
    print(f"\n{'=' * 78}\n{title}\n{'=' * 78}")
    if parse_failures:
        print(f"  ({parse_failures} fragment(s) failed to parse -- see warnings above if run via build.py's own loader)")
    if not stats:
        print("  (no matching elements found)")
        return

    mixed = []
    single = []
    for key, ks in stats.items():
        total = sum(ks.shape_counts.values())
        if total < min_total:
            continue
        if len(ks.shape_counts) > 1:
            minority_count = min(ks.shape_counts.values())
            mixed.append((minority_count, key, ks, total))
        else:
            single.append((key, ks, total))

    mixed.sort(key=lambda t: t[0])  # rarest minority shape first -- easiest to miss
    single.sort(key=lambda t: t[0])

    if mixed:
        print(f"\n-- MIXED SHAPES ({len(mixed)} key(s)) --")
        for minority_count, key, ks, total in mixed:
            shapes = sorted(ks.shape_counts.items(), key=lambda kv: kv[1])
            shape_summary = ", ".join(f"{shape} x{count}" for shape, count in shapes)
            print(f"\n{key}  [{total} total]  {shape_summary}")
            for shape, count in shapes:
                examples = ks.examples[shape]
                ex_str = "; ".join(f"{owner}={raw!r} ({fname})" for fname, owner, raw in examples)
                print(f"    {shape} ({count}): {ex_str}")

    if single:
        print(f"\n-- single-shape keys ({len(single)}, listed for completeness) --")
        names = ", ".join(f"{key}[{next(iter(ks.shape_counts))}]" for key, ks, total in single)
        print(f"  {names}")


# ---------------------------------------------------------------------------
# Presets -- which tags/files to scan for each logical "table"
# ---------------------------------------------------------------------------
def preset_items():
    files = [B.BASE_ITEM_FILE, B.BASE_BLOCK_FILE] + B.ITEM_FILES + B.BLOCK_FILES
    return collect(["item", "set", "append", "block"], files)


def preset_recipes():
    return collect(["recipe"], B.RECIPE_FILES)


def preset_research():
    return collect(["research"], [B.RESEARCH_FILE])


def preset_recycler():
    return collect(["recipe", "output", "ingredient"], [B.RECYCLE_FILE])


def preset_harvest():
    files = [B.BASE_BLOCK_FILE] + B.BLOCK_FILES
    return collect(["drop"], files, attr_keys_to_skip=())


def preset_materials():
    return collect(["material"], [B.BASE_MATERIALS_FILE, B.MATERIALS_FILE], attr_keys_to_skip=())


def preset_vehicles():
    files = [B.BASE_VEHICLES_FILE, B.MOD_VEHICLES_FILE, B.VEHICLE_ITEMS_FILE, B.VEHICLE_BLOCKS_FILE, B.RECIPE_VEHICLES_FILE]
    return collect(["vehicle", "item", "set", "append", "block", "recipe"], files)


def preset_upgrades():
    return collect(["upgrade", "block"], [B.UPGRADE_FILE], attr_keys_to_skip=())


def preset_loot():
    return collect(["lootgroup", "item", "group"], B.LOOT_GROUP_FILES + [B.LOOT_CONTAINERS_FILE], attr_keys_to_skip=())


def preset_traders():
    return collect(["item", "set", "append"], [B.TRADERS_FILE])


def preset_quests():
    return collect(["quest", "objective", "reward"], [B.QUESTS_FILE], attr_keys_to_skip=())


def preset_modifiers():
    return collect(
        ["item_modifier", "set", "append"], [B.BASE_ITEM_MODIFIERS_FILE, B.MOD_ITEM_MODIFIERS_FILE]
    )


PRESETS = {
    "items": ("Items/Blocks (<item>/<set>/<append>/<block> attrs + properties)", preset_items),
    "recipes": ("Recipes (<recipe> attrs + properties)", preset_recipes),
    "research": ("Research (<research> attrs + properties)", preset_research),
    "recycler": ("Recycler (<recipe>/<output>/<ingredient> attrs)", preset_recycler),
    "harvest": ("Harvest (<drop> attrs on blocks)", preset_harvest),
    "materials": ("Materials (<material> attrs + properties)", preset_materials),
    "vehicles": ("Vehicles (items/blocks/recipes across vehicle files)", preset_vehicles),
    "upgrades": ("Workstation upgrades (<upgrade>/<block> attrs)", preset_upgrades),
    "loot": ("Loot groups (<lootgroup>/<item>/<group> attrs)", preset_loot),
    "traders": ("Traders (<item>/<set>/<append> attrs in traders.xml)", preset_traders),
    "quests": ("Quests (<quest>/<objective>/<reward> attrs)", preset_quests),
    "modifiers": ("Weapon/armor mods (<item_modifier> attrs + properties)", preset_modifiers),
}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    install_root = sys.argv[1]
    requested = sys.argv[2:] or list(PRESETS.keys())
    B.configure_paths(install_root)
    for key in requested:
        if key not in PRESETS:
            print(f"Unknown preset {key!r} -- choices: {', '.join(PRESETS)}")
            continue
        title, fn = PRESETS[key]
        stats, failures = fn()
        report(title, stats, failures)


if __name__ == "__main__":
    main()
