// UL Mod Buddy -- minimal proof-of-life app shell, now with the
// Total Requirements Report (recursive dependency expansion) as the first
// real Phase-1 feature. See reportEngine.js for the pure recursion logic;
// this file is just data plumbing + rendering + DOM wiring.

// Exposes window.ULModBuddyApp.init(data) rather than self-running against a
// window.ULMODBUDDY_DATA global set by a generated <script> tag -- now that
// the dataset can come from an async IndexedDB read or a live in-browser
// build (see setup.js), nothing here can assume data is available the
// instant this file is parsed. setup.js calls init() exactly once per real
// page load (a fresh build always ends in a reload rather than a second,
// same-page init() call, so none of the event listeners below are ever
// double-registered).
window.ULModBuddyApp = (function () {
  "use strict";

  function init(data) {
  if (!window.ULModBuddyReportEngine) {
    document.getElementById("detail").textContent =
      "reportEngine.js did not load -- is it included in index.html alongside app.js?";
    return;
  }
  const reportEngine = window.ULModBuddyReportEngine.createReportEngine(data);

  const $ = (sel) => document.querySelector(sel);
  const searchEl = $("#search");
  const searchClearEl = $("#search-clear");
  const resultsEl = $("#results");
  const filtersEl = $("#filters");
  const detailEl = $("#detail");
  const metaEl = $("#meta-line");
  const rebuildBtnEl = $("#rebuild-btn");
  const sourceModalEl = $("#source-modal");
  const sourceModalTitleEl = $("#source-modal-title");
  const sourceModalBodyEl = $("#source-modal-body");
  const sourceModalCloseEl = $("#source-modal-close");
  const treeBtnEl = $("#tree-btn");
  const treeModalEl = $("#tree-modal");
  const treeModalCloseEl = $("#tree-modal-close");
  const treeCategoryBtnEl = $("#tree-category-btn");
  const treeCategoryBtnIconEl = $("#tree-category-btn-icon");
  const treeCategoryBtnLabelEl = $("#tree-category-btn-label");
  const treeCategoryMenuEl = $("#tree-category-menu");
  const treeCategoryFieldEl = $("#tree-category-field");
  const treeModeTreeBtnEl = $("#tree-mode-tree");
  const treeModeRecipesBtnEl = $("#tree-mode-recipes");
  const treeSortToggleEl = $("#tree-sort-toggle");
  const treeSortTierBtnEl = $("#tree-sort-tier");
  const treeSortResearchBtnEl = $("#tree-sort-research");
  const treeTierLegendEl = $("#tree-tier-legend");
  const treeCanvasWrapEl = $("#tree-canvas-wrap");
  const treeCanvasInnerEl = $("#tree-canvas-inner");
  const treeZoomInEl = $("#tree-zoom-in");
  const treeZoomOutEl = $("#tree-zoom-out");
  const treeZoomResetEl = $("#tree-zoom-reset");
  const treeNodeTooltipEl = $("#tree-node-tooltip");

  // ---------------------------------------------------------------------
  // Meta line
  // ---------------------------------------------------------------------
  const c = data.meta.counts;
  let metaHtml =
    `built ${data.meta.builtAt} from ${data.meta.sourceVersion} -- ` +
    `${c.recipes} recipes (${c.recipeItemNames} items) / ${c.research} research / ${c.upgrades} upgrades / ${c.vehicles} vehicles / ${c.icons} icons`;
  if (data.meta.warnings.length) {
    metaHtml += ` -- <button class="meta-warnings-btn" onclick="window.__cookbookShowWarnings()">${data.meta.warnings.length} build warning(s)</button>`;
  }
  metaEl.innerHTML = metaHtml;
  // ModInfo.xml's <Version> is maintained by hand and can lag behind an
  // actual release -- the number itself already says "(per ModInfo.xml)";
  // this just spells out why on hover, rather than crowding the header
  // line with it.
  metaEl.title = "The mod version above is read from the mod's own ModInfo.xml, which its author doesn't always update on every release -- it may not match what the game itself displays.";

  rebuildBtnEl.hidden = false;
  rebuildBtnEl.addEventListener("click", () => window.ULModBuddySetup.open({ allowCancel: true }));
  treeBtnEl.hidden = false;

  const displayName = (internalName) => {
    if (!internalName) return internalName;
    return data.names[internalName] || internalName;
  };

  const iconFor = (internalName) => data.icons[internalName] || null;
  const iconFallbackNames = new Set(data.iconFallbackNames || []);
  const isIconFallback = (internalName) => iconFallbackNames.has(internalName);

  // Matches the real in-game research UI: a research node that unlocks
  // exactly one object shows that object's own icon; a node that's a "pure
  // research" hub (0 or 2+ unlocks, no direct item identity of its own)
  // shows a generic research symbol instead -- never a borrowed, unrelated
  // ingredient's icon. Priority:
  //   1. the node's own symbol_X sprite (its `icon` attribute) -- takes
  //      priority even when the node's name also resolves to an item's own
  //      icon, since that symbol is what the tree actually shows for it.
  //   2. the node's own name, when it directly names a real item (the
  //      common case: a research node for one specific craftable/placeable
  //      thing is usually named after it).
  //   3. its single <unlocks> entry's icon, for the case where the node's
  //      name differs from the one thing it unlocks (e.g. "Minibike
  //      Maintenance" unlocking the "ulmBookMaintenanceMinibike" schematic).
  //   4. the generic research symbol (a "pure research" hub with 0 or 2+
  //      unlocks and no identity of its own -- ~5% of all nodes).
  const GENERIC_RESEARCH_ICON = "symbol_microscope"; // used for the research-points resource itself in the game's own research window
  function iconForResearch(name) {
    const node = data.research[name];
    const symbolIcon = node && node.icon ? iconFor(node.icon.split(";")[0]) : null;
    if (symbolIcon) return symbolIcon;
    const direct = iconFor(name);
    if (direct) return direct;
    if (!node) return null;
    const unlocks = node.unlocks || [];
    if (unlocks.length === 1) {
      const unlockIcon = iconFor(unlocks[0].name);
      if (unlockIcon) return unlockIcon;
    }
    return iconFor(GENERIC_RESEARCH_ICON);
  }

  function qtyLabel(qty) {
    if (Number.isInteger(qty)) return String(qty);
    return (Math.round(qty * 100) / 100).toString();
  }

  // ---------------------------------------------------------------------
  // Workstation tiers -- each tier of a station (Tier 1, Tier 2, ...) is
  // browsed as its own item instead of an abstract "upgrade" entry.
  // data.upgrades is keyed by the FROM tier (`block`); a family's base tier
  // never appears as a `next`, so that's how roots are found. Tier 1's own
  // cost is a normal recipe (data.recipesByName); every later tier's cost
  // is the upgrade INTO it (data.upgrades[prevTierName]).
  const upgradedInto = new Set(Object.values(data.upgrades).map((u) => u.next).filter(Boolean));
  const workstationFamilies = Object.keys(data.upgrades)
    .filter((block) => !upgradedInto.has(block))
    .map((root) => {
      const tiers = [root];
      let cur = root;
      while (data.upgrades[cur]) {
        cur = data.upgrades[cur].next;
        tiers.push(cur);
      }
      return tiers;
    });
  const tierInfo = {}; // tier name -> { familyTiers, tierIndex }
  const stationFamilyNames = new Set();
  workstationFamilies.forEach((tiers) => {
    tiers.forEach((t, i) => {
      tierInfo[t] = { familyTiers: tiers, tierIndex: i };
      stationFamilyNames.add(t);
    });
  });
  // Single-tier stations (campfire, stove, cementMixer) never appear in
  // data.upgrades at all -- no tierInfo entry, same as any other block name
  // that happens not to be part of a real upgrade chain (see
  // workstationRowKeyFor, which treats both cases identically: no tier to
  // place them by).

  // Tier 1's raw localized name is plain ("Carpenter's Table"); later tiers
  // already read "Carpenter's Table (Tier 2)" in the mod's own Localization
  // file -- only the base tier needs a suffix synthesized here.
  function workstationDisplayName(name) {
    const base = displayName(name);
    const info = tierInfo[name];
    return info && info.tierIndex === 0 && !/\(Tier \d+\)/.test(base) ? `${base} (Tier 1)` : base;
  }

  // Anything with real acquisition/harvest/recycle data but no recipe,
  // research, or workstation identity of its own -- e.g. a "Desktop PC"
  // that's only ever a Recycler *output*, never craftable, researchable, or
  // buildable. Without this, such a name would have data but no page:
  // unsearchable (never in `index` below), and unclickable everywhere it
  // shows up as an ingredient (see isKnownName/jumpSpan).
  const orphanCandidates = new Set([
    ...Object.keys(data.acquisition || {}),
    ...Object.keys(data.harvestSources || {}),
    ...Object.keys(data.recycleYields || {}),
    ...Object.keys(data.recycleSources || {}),
    ...Object.keys(data.scrapYields || {}),
    ...Object.values(data.scrapYields || {}).map((s) => s.name),
    // Weapon/armor mods (item_modifiers.xml) -- some have no acquisition
    // channel this app tracks at all, so without their own explicit list
    // they'd be invisible even though they're real, ownable things (e.g.
    // "Ball Cap Mod").
    ...(data.itemMods || []),
    // Vehicle body styles: the buildable ones (Comet Minibike, etc.) are
    // already a real recipe and covered above, but the "find it broken down
    // in a POI and repair it" cars (Sedan, SUV, Ambulance...) have no
    // recipe/research/acquisition entry at all -- they're placed directly
    // in world prefabs, a channel this app doesn't otherwise model.
    ...Object.keys(data.vehicles || {}),
  ]);
  // A vehicle recolor (e.g. 14 different paint jobs of the Renegade, each
  // independently purchasable from a trader) shares its representative's
  // exact display name but carries none of its stats -- indexing it
  // separately would produce a wall of identically-labeled "Renegade"
  // results where only one is ever the real page. Excluded from the
  // browsable index entirely; __cookbookJump below redirects any direct
  // reference straight to the representative instead.
  const vehicleColorVariantOf = data.vehicleColorVariants || {};
  const itemOnlyNames = new Set(
    [...orphanCandidates].filter(
      (name) =>
        !stationFamilyNames.has(name) &&
        !data.recipesByName[name] &&
        !data.research[name] &&
        !vehicleColorVariantOf[name]
    )
  );

  const isKnownName = (name) =>
    !!(
      stationFamilyNames.has(name) ||
      data.recipesByName[name] ||
      data.research[name] ||
      itemOnlyNames.has(name) ||
      vehicleColorVariantOf[name]
    );

  // ---------------------------------------------------------------------
  // Build a flat searchable index: one entry per item name, kind = recipe/research/workstation/item.
  // A name can be more than one kind at once (e.g. a recipe whose output is also a research node name).
  // ---------------------------------------------------------------------
  const index = [];
  for (const name of Object.keys(data.recipesByName)) {
    if (stationFamilyNames.has(name)) continue; // browsed under Workstations instead
    index.push({ name, kind: "recipe", variantCount: data.recipesByName[name].length });
  }
  for (const name of Object.keys(data.research)) {
    index.push({ name, kind: "research" });
  }
  for (const name of stationFamilyNames) {
    index.push({ name, kind: "workstation" });
  }
  for (const name of itemOnlyNames) {
    index.push({ name, kind: "item" });
  }
  index.sort((a, b) => {
    const la = a.kind === "workstation" ? workstationDisplayName(a.name) : displayName(a.name);
    const lb = b.kind === "workstation" ? workstationDisplayName(b.name) : displayName(b.name);
    return la.localeCompare(lb);
  });

  let activeFilter = "all";
  let selectedKey = null;

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "recipe", label: "Recipes" },
    { key: "research", label: "Research" },
    { key: "workstation", label: "Workstations" },
    { key: "item", label: "Items" },
  ];
  filtersEl.innerHTML = FILTERS.map(
    (f) => `<button class="filter-btn${f.key === activeFilter ? " active" : ""}" data-filter="${f.key}">${f.label}</button>`
  ).join("");
  filtersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".filter-btn");
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    filtersEl.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b === btn));
    renderResults();
  });

  // ---------------------------------------------------------------------
  // Results list
  // ---------------------------------------------------------------------
  function renderResults() {
    searchClearEl.hidden = !searchEl.value;
    const q = searchEl.value.trim().toLowerCase();
    const rows = index.filter((entry) => {
      if (activeFilter !== "all" && entry.kind !== activeFilter) return false;
      if (!q) return true;
      return (
        displayName(entry.name).toLowerCase().includes(q) ||
        entry.name.toLowerCase().includes(q)
      );
    });

    if (rows.length === 0) {
      resultsEl.innerHTML = `<div class="detail-empty">No matches.</div>`;
      return;
    }

    // Safety cap well above the current dataset size (~1,600 rows total) so
    // nothing renders thousands of DOM nodes if the mod grows a lot. Never
    // silent: if it ever actually truncates, a note says so instead of the
    // list just stopping partway through the alphabet with no explanation.
    const RENDER_CAP = 2000;
    const truncated = rows.length > RENDER_CAP;

    resultsEl.innerHTML = rows
      .slice(0, RENDER_CAP)
      .map((entry) => {
        const key = entry.kind + ":" + entry.name;
        const variantBadge =
          entry.variantCount > 1 ? `<span class="variant-count">${entry.variantCount}</span>` : "";
        const label = entry.kind === "workstation" ? workstationDisplayName(entry.name) : displayName(entry.name);
        let iconAndName;
        if (entry.kind === "research") {
          iconAndName = researchChip(entry.name, label, "result-icon", "result-name");
        } else {
          const icon = iconFor(entry.name);
          // The results list is the main browse view, not an ingredient
          // list or the Workstations panel, so a workstation entry gets its
          // icon ring here -- that "it's just an item" exception is scoped
          // to those two other contexts specifically.
          const ringClass = entry.kind === "workstation" ? " icon-ring-workstation" : "";
          const iconTag = icon
            ? `<img class="result-icon${ringClass}" src="${icon}" alt="">`
            : `<span class="result-icon placeholder"></span>`;
          const textClass = entry.kind === "workstation" || entry.kind === "recipe" ? ` text-${entry.kind}` : "";
          iconAndName = `${iconTag}<span class="result-name${textClass}">${label}</span>`;
        }
        return (
          `<div class="result-row result-row-${entry.kind}${key === selectedKey ? " selected" : ""}" data-key="${key}">` +
          iconAndName +
          `<span class="result-kind result-kind-${entry.kind}">${entry.kind}</span>` +
          variantBadge +
          `</div>`
        );
      })
      .join("");

    if (truncated) {
      resultsEl.innerHTML +=
        `<div class="detail-empty">Showing first ${RENDER_CAP} of ${rows.length} matches -- ` +
        `narrow your search to see more.</div>`;
    }
  }

  resultsEl.addEventListener("click", (e) => {
    const row = e.target.closest(".result-row");
    if (!row) return;
    selectByKey(row.dataset.key);
  });

  searchEl.addEventListener("input", renderResults);

  searchClearEl.addEventListener("click", () => {
    searchEl.value = "";
    activeFilter = "all";
    filtersEl.querySelectorAll(".filter-btn").forEach((b) => b.classList.toggle("active", b.dataset.filter === "all"));
    renderResults();
    searchEl.focus();
  });

  // ---------------------------------------------------------------------
  // Detail panel
  // ---------------------------------------------------------------------
  function selectByKey(key) {
    selectedKey = key;
    renderResults();
    const [kind, name] = key.split(/:(.+)/); // split on first colon only
    openReport(kind, name, null);
  }

  // Jump to an ingredient/tool/station by internal name: workstation tiers
  // first (a tier-1 name is also a real recipe, but it's browsed as a
  // workstation now -- see stationFamilyNames), then recipe, then research.
  window.__cookbookJump = function (name) {
    if (vehicleColorVariantOf[name]) name = vehicleColorVariantOf[name];
    if (stationFamilyNames.has(name)) selectByKey("workstation:" + name);
    else if (data.recipesByName[name]) selectByKey("recipe:" + name);
    else if (data.research[name]) selectByKey("research:" + name);
    else if (itemOnlyNames.has(name)) selectByKey("item:" + name);
  };

  // "Where do I get this" source modal -- shared by Harvest Sources
  // (data.harvestSources) and Recycle Sources (data.recycleSources), since
  // both are the exact same shape: rendered straight from data built once
  // at build time, rows pre-sorted by expected yield and pre-bucketed into
  // a "tier" of high/medium/low (relative to the best source for that same
  // item), so this only groups by that field and formats -- no computation
  // at click time either way.
  function hideSourceModal() {
    sourceModalEl.hidden = true;
  }

  const SOURCE_TIER_SECTIONS = [
    { tier: "high", label: "High Yield" },
    { tier: "medium", label: "Medium Yield" },
    { tier: "low", label: "Low Yield" },
  ];

  // `subjectKey` names the field holding the source's own internal name --
  // "block" for a harvest source, "item" for a recycle source.
  function sourceRow(s, subjectKey) {
    const subject = s[subjectKey];
    const countLabel = s.countMin === s.countMax ? `${s.countMin}` : `${s.countMin}–${s.countMax}`;
    const bits = [];
    if (s.event && s.event !== "Harvest") bits.push(s.event.toLowerCase());
    if (s.prob < 1) bits.push(`${Math.round(s.prob * 100)}% chance`);
    const meta = bits.length ? `<span class="source-row-meta">${bits.join(", ")}</span>` : "";
    return `<li>${reportRowIcon(subject)}<span class="ing-count">${countLabel}&times;</span><span>${displayName(subject)}</span>${meta}</li>`;
  }

  // Generic "show this HTML in the shared overlay" primitive -- used by the
  // yield-source modal below AND the build-warnings list, so there's one
  // popup component in the DOM instead of a near-duplicate per feature.
  function openModal(title, bodyHtml) {
    sourceModalTitleEl.textContent = title;
    sourceModalBodyEl.innerHTML = bodyHtml;
    // hidden must come off BEFORE resetting scroll -- a display:none
    // element silently ignores scrollTop writes, so setting it first left
    // the previous modal's scroll position to reappear once unhidden.
    sourceModalEl.hidden = false;
    sourceModalBodyEl.scrollTop = 0;
  }

  function showSourceModal(title, sources, subjectKey) {
    const bodyHtml = SOURCE_TIER_SECTIONS.map(({ tier, label }) => {
      const rows = sources.filter((s) => s.tier === tier);
      if (!rows.length) return "";
      return (
        `<div class="section-label source-tier-label source-tier-label-${tier}">${label} (${rows.length})</div>` +
        `<ul class="ingredient-list">${rows.map((s) => sourceRow(s, subjectKey)).join("")}</ul>`
      );
    }).join("");
    openModal(title, bodyHtml);
  }

  window.__cookbookShowHarvest = function (name) {
    const sources = data.harvestSources && data.harvestSources[name];
    if (!sources || !sources.length) return;
    showSourceModal(`Harvest Sources — ${displayName(name)}`, sources, "block");
  };

  window.__cookbookShowRecycleSources = function (name) {
    const sources = data.recycleSources && data.recycleSources[name];
    if (!sources || !sources.length) return;
    showSourceModal(`Recycle Sources — ${displayName(name)}`, sources, "item");
  };

  window.__cookbookShowScrapSources = function (name) {
    const sources = data.scrapSources && data.scrapSources[name];
    if (!sources || !sources.length) return;
    showSourceModal(`Scrap Sources — ${displayName(name)}`, sources, "item");
  };

  // Loot Sources -- a different shape from Harvest/Recycle above (no
  // count, no tier bucket): one row per lootcontainer this item is
  // reachable from, each with the block(s)/killed entity(ies) that
  // actually lead there, plus its full GATE CHAIN (see build.js's
  // loadLootSources/flattenLootGroup comments) -- structural reachability,
  // not verified odds. A stage-dependent gate is a named curve over loot
  // stage (Custom/loot_templates.xml, shipped as data.lootProbTemplates),
  // so unlike Harvest/Recycle this one IS interactive: the stage buttons
  // re-render the same rows against a different point on those curves, a
  // handful of array lookups multiplied together, not a rebuild.
  //
  // Why a CHAIN and not one number: a whole weapon tier is routinely
  // gated by a loot_prob_template on the REFERENCE to its group (e.g.
  // groupRanged's own <item group="groupRangedT1"
  // loot_prob_template="ProbT1"/>), not on the weapon itself -- the AK-47's
  // own <item> line carries no gate at all. Showing only a leaf's own line
  // (an earlier version of this feature did) made every weapon read as
  // unconditionally "guaranteed" regardless of loot stage, which is wrong
  // -- at loot stage 0 the real answer is "you cannot get this," because
  // ProbT1 is 0% below stage 10. Each gate in the chain is modeled as an
  // independent access check, multiplied together for the combined chance.
  // NOT round numbers -- the actual loot stage where the next weapon/tool/
  // armor tier switches on. Every tier's gate curve (ProbT0-ProbT3 for
  // weapons/tools, the near-identical Tier1-Tier5 for armor/headgear) is
  // exactly 0% below its own onset stage, then turns on -- e.g. ProbT1
  // (the AK-47's own tier) is 0% below stage 10, not some smooth ramp from
  // 0. Checked directly against Custom/loot_templates.xml's own bins:
  // T0/Tier1 always on, T1/Tier2 @10, T2/Tier3 @49, T3/Tier4 @89, Tier5
  // (armor's extra top tier) @129 -- the exact bin boundaries, not rounded,
  // so every button lands right on a real transition instead of a stage or
  // two into it. An arbitrary 0/50/100/150/200 split landed close to some
  // of these by chance but missed stage 10 entirely -- "can't get this at
  // all" to "now possible" is the single most dramatic jump on the whole
  // curve, and a round-number picker skipped right over it.
  const LOOT_STAGE_TIERS = [0, 10, 49, 89, 129];
  // Same tier KEYS and section styling as SOURCE_TIER_SECTIONS (Harvest/
  // Recycle) -- "Chance" instead of "Yield" in the label, since this is
  // about how likely a source is, not how much it gives.
  const LOOT_TIER_SECTIONS = [
    { tier: "high", label: "High Chance" },
    { tier: "medium", label: "Medium Chance" },
    { tier: "low", label: "Low Chance" },
  ];

  // Clamps to the nearest defined bin rather than failing outside a
  // template's own authored range -- several flat templates (e.g. "high")
  // only bother defining "level=1,999999", leaving stage 0 technically
  // undefined even though the template obviously doesn't vary by stage in
  // any range that matters. Only a genuinely malformed/missing template
  // (not shipped in data.lootProbTemplates at all) returns null.
  function lootProbAtStage(templateName, stage) {
    const bins = data.lootProbTemplates && data.lootProbTemplates[templateName];
    if (!bins || !bins.length) return null;
    const hit = bins.find(([lo, hi]) => stage >= lo && stage <= hi);
    if (hit) return hit[2];
    const sorted = bins.slice().sort((a, b) => a[0] - b[0]);
    return stage < sorted[0][0] ? sorted[0][2] : sorted[sorted.length - 1][2];
  }

  // Multiplies every gate's resolved value at `stage` -- see this
  // section's header comment for why a chain of independent checks, not a
  // single number, is the right model here.
  function lootCombinedChanceAtStage(gates, stage) {
    let combined = 1;
    for (const [prob, template] of gates) {
      if (template) {
        const p = lootProbAtStage(template, stage);
        if (p === null) return null;
        combined *= p;
      } else {
        combined *= prob;
      }
    }
    return combined;
  }

  // null = "no gate at all" (unconditional) reads as 1; an unresolvable
  // template lookup reads as null (kept distinct from a real, computed 0).
  function lootChanceAtStage(row, stage) {
    return row.gates.length ? lootCombinedChanceAtStage(row.gates, stage) : 1;
  }

  // High/Medium/Low, exactly like Harvest/Recycle Sources' own tiering
  // (see sortAndTierSources in build.js) -- same thresholds, relative to
  // the best source for the SAME item, so a lone 2% source still reads as
  // "High" when nothing better exists. The one difference from Harvest/
  // Recycle: this has to be computed here, live, per stage button click,
  // rather than baked in at build time, since "best" depends on which
  // loot stage is selected.
  function lootTierFor(p, best) {
    if (best <= 0) return "low";
    const ratio = p / best;
    return ratio >= 0.5 ? "high" : ratio >= 0.15 ? "medium" : "low";
  }

  // Dedupes by DISPLAY name, not internal name -- e.g. Elliannia's Stash
  // is authored as two internal block names (a secure/insecure pair) that
  // read identically to a player, so showing it twice under the same
  // heading is noise, not two different places to look. Returns
  // [internalName, label] pairs, first-seen internal name wins per label.
  function lootDedupedNames(names) {
    const seen = new Set();
    const out = [];
    for (const n of names) {
      const label = displayName(n);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push([n, label]);
    }
    return out;
  }

  function lootNameListHtml(pairs) {
    if (!pairs.length) return "";
    return `<ul class="ingredient-list loot-flat-list">${pairs
      .map(([n, label]) => `<li>${reportRowIcon(n)}<span>${label}</span></li>`)
      .join("")}</ul>`;
  }

  function lootSourcesModalHtml(name, stage) {
    const rows = (data.lootSources && data.lootSources[name]) || [];
    // A row this item's own gate chain rules out entirely at this stage
    // (e.g. an AK-47 below loot stage 10 -- its tier's own gate is a flat
    // 0%) is dropped, not shown at all: it isn't a real source at this
    // stage, and listing dead rows just to say so is noise, not help.
    // Filtered on the ROUNDED percent, not the raw float -- a chance small
    // enough to still display as 0% is just as much dead-row noise as an
    // exact 0.
    const withChance = rows
      .map((r) => [r, lootChanceAtStage(r, stage)])
      .filter(([, p]) => p === null || Math.round(p * 100) > 0);

    const stageBar =
      `<div class="loot-stage-bar">Loot stage: ` +
      LOOT_STAGE_TIERS.map(
        (s) =>
          `<button type="button" class="loot-stage-btn${s === stage ? " loot-stage-btn-active" : ""}" ` +
          `onclick="window.__cookbookShowLoot('${name.replace(/'/g, "\\'")}', ${s})">${s}</button>`
      ).join("") +
      `</div>`;

    if (!withChance.length) {
      return stageBar + `<div class="loot-empty-note">Not obtainable from any known source at loot stage ${stage}.</div>`;
    }

    const best = Math.max(...withChance.map(([, p]) => p ?? 0));
    const tiered = withChance.map(([r, p]) => [r, p === null ? "low" : lootTierFor(p, best)]);

    // Flattened per tier -- across every container that landed in this
    // tier, one shared "Found In" list and one shared "Dropped By" list,
    // rather than repeating those headings once per container. A
    // container's own identity was never the point; where to look and
    // what to kill are.
    const body = LOOT_TIER_SECTIONS.map(({ tier, label }) => {
      const inTier = tiered.filter(([, t]) => t === tier).map(([r]) => r);
      if (!inTier.length) return "";
      const blocks = lootDedupedNames(inTier.flatMap((r) => r.blocks));
      const killedBy = lootDedupedNames(inTier.flatMap((r) => r.killedBy));
      let html = `<div class="section-label source-tier-label source-tier-label-${tier}">${label} (${blocks.length + killedBy.length})</div>`;
      if (blocks.length) html += `<div class="loot-subheader">Found In</div>${lootNameListHtml(blocks)}`;
      if (killedBy.length) html += `<div class="loot-subheader">Dropped By</div>${lootNameListHtml(killedBy)}`;
      return html;
    }).join("");
    return stageBar + body;
  }

  window.__cookbookShowLoot = function (name, stage) {
    const rows = data.lootSources && data.lootSources[name];
    if (!rows || !rows.length) return;
    openModal(`Loot Sources — ${displayName(name)}`, lootSourcesModalHtml(name, stage === undefined ? 49 : stage));
  };

  window.__cookbookShowWarnings = function () {
    const warnings = data.meta.warnings || [];
    if (!warnings.length) return;
    const bodyHtml = `<ul class="ingredient-list warnings-list">${warnings
      .map((w) => `<li class="warning-note">${w}</li>`)
      .join("")}</ul>`;
    openModal(`Build Warnings (${warnings.length})`, bodyHtml);
  };

  sourceModalCloseEl.addEventListener("click", hideSourceModal);
  sourceModalEl.addEventListener("click", (e) => {
    if (e.target === sourceModalEl) hideSourceModal();
  });

  // ---------------------------------------------------------------------
  // Research tree. The in-game tabs are NOT the 3 `area` values (those are
  // just which physical Research Station tier a node requires) -- walking
  // every node's `parent` chain up to its ultimate root instead produces 12
  // real category branches (e.g. "Primitive Archery", "Novice Mechanic").
  // In-game, one category is ONE continuous tree spanning all 3 tiers --
  // it's never split into 3 separate tier trees -- so each category renders
  // as a single canvas with every one of its nodes, tier shown only as a
  // color ring rather than a hard split.
  // ---------------------------------------------------------------------
  const researchRootCache = new Map();
  function researchRootOf(name) {
    if (researchRootCache.has(name)) return researchRootCache.get(name);
    researchRootCache.set(name, name); // cycle guard: resolves to itself if re-entered
    const node = data.research[name];
    const root = node && node.parent ? researchRootOf(node.parent) : name;
    researchRootCache.set(name, root);
    return root;
  }

  // Only each tree's root node carries its own `category` in the mod's data
  // (e.g. "Mechanic" on Novice Mechanic) -- every descendant's own field is
  // empty, so fall back to the root's via the same parent walk above. Shared
  // by the research detail page and the Research Tree category picker so
  // both show the same resolved value rather than the picker using the
  // root's display NAME ("Novice Mechanic") while the detail page uses its
  // CATEGORY ("Mechanic").
  function researchCategoryOf(name) {
    const node = data.research[name];
    if (!node) return null;
    return node.category || (data.research[researchRootOf(name)] || {}).category || null;
  }

  const researchTreeGroups = new Map(); // root -> [research node, ...] (all tiers combined)
  for (const [name, node] of Object.entries(data.research)) {
    if (!node.pos) continue; // no coordinate to plot -- can't appear on any canvas
    const root = researchRootOf(name);
    if (!researchTreeGroups.has(root)) researchTreeGroups.set(root, []);
    researchTreeGroups.get(root).push(node);
  }
  // Sorted by the same resolved category text the picker displays (falling
  // back to the root's own display name, same as researchCategoryOf's own
  // fallback), not the root's display name -- otherwise the dropdown's
  // order wouldn't match what it's showing.
  const researchCategories = [...researchTreeGroups.keys()].sort((a, b) =>
    (researchCategoryOf(a) || displayName(a)).localeCompare(researchCategoryOf(b) || displayName(b))
  );

  function tierOf(area) {
    const m = area && /_(\d+)$/.exec(area);
    return m ? m[1] : "other";
  }

  // `pos` is relative to the node's own DIRECT parent, not an absolute
  // canvas coordinate: e.g. all 4 children of ulmVehicleBicycle1 sit at x=2
  // with evenly spaced y (1.8/0.6/-0.6/-1.8), which only makes sense as
  // "offset from parent", and two unrelated nodes (ulmVehicleBicycle1,
  // ulmVehicleMinibikeOld) independently reuse the exact same pos="0,-4" --
  // impossible if these were shared absolute coordinates. So the real
  // position of any node is its parent's real position plus its own `pos`
  // delta, recursively -- walked across a category's FULL node set (every
  // tier at once), so a tier-2 node's parent living in tier 1 is always
  // found.
  function computeAbsolutePositions(nodes) {
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));
    const resolved = new Map();
    const inProgress = new Set();
    function abs(name) {
      if (resolved.has(name)) return resolved.get(name);
      const n = nodeByName.get(name);
      const [dx, rawDy] = n.pos.split(",").map(Number);
      // The game's own y axis runs the opposite way from SVG's -- a more
      // negative dy means further DOWN in-game -- flipped once at the
      // source so every accumulated position downstream comes out already
      // correct.
      const dy = -rawDy;
      let base = { x: 0, y: 0 };
      // Only the category's true root (no parent at all) or a cycle-guard
      // hit anchors at its own delta -- everything else's parent is now
      // guaranteed present in the same full-category node set.
      if (n.parent && nodeByName.has(n.parent) && !inProgress.has(n.parent)) {
        inProgress.add(name);
        base = abs(n.parent);
        inProgress.delete(name);
      }
      const result = { x: base.x + dx, y: base.y + dy };
      resolved.set(name, result);
      return result;
    }
    const positions = new Map();
    for (const n of nodes) positions.set(n.name, abs(n.name));
    return positions;
  }

  function renderResearchTreeSvg(root) {
    const nodes = researchTreeGroups.get(root) || [];
    if (!nodes.length) return `<div class="req-flag-dim">No nodes in this category.</div>`;

    // SCALE (grid-unit-to-pixel spacing, from the game's own `pos` deltas)
    // is fixed. Since a node only ever shows an icon and a name, ZOOM
    // instead just makes each node's own rendered elements
    // (circle/icon/text) bigger relative to that fixed grid spacing, so
    // there's less dead space between them -- the SVG is then displayed
    // fit-to-width (see .tree-svg's CSS) rather than at native pixel size,
    // so bigger elements mean a chunkier zoomed-out overview, not more
    // scrolling.
    const ZOOM = 2;
    const SCALE = 70;
    const PAD = 50 * ZOOM;
    const absPos = computeAbsolutePositions(nodes);
    const xs = [...absPos.values()].map((p) => p.x);
    const ys = [...absPos.values()].map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = (Math.max(...xs) - minX) * SCALE + PAD * 2;
    const height = (Math.max(...ys) - minY) * SCALE + PAD * 2;
    const posOf = (name) => {
      const p = absPos.get(name);
      return { x: (p.x - minX) * SCALE + PAD, y: (p.y - minY) * SCALE + PAD };
    };
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));

    // link_type="H" (335 of 588 nodes) correlates with a consistent, larger
    // horizontal position delta from the parent (e.g. dx=5 paired with a
    // small/varying dy) vs. the mostly-vertical deltas on unset nodes (e.g.
    // dx=0, dy=-2) -- read as a connector-ROUTING hint (an orthogonal elbow
    // bend, common in tech-tree UIs for keeping a wide sibling fan-out
    // tidy) rather than decoration. Not confirmed against the game's actual
    // (compiled) renderer.
    let edges = "";
    for (const n of nodes) {
      if (!n.parent || !nodeByName.has(n.parent)) continue;
      const p1 = posOf(n.parent);
      const p2 = posOf(n.name);
      if (n.link_type === "H") {
        const midX = (p1.x + p2.x) / 2;
        edges += `<path class="tree-edge" fill="none" d="M${p1.x},${p1.y} L${midX},${p1.y} L${midX},${p2.y} L${p2.x},${p2.y}"/>`;
      } else {
        edges += `<line class="tree-edge" x1="${p1.x}" y1="${p1.y}" x2="${p2.x}" y2="${p2.y}"/>`;
      }
    }

    let nodesHtml = "";
    for (const n of nodes) {
      const p = posOf(n.name);
      const r = (n.size === "large" ? 26 : 18) * ZOOM;
      const icon = iconForResearch(n.name);
      const cls =
        "tree-node" +
        ` tree-node-tier-${tierOf(n.area)}` +
        (n.size === "large" ? " tree-node-large" : "") +
        (n.unlocked ? " tree-node-unlocked" : "");
      nodesHtml += `<g class="${cls}" data-name="${n.name}" transform="translate(${p.x},${p.y})">`;
      nodesHtml += `<circle r="${r}"/>`;
      if (icon) nodesHtml += `<image href="${icon}" x="${-r * 0.7}" y="${-r * 0.7}" width="${r * 1.4}" height="${r * 1.4}"/>`;
      nodesHtml += `<text y="${r + 14 * ZOOM}" text-anchor="middle">${displayName(n.name)}</text>`;
      nodesHtml += `</g>`;
    }

    return (
      `<svg class="tree-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<g class="tree-edges">${edges}</g><g class="tree-nodes">${nodesHtml}</g></svg>`
    );
  }

  // ---------------------------------------------------------------------
  // Tier-agnostic workstation identity for a recipe: which physical
  // CRAFTING station (not the research-conducting bench -- a different
  // axis entirely, always ulmStationResearch_*) a recipe's own unlock
  // actually requires. Shared by the recipe grid's grouping below.

  // Almost every always-available station's own area tag IS its real
  // internal name (campfire, cementMixer both have their own name+icon
  // entry directly). "stove" is the one known exception: the tag has its
  // own (icon-less) name entry ("Stove"), but the real placeable item --
  // proper name ("Powered Stove") and a real icon -- lives under a
  // completely different internal name. Confirmed against what the main
  // search nav itself resolves "Powered Stove" to (data.names /
  // data.icons), not guessed.
  const AREA_DISPLAY_OVERRIDES = { stove: "ulmStationStovePoweredVariantHelper" };
  const workstationDisplayKeyFor = (key) => AREA_DISPLAY_OVERRIDES[key] || key;

  function workstationRowKeyFor(area) {
    if (area === null) return { key: "__backpack__", label: "Backpack", tiered: false };
    if (tierInfo[area]) {
      const root = tierInfo[area].familyTiers[0];
      return { key: root, label: displayName(root), tiered: true };
    }
    // Always-available (campfire/stove/cementMixer) and any other block
    // that simply never appears in data.upgrades are the same case here:
    // no tier axis, so no column to put it in.
    return { key: area, label: displayName(workstationDisplayKeyFor(area)), tiered: false };
  }

  // ---------------------------------------------------------------------
  // Research tree, recipe grid -- one category at a time: no research
  // nodes or connecting lines, just every distinct (recipe, workstation)
  // pair the category unlocks (deduped -- several research nodes can
  // unlock the same recipe; a recipe craftable at more than one station,
  // e.g. a campfire-or-stove variant, gets one dot in EACH of those
  // stations' own blocks -- see recipeGridGroups), grouped by
  // tier-agnostic crafting-workstation identity (workstationRowKeyFor
  // above), then packed into one compact rectangle.
  //
  // The packing itself (rgBlockShape/rgCells, plus the shelf-pack scoring
  // in rgPackBlocks) is the shared block-shape + shelf-pack algorithm from
  // compact-groups-approach.md, ported as-is: each workstation group
  // becomes its own near-square block of dots, and every block for the
  // category is then shelf-packed edge to edge by trying every candidate
  // total width and keeping whichever is closest to square with the least
  // wasted area. This replaced an earlier row-sharing approach that scored
  // purely on rounding waste -- that objective quietly rewarded pulling
  // groups apart into singletons (a lone group always has zero rounding
  // waste), fragmenting badly on real category data.
  //
  // Departure from the shared doc's own `layout()`: every block gets its
  // own HEADER band above its dots (icon + title, single line, left-
  // aligned, vertically centered against the icon), sized and shaped by
  // rgShapeGroup -- always exactly one grid row tall, same height as the
  // icon itself, that the dot grid below never shares. A long name can't
  // make the header taller (no wrapping) or encroach on a row of dots the
  // way an earlier multi-row "notch" design once let it -- it makes the
  // BLOCK WIDER instead, trading width for a header height that's always
  // consistent. rgBlockShape (a pure count -> near-square shape function)
  // has no notion of a header, so rgShapeGroup wraps it: it picks `cols`
  // as whichever is wider, the near-square shape for the dot count alone
  // or the header's own minimum width (icon + gap + the full title,
  // RG_MIN_BLOCK_COLS floor), then derives the dot rows directly.
  // rgPackBlocks is the same shelf-pack/scoring loop as the doc's
  // `layout()`, just taking already-shaped blocks instead of deriving each
  // one from its count alone.
  // ---------------------------------------------------------------------
  const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
  function rgLessThan(a, b) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return a[i] < b[i];
    }
    return false;
  }
  function rgBlockShape(n, maxAspect = 2) {
    if (n <= 0) return [0, 0];
    let best = null;
    for (let rows = 1; ; rows++) {
      const cols = ceilDiv(n, rows);
      if (rows > cols) break;
      if ((n < 3 || rows >= 2) && cols <= maxAspect * rows) {
        const key = [rows * cols - n, cols - rows];
        if (best === null || rgLessThan(key, best.key)) best = { key, rows, cols };
      }
    }
    if (best === null) {
      // maxAspect too strict for this n: fall back to square-ish
      let s = 0;
      while (s * s < n) s++;
      return [ceilDiv(n, s), s];
    }
    return [best.rows, best.cols];
  }
  function rgShelfPack(order, width, gap) {
    let x = 0, y = 0, shelfH = 0, usedW = 0;
    const pos = new Map();
    for (const b of order) {
      if (x > 0 && x + b.cols > width) {
        y += shelfH + gap;
        x = 0;
        shelfH = 0;
      }
      pos.set(b.index, [x, y]);
      usedW = Math.max(usedW, x + b.cols);
      shelfH = Math.max(shelfH, b.rows);
      x += b.cols + gap;
    }
    return { pos, usedW, usedH: y + shelfH };
  }
  // Packs already-shaped blocks ({index, count, rows, cols}) -- see the
  // header comment above for why the recipe grid shapes its own blocks
  // (rgShapeGroup) rather than calling rgBlockShape straight from a bare
  // count array the way the shared doc's `layout()` does.
  function rgPackBlocks(blocks, { gap = 1, targetW = 1, targetH = 1 } = {}) {
    const items = blocks.filter((g) => g.count > 0);
    if (items.length === 0) return { width: 0, height: 0, groups: blocks };
    // Tallest first, then widest, then input order (explicit tie-break).
    const order = [...items].sort((a, b) => b.rows - a.rows || b.cols - a.cols || a.index - b.index);
    const minW = Math.max(...items.map((g) => g.cols));
    const maxW = items.reduce((s, g) => s + g.cols, 0) + gap * (items.length - 1);
    let best = null;
    for (let w = minW; w <= maxW; w++) {
      const r = rgShelfPack(order, w, gap);
      const score = [Math.max(r.usedW * targetH, r.usedH * targetW), r.usedW * r.usedH, r.usedW];
      if (best === null || rgLessThan(score, best.score)) best = { score, ...r };
    }
    for (const g of items) [g.x, g.y] = best.pos.get(g.index);
    return { width: best.usedW, height: best.usedH, groups: blocks };
  }
  // Row-major dot placement, straight from the shared doc's `cells()` --
  // the header band lives entirely above row 0 of this (see
  // renderRecipeGridSvg's y-offset when calling this), so there's nothing
  // for it to skip here.
  function rgCells(group) {
    const out = [];
    for (let i = 0; i < group.count; i++) {
      out.push([group.x + (i % group.cols), group.y + Math.floor(i / group.cols)]);
    }
    return out;
  }

  // Every distinct (recipe, workstation) pair unlocked anywhere in this
  // category, bucketed by workstation family (tier-agnostic, via
  // workstationRowKeyFor above). A recipe with variants at more than one
  // station -- e.g. craftable at either a campfire or a stove -- gets one
  // dot in EACH of those stations' own groups, not just a single
  // "cheapest" one: this is a workstation census, not a shortest-path.
  //
  // Each item also carries `researchTier` -- the RESEARCH bench tier of
  // whichever node unlocks it (node.area, always ulmStationResearch_*),
  // a completely different axis from `tier` (the CRAFTING station tier
  // the recipe itself needs, node.area never enters into that at all).
  // The two usually move together but don't have to: nothing stops a
  // tier-1 research node from unlocking a recipe that needs a tier-2
  // station. A recipe unlocked by more than one node (rare) takes the
  // lowest research tier among them -- the earliest point it's actually
  // available, same "cheapest path" spirit as elsewhere in this file.
  function recipeGridGroups(root) {
    const nodes = researchTreeGroups.get(root) || [];
    const recipeNames = new Set();
    const researchTierByRecipe = new Map(); // name -> lowest 0-based research tier, or null
    for (const n of nodes) {
      const t = tierOf(n.area); // "1"/"2"/"3"/"other" -- research bench is always tiered in practice
      const rTier = t === "other" ? null : Number(t) - 1;
      for (const rn of researchUnlockedRecipeNames(n)) {
        recipeNames.add(rn);
        const prev = researchTierByRecipe.get(rn);
        if (prev === undefined || (rTier !== null && (prev === null || rTier < prev))) {
          researchTierByRecipe.set(rn, rTier);
        }
      }
    }
    const groups = new Map(); // rowKey -> { key, label, tiered, items: [{name, area, tier, researchTier}] }
    for (const name of recipeNames) {
      const areas = new Set();
      for (const rid of data.recipesByName[name]) areas.add(data.recipes[rid].area || null);
      const researchTier = researchTierByRecipe.get(name) ?? null;
      for (const area of areas) {
        const rowInfo = workstationRowKeyFor(area);
        const tier = rowInfo.tiered ? tierInfo[area].tierIndex : null;
        if (!groups.has(rowInfo.key)) {
          groups.set(rowInfo.key, { key: rowInfo.key, label: rowInfo.label, tiered: rowInfo.tiered, items: [] });
        }
        // area travels with the item (not just the group) so the hover
        // tooltip can resolve exactly which of a recipe's several variants
        // (e.g. craftable at both a tier-1 and tier-2 station) this
        // specific dot represents -- data.recipesByName[name] alone is
        // ambiguous whenever a recipe has more than one.
        groups.get(rowInfo.key).items.push({ name, area, tier, researchTier });
      }
    }
    return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
  }

  const RG_CELL = 24;
  const RG_DOT_R = 9;
  const RG_LEFT = 20;
  const RG_TOP = 20;
  const RG_MIN_BLOCK_COLS = 3; // header's own minimum width floor
  const RG_LABEL_ICON_GAP = 6; // px between the icon and the title text
  // Deliberately smaller than RG_CELL: the label names a whole block of
  // icons, not one, so it should read as secondary to them (see the
  // "scale of the workstation name" feedback that shrank this from 13 to
  // 11). Must match .rgrid-label text's own font-size in styles.css --
  // width is measured against this exact font, not just eyeballed.
  const RG_LABEL_FONT_SIZE = 11;
  const RG_LABEL_FONT = `${RG_LABEL_FONT_SIZE}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;

  let rgMeasureCtx = null;
  function rgMeasureTextWidth(text) {
    if (!rgMeasureCtx) rgMeasureCtx = document.createElement("canvas").getContext("2d");
    rgMeasureCtx.font = RG_LABEL_FONT;
    return rgMeasureCtx.measureText(text).width;
  }

  // Shapes one block: a header band (icon + title, single line, left-
  // aligned) stacked directly above a plain dot grid -- they never share a
  // row. The header is always exactly one grid row tall, same height as
  // its own icon, never taller no matter how long the name is -- a long
  // title instead makes the BLOCK WIDER (its minimum width grows to fit
  // the title on that one line), trading width for a consistent, never-
  // awkward header height instead of wrapping into extra rows.
  //
  // When the workstation has no resolvable icon (Backpack, or a station
  // missing from the icon set -- see recipeGridGroups), that icon node +
  // gap is dropped from the width measurement entirely rather than left
  // as blank space.
  //
  // `cols` is whichever is wider: the near-square shape rgBlockShape picks
  // for the dot count alone, or the header's own minimum width (icon + gap
  // + the full title, rounded up to whole columns, floored at
  // RG_MIN_BLOCK_COLS). `rows` is the header's one row plus however many
  // rows that many dots need at that final `cols` (recomputed directly,
  // not trusted from rgBlockShape's own row count, since growing `cols` to
  // fit the header can leave rgBlockShape's original row count too
  // generous).
  function rgShapeGroup(count, title, hasIcon) {
    const iconPx = hasIcon ? RG_CELL + RG_LABEL_ICON_GAP : 0;
    const headerMinCols = Math.max(RG_MIN_BLOCK_COLS, Math.ceil((iconPx + rgMeasureTextWidth(title)) / RG_CELL));

    const [, dotCols] = rgBlockShape(count);
    const cols = Math.max(dotCols, headerMinCols);
    const dotRows = Math.ceil(count / cols);
    const headerRows = 1;

    return { rows: headerRows + dotRows, cols, headerRows };
  }

  function renderRecipeGridSvg(root) {
    const groups = recipeGridGroups(root);
    if (!groups.length) return `<div class="req-flag-dim">No recipes unlocked in this category.</div>`;

    // Backpack has no station icon at all (see recipeGridGroups); any other
    // group falls back to whatever data.icons resolves for it -- null for
    // the rare station missing from the icon set (e.g. the stove), same
    // treatment as Backpack rather than a broken-looking gap.
    const icons = groups.map((g) => (g.key === "__backpack__" ? null : iconFor(workstationDisplayKeyFor(g.key))));
    // The header icon gets the same ring/fill treatment as a recipe dot:
    // ring = whether this is a tiered family at all (it always shows that
    // family's OWN tier-1 icon -- see workstationRowKeyFor -- so "tier 1"
    // is the only ring value a tiered family could ever have here; a
    // non-tiered/always-available station rings "unlocked", same as its
    // own recipes do); fill = the research tier that unlocks BUILDING this
    // station in the first place (reportEngine.findResearchFor resolves a
    // block name back to whichever node's <unlocks> names it), a genuinely
    // different piece of information from any one recipe's own research
    // tier. Backpack isn't a placeable/craftable station, so there's
    // nothing to look up for it.
    const headerBuildResearchTiers = groups.map((g) => {
      if (g.key === "__backpack__") return null;
      const node = reportEngine.findResearchFor(workstationDisplayKeyFor(g.key));
      if (!node) return null;
      const t = tierOf(node.area);
      return t === "other" ? null : Number(t) - 1;
    });
    // Just the name -- the dots themselves already show the count visually,
    // repeating it as text would be redundant.
    const shapes = groups.map((g, i) => rgShapeGroup(g.items.length, g.label, !!icons[i]));
    const blocks = groups.map((g, i) => ({
      index: i,
      count: g.items.length,
      cols: shapes[i].cols,
      rows: shapes[i].rows,
      x: 0,
      y: 0,
    }));
    // Targeting a square overall shape (the default, and what the shared
    // doc itself uses) packs into a roughly 1:1 rectangle regardless of
    // where it'll actually be displayed -- fine on a square viewport, but
    // tree-canvas-wrap is a wide modal pane (~1.3:1 or more), so a square
    // result leaves the fit-to-height view with dead space down both
    // sides. Targeting the wrap's own live aspect ratio instead packs a
    // shape that actually fills it. Falls back to a plain square only if
    // the wrap has no real size yet (shouldn't happen -- this only ever
    // renders while the modal is already visible).
    const wrapW = treeCanvasWrapEl.clientWidth || 1;
    const wrapH = treeCanvasWrapEl.clientHeight || 1;
    const plan = rgPackBlocks(blocks, { gap: 1, targetW: wrapW, targetH: wrapH });

    let nodesHtml = "";
    let labelsHtml = "";
    plan.groups.forEach((g, gi) => {
      if (!g.count) return;
      const group = groups[gi];
      const shape = shapes[gi];
      // Sorted ascending (unlocked/no-tier last) by whichever tier axis is
      // currently selected (see the sort toggle/setRecipeSort) -- fills row
      // by row, so the block reads that axis's tier 1 at the top down to
      // tier 3 at the bottom. Switching to "research tier" is what surfaces
      // a recipe you can research early but that needs a high workstation
      // tier: it floats to the top of the block while its ring still shows
      // the (high) station tier it actually needs, instead of blending in
      // sorted by that same station tier.
      const sortKey = treeState.recipeSort === "research" ? "researchTier" : "tier";
      const sortedItems = [...group.items].sort(
        (a, b) => (a[sortKey] === null ? 99 : a[sortKey]) - (b[sortKey] === null ? 99 : b[sortKey])
      );
      // Dots start right below the header band, never inside it -- see
      // rgShapeGroup/the header comment above for why.
      const pts = rgCells({ ...g, y: g.y + shape.headerRows });
      pts.forEach(([cx, cy], i) => {
        const item = sortedItems[i];
        // Ring: same tier-color convention as the research tree's own
        // nodes (.tree-node-tier-N/-unlocked, reused directly) -- the
        // CRAFTING station tier this specific recipe needs. item.tier is
        // 0-based (0..2) here, those classes are 1-based (tier 1..3).
        const tierCls = item.tier === null ? "tree-node-unlocked" : `tree-node-tier-${item.tier + 1}`;
        // Fill: a separate, subtle tint for the RESEARCH bench tier that
        // unlocked it -- a different axis from the ring (see
        // recipeGridGroups), so it gets its own class rather than
        // overloading tierCls.
        const researchTierCls =
          item.researchTier === null ? "rgrid-fill-tier-none" : `rgrid-fill-tier-${item.researchTier}`;
        const recipeIcon = iconFor(item.name);
        const x = (RG_LEFT + cx * RG_CELL + RG_CELL / 2).toFixed(1);
        const y = (RG_TOP + cy * RG_CELL + RG_CELL / 2).toFixed(1);
        // data-area (omitted entirely when null, rather than an empty
        // string, so the tooltip can tell "no area" apart from "attribute
        // just wasn't read yet") resolves exactly which recipe variant
        // this dot is, since data.recipesByName[name] alone can hold
        // several -- see showRecipeDotTooltip.
        const areaAttr = item.area === null ? "" : ` data-area="${item.area}"`;
        nodesHtml += `<g class="tree-node rgrid-node ${tierCls} ${researchTierCls}" data-name="${item.name}"${areaAttr} transform="translate(${x},${y})">`;
        nodesHtml += `<circle r="${RG_DOT_R}"/>`;
        if (recipeIcon) {
          nodesHtml += `<image href="${recipeIcon}" x="${(-RG_DOT_R * 0.7).toFixed(1)}" y="${(-RG_DOT_R * 0.7).toFixed(1)}" width="${(RG_DOT_R * 1.4).toFixed(1)}" height="${(RG_DOT_R * 1.4).toFixed(1)}"/>`;
        }
        nodesHtml += `</g>`;
      });

      // Header band: top-left of the block, icon then title -- own reserved
      // rows the dot grid below never shares. When there's no resolvable
      // icon, the title starts right at the block's own left edge instead
      // of leaving a blank gap where the icon would have sat (rgShapeGroup
      // already dropped that space from every measurement to match).
      const icon = icons[gi];
      const blockX0 = RG_LEFT + g.x * RG_CELL;
      const labelTopY = RG_TOP + g.y * RG_CELL;
      labelsHtml += `<g class="rgrid-label">`;
      if (icon) {
        // Same ring/fill treatment as a recipe dot -- see the
        // headerBuildResearchTiers comment above for what each one means
        // here. rgrid-label-icon-bg still supplies the base panel-alt
        // fill/neutral border as a fallback; these classes' higher
        // selector specificity (class+element vs. this circle's own single
        // class) overrides both once applied, same as it does for a dot.
        const ringCls = group.tiered ? "tree-node-tier-1" : "tree-node-unlocked";
        const buildResearchTier = headerBuildResearchTiers[gi];
        const fillCls = buildResearchTier === null ? "rgrid-fill-tier-none" : `rgrid-fill-tier-${buildResearchTier}`;
        const iconR = RG_CELL / 2 - 1;
        const iconCx = blockX0 + RG_CELL / 2;
        const iconCy = labelTopY + RG_CELL / 2;
        labelsHtml += `<g class="${ringCls} ${fillCls}" transform="translate(${iconCx.toFixed(1)},${iconCy.toFixed(1)})">`;
        labelsHtml += `<circle class="rgrid-label-icon-bg" r="${iconR}"/>`;
        labelsHtml += `<image href="${icon}" x="${(-iconR * 0.8).toFixed(1)}" y="${(-iconR * 0.8).toFixed(1)}" width="${(iconR * 1.6).toFixed(1)}" height="${(iconR * 1.6).toFixed(1)}"/>`;
        labelsHtml += `</g>`;
      }
      const titleX = (icon ? blockX0 + RG_CELL + RG_LABEL_ICON_GAP : blockX0).toFixed(1);
      // Vertically centered in the header row, same as the icon: baseline
      // sits a bit below the row's own midline by roughly a cap-height, the
      // usual approximation for centering a single line of text in a box.
      const baselineY = (labelTopY + RG_CELL / 2 + RG_LABEL_FONT_SIZE * 0.35).toFixed(1);
      labelsHtml += `<text x="${titleX}" y="${baselineY}">${group.label}</text></g>`;
    });

    const totalWidth = RG_LEFT * 2 + plan.width * RG_CELL;
    const totalHeight = RG_TOP * 2 + plan.height * RG_CELL;
    return (
      `<svg class="tree-svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="${totalWidth}" height="${totalHeight}">` +
      `<g class="tree-nodes">${nodesHtml}</g>${labelsHtml}</svg>`
    );
  }

  // recipeSort only matters in "recipes" mode: "tier" (workstation tier,
  // the default) or "research" (research bench tier) -- see the sort
  // toggle wiring and renderRecipeGridSvg's sort of each block's items.
  const treeState = { root: null, mode: "tree", recipeSort: "tier" };
  // Pan/zoom is plain CSS transform on tree-canvas-inner, driven entirely
  // from here -- .tree-canvas-wrap has no native scrollbars (overflow:
  // hidden) so this is the only way to navigate a tree bigger than the
  // viewport. Natural (untransformed) pixel size of the current SVG, needed
  // to compute a fit-to-view scale -- read off the rendered <svg>'s own
  // width/height attributes rather than recomputed, so this never drifts
  // out of sync with renderResearchTreeSvg's own math.
  const treeView = { scale: 1, x: 0, y: 0 };
  let treeNaturalWidth = 0;
  let treeNaturalHeight = 0;

  function clampTreeScale(s) {
    return Math.min(5, Math.max(0.15, s));
  }

  // No pulling the tree past its own edges: centers it on whichever axis
  // the (scaled) content is smaller than the viewport, and otherwise caps
  // panning so the content's edge can reach the viewport's edge but never
  // pull away from it into empty space.
  function clampTreePan() {
    const wrapW = treeCanvasWrapEl.clientWidth;
    const wrapH = treeCanvasWrapEl.clientHeight;
    const contentW = treeNaturalWidth * treeView.scale;
    const contentH = treeNaturalHeight * treeView.scale;
    treeView.x =
      contentW <= wrapW ? (wrapW - contentW) / 2 : Math.min(0, Math.max(wrapW - contentW, treeView.x));
    treeView.y =
      contentH <= wrapH ? (wrapH - contentH) / 2 : Math.min(0, Math.max(wrapH - contentH, treeView.y));
  }

  function applyTreeTransform() {
    clampTreePan();
    treeCanvasInnerEl.style.transform = `translate(${treeView.x}px, ${treeView.y}px) scale(${treeView.scale})`;
    // CSS transform only ever changes paint position, never layout size --
    // tree-canvas-inner's actual (untransformed) layout box is the full
    // natural size of the tree, e.g. 2000px+ square, vastly bigger than
    // tree-canvas-wrap. overflow:hidden stops the user from scrolling that
    // via wheel/scrollbar, but the wrap is still technically scrollable, so
    // clicking a +/-/Fit button focuses it and the browser's default
    // focus-scroll-into-view kicks in, silently offsetting scrollTop/Left
    // out from under this transform. Zeroing them every update is what
    // actually keeps the pan/zoom math and the visible result in sync.
    treeCanvasWrapEl.scrollTop = 0;
    treeCanvasWrapEl.scrollLeft = 0;
  }

  // Default view: the whole tree/grid fit to the viewport on WHICHEVER
  // axis is more constraining (width or height), upscaled past 1x when
  // the content is smaller than the viewport on both -- capped at
  // clampTreeScale's usual 5x ceiling, same as manual zoom, rather than
  // hard-capped at 1x. That 1x cap made sense back when this only ever
  // fit the research tree (almost always bigger than the viewport, so it
  // rarely mattered) but left the much smaller recipe grid stranded tiny
  // in the middle of a wide, mostly-empty modal for most categories,
  // never actually filling the space "Fit" implies it should.
  // x/y just need a starting value here -- clampTreePan() (inside
  // applyTreeTransform) does the actual centering/bounding. Re-run every
  // time the modal opens, not just on first render, so a window resize
  // while it was closed doesn't leave a stale fit.
  function fitTreeView() {
    const wrapW = treeCanvasWrapEl.clientWidth;
    const wrapH = treeCanvasWrapEl.clientHeight;
    if (!treeNaturalWidth || !treeNaturalHeight || !wrapW || !wrapH) return;
    treeView.scale = clampTreeScale(Math.min(wrapW / treeNaturalWidth, wrapH / treeNaturalHeight));
    treeView.x = 0;
    treeView.y = 0;
    applyTreeTransform();
  }

  // Rescales around a fixed screen point (clientX/clientY) -- the point
  // under the cursor (wheel zoom) or the viewport's own center (+/-
  // buttons) stays visually still while everything around it scales.
  function zoomTreeAt(factor, clientX, clientY) {
    const rect = treeCanvasWrapEl.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const canvasX = (px - treeView.x) / treeView.scale;
    const canvasY = (py - treeView.y) / treeView.scale;
    treeView.scale = clampTreeScale(treeView.scale * factor);
    treeView.x = px - canvasX * treeView.scale;
    treeView.y = py - canvasY * treeView.scale;
    applyTreeTransform();
  }

  function renderTreeCanvas() {
    hideTreeNodeTooltip();
    treeCanvasInnerEl.innerHTML =
      treeState.mode === "recipes" ? renderRecipeGridSvg(treeState.root) : renderResearchTreeSvg(treeState.root);
    const svg = treeCanvasInnerEl.querySelector("svg");
    treeNaturalWidth = svg ? parseFloat(svg.getAttribute("width")) || 0 : 0;
    treeNaturalHeight = svg ? parseFloat(svg.getAttribute("height")) || 0 : 0;
    fitTreeView();
  }

  // Two lenses on one category at a time, picked with the same category
  // dropdown (always visible, not toggled by mode): the connected research
  // tree (renderResearchTreeSvg, tier shown as a ring color) or the recipe
  // grid (renderRecipeGridSvg, tier shown as dot color).
  function setTreeMode(mode) {
    if (treeState.mode === mode) return;
    treeState.mode = mode;
    treeModeTreeBtnEl.setAttribute("aria-pressed", String(mode === "tree"));
    treeModeRecipesBtnEl.setAttribute("aria-pressed", String(mode === "recipes"));
    // Recipe grid dots carry a second, independent tier signal (the subtle
    // background fill -- see recipeGridGroups/renderRecipeGridSvg) that
    // the research tree's own nodes don't have at all, so the legend only
    // explains ring-vs-fill in that mode.
    treeTierLegendEl.classList.toggle("tree-legend-mode-recipes", mode === "recipes");
    // Sort order only means anything for the recipe grid's own per-block
    // dot layout -- the research tree has no equivalent concept.
    treeSortToggleEl.hidden = mode !== "recipes";
    renderTreeCanvas();
  }

  // Which tier axis orders the dots within each recipe-grid block --
  // "tier" (workstation, the default) or "research" (research bench).
  // Switching to research tier is what surfaces a recipe you can research
  // early that still needs a high-tier workstation: sorted by research
  // tier, it floats toward the top of its block while its ring still shows
  // the (high) station tier, instead of sinking to the bottom sorted by
  // that same station tier.
  function setRecipeSort(sortBy) {
    if (treeState.recipeSort === sortBy) return;
    treeState.recipeSort = sortBy;
    treeSortTierBtnEl.setAttribute("aria-pressed", String(sortBy === "tier"));
    treeSortResearchBtnEl.setAttribute("aria-pressed", String(sortBy === "research"));
    renderTreeCanvas();
  }

  // Category picker -- a hand-built dropdown, not a native <select>, since
  // this is the one picker in the app where showing each choice's icon
  // actually matters (a bare category name reads far slower than its
  // familiar research-tree symbol). See .icon-select in styles.css.
  // Category roots are research nodes, so their icon should follow the same
  // "tree symbol first" preference as everywhere else research is shown
  // (see iconForResearch) -- not the plain ingredient-icon lookup.
  function treeCategoryIconHtml(root) {
    const icon = iconForResearch(root);
    return icon
      ? `<img class="icon-select-option-icon" src="${icon}" alt="">`
      : `<span class="icon-select-option-icon icon-select-option-icon-placeholder"></span>`;
  }

  function closeTreeCategoryMenu() {
    treeCategoryMenuEl.hidden = true;
    treeCategoryBtnEl.setAttribute("aria-expanded", "false");
  }

  function openTreeCategoryMenu() {
    treeCategoryMenuEl.hidden = false;
    treeCategoryBtnEl.setAttribute("aria-expanded", "true");
    const current = treeCategoryMenuEl.querySelector('[aria-selected="true"]');
    (current || treeCategoryMenuEl.firstElementChild)?.focus();
  }

  function selectTreeCategory(root) {
    treeState.root = root;
    treeCategoryBtnIconEl.innerHTML = treeCategoryIconHtml(root);
    treeCategoryBtnLabelEl.textContent = `${researchCategoryOf(root) || displayName(root)} (${researchTreeGroups.get(root).length})`;
    for (const opt of treeCategoryMenuEl.children) {
      opt.setAttribute("aria-selected", String(opt.dataset.root === root));
    }
    renderTreeCanvas();
  }

  function hideTreeModal() {
    treeModalEl.hidden = true;
    closeTreeCategoryMenu();
    hideTreeNodeTooltip();
  }

  function openTreeModal() {
    if (!treeCategoryMenuEl.children.length) {
      treeCategoryMenuEl.innerHTML = researchCategories
        .map(
          (root) =>
            `<button type="button" class="icon-select-option" role="option" data-root="${root}">` +
            `${treeCategoryIconHtml(root)}` +
            `<span>${researchCategoryOf(root) || displayName(root)} (${researchTreeGroups.get(root).length})</span></button>`
        )
        .join("");
      for (const opt of treeCategoryMenuEl.children) {
        opt.addEventListener("click", () => {
          selectTreeCategory(opt.dataset.root);
          closeTreeCategoryMenu();
          treeCategoryBtnEl.focus();
        });
      }
    }
    // Shown before selecting/fitting -- fitTreeView() needs the wrap's real
    // (non-zero) on-screen size, which a `hidden` element doesn't have.
    treeModalEl.hidden = false;
    if (!treeState.root) selectTreeCategory(researchCategories[0]);
    else fitTreeView();
  }

  treeModeTreeBtnEl.addEventListener("click", () => setTreeMode("tree"));
  treeModeRecipesBtnEl.addEventListener("click", () => setTreeMode("recipes"));
  treeSortTierBtnEl.addEventListener("click", () => setRecipeSort("tier"));
  treeSortResearchBtnEl.addEventListener("click", () => setRecipeSort("research"));

  treeBtnEl.addEventListener("click", openTreeModal);
  treeModalCloseEl.addEventListener("click", hideTreeModal);
  treeModalEl.addEventListener("click", (e) => {
    if (e.target === treeModalEl) hideTreeModal();
  });
  treeCategoryBtnEl.addEventListener("click", () => {
    if (treeCategoryMenuEl.hidden) openTreeCategoryMenu();
    else closeTreeCategoryMenu();
  });
  document.addEventListener("click", (e) => {
    if (!treeCategoryMenuEl.hidden && !e.target.closest("#tree-category-select")) closeTreeCategoryMenu();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !treeCategoryMenuEl.hidden) {
      closeTreeCategoryMenu();
      treeCategoryBtnEl.focus();
    }
  });

  treeZoomInEl.addEventListener("click", () => {
    const rect = treeCanvasWrapEl.getBoundingClientRect();
    zoomTreeAt(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  treeZoomOutEl.addEventListener("click", () => {
    const rect = treeCanvasWrapEl.getBoundingClientRect();
    zoomTreeAt(1 / 1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  treeZoomResetEl.addEventListener("click", fitTreeView);

  treeCanvasWrapEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomTreeAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // Click-drag panning via Pointer Events -- one code path for mouse,
  // touch, and pen. dragMoved distinguishes an actual drag from a plain
  // click (which should still jump to the clicked node, see below) using a
  // small pixel threshold so a slightly-shaky click isn't mistaken for one.
  //
  // Navigation deliberately does NOT use a "click" listener: setPointerCapture
  // below (needed so a drag that leaves the wrap's bounds keeps tracking)
  // makes the browser retarget the eventual click event to whatever element
  // captured the pointer -- tree-canvas-wrap itself, never the node actually
  // under the cursor. That would silently break node-click navigation
  // entirely -- the same root cause the +/-/Fit buttons avoid by being
  // excluded from capture -- but nodes can't just be excluded the same way,
  // since a drag gesture routinely starts on top of one. Instead, the node
  // (if any) is captured on pointerdown, before capture can retarget
  // anything, and acted on on pointerup if the pointer never actually
  // moved.
  let treeDragging = false;
  let treeDragMoved = false;
  let treeDragStartClientX = 0;
  let treeDragStartClientY = 0;
  let treeDragStartX = 0;
  let treeDragStartY = 0;
  let treePointerDownNode = null;

  treeCanvasWrapEl.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    // Pointer capture (below) retargets the eventual click to whatever
    // element it's captured on -- without this check, starting a drag
    // capture on every pointerdown silently ate every click on the +/-/Fit
    // buttons, since the browser would then fire their "click" at
    // tree-canvas-wrap instead of the button itself.
    if (e.target.closest(".tree-zoom-controls")) return;
    hideTreeNodeTooltip();
    treePointerDownNode = e.target.closest(".tree-node");
    treeDragging = true;
    treeDragMoved = false;
    treeDragStartClientX = e.clientX;
    treeDragStartClientY = e.clientY;
    treeDragStartX = treeView.x;
    treeDragStartY = treeView.y;
    treeCanvasWrapEl.classList.add("tree-dragging");
    treeCanvasWrapEl.setPointerCapture(e.pointerId);
  });
  treeCanvasWrapEl.addEventListener("pointermove", (e) => {
    if (!treeDragging) return;
    const dx = e.clientX - treeDragStartClientX;
    const dy = e.clientY - treeDragStartClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) treeDragMoved = true;
    treeView.x = treeDragStartX + dx;
    treeView.y = treeDragStartY + dy;
    applyTreeTransform();
  });
  // Clicking a node jumps to its real page, same as any other cross-reference
  // in the app -- the tree is a navigation aid, not a separate mini-app.
  // Only fires for a plain click (no real movement in between), and only
  // for the node the gesture actually started on.
  treeCanvasWrapEl.addEventListener("pointerup", (e) => {
    treeDragging = false;
    treeCanvasWrapEl.classList.remove("tree-dragging");
    if (!treeDragMoved && treePointerDownNode) {
      hideTreeModal();
      window.__cookbookJump(treePointerDownNode.dataset.name);
    }
  });
  treeCanvasWrapEl.addEventListener("pointercancel", () => {
    treeDragging = false;
    treeCanvasWrapEl.classList.remove("tree-dragging");
  });

  // Hover popup listing what a node unlocks -- every node gets one (not
  // just multi-unlock hubs), reusing the same researchUnlockedRecipeNames()
  // the detail page's own Unlocks list is built from, so both agree. A
  // node with nothing to show (the rare pure-hub case) just never displays
  // one rather than popping up an empty box.
  function hideTreeNodeTooltip() {
    treeNodeTooltipEl.hidden = true;
  }

  // Positioned in viewport coordinates (position: fixed), centered above
  // the node and flipped below when there's no room, clamped to the canvas
  // wrap's own bounds -- getBoundingClientRect() already accounts for the
  // pan/zoom transform on tree-canvas-inner, so no separate
  // unproject-from-SVG-space math is needed here. Shared by both tooltip
  // flavors below -- only the content they put in treeNodeTooltipEl differs.
  function positionTreeNodeTooltip(nodeEl) {
    const nodeRect = nodeEl.getBoundingClientRect();
    const wrapRect = treeCanvasWrapEl.getBoundingClientRect();
    const ttRect = treeNodeTooltipEl.getBoundingClientRect();
    let left = nodeRect.left + nodeRect.width / 2 - ttRect.width / 2;
    let top = nodeRect.top - ttRect.height - 10;
    if (top < wrapRect.top) top = nodeRect.bottom + 10;
    left = Math.max(wrapRect.left + 4, Math.min(left, wrapRect.right - ttRect.width - 4));
    treeNodeTooltipEl.style.left = `${left}px`;
    treeNodeTooltipEl.style.top = `${top}px`;
  }

  function showTreeNodeTooltip(nodeEl) {
    const node = data.research[nodeEl.dataset.name];
    const unlockedRecipes = node ? researchUnlockedRecipeNames(node) : [];
    if (!unlockedRecipes.length) {
      hideTreeNodeTooltip();
      return;
    }
    // Larger than the usual .ing-icon rows this same markup pattern uses
    // elsewhere (e.g. Unlocks on the research detail page) -- a hover
    // popup is glanced at for a moment, not read closely, so the icons
    // need to read at a glance too.
    treeNodeTooltipEl.innerHTML = unlockedRecipes
      .map((n) => `<div class="tree-node-tooltip-item">${reportRowIcon(n, "tree-node-tooltip-icon")}<span>${displayName(n)}</span></div>`)
      .join("");
    treeNodeTooltipEl.hidden = false;
    positionTreeNodeTooltip(nodeEl);
  }

  // One <li> per direct ingredient -- same icon+qty+name shape used
  // everywhere else in the app (e.g. renderTotalsCard), just not wrapped
  // in jumpSpan's click-to-navigate since a tooltip is transient and
  // pointer-events:none anyway.
  function recipeIngredientRowsHtml(recipe) {
    return (recipe.ingredients || [])
      .filter((ing) => ing.name)
      .map((ing) => {
        const qty = parseFloat(ing.count) || 1;
        return `<li>${reportRowIcon(ing.name)}<span class="ing-count">${qtyLabel(qty)}×</span><span>${displayName(ing.name)}</span></li>`;
      })
      .join("");
  }

  // Recipe grid dots are recipes, not research nodes: instead of an
  // "unlocks" list, hovering shows the full recipe -- every direct
  // ingredient, flattened one level (no expand/collapse, same as the item
  // detail page's own Construction Cost list before anything's expanded)
  // -- enough to compare two recipes' cost at a glance without clicking
  // through to either page. data.recipesByName[name] can hold several
  // variants at different workstations; data-area (set in
  // renderRecipeGridSvg from the exact area recipeGridGroups resolved for
  // this dot) picks the one this specific dot actually represents.
  function showRecipeDotTooltip(nodeEl) {
    const name = nodeEl.dataset.name;
    const area = nodeEl.dataset.area === undefined ? null : nodeEl.dataset.area;
    const ids = data.recipesByName[name] || [];
    const recipe = data.recipes[ids.find((id) => (data.recipes[id].area || null) === area) || ids[0]];

    const yieldQty = recipe ? parseFloat(recipe.count) || 1 : 1;
    const yieldNote = yieldQty !== 1 ? ` <span class="tree-node-tooltip-yield">(makes ${qtyLabel(yieldQty)})</span>` : "";
    let html =
      `<div class="tree-node-tooltip-item tree-node-tooltip-header">` +
      `${reportRowIcon(name, "tree-node-tooltip-icon")}<span>${displayName(name)}${yieldNote}</span></div>`;
    const rows = recipe ? recipeIngredientRowsHtml(recipe) : "";
    if (rows) html += `<ul class="ingredient-list tree-node-tooltip-ingredients">${rows}</ul>`;

    treeNodeTooltipEl.innerHTML = html;
    treeNodeTooltipEl.hidden = false;
    positionTreeNodeTooltip(nodeEl);
  }

  treeCanvasWrapEl.addEventListener("mouseover", (e) => {
    if (treeDragging) return;
    const nodeEl = e.target.closest(".tree-node");
    if (!nodeEl) return;
    if (nodeEl.classList.contains("rgrid-node")) showRecipeDotTooltip(nodeEl);
    else showTreeNodeTooltip(nodeEl);
  });
  treeCanvasWrapEl.addEventListener("mouseout", (e) => {
    const nodeEl = e.target.closest(".tree-node");
    if (nodeEl && !nodeEl.contains(e.relatedTarget)) hideTreeNodeTooltip();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!sourceModalEl.hidden) hideSourceModal();
    if (!treeModalEl.hidden) hideTreeModal();
  });

  // Craftable/harvestable/purchasable/lootable/rewardable -- independent of
  // `unlock` (which is about *when* a recipe becomes available, not *how
  // else* the resulting item can be obtained). Returns "" when the name has
  // no entry at all (most research-only names, and any block you only ever
  // build/place), so callers can skip the row entirely rather than show an
  // empty one.
  // Ordered least-common (left) to most-common (right), so the badge you're
  // most likely to see for any given item sits closest to the name, and the
  // rarer channels are the ones pushed furthest away.
  // Measured counts at build time: scrappable ~60, recyclable 83,
  // harvestable 151, rewardable 950, craftable ~921, lootable 1241,
  // purchasable 1445.
  const ACQUISITION_LABELS = {
    scrappable: "Scrap",
    recyclable: "Recycle",
    rewardable: "Quest",
    harvestable: "Harvest",
    craftable: "Craft",
    lootable: "Loot",
    purchasable: "Buy",
  };
  // The three badges with real detail behind them (data.harvestSources /
  // data.recycleSources / data.scrapSources) -- clickable only when that
  // detail actually exists for this name, rather than always-on and
  // sometimes opening an empty modal.
  const ACQUISITION_SOURCE_LINKS = {
    harvestable: { sources: () => data.harvestSources, fn: "__cookbookShowHarvest", title: "See harvest sources" },
    recyclable: { sources: () => data.recycleSources, fn: "__cookbookShowRecycleSources", title: "See recycle sources" },
    lootable: { sources: () => data.lootSources || {}, fn: "__cookbookShowLoot", title: "See loot sources" },
    scrappable: { sources: () => data.scrapSources, fn: "__cookbookShowScrapSources", title: "See scrap sources" },
  };
  // Wrapped in its own flex span (margin-left: auto) rather than left as
  // loose inline badges, so it pushes to the right edge of whatever
  // flex row it lands in -- the item name reads easier when it isn't
  // competing with a run of badges immediately after it.
  //
  // Every one of the 7 channels always gets a slot, in the same fixed
  // order, whether or not this name actually has that badge -- a missing
  // one renders as an invisible placeholder (.acq-badge-empty) rather than
  // being skipped, so every row's badges line up in the same fixed
  // columns regardless of which channels a given item actually has, the
  // same table-like alignment .ing-count already gives quantities.
  function acquisitionBadges(name) {
    const acq = data.acquisition && data.acquisition[name];
    const badges = Object.keys(ACQUISITION_LABELS)
      .map((k) => {
        if (!acq || !acq[k]) return `<span class="acq-badge acq-badge-empty" aria-hidden="true"></span>`;
        const link = ACQUISITION_SOURCE_LINKS[k];
        const sources = link && link.sources()[name];
        if (sources && sources.length) {
          const safeName = name.replace(/'/g, "\\'");
          // stopPropagation matters here: this badge often sits inside a
          // .req-toggle row (an ingredient with its own recipe), which
          // toggles expand/collapse on any click within it -- without this,
          // opening the modal also silently flipped that row's expand state.
          return `<span class="acq-badge acq-badge-${k} acq-badge-clickable" onclick="event.stopPropagation(); window.${link.fn}('${safeName}')" title="${link.title}">${ACQUISITION_LABELS[k]}</span>`;
        }
        return `<span class="acq-badge acq-badge-${k}">${ACQUISITION_LABELS[k]}</span>`;
      })
      .join("");
    return `<span class="acq-badges">${badges}</span>`;
  }

  // This item has no icon of its own in the source data -- what's shown is
  // borrowed from one of several real placeable skins (see build.py's
  // variant-helper fallback). Surface that plainly rather than let the
  // icon look like it's the item's own canonical art.
  function iconFallbackNote(name) {
    if (!isIconFallback(name)) return "";
    return `<div class="warning-note">This item has no icon of its own &mdash; it's a "variant" item with multiple placeable skins in-game, so the icon shown is just one representative skin.</div>`;
  }

  // ---------------------------------------------------------------------
  // Vehicle comparison table -- shown on every vehicle's own page, grouped
  // by MaintenanceGroup (the repair-material tier, and the only
  // classification the source data actually groups vehicles by) with the
  // currently-viewed vehicle's row highlighted. Column headers are
  // clickable to sort; sorting only ever reorders ROWS WITHIN a group -- the
  // groups themselves and their order never change. Re-rendered in place
  // (not via the full renderReportBody) so clicking a header doesn't
  // collapse whatever construction-tree state is open elsewhere on the
  // page.
  // ---------------------------------------------------------------------
  const VEHICLE_COLUMNS = [
    { key: "name", label: "Vehicle" },
    { key: "cargoCapacity", label: "Cargo (kg)", numeric: true },
    { key: "topSpeed", label: "Top Speed", numeric: true },
    { key: "weight", label: "Weight (kg)", numeric: true },
    // param1 of the CarryWeight property -- what this represents is
    // unconfirmed ("tow capacity" and "inventory slot count" have both been
    // ruled out), so it's labeled by its raw XML attribute name rather than
    // a guessed meaning.
    { key: "param1", label: "param1", numeric: true },
    { key: "modSlots", label: "Mod Slots", numeric: true },
    { key: "degradationMax", label: "Durability", numeric: true },
    { key: "repairTool", label: "Repair Kit" },
  ];
  let vehicleSort = { column: "cargoCapacity", direction: -1 };
  let vehicleCompareHighlight = null;

  function vehicleColumnValue(col, name, v) {
    if (col.key === "name") return displayName(name);
    if (col.key === "repairTool") return v.repairTool ? displayName(v.repairTool) : "";
    const raw = v[col.key];
    return raw == null ? null : Number(raw);
  }

  function vehicleCompareTableHtml() {
    // Sections are the maintenance schematic (research) needed to repair the
    // vehicle -- ulmBookMaintenanceVan etc., off its repair tiers' learnable=
    // -- NOT MaintenanceGroup: that one lumps cars and vans together
    // (MG_CarRepair) and files the go-kart under Motorcycle even though it
    // needs Minibike Maintenance. A vehicle with no repair path (buildable
    // placeables, mine cart...) takes the most common schematic among
    // vehicles sharing its MaintenanceGroup, else a MaintenanceGroup label.
    const vehicles = Object.entries(data.vehicles || {});
    // Crafted vehicles often have no repair tier at all, so their schematic
    // comes from the research tree instead: walk up from the vehicle's own
    // research node to the nearest ancestor that unlocks a "... Maintenance"
    // book (e.g. 4x4 -> Cars -> Car Maintenance).
    const research = data.research || {};
    const researchSchematic = (name) => {
      let cur = research[name] ? name : null;
      for (let hops = 0; cur && research[cur] && hops < 50; hops++) {
        const hit = (research[cur].unlocks || []).find((u) => u.name.startsWith("ulmBookMaintenance"));
        if (hit) return hit.name;
        cur = research[cur].parent;
      }
      return null;
    };
    const schematicOf = (v, name) => {
      const t = (v.repairRecipes || []).find((r) => r.learnable);
      return t ? t.learnable : researchSchematic(name);
    };
    const tally = new Map();
    for (const [name, v] of vehicles) {
      const s = schematicOf(v, name);
      if (!s) continue;
      const mg = v.maintenanceGroup || "(none)";
      if (!tally.has(mg)) tally.set(mg, new Map());
      tally.get(mg).set(s, (tally.get(mg).get(s) || 0) + 1);
    }
    const dominant = (mg) => {
      const m = tally.get(mg);
      return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
    };
    const mgLabel = (g) => g.replace(/^MG_/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    const groups = new Map();
    const labels = new Map();
    for (const [name, v] of vehicles) {
      const s = schematicOf(v, name) || dominant(v.maintenanceGroup || "(none)");
      const key = s || v.maintenanceGroup || "(none)";
      if (!groups.has(key)) {
        groups.set(key, []);
        labels.set(key, s ? displayName(s) : mgLabel(key));
      }
      groups.get(key).push([name, v]);
    }
    const groupLabel = (g) => labels.get(g);
    // In-game unlock progression, not alphabetical: bike, minibike,
    // motorcycle, car, van, truck, then gyrocopter. Anything else
    // (helicopters...) sorts after, alphabetically.
    const GROUP_ORDER = [
      "ulmBookMaintenanceBicycle", "ulmBookMaintenanceMinibike", "ulmBookMaintenanceMotorcycle",
      "ulmBookMaintenanceCar", "ulmBookMaintenanceVan", "ulmBookMaintenanceTruck", "ulmBookMaintenanceGyrocopter",
    ];
    const groupRank = (g) => {
      const i = GROUP_ORDER.indexOf(g);
      return i === -1 ? GROUP_ORDER.length : i;
    };
    const groupNames = [...groups.keys()].sort((a, b) => {
      const ra = groupRank(a), rb = groupRank(b);
      return ra !== rb ? ra - rb : groupLabel(a).localeCompare(groupLabel(b));
    });

    const col = VEHICLE_COLUMNS.find((c) => c.key === vehicleSort.column);
    const dir = vehicleSort.direction;
    for (const rows of groups.values()) {
      rows.sort((a, b) => {
        const va = vehicleColumnValue(col, a[0], a[1]);
        const vb = vehicleColumnValue(col, b[0], b[1]);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === "number") return (va - vb) * dir;
        return va.localeCompare(vb) * dir;
      });
    }

    let html = `<div class="vehicle-compare-wrap"><table class="vehicle-compare-table"><thead><tr>`;
    html += VEHICLE_COLUMNS.map((c) => {
      const sorted = c.key === vehicleSort.column;
      const arrow = sorted ? (dir === 1 ? " ▲" : " ▼") : "";
      return `<th class="${sorted ? "sorted" : ""}" onclick="window.__cookbookSortVehicles('${c.key}')">${c.label}${arrow}</th>`;
    }).join("");
    html += `</tr></thead><tbody>`;
    for (const group of groupNames) {
      html += `<tr class="vehicle-group-row"><td colspan="${VEHICLE_COLUMNS.length}">${groupLabel(group)}</td></tr>`;
      for (const [name, v] of groups.get(group)) {
        const rowClass = name === vehicleCompareHighlight ? " vehicle-compare-row-highlight" : "";
        html += `<tr class="${rowClass}">`;
        html += `<td>${jumpSpan(name, displayName(name))}</td>`;
        html += `<td>${v.cargoCapacity ?? "-"}</td>`;
        html += `<td>${v.topSpeed ?? "-"}</td>`;
        html += `<td>${v.weight ?? "-"}</td>`;
        html += `<td>${v.param1 ?? "-"}</td>`;
        html += `<td>${v.modSlots ?? "-"}</td>`;
        html += `<td>${v.degradationMax ?? "-"}</td>`;
        html += `<td>${v.repairTool ? jumpSpan(v.repairTool, displayName(v.repairTool)) : "-"}</td>`;
        html += `</tr>`;
      }
    }
    html += `</tbody></table></div>`;
    return html;
  }

  function renderVehicleCompareSection(highlightName) {
    vehicleCompareHighlight = highlightName;
    return (
      `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">All Vehicles</div>` +
      `<div id="vehicle-compare-wrap">${vehicleCompareTableHtml()}</div>`
    );
  }

  // World-repair costs (recipes_vehicles.xml, joined to the vehicle item via
  // its block's own ItemName/ItemPrefix -- see build.py's
  // load_vehicle_repairs()) -- a completely separate path from crafting,
  // and for most "find it and repair it" cars the ONLY path. Not every
  // vehicle has one: the five buildable "Placeable" vanilla templates don't
  // appear in the source data as independently repairable (only their
  // "ulm"-branded counterpart is, e.g. the Comet Minibike but not the
  // vanilla Minibike item).
  function renderVehicleRepairSection(v) {
    if (!v.repairRecipes || !v.repairRecipes.length) return "";
    let html = `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Repair Cost (found in the world)</div>`;
    html += v.repairRecipes
      .map((tier) => {
        let card = `<div class="variant-card">`;
        card += `<div class="kv-row"><span class="k">Damage Tier</span><span>${tier.damage}</span></div>`;
        if (tier.learnable) {
          card += `<div class="kv-row"><span class="k">Schematic</span><span>${jumpSpan(tier.learnable, displayName(tier.learnable))}</span></div>`;
        }
        if (tier.tools && tier.tools.length) {
          card += `<div class="kv-row"><span class="k">Tool</span><span>${tier.tools.map((t) => displayName(t)).join(" / ")}</span></div>`;
        }
        card += `<ul class="ingredient-list">`;
        card += tier.ingredients
          .map(
            (ing) =>
              `<li>${reportRowIcon(ing.name)}<span class="ing-count">${qtyLabel(Number(ing.count))}&times;</span>${jumpSpan(ing.name, displayName(ing.name))}</li>`
          )
          .join("");
        card += `</ul></div>`;
        return card;
      })
      .join("");
    return html;
  }

  window.__cookbookSortVehicles = function (col) {
    if (vehicleSort.column === col) {
      vehicleSort.direction *= -1;
    } else {
      const spec = VEHICLE_COLUMNS.find((c) => c.key === col);
      vehicleSort = { column: col, direction: spec && spec.numeric ? -1 : 1 };
    }
    const wrap = document.getElementById("vehicle-compare-wrap");
    if (wrap) wrap.innerHTML = vehicleCompareTableHtml();
  };

  // What a research node unlocks, in reverse of how reportEngine's own
  // findResearchFor() resolves a RECIPE's unlock.via: most nodes (457 of
  // 589) have no <unlocks> children at all and unlock a same-named recipe
  // purely by that name match, while the rest name it explicitly via
  // <unlocks>. Either way, the real signal is "does a recipe with this name
  // exist" -- an <unlocks> child just as often names a workstation tier or a
  // plain resource/book with no recipe of its own (data.recipesByName won't
  // have those), which is why no separate check of the child's own
  // craftable/display_only flags is needed here.
  function researchUnlockedRecipeNames(node) {
    const names = new Set();
    if (data.recipesByName[node.name]) names.add(node.name);
    for (const u of node.unlocks || []) {
      if (u.name && data.recipesByName[u.name]) names.add(u.name);
    }
    return [...names];
  }

  // The item's own facts, shown at the top of its Total Requirements page:
  // browsing an item and sizing up its cost are the same task, not two
  // pages linked by a button. Doesn't repeat the recipe's own Ingredients
  // (the Construction Cost breakdown right below already covers that,
  // interactively) or a research node's own cost (same reason -- see its
  // Unlock Chain entry).
  function renderFactsBlock(kind, name, recipeId) {
    let html = "";
    // A recipe's own Unlock/Workstation/Time/Yields/Tags/Source facts aren't
    // shown here: Unlock would duplicate the Research Required section,
    // Workstation would duplicate the Workstations section, and the rest
    // isn't worth the redundancy.
    if (kind === "research") {
      const node = data.research[name];
      const unlockedRecipes = researchUnlockedRecipeNames(node);
      const category = researchCategoryOf(name);
      html += `<div class="variant-card variant-card-columns">`;
      html += `<div class="variant-card-col">`;
      html += `<div class="kv-row"><span class="k">Category</span><span>${category || "-"}</span></div>`;
      html += `<div class="kv-row"><span class="k">Parent</span><span>${node.parent ? displayName(node.parent) : "(root)"}</span></div>`;
      html += `<div class="kv-row"><span class="k">Unlocked by default</span><span>${node.unlocked ? "yes" : "no"}</span></div>`;
      if (node.requires) html += `<div class="kv-row"><span class="k">Requires</span><span>${displayName(node.requires)}</span></div>`;
      html += `</div>`;
      html += `<div class="variant-card-col">`;
      html += `<div class="kv-row"><span class="k">Unlocks</span><span>${unlockedRecipes.length} recipe${unlockedRecipes.length === 1 ? "" : "s"}</span></div>`;
      if (unlockedRecipes.length) {
        html += `<ul class="ingredient-list">`;
        html += unlockedRecipes.map((n) => `<li>${reportRowIcon(n)}${jumpSpan(n, displayName(n))}</li>`).join("");
        html += `</ul>`;
      }
      html += `</div>`;
      html += `</div>`;
    } else if (kind === "workstation") {
      const info = tierInfo[name];
      html += `<div class="variant-card">`;
      html += `<div class="kv-row"><span class="k">Tier</span><span>${info.tierIndex + 1} of ${info.familyTiers.length}</span></div>`;
      if (info.tierIndex < info.familyTiers.length - 1) {
        html += `<div class="kv-row"><span class="k">Upgrades to</span><span class="text-workstation">${workstationDisplayName(info.familyTiers[info.tierIndex + 1])}</span></div>`;
      }
      html += `</div>`;
    }
    // A vehicle body style is orthogonal to kind -- the five buildable ones
    // (Comet Minibike, etc.) are a real recipe, while every "find it broken
    // down and repair it" car (Sedan, SUV, Ambulance...) has no recipe of
    // its own at all and only ever reaches a page via the "item" fallback
    // (see orphanCandidates) -- so this card is appended regardless of kind
    // rather than living inside the if/else above.
    if (data.vehicles && data.vehicles[name]) {
      const v = data.vehicles[name];
      html += `<div class="variant-card">`;
      if (v.cargoCapacity != null) html += `<div class="kv-row"><span class="k">Cargo Capacity</span><span>${v.cargoCapacity} kg</span></div>`;
      if (v.topSpeed != null) html += `<div class="kv-row"><span class="k">Top Speed</span><span>${v.topSpeed} (no sprint)</span></div>`;
      if (v.repairTool) html += `<div class="kv-row"><span class="k">Repair Kit</span><span>${jumpSpan(v.repairTool, displayName(v.repairTool))}</span></div>`;
      if (v.weight != null) html += `<div class="kv-row"><span class="k">Vehicle Weight</span><span>${v.weight} kg</span></div>`;
      // Unconfirmed what this second number means (see VEHICLE_COLUMNS) --
      // shown by its raw XML attribute name rather than a guessed label.
      if (v.param1 != null) html += `<div class="kv-row"><span class="k">param1</span><span>${v.param1}</span></div>`;
      if (v.modSlots != null) html += `<div class="kv-row"><span class="k">Mod Slots</span><span>${v.modSlots}</span></div>`;
      if (v.degradationMax != null) html += `<div class="kv-row"><span class="k">Durability</span><span>${v.degradationMax}</span></div>`;
      if (v.maintenanceGroup) html += `<div class="kv-row"><span class="k">Maintenance Group</span><span>${v.maintenanceGroup}</span></div>`;
      html += `</div>`;
      html += renderVehicleRepairSection(v);
      html += renderVehicleCompareSection(name);
    }
    return html;
  }

  // ---------------------------------------------------------------------
  // Total Requirements Report -- interactive
  //
  // Nothing auto-expands past the target itself.
  // Every craftable ingredient/tool/workstation/research step starts
  // collapsed (assume you'll buy/loot/harvest/already-have it) and shows a
  // native <details> triangle; clicking it says "I'll make this myself" and
  // reveals its own cost, which can itself cascade further. Totals
  // (construction and one-time alike) only count what's currently expanded.
  //
  // Expand state is path-keyed (per tree POSITION, not per item name) for
  // ingredients/research: owning one Beaker to build a workstation doesn't
  // mean you own a second one for some other recipe that also needs one.
  // Workstations and research nodes are keyed by name instead, since those
  // are singular, global facts ("I have a Chemistry Station" / "I've
  // researched Carpentry"), not consumable counts.
  // ---------------------------------------------------------------------
  let reportState = null; // { kind, name, recipeId, qty, expanded: Set<path> }

  // A name with no icon still reserves the icon's own width (an invisible
  // placeholder, same pattern as .result-icon.placeholder in the results
  // list) so every row's name starts at the same x position regardless of
  // which sibling rows happen to have real icons.
  function reportRowIcon(name, extraClass) {
    const icon = iconFor(name);
    const cls = `ing-icon${extraClass ? " " + extraClass : ""}`;
    return icon ? `<img class="${cls}" src="${icon}" alt="">` : `<span class="${cls} ing-icon-placeholder"></span>`;
  }

  // Wraps a research node's icon + name in the blue pill (see .research-chip
  // in styles.css for why it's a pill around both rather than a ring around
  // just the icon). `innerClass` lets call sites keep whatever class the
  // name span needs elsewhere (e.g. .result-name in the results list, for
  // its own truncation/selected-state rules) without hard-coding it here.
  function researchChip(name, label, iconClass, innerClass, extraChipClass) {
    const icon = iconForResearch(name);
    const iconTag = icon ? `<img class="${iconClass}" src="${icon}" alt="">` : "";
    const chipClass = extraChipClass ? `research-chip ${extraChipClass}` : "research-chip";
    const inner = innerClass ? `<span class="${innerClass}">${label}</span>` : `<span>${label}</span>`;
    return `<span class="${chipClass}">${iconTag}${inner}</span>`;
  }

  function jumpSpan(name, label) {
    if (isKnownName(name)) {
      return `<span class="ing-name" onclick="window.__cookbookJump('${name.replace(/'/g, "\\'")}')">${label}</span>`;
    }
    return `<span>${label}</span>`;
  }

  function bump(map, key, qty) {
    map.set(key, (map.get(key) || 0) + qty);
  }

  // Ingredient rows read highest-quantity-first rather than in whatever
  // order the source XML happens to list them -- applied uniformly
  // everywhere a set of sibling ingredient/tier nodes is built.
  function sortByQtyDesc(children) {
    children.sort((a, b) => (b.qty || 0) - (a.qty || 0));
  }

  // ---- build pass: walks only what's currently expanded, gathering
  // totals + which workstations/tools are "in play" as a side effect ------

  // Shared by root ingredients, nested ingredients, workstation upgrade-step
  // ingredients, and research-cost ingredients -- they all follow the same
  // rule. `totalsMap` is construction- or one-time-totals depending on the
  // caller, keeping those two counts separate.
  function buildIngredientNode(ctx, totalsMap, name, qty, path, ancestry) {
    const ids = data.recipesByName[name];
    if (!ids || !ids.length) {
      bump(totalsMap, name, qty);
      return { kind: "material", name, qty, path };
    }
    if (ancestry.has(name) || ancestry.size > 40) {
      bump(totalsMap, name, qty);
      return { kind: "material", name, qty, path, circular: true };
    }
    const recipe = reportEngine.pickDefaultRecipe(ids);
    const isOpen = ctx.expanded.has(path);
    const node = {
      kind: "recipe",
      name,
      recipeId: recipe.id,
      qty,
      alwaysUnlocked: recipe.always_unlocked,
      variantCount: ids.length,
      path,
      open: isOpen,
      children: [],
    };
    if (!isOpen) {
      bump(totalsMap, name, qty);
      return node;
    }
    registerWorkstationTrigger(ctx, recipe.area, displayName(name));
    registerToolTrigger(ctx, recipe.tool, displayName(name));
    const newAncestry = new Set(ancestry);
    newAncestry.add(name);
    recipe.ingredients.forEach((ing, i) => {
      if (!ing.name) return;
      const subQty = (parseFloat(ing.count) || 1) * qty;
      const childPath = path + "/" + i + ":" + ing.name;
      node.children.push(buildIngredientNode(ctx, totalsMap, ing.name, subQty, childPath, newAncestry));
    });
    sortByQtyDesc(node.children);
    return node;
  }

  function registerWorkstationTrigger(ctx, area, triggerName) {
    if (!area || ctx.workstations.has(area)) return;
    ctx.workstations.set(area, { area, triggerName });
  }

  function registerToolTrigger(ctx, toolName, triggerName) {
    if (!toolName || ctx.tools.has(toolName)) return;
    ctx.tools.set(toolName, { name: toolName, triggerName });
  }

  // Base tier + unlock status is always known (for the "unresolved" flag
  // downstream); this entry's OWN cost -- one upgrade step if it has a
  // previous tier, or its own recipe if it doesn't -- is only walked once
  // expanded. The previous tier is registered as its own sibling entry
  // (via registerWorkstationTrigger) rather than nested as a child: this
  // list is the flat "what's currently in play" panel, not a construction
  // tree, so expanding Tier 2 should surface Tier 1 as its own line here --
  // and on a workstation's own page too -- rather than nested inside its
  // Crafting Cost tree -- and collapsing Tier 2 again should drop it
  // (naturally, since this whole report rebuilds from reportState.expanded
  // on every render).
  function buildWorkstationNode(ctx, entry) {
    const { area, triggerName } = entry;
    const path = "ws:" + area;
    const isOpen = ctx.expanded.has(path);
    const chain = reportEngine.stationChain(area);
    const info = tierInfo[area];
    const prevName = info && info.tierIndex > 0 ? info.familyTiers[info.tierIndex - 1] : null;
    const ownRecipeIds = !prevName ? data.recipesByName[area] : null;
    const hasCost = !!prevName || !!(ownRecipeIds && ownRecipeIds.length);
    const node = {
      area,
      triggerName,
      path,
      open: isOpen,
      baseTier: chain.baseTier,
      unlock: chain.unlock,
      hasUpgrade: hasCost,
      toolRef: null,
      children: [],
    };
    if (!isOpen || !hasCost) return node;
    if (prevName) {
      const upgrade = data.upgrades[prevName];
      upgrade.ingredients.forEach((ing, i) => {
        if (!ing.name) return;
        const childPath = path + "/" + i + ":" + ing.name;
        node.children.push(
          buildIngredientNode(ctx, ctx.oneTimeTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set())
        );
      });
      if (upgrade.tools.length) {
        node.toolRef = upgrade.tools[0];
        registerToolTrigger(ctx, upgrade.tools[0], `upgrading to ${workstationDisplayName(area)}`);
      }
      registerWorkstationTrigger(ctx, prevName, `upgrading to ${workstationDisplayName(area)}`);
    } else {
      const recipe = reportEngine.pickDefaultRecipe(ownRecipeIds);
      recipe.ingredients.forEach((ing, i) => {
        if (!ing.name) return;
        const childPath = path + "/" + i + ":" + ing.name;
        node.children.push(
          buildIngredientNode(ctx, ctx.oneTimeTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set())
        );
      });
      if (recipe.tool) {
        node.toolRef = recipe.tool;
        registerToolTrigger(ctx, recipe.tool, workstationDisplayName(area));
      }
      if (recipe.area && recipe.area !== area) {
        registerWorkstationTrigger(ctx, recipe.area, workstationDisplayName(area));
      }
    }
    sortByQtyDesc(node.children);
    return node;
  }

  function buildToolNode(ctx, entry) {
    const { name, triggerName } = entry;
    const path = "tool:" + name;
    const ids = data.recipesByName[name];
    const craftable = !!(ids && ids.length);
    const isOpen = ctx.expanded.has(path);
    const node = { name, triggerName, path, open: isOpen, craftable, children: [] };
    if (!isOpen) return node;
    if (craftable) {
      const recipe = reportEngine.pickDefaultRecipe(ids);
      registerWorkstationTrigger(ctx, recipe.area, displayName(name));
      recipe.ingredients.forEach((ing, i) => {
        if (!ing.name) return;
        const childPath = path + "/" + i + ":" + ing.name;
        node.children.push(
          buildIngredientNode(ctx, ctx.oneTimeTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set())
        );
      });
    } else {
      bump(ctx.oneTimeTotals, name, 1);
    }
    sortByQtyDesc(node.children);
    return node;
  }

  // Collapsed by default (assume "I've already researched this"); expanding
  // reveals its own ingredient cost (same rules as any other ingredient)
  // and cascades into its parent -- also collapsed by default -- the same
  // way. `shown` guards a shared ancestor reached via two branches.
  function buildResearchNode(ctx, name, shown) {
    if (shown.has(name)) return { name, alreadyShown: true, path: "res-dup:" + name };
    shown.add(name);
    const rnode = data.research[name];
    const path = "res:" + name;
    const isOpen = ctx.expanded.has(path);
    const node = { name, path, open: isOpen, children: [], parentNode: null, requiresNode: null };
    if (!isOpen) return node;
    (rnode.ingredients || [])
      .filter((i) => i.name)
      .forEach((ing, i) => {
        const childPath = path + "/" + i + ":" + ing.name;
        node.children.push(
          buildIngredientNode(ctx, ctx.oneTimeTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set())
        );
      });
    sortByQtyDesc(node.children);
    if (rnode.area) registerWorkstationTrigger(ctx, rnode.area, displayName(name));
    if (rnode.parent && data.research[rnode.parent]) node.parentNode = buildResearchNode(ctx, rnode.parent, shown);
    if (rnode.requires && rnode.requires !== rnode.parent && data.research[rnode.requires]) {
      node.requiresNode = buildResearchNode(ctx, rnode.requires, shown);
    }
    return node;
  }

  function buildInteractiveReport(state) {
    const { kind, name, recipeId, qty } = state;
    const ctx = {
      expanded: state.expanded,
      constructionTotals: new Map(),
      oneTimeTotals: new Map(),
      workstations: new Map(),
      tools: new Map(),
    };

    let constructionTree = null;
    let targetUnlock = null;

    if (kind === "recipe") {
      const ids = data.recipesByName[name] || [];
      const forced = recipeId ? data.recipes[recipeId] : null;
      const recipe = forced || (ids.length ? reportEngine.pickDefaultRecipe(ids) : null);
      if (recipe) {
        targetUnlock = recipe.unlock;
        constructionTree = {
          kind: "recipe",
          name,
          recipeId: recipe.id,
          qty,
          alwaysUnlocked: recipe.always_unlocked,
          variantCount: ids.length,
          path: "root",
          open: true,
          children: [],
        };
        registerWorkstationTrigger(ctx, recipe.area, displayName(name));
        registerToolTrigger(ctx, recipe.tool, displayName(name));
        recipe.ingredients.forEach((ing, i) => {
          if (!ing.name) return;
          const subQty = (parseFloat(ing.count) || 1) * qty;
          const childPath = "root/" + i + ":" + ing.name;
          constructionTree.children.push(
            buildIngredientNode(ctx, ctx.constructionTotals, ing.name, subQty, childPath, new Set([name]))
          );
        });
        sortByQtyDesc(constructionTree.children);
      }
    } else if (kind === "workstation") {
      const info = tierInfo[name];
      targetUnlock = reportEngine.baseTierUnlock(info.familyTiers[0]);
      constructionTree = { kind: "tier", name, path: "root", open: true, toolRef: null, children: [] };
      if (info.tierIndex === 0) {
        const ids = data.recipesByName[name] || [];
        const forced = recipeId ? data.recipes[recipeId] : null;
        const recipe = forced || (ids.length ? reportEngine.pickDefaultRecipe(ids) : null);
        if (recipe) {
          targetUnlock = recipe.unlock; // more precise than baseTierUnlock for the base tier itself
          constructionTree.recipeId = recipe.id;
          constructionTree.variantCount = ids.length;
          registerWorkstationTrigger(ctx, recipe.area, workstationDisplayName(name));
          registerToolTrigger(ctx, recipe.tool, workstationDisplayName(name));
          recipe.ingredients.forEach((ing, i) => {
            if (!ing.name) return;
            const childPath = "root/" + i + ":" + ing.name;
            constructionTree.children.push(
              buildIngredientNode(ctx, ctx.constructionTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set([name]))
            );
          });
          sortByQtyDesc(constructionTree.children);
        }
      } else {
        const prevName = info.familyTiers[info.tierIndex - 1];
        const upgrade = data.upgrades[prevName];
        if (upgrade.tools.length) {
          constructionTree.toolRef = upgrade.tools[0];
          registerToolTrigger(ctx, upgrade.tools[0], workstationDisplayName(name));
        }
        upgrade.ingredients.forEach((ing, i) => {
          if (!ing.name) return;
          const childPath = "root/" + i + ":" + ing.name;
          constructionTree.children.push(
            buildIngredientNode(ctx, ctx.constructionTotals, ing.name, parseFloat(ing.count) || 1, childPath, new Set([name]))
          );
        });
        sortByQtyDesc(constructionTree.children);
        // The previous tier is a workstation requirement, not a consumed
        // ingredient -- it belongs in the Workstations section like any
        // other, not nested inside Crafting Cost. Reuses the exact same
        // registration buildWorkstationNode already knows how to expand and
        // cascade further back (Tier 1, if this is Tier 3), rather than a
        // separate nested-tree code path for it.
        registerWorkstationTrigger(ctx, prevName, workstationDisplayName(name));
      }
    } else if (kind === "research") {
      targetUnlock = { type: "direct", via: name };
    }

    let unlockRoot = null;
    const shown = new Set();
    if (kind === "research") {
      unlockRoot = buildResearchNode(ctx, name, shown);
    } else if (targetUnlock && targetUnlock.type === "direct" && targetUnlock.via) {
      // unlock.via names the research node only sometimes (the self-name-
      // match case) -- when it instead unlocks via an <unlocks> child, `via`
      // is the recipe's own name, so it needs the engine's own resolution.
      const rnode = reportEngine.findResearchFor(targetUnlock.via);
      if (rnode) unlockRoot = buildResearchNode(ctx, rnode.name, shown);
    }

    // A Map iterator visits keys inserted during iteration (spec-guaranteed),
    // so this single pass reaches a fixpoint even though building a
    // workstation or tool node can register brand-new ones as a side effect.
    const workstationNodes = [];
    for (const entry of ctx.workstations.values()) workstationNodes.push(buildWorkstationNode(ctx, entry));
    const toolNodes = [];
    for (const entry of ctx.tools.values()) toolNodes.push(buildToolNode(ctx, entry));

    return {
      kind,
      name,
      targetUnlock,
      constructionTree,
      constructionTotals: ctx.constructionTotals,
      unlockRoot,
      researchCount: shown.size,
      workstationNodes,
      toolNodes,
      oneTimeTotals: ctx.oneTimeTotals,
    };
  }

  // ---- render pass ------------------------------------------------------

  function renderIngredientNode(node) {
    if (node.kind === "material") {
      // No "raw material -- no recipe" note here: the absence of a Craft
      // acquisition badge already says that. Circular reference stays --
      // it's a real edge case the badges don't cover.
      const tag = node.circular ? ` <span class="req-flag">(circular reference &mdash; counted as raw here)</span>` : "";
      return `<li class="req-leaf">${reportRowIcon(node.name)}<span class="ing-count">${qtyLabel(node.qty)}&times;</span>${jumpSpan(node.name, displayName(node.name))}${tag} ${acquisitionBadges(node.name)}</li>`;
    }
    // Plain text, not jumpSpan: this whole row is a click-to-toggle target,
    // and a nested navigate-away link on the name would make clicking
    // anywhere near it a gamble between expanding and leaving the report
    // entirely. Recipe-variant/always-unlocked detail isn't shown as a
    // parenthetical here either -- the acquisition badges already cover
    // that ground without crowding the row.
    const caret = `<span class="req-caret">${node.open ? "▾" : "▸"}</span>`;
    const row = `${caret}${reportRowIcon(node.name)}<span class="ing-count">${qtyLabel(node.qty)}&times;</span><span>${displayName(node.name)}</span> ${acquisitionBadges(node.name)}`;
    if (!node.open) {
      return `<li><div class="req-toggle" data-path="${node.path}">${row}</div></li>`;
    }
    return (
      `<li><div class="req-toggle" data-path="${node.path}">${row}</div>` +
      `<ul class="req-tree">${node.children.map(renderIngredientNode).join("")}</ul>` +
      `</li>`
    );
  }

  function renderWorkstationNode(node) {
    // Green font, no icon ring: a workstation is fundamentally "an item"
    // here (same as in the Ingredient Breakdown's nested tier requirement),
    // so it doesn't get the research-style ring treatment.
    const triggerNote = node.triggerName ? ` <span class="req-flag-dim">&mdash; needed for ${node.triggerName}</span>` : "";
    const label = `${reportRowIcon(node.area)}<span class="text-workstation">${workstationDisplayName(node.area)}</span>${triggerNote}`;
    if (!node.hasUpgrade) return `<li class="req-leaf">${label}</li>`;
    const caret = `<span class="req-caret">${node.open ? "▾" : "▸"}</span>`;
    const row = `<div class="req-toggle" data-path="${node.path}">${caret}${label}</div>`;
    if (!node.open) return `<li>${row}</li>`;
    let inner = node.children.map(renderIngredientNode).join("");
    if (node.toolRef) {
      inner += `<li class="req-leaf req-dim">Tool: <span>${displayName(node.toolRef)}</span> <span class="req-flag-dim">(see Tools below)</span></li>`;
    }
    return `<li>${row}<ul class="req-tree">${inner}</ul></li>`;
  }

  function renderToolNode(node) {
    const triggerNote = node.triggerName ? ` <span class="req-flag-dim">&mdash; needed for ${node.triggerName}</span>` : "";
    const label = `${reportRowIcon(node.name)}<span>${displayName(node.name)}</span>${triggerNote}`;
    if (!node.craftable) return `<li class="req-leaf">${label} ${acquisitionBadges(node.name)}</li>`;
    const caret = `<span class="req-caret">${node.open ? "▾" : "▸"}</span>`;
    const row = `<div class="req-toggle" data-path="${node.path}">${caret}${label} ${acquisitionBadges(node.name)}</div>`;
    if (!node.open) return `<li>${row}</li>`;
    return `<li>${row}<ul class="req-tree">${node.children.map(renderIngredientNode).join("")}</ul></li>`;
  }

  function renderResearchNode(node) {
    if (node.alreadyShown) {
      return `<li class="req-leaf req-dim">${researchChip(node.name, displayName(node.name), "ing-icon")} <span class="req-flag-dim">(already listed above)</span></li>`;
    }
    // Blue pill around icon + name: the Unlock Chain mixes research nodes
    // with the plain items they cost, and with so many research entries
    // cascading through one item's chain, the two need to read as visually
    // distinct at a glance.
    const label = researchChip(node.name, displayName(node.name), "ing-icon");
    const caret = `<span class="req-caret">${node.open ? "▾" : "▸"}</span>`;
    const row = `<div class="req-toggle" data-path="${node.path}">${caret}${label}</div>`;
    if (!node.open) return `<li>${row}</li>`;
    let inner = "";
    if (node.children.length) {
      inner += `<li class="req-flag-dim" style="padding-left:16px;">Research cost:</li>`;
      inner += `<ul class="req-tree">${node.children.map(renderIngredientNode).join("")}</ul>`;
    }
    if (node.parentNode) {
      inner += `<li class="req-flag-dim" style="padding-left:16px;">Cascades from:</li>`;
      inner += `<ul class="req-tree">${renderResearchNode(node.parentNode)}</ul>`;
    }
    if (node.requiresNode) {
      inner += `<li class="req-flag-dim" style="padding-left:16px;">Also requires:</li>`;
      inner += `<ul class="req-tree">${renderResearchNode(node.requiresNode)}</ul>`;
    }
    return `<li>${row}<ul class="req-tree">${inner}</ul></li>`;
  }

  // A rolled-up material list, used both for the per-craft construction
  // total and for the one-time research/workstation/tool total. Same shape,
  // different meaning, so it gets one renderer and two call sites.
  function renderTotalsCard(title, totalsMap, emptyLabel, subtitle) {
    const rows = [...totalsMap.entries()].sort((a, b) => b[1] - a[1]);
    let html = `<div class="variant-card">`;
    html += `<div class="section-label">${title}${rows.length ? ` (${rows.length} distinct)` : ""}</div>`;
    if (subtitle) html += `<div class="req-flag-dim totals-subtitle">${subtitle}</div>`;
    if (rows.length) {
      html += `<ul class="ingredient-list">`;
      html += rows
        .map(
          ([n, q]) =>
            `<li>${reportRowIcon(n)}<span class="ing-count">${qtyLabel(q)}&times;</span>${jumpSpan(n, displayName(n))}</li>`
        )
        .join("");
      html += `</ul>`;
    } else {
      html += `<div class="req-flag-dim">${emptyLabel || "None."}</div>`;
    }
    html += `</div>`;
    return html;
  }

  function renderUnlockChainCard(report) {
    let html = `<div class="variant-card">`;
    const unlock = report.targetUnlock;
    if (!unlock || unlock.type === "always") {
      html += `<div class="req-flag-dim">Always unlocked &mdash; no research needed.</div>`;
    } else if (unlock.type === "unknown") {
      html += `<div class="warning-note">No traceable unlock path for this item.</div>`;
    } else if (unlock.type === "station") {
      html += `<div class="req-flag-dim">No dedicated research node &mdash; becomes craftable automatically once its workstation is reachable (see Workstations below).</div>`;
    } else if (report.unlockRoot) {
      html += `<ul class="req-tree req-tree-root">${renderResearchNode(report.unlockRoot)}</ul>`;
    }
    html += `</div>`;
    return html;
  }

  function renderWorkstationsCard(report) {
    const nodes = report.workstationNodes;
    let html = `<div class="variant-card">`;
    html += nodes.length
      ? `<ul class="req-tree req-tree-root">${nodes.map(renderWorkstationNode).join("")}</ul>`
      : `<div class="req-flag-dim">None currently in play.</div>`;
    const unresolved = nodes.filter((n) => n.unlock && n.unlock.type === "unknown");
    if (unresolved.length) {
      html += `<div class="warning-note">${unresolved.length} workstation(s) above have no traceable unlock path: ${unresolved.map((n) => displayName(n.area)).join(", ")}</div>`;
    }
    html += `</div>`;
    return html;
  }

  function renderToolsCard(report) {
    const nodes = report.toolNodes;
    let html = `<div class="variant-card">`;
    html += nodes.length
      ? `<ul class="req-tree req-tree-root">${nodes.map(renderToolNode).join("")}</ul>`
      : `<div class="req-flag-dim">None currently in play.</div>`;
    html += `</div>`;
    return html;
  }

  // Straight from data.recycleYields (build.py's load_recycle_data) -- a
  // flat, terminal fact about this item, not a toggleable tree, since a
  // Recycler output is never itself further craftable/expandable the way an
  // ingredient can be. Shown as part of an item's own page, same convention
  // as Workstations/Tools below (always shows the section, with a plain
  // "not recyclable" note rather than omitting it).
  function renderRecycleYieldsCard(name) {
    const outputs = data.recycleYields && data.recycleYields[name];
    let html = `<div class="variant-card">`;
    html += outputs && outputs.length
      ? `<ul class="ingredient-list">${outputs
          .map((o) => {
            const countLabel = o.countMin === o.countMax ? `${o.countMin}` : `${o.countMin}–${o.countMax}`;
            const meta = o.prob < 1 ? `<span class="source-row-meta">${Math.round(o.prob * 100)}% chance</span>` : "";
            return `<li>${reportRowIcon(o.name)}<span class="ing-count">${countLabel}&times;</span>${jumpSpan(o.name, displayName(o.name))}${meta}</li>`;
          })
          .join("")}</ul>`
      : `<div class="req-flag-dim">Not recyclable.</div>`;
    html += `</div>`;
    return html;
  }

  function openYieldListHtml(entries) {
    return entries
      .map((o) => {
        const countLabel = o.countMin === o.countMax ? `${o.countMin}` : `${o.countMin}–${o.countMax}`;
        return `<li>${reportRowIcon(o.name)}<span class="ing-count">${countLabel}&times;</span>${jumpSpan(o.name, displayName(o.name))}</li>`;
      })
      .join("");
  }

  // Straight from data.openYields (build.py's load_open_yields) -- the
  // item's own primary-use ("Open") action, e.g. a "Box of AP Robotic
  // Turret Ammo (1000)" opening into 1000 loose ammo, or a quest-reward
  // "Blade Trap Bundle" opening into several different items at once.
  // Unlike Scraps/Recycles Into (universal facts worth stating either way,
  // so always shown even as "Not scrappable"), only a small, specific set
  // of items can be opened at all -- the section is skipped entirely
  // rather than saying "doesn't open into anything" on every other page.
  //
  // Some bundles ALSO roll a random pick from a pool (data.openYields[x].
  // random) on top of their fixed items -- shown as its own sub-section,
  // explicitly flagged unvalidated: the pool/count-per-candidate shape is
  // read straight from the XML (see build.py's load_open_bundle_props for
  // the evidence pinning down what each field means), but the actual
  // in-game selection algorithm has never been confirmed by play-testing.
  function renderOpenYieldCard(name) {
    const opens = data.openYields && data.openYields[name];
    if (!opens || (!opens.items.length && !opens.random)) return "";
    let html = `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Opens Into</div>`;
    html += `<div class="variant-card">`;
    if (opens.items.length) {
      html += `<ul class="ingredient-list">${openYieldListHtml(opens.items)}</ul>`;
    }
    if (opens.random) {
      const r = opens.random;
      const pickLabel = `${r.pickCount}${r.unique ? " unique" : ""} random pick${r.pickCount === 1 ? "" : "s"}`;
      if (opens.items.length) html += `<div class="req-flag-dim" style="margin-top:10px;">plus ${pickLabel} from:</div>`;
      else html += `<div class="req-flag-dim">${pickLabel} from:</div>`;
      html += `<ul class="ingredient-list">${openYieldListHtml(r.pool)}</ul>`;
      html += `<div class="warning-note">Random-pick contents are inferred from the mod's own data (candidate pool, per-candidate count, and how many get drawn) -- not confirmed by in-game testing, so treat the exact selection odds as unvalidated.</div>`;
    }
    html += `</div>`;
    return html;
  }

  // Straight from data.scrapYields (build.py's load_scrap_data) -- like
  // Recycles Into, a flat terminal fact rather than a toggleable tree, but
  // simpler: the in-inventory Scrap action always yields exactly one
  // resource type at one fixed count (derived from the item's own Weight
  // property), never a range or multiple outputs the way the Recycler is.
  function renderScrapYieldCard(name) {
    const scrap = data.scrapYields && data.scrapYields[name];
    let html = `<div class="variant-card">`;
    html += scrap
      ? `<ul class="ingredient-list"><li>${reportRowIcon(scrap.name)}<span class="ing-count">${scrap.count}&times;</span>${jumpSpan(scrap.name, displayName(scrap.name))}</li></ul>`
      : `<div class="req-flag-dim">Not scrappable.</div>`;
    html += `</div>`;
    return html;
  }

  // One-Time Totals lives in the left nav now, below the results list,
  // rather than at the bottom of the report -- it's a running summary you
  // want visible while you're browsing/expanding, not something to scroll
  // all the way down to see. Re-rendered alongside the report itself since
  // it reflects the exact same expand state.
  function renderTotalsPanel(report) {
    const panel = document.getElementById("totals-panel");
    if (!panel) return;
    // Merges the per-craft Crafting Cost total in with the one-time
    // research/workstation/tool total: a recipe's own direct ingredients
    // are always counted here (root children are never collapsed away), so
    // opening a recipe with nothing expanded shows exactly what it costs to
    // make one -- expanding anything just adds to the same running total
    // instead of needing a second card to check.
    const combined = new Map(report.oneTimeTotals);
    for (const [k, v] of report.constructionTotals) {
      combined.set(k, (combined.get(k) || 0) + v);
    }
    panel.innerHTML = renderTotalsCard(
      "One-Time Totals",
      combined,
      "Nothing expanded yet -- everything above is assumed already in hand.",
      "Expanding a workstation, tool, or research step adds its own cost here too, same as an ingredient -- leaving it collapsed means “I already have this.”"
    );
  }

  function renderReportBody() {
    const { kind, name, recipeId, qty } = reportState;
    const report = buildInteractiveReport(reportState);
    const pageName = kind === "workstation" ? workstationDisplayName(name) : displayName(name);

    let html = `<div class="detail-header">`;
    if (kind === "research") {
      html += researchChip(name, pageName, "detail-icon", "detail-title", "research-chip-large");
    } else {
      const ringClass = kind === "workstation" ? " icon-ring-workstation" : "";
      const textClass = kind === "workstation" || kind === "recipe" ? ` text-${kind}` : "";
      const icon = iconFor(name);
      html += icon ? `<img class="detail-icon${ringClass}" src="${icon}" alt="">` : "";
      html += `<div class="detail-title${textClass}">${pageName}</div>`;
    }
    // Acquisition (craftable/harvestable/purchasable/lootable/rewardable) is
    // about how to obtain an ITEM -- meaningless for a research node itself,
    // so it's skipped there. Lives on the title row, pushed to the right,
    // rather than its own separate card further down.
    if (kind !== "research") html += acquisitionBadges(name);
    html += `</div>`;
    html += iconFallbackNote(name);
    html += renderFactsBlock(kind, name, recipeId);

    // Tier 1 of a workstation is a normal recipe underneath, so it gets the
    // same variant picker as any other recipe -- just no Quantity, since
    // you only ever build one of a given tier.
    const isBaseTierWorkstation = kind === "workstation" && tierInfo[name].tierIndex === 0;
    if (kind === "recipe" || isBaseTierWorkstation) {
      const ids = data.recipesByName[name] || [];
      const showQty = kind === "recipe";
      const showVariant = ids.length > 1;
      if (showQty || showVariant) {
        html += `<div class="report-controls">`;
        if (showQty) html += `<label>Quantity: <input id="report-qty" type="number" min="1" step="1" value="${qty}"></label>`;
        if (showVariant) {
          html += `<label>Recipe variant: <select id="report-variant">`;
          html += ids
            .map((id) => {
              const r = data.recipes[id];
              const sel = id === (recipeId || ids[0]) ? " selected" : "";
              return `<option value="${id}"${sel}>${id}${r.always_unlocked ? " (always unlocked)" : ""}</option>`;
            })
            .join("");
          html += `</select></label>`;
        }
        html += `</div>`;
      }
    }

    // "item" kind (a name with real acquisition/harvest/recycle data but no
    // recipe/research/workstation identity of its own -- see itemOnlyNames)
    // never has anything expandable, so this hint and the Crafting
    // Cost/Research Required/Workstations/Tools sections below (all about
    // requirements for MAKING something) would just be noise; only the
    // header's acquisition badges and Recycles Into apply.
    if (kind !== "item") {
      html += `<div class="req-flag-dim" style="margin-bottom:14px;">Click the &#9656; triangle on any craftable ingredient, workstation, or research step to say &ldquo;I'll make this myself&rdquo; and see its own cost &mdash; collapsed items are assumed already on hand (bought, looted, harvested, or already researched/built).</div>`;
    }

    // Section 1 -- crafting cost: ingredient edges only, counting only what's
    // currently expanded. Applies to a recipe (quantity multiplies through)
    // and to a workstation tier (its own upgrade/build cost, plus the
    // previous tier as one more collapsible requirement) -- not meaningful
    // for a bare research node. Material Totals dropped: One-Time Totals (in
    // the left nav) already covers the same ground when nothing's expanded,
    // and the two would just duplicate each other once something is.
    if ((kind === "recipe" || kind === "workstation") && report.constructionTree) {
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Crafting Cost</div>`;
      const costIntro =
        kind === "recipe"
          ? `What it costs to make ${qtyLabel(qty)}&times; ${pageName}, given everything expanded below.`
          : `What it costs to build ${pageName}, given everything expanded below.`;
      let rootRow, rootInner;
      if (kind === "recipe") {
        rootRow = `<div class="req-row-static">${reportRowIcon(name)}<span class="ing-count">${qtyLabel(report.constructionTree.qty)}&times;</span>${jumpSpan(name, pageName)} ${acquisitionBadges(name)}</div>`;
        rootInner = report.constructionTree.children.map(renderIngredientNode).join("");
      } else {
        rootRow = `<div class="req-row-static">${reportRowIcon(name)}<span>${pageName}</span> ${acquisitionBadges(name)}</div>`;
        rootInner = report.constructionTree.children.map(renderIngredientNode).join("");
        if (report.constructionTree.toolRef) {
          rootInner += `<li class="req-leaf req-dim">Tool: <span>${displayName(report.constructionTree.toolRef)}</span> <span class="req-flag-dim">(see Tools below)</span></li>`;
        }
      }
      html += `<div class="variant-card"><div class="req-flag-dim" style="margin:0 0 10px;">${costIntro}</div><ul class="req-tree req-tree-root"><li>${rootRow}<ul class="req-tree">${rootInner}</ul></li></ul></div>`;
    }

    // Section 2 -- one-time research/workstation/tool investment: each part
    // gets its own header with a live count instead of one shared
    // "Research & Workstations" umbrella, since they answer independent
    // questions once you're actually deciding what you still need. Not
    // meaningful for a bare "item" (see above) -- skipped entirely rather
    // than shown empty/misleading (e.g. "Always unlocked" reads oddly for
    // something that was never lockable in the first place).
    if (kind !== "item") {
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Research Required${report.researchCount ? ` (${report.researchCount})` : ""}</div>`;
      html += renderUnlockChainCard(report);
      html += `<div class="section-label" style="font-size:15px;color:var(--workstation);margin-top:20px;">Workstations${report.workstationNodes.length ? ` (${report.workstationNodes.length})` : ""}</div>`;
      html += renderWorkstationsCard(report);
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Tools${report.toolNodes.length ? ` (${report.toolNodes.length})` : ""}</div>`;
      html += renderToolsCard(report);
    }

    // A research node isn't itself an openable/scrappable/recyclable item --
    // it just happens to share its internal name with the item/recipe it
    // unlocks, which is where any openYields/scrapYields/recycleYields
    // entry for that name actually belongs. Opens Into shown above Scraps
    // Into shown above Recycles Into: in practice very few names have more
    // than one (they're three different kinds of item -- a bundle you open,
    // gear you scrap in your inventory, materials fed through the Recycler
    // block).
    if (kind !== "research") {
      html += renderOpenYieldCard(name);

      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Scraps Into</div>`;
      html += renderScrapYieldCard(name);

      const recycleOutputs = data.recycleYields && data.recycleYields[name];
      html += `<div class="section-label" style="font-size:15px;color:var(--acq-recyclable);margin-top:20px;">Recycles Into${recycleOutputs ? ` (${recycleOutputs.length})` : ""}</div>`;
      html += renderRecycleYieldsCard(name);
      html += renderPoiCard(name);
    }

    detailEl.innerHTML = html;
    renderTotalsPanel(report);
  }

  // "Found in POIs" -- every prefab (point of interest) that physically
  // contains this block, from data.poiBlocks (counted straight out of each
  // prefab's own block data at build time -- see build.js's loadPoiBlocks).
  // Only ever present for a name that is itself a placed block, so items
  // that exist only in inventory simply get no section. Grouped by how many
  // of it each POI holds, bucketed High/Medium/Low relative to the POI with
  // the most (same thresholds as Loot Sources' lootTierFor); within a
  // bucket, lowest difficulty tier first, then most copies, then name. The POI's own DifficultyTier is shown as
  // that many skull emoji on the right, like the in-game POI difficulty (an
  // emoji rather than a game icon: the real skull sprite lives inside a Unity
  // atlas that isn't extracted anywhere in the install). A
  // placeholder/randomizer stub placed in a prefab counts toward its most
  // likely real variant, like everywhere else a block is named here.
  const POI_COUNT_SECTIONS = [
    { tier: "high", label: "High Count" },
    { tier: "medium", label: "Medium Count" },
    { tier: "low", label: "Low Count" },
  ];

  function poiSkulls(tier) {
    if (!tier) return "";
    const label = `Difficulty tier ${tier}`;
    return `<span class="source-row-meta poi-skulls" title="${label}" aria-label="${label}">${"💀".repeat(tier)}</span>`;
  }

  // Hover preview of a POI's own <name>.jpg thumbnail -- read on demand,
  // never stored in the dataset. Where it comes from, in order:
  //   1. the install folder the browser build was pointed at (the saved
  //      FileSystemDirectoryHandle in storage.js), but only if the browser
  //      still has read access granted -- a hover can't ask for it (that
  //      needs a click), so a returning visit may find it expired: the
  //      popup then says so, and clicking the row asks once;
  //   2. otherwise server.py's /api/poi-image, if this page is served by it.
  // Anything that fails just means no picture -- never an error.
  const poiImageUrls = new Map();

  async function poiImageSource(poi, askPermission) {
    const storage = window.ULModBuddyStorage;
    let root = null;
    try {
      root = storage && (await storage.getSavedRoot());
    } catch (e) {
      /* no storage -- fall through to the server */
    }
    if (root && root.queryPermission) {
      let state = await root.queryPermission({ mode: "read" });
      if (state !== "granted" && askPermission) state = await root.requestPermission({ mode: "read" });
      if (state === "granted") {
        const folders = [["Mods", "UndeadLegacy", "Prefabs", "POIs"], ["Data", "Prefabs", "POIs"]];
        for (const parts of folders) {
          try {
            let dir = root;
            for (const p of parts) dir = await dir.getDirectoryHandle(p);
            const file = await (await dir.getFileHandle(poi + ".jpg")).getFile();
            return { url: URL.createObjectURL(file) };
          } catch (e) {
            /* not in this folder -- try the next */
          }
        }
        return { url: null };
      }
      return { needsPermission: true };
    }
    try {
      const resp = await fetch(`/api/poi-image?name=${encodeURIComponent(poi)}`);
      if (resp.ok) return { url: URL.createObjectURL(await resp.blob()) };
    } catch (e) {
      /* no server behind this page */
    }
    return { url: null };
  }

  function poiImageFor(poi, askPermission) {
    const cached = poiImageUrls.get(poi);
    if (cached && !(askPermission && cached.needsPermission)) return cached.promise;
    const entry = { promise: poiImageSource(poi, askPermission) };
    poiImageUrls.set(poi, entry);
    entry.promise.then((r) => {
      entry.needsPermission = !!r.needsPermission;
      if (r.url === null) poiImageUrls.delete(poi);
    });
    return entry.promise;
  }

  let poiTipEl = null;
  let poiTipFor = null;

  function poiTip() {
    if (!poiTipEl) {
      poiTipEl = document.createElement("div");
      poiTipEl.className = "poi-tooltip";
      poiTipEl.hidden = true;
      document.body.appendChild(poiTipEl);
    }
    return poiTipEl;
  }

  function movePoiTip(e) {
    const tip = poiTip();
    const pad = 16;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = e.clientX + pad + w > window.innerWidth ? e.clientX - pad - w : e.clientX + pad;
    const y = Math.min(Math.max(8, e.clientY - h / 2), window.innerHeight - h - 8);
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = y + "px";
  }

  async function showPoiTip(poi, e, askPermission) {
    const tip = poiTip();
    poiTipFor = poi;
    const result = await poiImageFor(poi, askPermission);
    if (poiTipFor !== poi) return; // moved on while it loaded
    if (result.url) tip.innerHTML = `<img src="${result.url}" alt="">`;
    else if (result.needsPermission) tip.innerHTML = `<div class="poi-tooltip-note">Click this row to allow the browser to read POI pictures from your install folder.</div>`;
    else return;
    tip.hidden = false;
    movePoiTip(e);
  }

  function hidePoiTip() {
    poiTipFor = null;
    if (poiTipEl) poiTipEl.hidden = true;
  }

  detailEl.addEventListener("mouseover", (e) => {
    const row = e.target.closest("li[data-poi]");
    if (!row || (e.relatedTarget && row.contains(e.relatedTarget))) return;
    showPoiTip(row.dataset.poi, e, false);
  });
  detailEl.addEventListener("mousemove", (e) => {
    if (poiTipEl && !poiTipEl.hidden && e.target.closest("li[data-poi]")) movePoiTip(e);
  });
  detailEl.addEventListener("mouseout", (e) => {
    const row = e.target.closest("li[data-poi]");
    if (row && !row.contains(e.relatedTarget)) hidePoiTip();
  });
  detailEl.addEventListener("click", (e) => {
    const row = e.target.closest("li[data-poi]");
    if (row) showPoiTip(row.dataset.poi, e, true);
  });

  function renderPoiCard(name) {
    const perPoi = data.poiBlocks && data.poiBlocks[name];
    if (!perPoi) return "";
    // A POI with no recorded tier sorts after every real one.
    const tierOf = (poi) => {
      const t = data.pois && data.pois[poi] && data.pois[poi].tier;
      return t == null ? Infinity : t;
    };
    const entries = Object.entries(perPoi).sort(
      (a, b) =>
        tierOf(a[0]) - tierOf(b[0]) || b[1] - a[1] || displayName(a[0]).localeCompare(displayName(b[0]))
    );
    const best = Math.max(...entries.map(([, n]) => n));
    const body = POI_COUNT_SECTIONS.map(({ tier, label }) => {
      const rows = entries.filter(([, n]) => lootTierFor(n, best) === tier);
      if (!rows.length) return "";
      const items = rows
        .map(([poi, n]) => {
          const info = (data.pois && data.pois[poi]) || {};
          return (
            `<li${info.img ? ` data-poi="${poi}"` : ""}><span class="ing-count">${n}&times;</span><span><strong>${displayName(poi)}</strong> (${poi})</span>` +
            `${poiSkulls(info.tier)}</li>`
          );
        })
        .join("");
      return (
        `<div class="section-label source-tier-label source-tier-label-${tier}">${label} (${rows.length})</div>` +
        `<ul class="ingredient-list">${items}</ul>`
      );
    }).join("");
    return (
      `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Found in POIs (${entries.length})</div>` +
      `<div class="variant-card">${body}</div>`
    );
  }

  // A research page's whole point is sizing up what that research itself
  // costs -- its own top-level Research Required entry (just that one, not
  // its ancestor cascade) starts expanded rather than making that the
  // first click every time you open one.
  function initialExpandedPaths(kind, name) {
    const expanded = new Set();
    if (kind === "research") expanded.add("res:" + name);
    return expanded;
  }

  function openReport(kind, name, recipeId) {
    reportState = { kind, name, recipeId: recipeId || null, qty: 1, expanded: initialExpandedPaths(kind, name) };
    renderReportBody();
    detailEl.scrollTop = 0;
  }

  detailEl.addEventListener("click", (e) => {
    // Expand/collapse: a plain click handler rather than native <details>
    // (see the CSS comment on .req-toggle for why) -- toggles this path in
    // reportState.expanded and re-renders so the change propagates to
    // totals and any Workstations/Tools entries it triggers. These rows
    // deliberately carry no jump-to-item link: a click anywhere on the row
    // should toggle, never risk navigating away instead.
    const toggleRow = e.target.closest(".req-toggle");
    if (toggleRow && reportState) {
      const path = toggleRow.dataset.path;
      if (reportState.expanded.has(path)) reportState.expanded.delete(path);
      else reportState.expanded.add(path);
      renderReportBody();
      return;
    }
  });

  detailEl.addEventListener("input", (e) => {
    if (e.target.id === "report-qty" && reportState) {
      const v = parseFloat(e.target.value);
      reportState.qty = v && v > 0 ? v : 1;
      renderReportBody();
    }
  });

  detailEl.addEventListener("change", (e) => {
    if (e.target.id === "report-variant" && reportState) {
      reportState.recipeId = e.target.value;
      renderReportBody();
    }
  });

  renderResults();
  }

  return { init: init };
})();
