// UL Mod Buddy -- in-browser build pipeline.
//
// A faithful port of build/build.py: parses the mod's source Config/ XML,
// read live from a local 7 Days To Die install the user grants access to via
// the File System Access API (window.showDirectoryPicker()), into the same
// dataset shape build.py writes to data.js. No server, no Python -- this is
// what lets the app run as a static page (e.g. GitHub Pages) with zero
// installs. See setup.js for the UI that drives this.
//
// Two deliberate differences from build.py:
//   - XML is parsed whole-file with the browser's native DOMParser rather
//     than build.py's fragment-by-fragment regex scanner. These files are
//     already successfully parsed by the game's own engine every time the
//     mod runs, so a malformed fragment isn't the realistic risk it would be
//     for arbitrary XML -- and DOMParser also means most of build.py's
//     regex-based tag/name/body extraction (ITEM_BLOCK_RE, BLOCK_TAG_RE)
//     collapses into plain DOM traversal here.
//   - Icons are never copied anywhere -- `data.icons[name]` is an
//     `URL.createObjectURL(...)` string pointing straight at the file inside
//     the user's own folder, since there's no document root to copy into.
//     app.js only ever does `<img src="${icon}">`, so this is invisible to it.
//
// Data-fidelity principle (unchanged from build.py): stored fields mirror
// the source XML attributes exactly. Nothing is rewritten or invented.
// Anything that looks wrong in the source is reported in meta.warnings,
// never silently corrected here.
window.ULModBuddyBuilder = (function () {
  "use strict";

  class InstallRootError extends Error {}

  // Environmental workstations that need no unlock (found in the world, not built).
  const ALWAYS_AVAILABLE_STATIONS = ["campfire", "stove", "cementMixer"];

  // Known source-data typos: reported, never silently rewritten in storage.
  const KNOWN_TAG_TYPOS = { salvsageScrap: "salvageScrap" };

  let WARNINGS = [];
  function warn(msg) {
    WARNINGS.push(msg);
  }

  // -------------------------------------------------------------------
  // Filesystem helpers (File System Access API)
  // -------------------------------------------------------------------
  async function tryGetDir(parent, name) {
    if (!parent) return null;
    try {
      return await parent.getDirectoryHandle(name);
    } catch (e) {
      return null;
    }
  }

  async function tryGetFile(parent, name) {
    if (!parent) return null;
    try {
      return await parent.getFileHandle(name);
    } catch (e) {
      return null;
    }
  }

  // A "ref" pairs a human-readable, install-relative label (there's no real
  // absolute path available from a directory handle, nor is one needed) with
  // a possibly-null FileSystemFileHandle, so every load_* function can warn
  // with a meaningful name exactly like build.py's `missing expected file:
  // {path}` messages.
  function ref(label, handle) {
    return { label, handle };
  }

  async function readText(fileRef) {
    if (!fileRef || !fileRef.handle) return null;
    const file = await fileRef.handle.getFile();
    return await file.text();
  }

  // Lists files directly inside dirHandle whose name matches `regex` --
  // the glob-equivalent for Config/Custom/items_*.xml and blocks_*.xml,
  // sorted by name to match Python's sorted(glob(...)).
  async function listMatchingFiles(dirHandle, regex, labelPrefix) {
    if (!dirHandle) return [];
    const out = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "file" && regex.test(name)) {
        out.push(ref(labelPrefix + name, handle));
      }
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  // Recursively walks every .png under dirHandle, first-wins per stem --
  // used for index_icons()'s per-atlas-folder rglob("*.png").
  async function walkPngRecursive(dirHandle, index) {
    if (!dirHandle) return;
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind === "directory") {
        await walkPngRecursive(handle, index);
      } else if (/\.png$/i.test(name)) {
        const stem = name.slice(0, -4);
        if (!index.has(stem)) index.set(stem, handle);
      }
    }
  }

  // -------------------------------------------------------------------
  // Paths
  // -------------------------------------------------------------------
  // Like tryGetDir, but on failure remembers *why* -- used only for the
  // handful of hops the top-level install-root check depends on. Permission
  // and traversal issues can both surface as a DOMException (NotFoundError
  // as well as NotAllowedError), so the actual name/message is kept
  // available to explain a "missing" folder instead of a bare
  // "expected to find" list.
  async function getDirDiag(parent, name, pathSoFar, diagnostics) {
    if (!parent) {
      diagnostics.push(`${pathSoFar}\\${name}: parent folder wasn't found (see above)`);
      return null;
    }
    try {
      return await parent.getDirectoryHandle(name);
    } catch (e) {
      diagnostics.push(`${pathSoFar}\\${name}: ${e && e.name ? e.name : "Error"} -- ${e && e.message ? e.message : e}`);
      return null;
    }
  }

  async function validateAndResolvePaths(rootHandle) {
    const diagnostics = [];
    const modConfig = await (async () => {
      const mods = await getDirDiag(rootHandle, "Mods", "(install root)", diagnostics);
      const ul = await getDirDiag(mods, "UndeadLegacy", "Mods", diagnostics);
      return { modRoot: ul, config: await getDirDiag(ul, "Config", "Mods\\UndeadLegacy", diagnostics) };
    })();
    const dataDirTop = await getDirDiag(rootHandle, "Data", "(install root)", diagnostics);
    const dataConfig = await getDirDiag(dataDirTop, "Config", "Data", diagnostics);

    const missing = [];
    if (!modConfig.config) missing.push("Mods\\UndeadLegacy\\Config");
    if (!dataConfig) missing.push("Data\\Config");
    if (missing.length) {
      throw new InstallRootError(
        "Not a valid 7 Days To Die install with Undead Legacy -- expected to find:\n" +
          missing.join("\n") +
          "\n\nDetails:\n" +
          diagnostics.join("\n")
      );
    }

    const modRoot = modConfig.modRoot;
    const config = modConfig.config;
    const atlases = await tryGetDir(modRoot, "UIAtlases");
    const custom = await tryGetDir(config, "Custom");
    const localizationDir = await tryGetDir(config, "Localization");
    const dataDir = await tryGetDir(rootHandle, "Data");

    const itemFiles = [ref("Mods/UndeadLegacy/Config/items.xml", await tryGetFile(config, "items.xml"))];
    itemFiles.push(...(await listMatchingFiles(custom, /^items_.*\.xml$/i, "Mods/UndeadLegacy/Config/Custom/")));
    const blockFiles = [ref("Mods/UndeadLegacy/Config/blocks.xml", await tryGetFile(config, "blocks.xml"))];
    blockFiles.push(...(await listMatchingFiles(custom, /^blocks_.*\.xml$/i, "Mods/UndeadLegacy/Config/Custom/")));

    return {
      rootHandle,
      modRoot,
      config,
      atlases,
      recipeFiles: [
        ref("Mods/UndeadLegacy/Config/recipes.xml", await tryGetFile(config, "recipes.xml")),
        ref("Mods/UndeadLegacy/Config/Custom/recipes_armor.xml", await tryGetFile(custom, "recipes_armor.xml")),
      ],
      upgradeFile: ref("Mods/UndeadLegacy/Config/Custom/recipes_upgrades.xml", await tryGetFile(custom, "recipes_upgrades.xml")),
      researchFile: ref("Mods/UndeadLegacy/Config/Custom/recipes_research.xml", await tryGetFile(custom, "recipes_research.xml")),
      localizationFile: ref("Mods/UndeadLegacy/Config/Localization/English.txt", await tryGetFile(localizationDir, "English.txt")),
      baseLocalizationFile: ref("Data/Config/Localization.txt", await tryGetFile(dataConfig, "Localization.txt")),
      baseIconsDir: await tryGetDir(dataDir, "ItemIcons"),
      baseItemFile: ref("Data/Config/items.xml", await tryGetFile(dataConfig, "items.xml")),
      baseBlockFile: ref("Data/Config/blocks.xml", await tryGetFile(dataConfig, "blocks.xml")),
      itemFiles,
      blockFiles,
      modItemModifiersFile: ref("Mods/UndeadLegacy/Config/item_modifiers.xml", await tryGetFile(config, "item_modifiers.xml")),
      baseItemModifiersFile: ref("Data/Config/item_modifiers.xml", await tryGetFile(dataConfig, "item_modifiers.xml")),
      tradersFile: ref("Mods/UndeadLegacy/Config/traders.xml", await tryGetFile(config, "traders.xml")),
      questsFile: ref("Mods/UndeadLegacy/Config/quests.xml", await tryGetFile(config, "quests.xml")),
      lootContainersFile: ref("Mods/UndeadLegacy/Config/Custom/loot_containers.xml", await tryGetFile(custom, "loot_containers.xml")),
      lootGroupFiles: [
        ref("Mods/UndeadLegacy/Config/Custom/loot_groups.xml", await tryGetFile(custom, "loot_groups.xml")),
        ref("Mods/UndeadLegacy/Config/Custom/loot_quests_and_airdrops.xml", await tryGetFile(custom, "loot_quests_and_airdrops.xml")),
        ref("Mods/UndeadLegacy/Config/Custom/loot_twitch.xml", await tryGetFile(custom, "loot_twitch.xml")),
      ],
      recycleFile: ref("Mods/UndeadLegacy/Config/Custom/recipes_recycler.xml", await tryGetFile(custom, "recipes_recycler.xml")),
      vehicleItemsFile: ref("Mods/UndeadLegacy/Config/Custom/items_vehicles.xml", await tryGetFile(custom, "items_vehicles.xml")),
      modVehiclesFile: ref("Mods/UndeadLegacy/Config/vehicles.xml", await tryGetFile(config, "vehicles.xml")),
      baseVehiclesFile: ref("Data/Config/vehicles.xml", await tryGetFile(dataConfig, "vehicles.xml")),
      vehicleBlocksFile: ref("Mods/UndeadLegacy/Config/Custom/blocks_vehicles.xml", await tryGetFile(custom, "blocks_vehicles.xml")),
      recipeVehiclesFile: ref("Mods/UndeadLegacy/Config/Custom/recipes_vehicles.xml", await tryGetFile(custom, "recipes_vehicles.xml")),
    };
  }

  // ModInfo.xml's <Version> is maintained by hand and can lag behind the
  // mod's real released version. The real version is embedded in
  // UndeadLegacy.dll, but Chromium's File System Access API hard-blocks
  // getFileHandle() for a fixed list of "dangerous" extensions -- .dll
  // included -- with no client-side workaround, so that isn't readable
  // from the browser. ModInfo.xml is used as-is instead, labeled by its
  // source rather than presented as authoritative.
  async function loadModVersion(paths) {
    let modName = "UndeadLegacy";
    let xmlVersion = null;
    const modInfoHandle = await tryGetFile(paths.modRoot, "ModInfo.xml");
    if (modInfoHandle) {
      try {
        const text = await (await modInfoHandle.getFile()).text();
        const doc = new DOMParser().parseFromString(text, "application/xml");
        if (!doc.querySelector("parsererror")) {
          const versionEl = doc.querySelector("Version");
          const nameEl = doc.querySelector("Name");
          xmlVersion = versionEl && versionEl.getAttribute("value");
          modName = (nameEl && nameEl.getAttribute("value")) || modName;
        }
      } catch (e) {
        /* fall through */
      }
    }
    if (xmlVersion) {
      return `${modName} ${xmlVersion} (per ModInfo.xml)`;
    }
    return "your install"; // no directory handle exposes its own folder name reliably across browsers
  }

  // -------------------------------------------------------------------
  // XML parsing
  // -------------------------------------------------------------------
  function parseXml(text, label) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror")) {
      warn(`${label}: could not parse as XML, file skipped`);
      return null;
    }
    return doc;
  }

  async function readAndParse(fileRef) {
    if (!fileRef.handle) {
      warn(`missing expected file: ${fileRef.label}`);
      return null;
    }
    const text = await readText(fileRef);
    return parseXml(text, fileRef.label);
  }

  // Every tag name this schema uses, found anywhere in the document
  // regardless of nesting -- the DOMParser equivalent of build.py's
  // scan_blocks() regex scan.
  function scanBlocks(doc, tag) {
    return Array.from(doc.getElementsByTagName(tag));
  }

  // Direct children only (matches Python's `for child in el:` / `el.findall(tag)`).
  function directChildren(el, tag) {
    return Array.from(el.children).filter((c) => c.tagName === tag);
  }

  function attr(el, name, fallback) {
    const v = el.getAttribute(name);
    return v === null ? (fallback === undefined ? null : fallback) : v;
  }

  // -------------------------------------------------------------------
  // Localization: internal name -> display text
  // -------------------------------------------------------------------
  // A small RFC4180-ish CSV line splitter -- the browser has no CSV parser,
  // and Localization.txt entries can contain literal commas inside quoted
  // fields (descriptions, mostly).
  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        // skip -- \r\n is handled by the \n branch below
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += c;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function loadLocalizationCsv(text, label) {
    const names = {};
    if (!text) return names;
    // utf-8-sig equivalent: strip a leading BOM if present.
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = parseCsv(text);
    if (!rows.length || !rows[0].length) {
      warn(`${label}: empty or missing header row`);
      return names;
    }
    const header = rows[0];
    let englishIdx = header.findIndex((col) => col.trim().toLowerCase() === "english");
    if (englishIdx === -1) englishIdx = 1;
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.length || !row[0]) continue;
      const key = row[0].trim();
      const val = row.length > englishIdx ? (row[englishIdx] || "").trim() : "";
      if (key && !(key in names)) names[key] = val;
    }
    return names;
  }

  async function loadLocalization(paths, log) {
    const modText = await readText(paths.localizationFile);
    if (modText === null) warn(`missing expected file: ${paths.localizationFile.label}`);
    const names = loadLocalizationCsv(modText || "", paths.localizationFile.label);
    const baseText = await readText(paths.baseLocalizationFile);
    if (baseText !== null) {
      const baseNames = loadLocalizationCsv(baseText, paths.baseLocalizationFile.label);
      let added = 0;
      for (const k in baseNames) {
        if (!(k in names)) {
          names[k] = baseNames[k];
          added++;
        }
      }
      log(`  +${added} display names from base-game localization`);
    } else {
      warn(
        `base-game localization file not found at ${paths.baseLocalizationFile.label} -- ` +
          `vanilla item names will show as internal names until this is fixed ` +
          `(double-check the install root points at a real game install)`
      );
    }
    return names;
  }

  // -------------------------------------------------------------------
  // Recipes (crafting) -- <recipe> in recipes.xml / Custom/recipes_armor.xml
  // -------------------------------------------------------------------
  async function loadRecipes(paths) {
    const recipes = {};
    const recipesByName = {};
    const seenCounts = {};
    for (const fileRef of paths.recipeFiles) {
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const el of scanBlocks(doc, "recipe")) {
        const name = attr(el, "name");
        if (!name) {
          warn(`${fileRef.label}: <recipe> with no name attribute, skipped`);
          continue;
        }
        const tagsRaw = attr(el, "tags", "");
        const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
        for (const t of tags) {
          if (t in KNOWN_TAG_TYPOS) {
            warn(`recipe '${name}': tag '${t}' looks like a typo for '${KNOWN_TAG_TYPOS[t]}' (stored as-is)`);
          }
        }
        const ingredients = directChildren(el, "ingredient").map((c) => ({
          name: attr(c, "name"),
          count: attr(c, "count", "1"),
        }));
        const outputs = directChildren(el, "output").map((c) => ({
          name: attr(c, "name"),
          count: attr(c, "count", "1"),
        }));

        seenCounts[name] = (seenCounts[name] || 0) + 1;
        const n = seenCounts[name];
        const recipeId = n === 1 ? name : `${name}#${n}`;

        recipes[recipeId] = {
          id: recipeId,
          name,
          source: fileRef.label.split("/").pop(),
          time: attr(el, "time"),
          area: attr(el, "area"), // null => Backpack (no station)
          tool: attr(el, "tool"),
          tags,
          always_unlocked: attr(el, "always_unlocked") === "true",
          count: attr(el, "count", "1"),
          ingredients,
          outputs,
        };
        (recipesByName[name] = recipesByName[name] || []).push(recipeId);
      }
    }

    const variantCounts = Object.entries(recipesByName).filter(([, ids]) => ids.length > 1);
    if (variantCounts.length) {
      const totalVariants = variantCounts.reduce((sum, [, ids]) => sum + ids.length, 0);
      warn(
        `${variantCounts.length} item name(s) have multiple alternate recipes ` +
          `(${totalVariants} recipe entries total) -- all kept, see recipesByName`
      );
    }
    return { recipes, recipesByName };
  }

  // -------------------------------------------------------------------
  // Workstation tier upgrades -- <upgrade block next tools> in recipes_upgrades.xml
  // -------------------------------------------------------------------
  async function loadUpgrades(paths) {
    const upgrades = {};
    const doc = await readAndParse(paths.upgradeFile);
    if (!doc) return upgrades;
    for (const el of scanBlocks(doc, "upgrade")) {
      const block = attr(el, "block");
      if (!block) {
        warn(`${paths.upgradeFile.label}: <upgrade> with no block attribute, skipped`);
        continue;
      }
      const toolsRaw = attr(el, "tools", "");
      const tools = toolsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      const ingredients = directChildren(el, "ingredient").map((c) => ({
        name: attr(c, "name"),
        count: attr(c, "count", "1"),
      }));
      upgrades[block] = { block, next: attr(el, "next"), tools, ingredients };
    }
    return upgrades;
  }

  // -------------------------------------------------------------------
  // Research tree -- <research> in recipes_research.xml
  // -------------------------------------------------------------------
  async function loadResearch(paths) {
    const research = {};
    const doc = await readAndParse(paths.researchFile);
    if (!doc) return research;
    for (const el of scanBlocks(doc, "research")) {
      const name = attr(el, "name");
      if (!name) {
        warn(`${paths.researchFile.label}: <research> with no name attribute, skipped`);
        continue;
      }
      const ingredients = directChildren(el, "ingredient").map((c) => ({
        name: attr(c, "name"),
        count: attr(c, "count", "1"),
      }));
      const unlocks = directChildren(el, "unlocks").map((c) => ({
        name: attr(c, "name"),
        craftable: attr(c, "craftable"),
        display_only: attr(c, "display_only"),
      }));
      if (name in research) {
        warn(`duplicate research node name '${name}', later one kept`);
      }
      research[name] = {
        name,
        area: attr(el, "area"),
        pos: attr(el, "pos"),
        parent: attr(el, "parent"),
        category: attr(el, "category"),
        icon: attr(el, "icon"),
        size: attr(el, "size"),
        link_type: attr(el, "link_type"),
        unlocked: attr(el, "unlocked") === "true",
        requires: attr(el, "requires"),
        ingredients,
        unlocks,
      };
    }
    return research;
  }

  // -------------------------------------------------------------------
  // Unlock pathway -- the resolved 3-rule model from the spec
  // -------------------------------------------------------------------
  function computeUnlocks(recipes, research, upgrades) {
    const researchNodeNames = new Set(Object.keys(research));
    const unlockChildren = new Set();
    for (const node of Object.values(research)) {
      for (const u of node.unlocks) {
        if (u.name) unlockChildren.add(u.name);
      }
    }
    const directlyNamed = new Set([...researchNodeNames, ...unlockChildren]);

    const availableStations = new Set([...directlyNamed, ...ALWAYS_AVAILABLE_STATIONS]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const up of Object.values(upgrades)) {
        if (availableStations.has(up.block) && up.next && !availableStations.has(up.next)) {
          availableStations.add(up.next);
          changed = true;
        }
      }
    }

    const unresolved = [];
    const unlockCounts = {};
    for (const [recipeId, r] of Object.entries(recipes)) {
      const name = r.name;
      let unlock;
      if (r.always_unlocked) {
        unlock = { type: "always", via: null };
      } else if (directlyNamed.has(name)) {
        unlock = { type: "direct", via: name };
      } else if (r.area && availableStations.has(r.area)) {
        unlock = { type: "station", via: r.area };
      } else {
        unlock = { type: "unknown", via: null };
        if (r.tags.includes("learnable")) unresolved.push(recipeId);
      }
      r.unlock = unlock;
      unlockCounts[unlock.type] = (unlockCounts[unlock.type] || 0) + 1;
    }

    if (unresolved.length) {
      warn(
        `${unresolved.length} learnable recipe(s) with no traceable unlock path: ` +
          unresolved.slice(0, 20).join(", ") +
          (unresolved.length > 20 ? " ..." : "")
      );
    }
    return { availableStations, unlockCounts };
  }

  // -------------------------------------------------------------------
  // Acquisition channels -- purchasable / lootable / rewardable
  // -------------------------------------------------------------------
  async function parseNamedGroupFamily(fileRefs, groupTag) {
    const groups = {};
    for (const fileRef of fileRefs) {
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const el of scanBlocks(doc, groupTag)) {
        const name = attr(el, "name");
        if (!name) continue;
        const children = [];
        for (const child of Array.from(el.getElementsByTagName("item"))) {
          if (attr(child, "name")) children.push(["item", attr(child, "name")]);
          else if (attr(child, "group")) children.push(["group", attr(child, "group")]);
        }
        groups[name] = children;
      }
    }
    return groups;
  }

  function flattenGroup(name, groups, visited, out) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const [kind, refName] of groups[name] || []) {
      if (kind === "item") out.add(refName);
      else flattenGroup(refName, groups, visited, out);
    }
  }

  async function rootsFromBlocks(fileRef, rootTag, groups) {
    const out = new Set();
    const doc = await readAndParse(fileRef);
    if (!doc) return out;
    for (const el of scanBlocks(doc, rootTag)) {
      const visited = new Set();
      for (const itemEl of Array.from(el.getElementsByTagName("item"))) {
        if (attr(itemEl, "name")) out.add(attr(itemEl, "name"));
        else if (attr(itemEl, "group")) flattenGroup(attr(itemEl, "group"), groups, visited, out);
      }
    }
    return out;
  }

  async function loadAcquisitionChannels(paths) {
    const traderGroups = await parseNamedGroupFamily([paths.tradersFile], "trader_item_group");
    const lootGroups = await parseNamedGroupFamily(paths.lootGroupFiles, "lootgroup");

    const purchasable = await rootsFromBlocks(paths.tradersFile, "trader_info", traderGroups);
    const lootable = await rootsFromBlocks(paths.lootContainersFile, "lootcontainer", lootGroups);

    const rewardable = new Set();
    const doc = await readAndParse(paths.questsFile);
    if (doc) {
      const visited = new Set();
      for (const el of scanBlocks(doc, "reward")) {
        const rid = attr(el, "id");
        if (!rid) continue;
        if (attr(el, "type") === "Item") rewardable.add(rid);
        else if (attr(el, "type") === "LootItem") flattenGroup(rid, lootGroups, visited, rewardable);
      }
    }

    return { purchasable, lootable, rewardable };
  }

  // -------------------------------------------------------------------
  // Shared source-row helpers (harvest + recycle)
  // -------------------------------------------------------------------
  function parseCountRange(countAttr) {
    const parts = countAttr.split(",");
    return [Math.trunc(parseFloat(parts[0])), Math.trunc(parseFloat(parts[parts.length - 1]))];
  }

  function expectedYield(s) {
    return (s.prob * (s.countMin + s.countMax)) / 2.0;
  }

  // Matches the "_<N>" / "_<N><letters>" tier/quality-variant suffix
  // convention -- see build.py's TIER_VARIANT_SUFFIX_RE comment.
  const TIER_VARIANT_SUFFIX_RE = /^(.*)_(\d+)[A-Za-z]*$/;

  function collapseTierVariants(sources, key) {
    const groups = new Map();
    const order = [];
    for (const s of sources) {
      const m = TIER_VARIANT_SUFFIX_RE.exec(s[key]);
      const root = m ? m[1] : s[key];
      const groupKey = JSON.stringify([root, s.event ?? null, s.countMin, s.countMax, s.prob]);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
        order.push(groupKey);
      }
      groups.get(groupKey).push(s);
    }
    const suffixNum = (s) => {
      const m = TIER_VARIANT_SUFFIX_RE.exec(s[key]);
      return m ? parseInt(m[2], 10) : 0;
    };
    return order.map((k) => {
      const group = groups.get(k);
      return group.length === 1 ? group[0] : group.reduce((a, b) => (suffixNum(b) < suffixNum(a) ? b : a));
    });
  }

  function collapseSameBlockEvents(sources) {
    const groups = new Map();
    const order = [];
    for (const s of sources) {
      const key = JSON.stringify([s.block, s.countMin, s.countMax, s.prob]);
      if (!groups.has(key)) {
        groups.set(key, []);
        order.push(key);
      }
      groups.get(key).push(s);
    }
    return order.map((k) => {
      const group = groups.get(k);
      if (group.length === 1) return group[0];
      return group.find((s) => s.event === "Harvest") || group[0];
    });
  }

  function sortAndTierSources(sourcesMap, key) {
    for (const sources of Object.values(sourcesMap)) {
      sources.sort((a, b) => {
        const ey = expectedYield(b) - expectedYield(a);
        if (ey) return ey;
        const p = b.prob - a.prob;
        if (p) return p;
        return a[key].localeCompare(b[key]);
      });
      const best = sources.length ? expectedYield(sources[0]) : 0;
      for (const s of sources) {
        const ratio = best > 0 ? expectedYield(s) / best : 0;
        s.tier = ratio >= 0.5 ? "high" : ratio >= 0.15 ? "medium" : "low";
      }
    }
    return sourcesMap;
  }

  function collapseSourceLookalikes(sourcesMap, names, icons, key) {
    for (const sources of Object.values(sourcesMap)) {
      const seen = new Map();
      const order = [];
      for (const s of sources) {
        const dedupKey = JSON.stringify([
          names[s[key]] ?? s[key],
          icons[s[key]] ?? null,
          s.event ?? null,
          s.countMin,
          s.countMax,
          s.prob,
        ]);
        if (!seen.has(dedupKey)) {
          seen.set(dedupKey, s);
          order.push(dedupKey);
        }
      }
      sources.length = 0;
      sources.push(...order.map((k) => seen.get(k)));
    }
    return sourcesMap;
  }

  // -------------------------------------------------------------------
  // Harvestable -- <drop> inside <block>/<set>/<append> in blocks.xml files
  // -------------------------------------------------------------------
  async function loadHarvestSources(paths) {
    const harvestable = new Set();
    const harvestSources = {};
    for (const fileRef of paths.blockFiles) {
      if (!fileRef.handle) {
        warn(`missing expected file: ${fileRef.label}`);
        continue;
      }
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const tag of ["block", "set", "append"]) {
        for (const blockEl of scanBlocks(doc, tag)) {
          const blockName = attr(blockEl, "name") || nameFromXpath(attr(blockEl, "xpath"));
          if (!blockName) continue;
          for (const el of Array.from(blockEl.getElementsByTagName("drop"))) {
            const name = attr(el, "name");
            const countAttr = attr(el, "count", "1");
            if (!name || countAttr === "0") continue;
            harvestable.add(name);
            const [countMin, countMax] = parseCountRange(countAttr);
            (harvestSources[name] = harvestSources[name] || []).push({
              block: blockName,
              event: attr(el, "event", "Harvest"),
              countMin,
              countMax,
              prob: parseFloat(attr(el, "prob", "1")),
            });
          }
        }
      }
    }
    for (const name in harvestSources) {
      const collapsed = collapseSameBlockEvents(harvestSources[name]);
      harvestSources[name] = collapseTierVariants(collapsed, "block");
    }
    sortAndTierSources(harvestSources, "block");
    return { harvestable, harvestSources };
  }

  // -------------------------------------------------------------------
  // Recycling -- <recycle><output/></recycle> in recipes_recycler.xml
  // -------------------------------------------------------------------
  async function loadRecycleData(paths) {
    const recycleYields = {};
    const recycleSources = {};
    const doc = await readAndParse(paths.recycleFile);
    if (!doc) return { recycleYields, recycleSources };
    for (const el of scanBlocks(doc, "recycle")) {
      const inputNames = attr(el, "name", "").split(",").map((n) => n.trim()).filter(Boolean);
      const outputs = [];
      for (const outEl of directChildren(el, "output")) {
        const outName = attr(outEl, "name");
        if (!outName) continue;
        let countAttr = attr(outEl, "count");
        let probAttr = attr(outEl, "prob", "1");
        if (countAttr === null && probAttr.includes(",")) {
          warn(
            `${paths.recycleFile.label}: <output name="${outName}"> has prob="${probAttr}" ` +
              `(a comma-range, never valid for a probability) -- treated as the count ` +
              `attribute the author meant, prob=1`
          );
          [countAttr, probAttr] = [probAttr, "1"];
        }
        const [countMin, countMax] = parseCountRange(countAttr || "1");
        outputs.push({ name: outName, countMin, countMax, prob: parseFloat(probAttr) });
      }
      if (!inputNames.length || !outputs.length) continue;
      for (const inputName of inputNames) {
        (recycleYields[inputName] = recycleYields[inputName] || []).push(...outputs);
        for (const o of outputs) {
          (recycleSources[o.name] = recycleSources[o.name] || []).push({
            item: inputName,
            countMin: o.countMin,
            countMax: o.countMax,
            prob: o.prob,
          });
        }
      }
    }
    for (const name in recycleSources) {
      recycleSources[name] = collapseTierVariants(recycleSources[name], "item");
    }
    sortAndTierSources(recycleSources, "item");
    return { recycleYields, recycleSources };
  }

  // -------------------------------------------------------------------
  // Vehicles -- <item>/<set xpath="...item[@name='X']"> in items_vehicles.xml
  // -------------------------------------------------------------------
  const VEHICLE_STAT_FIELDS = [
    "cargoCapacity", "repairTool", "weight", "param1",
    "maintenanceGroup", "modSlots", "degradationMax", "entityName",
  ];

  function nameFromXpath(xpath) {
    if (!xpath) return null;
    const m = /@name='([^']+)'/.exec(xpath);
    return m ? m[1] : null;
  }

  async function loadVehicleSpeeds(paths) {
    const speeds = {};

    async function scan(fileRef) {
      const doc = await readAndParse(fileRef);
      if (!doc) return;
      for (const tag of ["vehicle", "set"]) {
        for (const el of scanBlocks(doc, tag)) {
          const name = attr(el, "name") || nameFromXpath(attr(el, "xpath"));
          if (!name) continue;
          for (const prop of Array.from(el.getElementsByTagName("property"))) {
            if (attr(prop, "name") === "velocityMax_turbo") {
              speeds[name] = attr(prop, "value");
            }
          }
        }
      }
    }

    await scan(paths.baseVehiclesFile);
    await scan(paths.modVehiclesFile);

    // One narrower shape isn't a real XML element at all -- an
    // attribute-only <set xpath=".../@value">newValue</set> patch (used
    // just for the minibike/motorcycle) -- so it needs its own regex over
    // the raw text rather than a DOM query.
    const modText = await readText(paths.modVehiclesFile);
    if (modText) {
      const attrSetRe = /<set xpath="\/vehicles\/vehicle\[@name='([^']+)'\]\/property\[@name='velocityMax_turbo'\]\/@value">([^<]+)<\/set>/g;
      let m;
      while ((m = attrSetRe.exec(modText))) {
        speeds[m[1]] = m[2].trim();
      }
    }

    const topSpeed = {};
    for (const name in speeds) {
      const first = speeds[name].split(",")[0].trim();
      const val = parseFloat(first);
      if (Number.isNaN(val)) {
        warn(`vehicles.xml: '${name}' has an unparseable velocityMax_turbo value: ${JSON.stringify(speeds[name])}`);
      } else {
        topSpeed[name] = val;
      }
    }
    return topSpeed;
  }

  async function loadVehicles(paths) {
    const vehicles = {};
    if (!paths.vehicleItemsFile.handle) {
      warn(`missing expected file: ${paths.vehicleItemsFile.label}`);
      return { vehicles, vehicleColorVariants: {} };
    }
    const doc = await readAndParse(paths.vehicleItemsFile);
    if (!doc) return { vehicles, vehicleColorVariants: {} };

    const entries = {};
    for (const tag of ["item", "set"]) {
      for (const el of scanBlocks(doc, tag)) {
        const name = attr(el, "name") || nameFromXpath(attr(el, "xpath"));
        if (!name) continue;
        const d = (entries[name] = entries[name] || {});
        for (const prop of Array.from(el.getElementsByTagName("property"))) {
          const pname = attr(prop, "name");
          if (pname === "Tags") d.tags = attr(prop, "value", "");
          else if (pname === "RepairTools") d.repairTool = attr(prop, "value");
          else if (pname === "MaintenanceGroup") d.maintenanceGroup = attr(prop, "value");
          else if (pname === "Extends") d.extends = attr(prop, "value");
          else if (pname === "CarryWeight") {
            d.weight = attr(prop, "value");
            d.param1 = attr(prop, "param1");
          } else if (pname === "Vehicle") {
            d.entityName = attr(prop, "value");
          }
        }
        for (const eff of Array.from(el.getElementsByTagName("passive_effect"))) {
          const ename = attr(eff, "name");
          if (ename === "VehicleCargoCapacity") d.cargoCapacity = attr(eff, "value");
          else if (ename === "ModSlots") d.modSlots = attr(eff, "value");
          else if (ename === "DegradationMax") d.degradationMax = attr(eff, "value");
        }
      }
    }

    function resolve(name, field, seen) {
      seen = seen || new Set();
      if (!name || seen.has(name) || !(name in entries)) return null;
      seen.add(name);
      const d = entries[name];
      if (field in d) return d[field];
      return d.extends ? resolve(d.extends, field, seen) : null;
    }

    const speeds = await loadVehicleSpeeds(paths);
    for (const name in entries) {
      const d = entries[name];
      if (!d.tags || !d.tags.split(",").includes("vehicle")) continue;
      const v = {};
      for (const field of VEHICLE_STAT_FIELDS) v[field] = resolve(name, field);
      const entityName = v.entityName || name;
      delete v.entityName;
      v.topSpeed = speeds[entityName] ?? null;
      vehicles[name] = v;
    }

    function resolveRepresentative(name, seen) {
      seen = seen || new Set();
      if (!name || seen.has(name) || !(name in entries)) return null;
      seen.add(name);
      if (name in vehicles) return name;
      return entries[name].extends ? resolveRepresentative(entries[name].extends, seen) : null;
    }

    const vehicleColorVariants = {};
    for (const name in entries) {
      if (name in vehicles) continue;
      const rep = resolveRepresentative(name);
      if (rep) vehicleColorVariants[name] = rep;
    }

    return { vehicles, vehicleColorVariants };
  }

  async function indexVehicleBlockJoinKeys(paths) {
    const keys = {};
    const doc = await readAndParse(paths.vehicleBlocksFile);
    if (!doc) return keys;
    for (const el of scanBlocks(doc, "block")) {
      const name = attr(el, "name");
      if (!name) continue;
      let itemName = null;
      let itemPrefix = null;
      for (const prop of Array.from(el.getElementsByTagName("property"))) {
        const pname = attr(prop, "name");
        if (pname === "ItemName") itemName = attr(prop, "value");
        else if (pname === "ItemPrefix" && attr(prop, "value")) itemPrefix = attr(prop, "value");
      }
      if (itemName) keys[name] = { kind: "exact", value: itemName };
      else if (itemPrefix) keys[name] = { kind: "prefix", value: itemPrefix };
    }
    return keys;
  }

  async function loadVehicleRepairs(paths, vehicleNames) {
    const repairs = {};
    if (!paths.recipeVehiclesFile.handle) {
      warn(`missing expected file: ${paths.recipeVehiclesFile.label}`);
      return repairs;
    }
    const blockKeys = await indexVehicleBlockJoinKeys(paths);
    const doc = await readAndParse(paths.recipeVehiclesFile);
    if (!doc) return repairs;
    for (const el of scanBlocks(doc, "vehicle")) {
      const blockList = attr(el, "block", "").split(",").map((b) => b.trim()).filter(Boolean);
      const matched = new Set();
      for (const b of blockList) {
        const join = blockKeys[b];
        if (!join) continue;
        if (join.kind === "exact") {
          if (vehicleNames.has(join.value)) matched.add(join.value);
        } else {
          for (const n of vehicleNames) {
            if (n.startsWith(join.value)) matched.add(n);
          }
        }
      }
      if (!matched.size) {
        warn(`${paths.recipeVehiclesFile.label}: repair entry for block(s) '${attr(el, "block")}' didn't match any known vehicle`);
        continue;
      }
      const ingredients = directChildren(el, "ingredient")
        .map((ing) => ({ name: attr(ing, "name"), count: attr(ing, "count", "1") }))
        .filter((ing) => ing.name);
      const tier = {
        damage: attr(el, "damage"),
        learnable: attr(el, "learnable"),
        tools: attr(el, "tools", "").split(",").map((t) => t.trim()).filter(Boolean),
        ingredients,
      };
      for (const name of matched) {
        (repairs[name] = repairs[name] || []).push(tier);
      }
    }
    for (const name in repairs) {
      repairs[name].sort((a, b) => (parseFloat(a.damage) || 0) - (parseFloat(b.damage) || 0));
    }
    return repairs;
  }

  // -------------------------------------------------------------------
  // CustomIcon overrides + Extends graph
  //
  // build.py scans these with a regex over raw text (ITEM_BLOCK_RE /
  // BLOCK_TAG_RE) since it never does a real parse. With a real DOM
  // available, the equivalent is just: for every item/set/append/block/
  // item_modifier element, look at ITS OWN descendant <property> elements
  // (not just direct children -- some sit inside a nested class, e.g.
  // property class="Action1") for one named "CustomIcon"/"Extends".
  // -------------------------------------------------------------------
  const ITEM_BLOCK_TAGS = ["item_modifier", "item", "set", "append", "block"];
  const BLOCK_TAGS = ["block", "set", "append"];

  function firstPropertyValue(el, propName) {
    for (const prop of Array.from(el.getElementsByTagName("property"))) {
      if (attr(prop, "name") === propName) {
        const v = attr(prop, "value");
        if (v !== null) return v;
      }
    }
    return null;
  }

  async function loadCustomIcons(paths) {
    const customIcons = {};
    // Base game files scanned FIRST, mod files LAST -- mod always wins on
    // the same key, matching the precedence used throughout this file.
    const files = [paths.baseItemFile, paths.baseBlockFile, paths.baseItemModifiersFile, paths.modItemModifiersFile]
      .concat(paths.itemFiles, paths.blockFiles);
    for (const fileRef of files) {
      if (!fileRef.handle) continue;
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const tag of ITEM_BLOCK_TAGS) {
        for (const el of scanBlocks(doc, tag)) {
          const name = attr(el, "name") || nameFromXpath(attr(el, "xpath"));
          if (!name) continue;
          const customIcon = firstPropertyValue(el, "CustomIcon");
          if (customIcon !== null) customIcons[name] = customIcon;
        }
      }
    }
    return customIcons;
  }

  async function loadExtendsGraph(paths) {
    const extendsMap = {};
    const childrenMap = {};
    const files = [paths.baseItemFile, paths.baseBlockFile, paths.baseItemModifiersFile, paths.modItemModifiersFile]
      .concat(paths.itemFiles, paths.blockFiles);
    for (const fileRef of files) {
      if (!fileRef.handle) continue;
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const tag of ITEM_BLOCK_TAGS) {
        for (const el of scanBlocks(doc, tag)) {
          const entryName = attr(el, "name") || nameFromXpath(attr(el, "xpath"));
          if (!entryName) continue;
          const extendsVal = firstPropertyValue(el, "Extends");
          if (!extendsVal) continue;
          extendsMap[entryName] = extendsVal;
          (childrenMap[extendsVal] = childrenMap[extendsVal] || []).push(entryName);
        }
      }
    }
    return { extendsMap, childrenMap };
  }

  async function loadVariantHelperCandidates(paths) {
    const helperToCandidates = {};
    for (const fileRef of paths.blockFiles) {
      if (!fileRef.handle) continue;
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const tag of BLOCK_TAGS) {
        for (const el of scanBlocks(doc, tag)) {
          const name = attr(el, "name") || nameFromXpath(attr(el, "xpath"));
          if (!name) continue;
          let helper = null;
          for (const prop of Array.from(el.getElementsByTagName("property"))) {
            if (attr(prop, "name") === "CanPickup" && attr(prop, "value") === "true" && attr(prop, "param1")) {
              helper = attr(prop, "param1");
              break;
            }
          }
          if (!helper) continue;
          const candidate = firstPropertyValue(el, "CustomIcon") || name;
          (helperToCandidates[helper] = helperToCandidates[helper] || []).push(candidate);
        }
      }
    }
    return helperToCandidates;
  }

  async function loadItemModifierNames(paths) {
    const names = new Set();
    for (const fileRef of [paths.modItemModifiersFile, paths.baseItemModifiersFile]) {
      if (!fileRef.handle) {
        warn(`missing expected file: ${fileRef.label}`);
        continue;
      }
      const doc = await readAndParse(fileRef);
      if (!doc) continue;
      for (const el of scanBlocks(doc, "item_modifier")) {
        const name = attr(el, "name");
        if (name) names.add(name);
      }
    }
    return names;
  }

  function sharedPrefixLen(a, b) {
    let n = 0;
    while (n < a.length && n < b.length && a[n] === b[n]) n++;
    return n;
  }

  function resolveNameFallback(block, names, extendsMap, childrenMap) {
    const seen = new Set([block]);
    let cur = block;
    while (cur in extendsMap) {
      cur = extendsMap[cur];
      if (seen.has(cur)) break;
      seen.add(cur);
      if (cur in names) return names[cur];
    }
    const found = [];
    const seenDown = new Set([block]);
    const queue = [...(childrenMap[block] || [])];
    while (queue.length) {
      const child = queue.shift();
      if (seenDown.has(child)) continue;
      seenDown.add(child);
      if (child in names) found.push(child);
      queue.push(...(childrenMap[child] || []));
    }
    if (!found.length) return null;
    const best = found.reduce((a, b) => {
      const sa = sharedPrefixLen(block, a);
      const sb = sharedPrefixLen(block, b);
      if (sb !== sa) return sb > sa ? b : a;
      return b.length < a.length ? b : a;
    });
    return names[best];
  }

  // -------------------------------------------------------------------
  // Icon index -- every PNG under UIAtlases, keyed by filename stem
  // -------------------------------------------------------------------
  async function indexIcons(paths) {
    const index = new Map();
    const folderPriority = [
      "ItemIconAtlas", "UIAltAtlas", "UIActiveItems", "UIAtlas",
      "ItemIconAtlasGrey", "UIStack", "UIBackground", "UIScrollTab", "UISkills",
    ];
    for (const folder of folderPriority) {
      const base = await tryGetDir(paths.atlases, folder);
      if (!base) continue;
      const folderIndex = new Map();
      await walkPngRecursive(base, folderIndex);
      for (const [stem, handle] of folderIndex) {
        if (!index.has(stem)) index.set(stem, handle);
      }
    }
    return index;
  }

  async function indexBaseIcons(paths) {
    const index = new Map();
    if (!paths.baseIconsDir) return index;
    for await (const [name, handle] of paths.baseIconsDir.entries()) {
      if (handle.kind === "file" && /\.png$/i.test(name)) {
        const stem = name.slice(0, -4);
        if (!index.has(stem)) index.set(stem, handle);
      }
    }
    return index;
  }

  const VARIANT_HELPER_SUFFIX = "VariantHelper";

  function variantCandidates(name, variantHelperCandidates) {
    const candidates = [...(variantHelperCandidates[name] || [])];
    if (name.endsWith(VARIANT_HELPER_SUFFIX)) {
      const guess = name.slice(0, -VARIANT_HELPER_SUFFIX.length);
      if (guess && !candidates.includes(guess)) candidates.push(guess);
    }
    return candidates;
  }

  // Resolves an icon to its file's raw bytes (a Blob) plus an object URL
  // for immediate use, and caches both by resolved stem -- used_icons maps
  // a resolved atlas-relative stem to its FileSystemFileHandle so the same
  // file is never read/turned into more than one object URL.
  //
  // The Blob is what actually gets persisted to IndexedDB (see build()'s
  // `iconBlobs`, and storage.js's getCachedDataset()) -- a blob: URL is only
  // valid for the document that created it, so one baked into a cached
  // dataset and reused after a reload is already dead. Caching the Blob
  // itself (structured-clone-storable, unlike the URL string) lets a fresh,
  // valid URL be minted from it on every page load instead.
  const iconCache = new Map(); // stem -> Promise<{blob, url}>

  async function resolveIcon(name, iconIndex, customIcons, usedIcons) {
    if (!name) return null;
    let lookup = customIcons[name] !== undefined ? customIcons[name] : name;
    lookup = lookup.split(";")[0]; // strip "name;color;alpha" suffixes (skill-tree icons)
    const handle = iconIndex.get(lookup);
    if (!handle) return null;
    usedIcons.set(lookup, handle);
    if (!iconCache.has(lookup)) {
      iconCache.set(
        lookup,
        (async () => {
          const blob = await handle.getFile();
          return { blob, url: URL.createObjectURL(blob) };
        })()
      );
    }
    return await iconCache.get(lookup);
  }

  async function resolveIconWithVariantFallback(
    name, iconIndex, customIcons, usedIcons, variantHelperCandidates, baseIconIndex, extendsMap, seen
  ) {
    let rel = await resolveIcon(name, iconIndex, customIcons, usedIcons);
    if (rel !== null) return { rel, source: null };
    const candidates = variantCandidates(name, variantHelperCandidates);
    for (const candidate of candidates) {
      rel = await resolveIcon(candidate, iconIndex, customIcons, usedIcons);
      if (rel !== null) return { rel, source: "variant" };
    }
    rel = await resolveIcon(name, baseIconIndex, customIcons, usedIcons);
    if (rel !== null) return { rel, source: "base_game" };
    for (const candidate of candidates) {
      rel = await resolveIcon(candidate, baseIconIndex, customIcons, usedIcons);
      if (rel !== null) return { rel, source: "variant_base_game" };
    }
    if (extendsMap) {
      const seenSet = seen || new Set([name]);
      const parent = extendsMap[name];
      if (parent && !seenSet.has(parent)) {
        const result = await resolveIconWithVariantFallback(
          parent, iconIndex, customIcons, usedIcons, variantHelperCandidates, baseIconIndex, extendsMap,
          new Set([...seenSet, parent])
        );
        if (result.rel !== null) return { rel: result.rel, source: "extends" };
      }
    }
    return { rel: null, source: null };
  }

  // -------------------------------------------------------------------
  // Main
  // -------------------------------------------------------------------
  async function build(rootHandle, onLog) {
    const log = onLog || (() => {});
    WARNINGS = [];

    const paths = await validateAndResolvePaths(rootHandle);

    log("Loading localization...");
    const names = await loadLocalization(paths, log);

    log("Loading recipes...");
    const { recipes, recipesByName } = await loadRecipes(paths);
    const variantNames = Object.values(recipesByName).filter((ids) => ids.length > 1).length;
    log(`  ${Object.keys(recipes).length} recipe entries (${Object.keys(recipesByName).length} distinct item names, ${variantNames} with 2+ alternate recipes)`);

    log("Loading workstation tier upgrades...");
    const upgrades = await loadUpgrades(paths);
    log(`  ${Object.keys(upgrades).length} upgrades`);

    log("Loading research tree...");
    const research = await loadResearch(paths);
    log(`  ${Object.keys(research).length} research nodes`);

    log("Computing unlock pathways...");
    const { availableStations, unlockCounts } = computeUnlocks(recipes, research, upgrades);
    log(`  unlock breakdown: ${JSON.stringify(unlockCounts)}`);

    log("Loading acquisition channels (purchasable/lootable/rewardable)...");
    const { purchasable, lootable, rewardable } = await loadAcquisitionChannels(paths);
    log(`  ${purchasable.size} purchasable, ${lootable.size} lootable, ${rewardable.size} rewardable distinct name(s)`);

    log("Loading harvestable (block drop tables)...");
    const { harvestable, harvestSources } = await loadHarvestSources(paths);
    log(`  ${harvestable.size} harvestable distinct name(s), ${Object.values(harvestSources).reduce((s, v) => s + v.length, 0)} source row(s)`);

    log("Loading recycler data...");
    const { recycleYields, recycleSources } = await loadRecycleData(paths);
    const recyclable = new Set(Object.keys(recycleSources));
    log(`  ${Object.keys(recycleYields).length} recyclable item(s), ${recyclable.size} distinct recycle output(s), ${Object.values(recycleSources).reduce((s, v) => s + v.length, 0)} source row(s)`);

    log("Resolving icons...");
    const customIcons = await loadCustomIcons(paths);
    const iconIndex = await indexIcons(paths);
    const baseIconIndex = await indexBaseIcons(paths);
    const variantHelperCandidates = await loadVariantHelperCandidates(paths);
    const usedIcons = new Map();

    const allNames = new Set([...Object.keys(recipesByName), ...Object.keys(research), ...Object.keys(upgrades)]);
    for (const r of Object.values(recipes)) {
      for (const ing of [...r.ingredients, ...r.outputs]) {
        if (ing.name) allNames.add(ing.name);
      }
    }
    for (const up of Object.values(upgrades)) {
      if (up.next) allNames.add(up.next);
      for (const ing of up.ingredients) if (ing.name) allNames.add(ing.name);
      for (const t of up.tools) allNames.add(t);
    }
    for (const node of Object.values(research)) {
      for (const ing of node.ingredients) if (ing.name) allNames.add(ing.name);
      if (node.icon) allNames.add(node.icon.split(";")[0]);
    }
    for (const sources of Object.values(harvestSources)) {
      for (const s of sources) allNames.add(s.block);
    }
    for (const name in recycleYields) {
      allNames.add(name);
      for (const o of recycleYields[name]) allNames.add(o.name);
    }
    for (const n of purchasable) allNames.add(n);
    for (const n of lootable) allNames.add(n);
    for (const n of rewardable) allNames.add(n);

    log("Loading weapon/armor mods (item_modifiers.xml)...");
    const itemMods = await loadItemModifierNames(paths);
    for (const n of itemMods) allNames.add(n);
    log(`  ${itemMods.size} distinct mod name(s)`);

    log("Loading vehicles (items_vehicles.xml)...");
    const { vehicles, vehicleColorVariants } = await loadVehicles(paths);
    for (const n of Object.keys(vehicles)) allNames.add(n);
    log(`  ${Object.keys(vehicles).length} vehicle body style(s), ${Object.keys(vehicleColorVariants).length} color-variant name(s) mapped to them`);

    log("Loading vehicle world-repair costs (recipes_vehicles.xml)...");
    const vehicleRepairs = await loadVehicleRepairs(paths, new Set(Object.keys(vehicles)));
    for (const name in vehicleRepairs) {
      vehicles[name].repairRecipes = vehicleRepairs[name];
      for (const tier of vehicleRepairs[name]) {
        for (const ing of tier.ingredients) allNames.add(ing.name);
        if (tier.learnable) allNames.add(tier.learnable);
        for (const t of tier.tools) allNames.add(t);
      }
    }
    log(`  ${Object.values(vehicleRepairs).reduce((s, t) => s + t.length, 0)} repair recipe(s) across ${Object.keys(vehicleRepairs).length} vehicle(s)`);

    log("Backfilling display names via Extends chain...");
    const { extendsMap, childrenMap } = await loadExtendsGraph(paths);
    const nameFallbackUsed = [];
    for (const nm of allNames) {
      if (!(nm in names)) {
        const resolved = resolveNameFallback(nm, names, extendsMap, childrenMap);
        if (resolved) {
          names[nm] = resolved;
          nameFallbackUsed.push(nm);
        }
      }
    }
    if (nameFallbackUsed.length) {
      log(`  ${nameFallbackUsed.length} name(s) backfilled from a named Extends ancestor/descendant`);
      warn(
        `${nameFallbackUsed.length} name(s) have no localization of their own -- shown using a ` +
          `related block's name via the Extends chain (an ancestor's name, or a real placeable ` +
          `variant's, for an abstract template that's never itself placed): ` +
          nameFallbackUsed.slice(0, 10).join(", ") +
          (nameFallbackUsed.length > 10 ? " ..." : "")
      );
    }

    const icons = {};
    const iconBlobs = {};
    const fallbackUsed = [];
    const baseGameUsed = [];
    const extendsUsed = [];
    for (const nm of allNames) {
      const { rel, source } = await resolveIconWithVariantFallback(
        nm, iconIndex, customIcons, usedIcons, variantHelperCandidates, baseIconIndex, extendsMap
      );
      if (rel) {
        icons[nm] = rel.url;
        iconBlobs[nm] = rel.blob;
        if (source === "variant" || source === "variant_base_game") fallbackUsed.push(nm);
        else if (source === "base_game") baseGameUsed.push(nm);
        else if (source === "extends") extendsUsed.push(nm);
      }
    }
    log(
      `  ${Object.keys(icons).length} icons resolved of ${allNames.size} distinct names ` +
        `(${fallbackUsed.length} via variant-skin fallback, ${baseGameUsed.length} via base-game icon, ` +
        `${extendsUsed.length} via Extends ancestor)`
    );
    if (fallbackUsed.length) {
      warn(
        `${fallbackUsed.length} name(s) have no icon of their own -- they are ` +
          `"variant helper" tokens (the recipe/research produces an abstract item ` +
          `that the player skins as one of several real blocks at placement); shown ` +
          `using one variant's icon as a representative: ` +
          fallbackUsed.slice(0, 10).join(", ") +
          (fallbackUsed.length > 10 ? " ..." : "")
      );
    }
    if (baseGameUsed.length) {
      log(`  ${baseGameUsed.length} icon(s) resolved from the base game's own Data/ItemIcons (vanilla items the mod never gives a CustomIcon override)`);
    }
    if (extendsUsed.length) {
      log(`  ${extendsUsed.length} icon(s) borrowed from a named Extends ancestor (the mod patches the item without touching its inherited icon)`);
    }
    log(`  ${usedIcons.size} unique icon file(s) referenced (served directly from your install, never copied)`);

    let before = Object.values(harvestSources).reduce((s, v) => s + v.length, 0);
    collapseSourceLookalikes(harvestSources, names, icons, "block");
    let after = Object.values(harvestSources).reduce((s, v) => s + v.length, 0);
    if (before !== after) {
      log(`  collapsed ${before - after} look-alike harvest source row(s) (same display name/icon/drop under a different internal block name)`);
    }

    before = Object.values(recycleSources).reduce((s, v) => s + v.length, 0);
    collapseSourceLookalikes(recycleSources, names, icons, "item");
    after = Object.values(recycleSources).reduce((s, v) => s + v.length, 0);
    if (before !== after) {
      log(`  collapsed ${before - after} look-alike recycle source row(s) (same display name/icon/yield under a different internal item name)`);
    }

    const craftable = new Set(Object.keys(recipesByName));
    const acquisition = {};
    for (const nm of new Set([...craftable, ...harvestable, ...purchasable, ...lootable, ...rewardable, ...recyclable])) {
      const entry = {};
      if (craftable.has(nm)) entry.craftable = true;
      if (harvestable.has(nm)) entry.harvestable = true;
      if (purchasable.has(nm)) entry.purchasable = true;
      if (lootable.has(nm)) entry.lootable = true;
      if (rewardable.has(nm)) entry.rewardable = true;
      if (recyclable.has(nm)) entry.recyclable = true;
      acquisition[nm] = entry;
    }

    const dataset = {
      meta: {
        builtAt: new Date().toISOString(),
        sourceVersion: await loadModVersion(paths),
        counts: {
          recipes: Object.keys(recipes).length,
          recipeItemNames: Object.keys(recipesByName).length,
          upgrades: Object.keys(upgrades).length,
          research: Object.keys(research).length,
          icons: Object.keys(icons).length,
          craftable: craftable.size,
          harvestable: harvestable.size,
          harvestSourceRows: Object.values(harvestSources).reduce((s, v) => s + v.length, 0),
          nameFallbackUsed: nameFallbackUsed.length,
          iconExtendsFallbackUsed: extendsUsed.length,
          purchasable: purchasable.size,
          lootable: lootable.size,
          rewardable: rewardable.size,
          recyclable: recyclable.size,
          recycleYieldItems: Object.keys(recycleYields).length,
          recycleSourceRows: Object.values(recycleSources).reduce((s, v) => s + v.length, 0),
          itemMods: itemMods.size,
          vehicles: Object.keys(vehicles).length,
          vehicleRepairRecipes: Object.values(vehicleRepairs).reduce((s, t) => s + t.length, 0),
          vehicleColorVariants: Object.keys(vehicleColorVariants).length,
        },
        unlockBreakdown: unlockCounts,
        warnings: WARNINGS,
      },
      names,
      icons,
      iconBlobs,
      acquisition,
      harvestSources,
      recycleYields,
      recycleSources,
      itemMods: [...itemMods].sort(),
      vehicles,
      vehicleColorVariants,
      alwaysAvailableStations: [...ALWAYS_AVAILABLE_STATIONS].sort(),
      iconFallbackNames: fallbackUsed,
      recipes,
      recipesByName,
      upgrades,
      research,
    };

    if (WARNINGS.length) {
      log(`\n${WARNINGS.length} warning(s) -- see meta.warnings, or below:`);
      for (const w of WARNINGS.slice(0, 30)) log(`  - ${w}`);
      if (WARNINGS.length > 30) log(`  ... and ${WARNINGS.length - 30} more`);
    }

    return dataset;
  }

  return { build, InstallRootError };
})();
