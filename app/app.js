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
  const treeCategorySelectEl = $("#tree-category-select");
  const treeCanvasWrapEl = $("#tree-canvas-wrap");

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

  // Confirmed against the real in-game research UI (JP, 2026-09-13): a
  // research node that unlocks exactly one object shows that object's own
  // icon; a node that's a "pure research" hub (0 or 2+ unlocks, no direct
  // item identity of its own) shows a generic research symbol instead --
  // never a borrowed, unrelated ingredient's icon, which is what the
  // previous fallback tier did. Priority:
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
  // Workstation tiers -- per JP's 2026-09-04 call: browse each tier of a
  // station (Tier 1, Tier 2, ...) as its own item instead of an abstract
  // "upgrade" entry. data.upgrades is keyed by the FROM tier (`block`); a
  // family's base tier never appears as a `next`, so that's how roots are
  // found. Tier 1's own cost is a normal recipe (data.recipesByName); every
  // later tier's cost is the upgrade INTO it (data.upgrades[prevTierName]).
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
  // buildable. Without this, such a name had data but no page: unsearchable
  // (never in `index` below), and unclickable everywhere it showed up as an
  // ingredient (see isKnownName/jumpSpan) -- found via JP's 2026-09-06
  // report that a known-to-exist recycle item was nowhere to be found.
  const orphanCandidates = new Set([
    ...Object.keys(data.acquisition || {}),
    ...Object.keys(data.harvestSources || {}),
    ...Object.keys(data.recycleYields || {}),
    ...Object.keys(data.recycleSources || {}),
    // Weapon/armor mods (item_modifiers.xml) -- some have no acquisition
    // channel this app tracks at all, so without their own explicit list
    // they'd be invisible even though they're real, ownable things (found
    // via JP's report on mods like "Ball Cap Mod" missing entirely).
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
  // separately produced a wall of identically-labeled "Renegade" results
  // where only one was ever the real page (JP's 2026-09-13 report: clicking
  // "Renegade" sometimes landed on a near-empty page). Excluded from the
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
    // nothing renders thousands of DOM nodes if the mod grows a lot -- but
    // unlike the old hard 400-row cutoff, this is never silent: if it ever
    // actually truncates, a note says so instead of the list just stopping
    // partway through the alphabet with no explanation.
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
  // Research tree -- JP's 2026-09-13 request. The in-game tabs turned out
  // NOT to be the 3 `area` values (those are just which physical Research
  // Station tier a node requires) -- walking every node's `parent` chain up
  // to its ultimate root instead produces 12 real category branches (e.g.
  // "Primitive Archery", "Novice Mechanic"). Per JP's follow-up: in-game,
  // one category is ONE continuous tree spanning all 3 tiers -- it's never
  // split into 3 separate tier trees -- so each category renders as a
  // single canvas with every one of its nodes, tier shown only as a color
  // ring rather than a hard split (an earlier version split by tier too,
  // which orphaned every node whose real parent lived in an earlier tier).
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

  const researchTreeGroups = new Map(); // root -> [research node, ...] (all tiers combined)
  for (const [name, node] of Object.entries(data.research)) {
    if (!node.pos) continue; // no coordinate to plot -- can't appear on any canvas
    const root = researchRootOf(name);
    if (!researchTreeGroups.has(root)) researchTreeGroups.set(root, []);
    researchTreeGroups.get(root).push(node);
  }
  const researchCategories = [...researchTreeGroups.keys()].sort((a, b) =>
    displayName(a).localeCompare(displayName(b))
  );

  function tierOf(area) {
    const m = area && /_(\d+)$/.exec(area);
    return m ? m[1] : "other";
  }

  // `pos` turned out to be relative to the node's own DIRECT parent, not an
  // absolute canvas coordinate -- confirmed by JP's 2026-09-13 report of
  // heavy node overlap, then verified against the source data: e.g. all 4
  // children of ulmVehicleBicycle1 sit at x=2 with evenly spaced y
  // (1.8/0.6/-0.6/-1.8), which only makes sense as "offset from parent",
  // and two unrelated nodes (ulmVehicleBicycle1, ulmVehicleMinibikeOld)
  // independently reuse the exact same pos="0,-4" -- impossible if these
  // were shared absolute coordinates. So the real position of any node is
  // its parent's real position plus its own `pos` delta, recursively --
  // now walked across a category's FULL node set (every tier at once), so
  // a tier-2 node's parent living in tier 1 is always found.
  function computeAbsolutePositions(nodes) {
    const nodeByName = new Map(nodes.map((n) => [n.name, n]));
    const resolved = new Map();
    const inProgress = new Set();
    function abs(name) {
      if (resolved.has(name)) return resolved.get(name);
      const n = nodeByName.get(name);
      const [dx, rawDy] = n.pos.split(",").map(Number);
      // The game's own y axis runs the opposite way from SVG's -- a more
      // negative dy means further DOWN in-game (confirmed by JP's
      // 2026-09-13 report: Comet Minibike sits below Minibike Maintenance
      // in-game, but rendered above it here) -- flipped once at the source
      // so every accumulated position downstream comes out already correct.
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

    const SCALE = 70;
    const PAD = 50;
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
    // tidy) rather than decoration. Unconfirmed against the game's actual
    // (compiled) renderer -- per JP's 2026-09-13 call, worth trying and
    // comparing against the in-game display rather than assuming.
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
      const r = n.size === "large" ? 26 : 18;
      const icon = iconForResearch(n.name);
      const cls =
        "tree-node" +
        ` tree-node-tier-${tierOf(n.area)}` +
        (n.size === "large" ? " tree-node-large" : "") +
        (n.unlocked ? " tree-node-unlocked" : "");
      nodesHtml += `<g class="${cls}" data-name="${n.name}" transform="translate(${p.x},${p.y})">`;
      nodesHtml += `<circle r="${r}"/>`;
      if (icon) nodesHtml += `<image href="${icon}" x="${-r * 0.7}" y="${-r * 0.7}" width="${r * 1.4}" height="${r * 1.4}"/>`;
      nodesHtml += `<text y="${r + 14}" text-anchor="middle">${displayName(n.name)}</text>`;
      nodesHtml += `</g>`;
    }

    return (
      `<svg class="tree-svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
      `<g class="tree-edges">${edges}</g><g class="tree-nodes">${nodesHtml}</g></svg>`
    );
  }

  const treeState = { root: null };

  function renderTreeCanvas() {
    treeCanvasWrapEl.innerHTML = renderResearchTreeSvg(treeState.root);
  }

  function selectTreeCategory(root) {
    treeState.root = root;
    treeCategorySelectEl.value = root;
    renderTreeCanvas();
  }

  function hideTreeModal() {
    treeModalEl.hidden = true;
  }

  function openTreeModal() {
    if (!treeCategorySelectEl.options.length) {
      treeCategorySelectEl.innerHTML = researchCategories
        .map((root) => `<option value="${root}">${displayName(root)} (${researchTreeGroups.get(root).length})</option>`)
        .join("");
    }
    if (!treeState.root) selectTreeCategory(researchCategories[0]);
    treeModalEl.hidden = false;
  }

  treeBtnEl.addEventListener("click", openTreeModal);
  treeModalCloseEl.addEventListener("click", hideTreeModal);
  treeModalEl.addEventListener("click", (e) => {
    if (e.target === treeModalEl) hideTreeModal();
  });
  treeCategorySelectEl.addEventListener("change", () => selectTreeCategory(treeCategorySelectEl.value));
  // Clicking a node jumps to its real page, same as any other cross-reference
  // in the app -- the tree is a navigation aid, not a separate mini-app.
  treeCanvasWrapEl.addEventListener("click", (e) => {
    const g = e.target.closest(".tree-node");
    if (!g) return;
    hideTreeModal();
    window.__cookbookJump(g.dataset.name);
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
  // Ordered least-common (left) to most-common (right) -- per JP's call, so
  // the badge you're most likely to see for any given item sits closest to
  // the name, and the rarer channels are the ones pushed furthest away.
  // Measured counts at build time: recyclable 83, harvestable 151,
  // rewardable 950, craftable ~921, lootable 1241, purchasable 1445.
  const ACQUISITION_LABELS = {
    recyclable: "Recycle",
    rewardable: "Quest",
    harvestable: "Harvest",
    craftable: "Craft",
    lootable: "Loot",
    purchasable: "Buy",
  };
  // The two badges with real detail behind them (data.harvestSources /
  // data.recycleSources) -- clickable only when that detail actually
  // exists for this name, rather than always-on and sometimes opening an
  // empty modal.
  const ACQUISITION_SOURCE_LINKS = {
    harvestable: { sources: () => data.harvestSources, fn: "__cookbookShowHarvest", title: "See harvest sources" },
    recyclable: { sources: () => data.recycleSources, fn: "__cookbookShowRecycleSources", title: "See recycle sources" },
  };
  // Wrapped in its own flex span (margin-left: auto) rather than left as
  // loose inline badges, so it pushes to the right edge of whatever
  // flex row it lands in -- per JP's call, the item name reads easier when
  // it isn't competing with a run of badges immediately after it.
  function acquisitionBadges(name) {
    const acq = data.acquisition && data.acquisition[name];
    if (!acq) return "";
    const badges = Object.keys(ACQUISITION_LABELS)
      .filter((k) => acq[k])
      .map((k) => {
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
  // Vehicle comparison table -- shown on every vehicle's own page (JP's
  // 2026-09-12 "let me compare all vehicles while deciding which to
  // repair" request), grouped by MaintenanceGroup (the repair-material
  // tier -- see the same day's "is the Ambulance a Car or a Van" answer:
  // it's the only classification the source data actually groups vehicles
  // by) with the currently-viewed vehicle's row highlighted. Column headers
  // are clickable to sort; sorting only ever reorders ROWS WITHIN a group
  // -- the groups themselves and their order never change -- per JP's
  // explicit call. Re-rendered in place (not via the full renderReportBody)
  // so clicking a header doesn't collapse whatever construction-tree state
  // is open elsewhere on the page.
  // ---------------------------------------------------------------------
  const VEHICLE_COLUMNS = [
    { key: "name", label: "Vehicle" },
    { key: "cargoCapacity", label: "Cargo (kg)", numeric: true },
    { key: "topSpeed", label: "Top Speed", numeric: true },
    { key: "weight", label: "Weight (kg)", numeric: true },
    // param1 of the CarryWeight property -- genuinely unconfirmed what this
    // represents (both "tow capacity" and "inventory slot count" were ruled
    // out per JP's 2026-09-12 investigation), so it's labeled by its raw
    // XML attribute name rather than a guessed meaning.
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
    const groups = new Map();
    for (const [name, v] of Object.entries(data.vehicles || {})) {
      const group = v.maintenanceGroup || "(none)";
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push([name, v]);
    }
    const groupLabel = (g) => g.replace(/^MG_/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    // In-game unlock progression, not alphabetical -- per JP's call: you get
    // a bike, then a minibike, then a motorcycle, then cars/vans (one
    // MaintenanceGroup covers both -- see the "is the Ambulance a Car or a
    // Van" answer, the source data never actually splits them), then
    // trucks, then a gyrocopter. Helicopters aren't part of that mental
    // model (JP didn't mention them) but still exist in the data, so they
    // sort after everything named, in whatever order they naturally fall.
    const GROUP_ORDER = ["MG_Bicycle", "MG_Minibike", "MG_Motorcycle", "MG_CarRepair", "MG_TruckRepair", "MG_Gyrocopter"];
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
  // vehicle has one: the five buildable "Placeable" vanilla templates never
  // showed up in the source data as independently repairable (only their
  // "ulm"-branded counterpart is, e.g. the Comet Minibike but not the
  // vanilla Minibike item) -- see JP's 2026-09-12 Renegade question.
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

  // The item's own facts -- what used to be a separate "details" page,
  // transplanted to the top of its Total Requirements page per JP's
  // 2026-09-04 call to merge the two: browsing an item and sizing up its
  // cost are the same task now, not two pages linked by a button. Doesn't
  // repeat the recipe's own Ingredients (the Construction Cost breakdown
  // right below already covers that, interactively) or a research node's
  // own cost (same reason -- see its Unlock Chain entry).
  function renderFactsBlock(kind, name, recipeId) {
    let html = "";
    // A recipe's Unlock/Workstation/Time/Yields/Tags/Source card is gone,
    // per JP's call: Unlock duplicated (and could disagree with -- see
    // unlockBadge's stale via-name bug) the Research Required section,
    // Workstation duplicated the Workstations section, and the rest wasn't
    // pulling its weight against the redundancy.
    if (kind === "research") {
      const node = data.research[name];
      html += `<div class="variant-card">`;
      html += `<div class="kv-row"><span class="k">Category</span><span>${node.category || "-"}</span></div>`;
      html += `<div class="kv-row"><span class="k">Parent</span><span>${node.parent ? displayName(node.parent) : "(root)"}</span></div>`;
      html += `<div class="kv-row"><span class="k">Unlocked by default</span><span>${node.unlocked ? "yes" : "no"}</span></div>`;
      if (node.requires) html += `<div class="kv-row"><span class="k">Requires</span><span>${displayName(node.requires)}</span></div>`;
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
    // rather than living inside the if/else above. See JP's 2026-09-12
    // "which car has the most storage" question.
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
  // Per JP's 2026-09-04 design: nothing auto-expands past the target itself.
  // Every craftable ingredient/tool/workstation/research step starts
  // collapsed (assume you'll buy/loot/harvest/already-have it) and shows a
  // native <details> triangle; clicking it says "I'll make this myself" and
  // reveals its own cost, which can itself cascade further. Totals
  // (construction and one-time alike) only count what's currently expanded.
  //
  // Expand state is path-keyed (per tree POSITION, not per item name) for
  // ingredients/research -- JP's call: owning one Beaker to build a
  // workstation doesn't mean you own a second one for some other recipe
  // that also needs one. Workstations and research nodes are keyed by name
  // instead, since those are singular, global facts ("I have a Chemistry
  // Station" / "I've researched Carpentry"), not consumable counts.
  // ---------------------------------------------------------------------
  let reportState = null; // { kind, name, recipeId, qty, expanded: Set<path> }

  // A name with no icon still reserves the icon's own width (an invisible
  // placeholder, same pattern as .result-icon.placeholder in the results
  // list) so every row's name starts at the same x position regardless of
  // which sibling rows happen to have real icons -- per JP's call, first
  // noticed in the harvest sources modal but applies everywhere this is used.
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
  // order the source XML happens to list them -- per JP's call, applied
  // uniformly everywhere a set of sibling ingredient/tier nodes is built.
  function sortByQtyDesc(children) {
    children.sort((a, b) => (b.qty || 0) - (a.qty || 0));
  }

  // ---- build pass: walks only what's currently expanded, gathering
  // totals + which workstations/tools are "in play" as a side effect ------

  // Shared by root ingredients, nested ingredients, workstation upgrade-step
  // ingredients, and research-cost ingredients -- they all follow the same
  // rule. `totalsMap` is construction- or one-time-totals depending on the
  // caller, keeping those two counts separate per JP's earlier call.
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
  // and on a workstation's own page too, per JP's call, rather than nested
  // inside its Crafting Cost tree -- and collapsing Tier 2 again should drop
  // it (naturally, since this whole report rebuilds from
  // reportState.expanded on every render).
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

  // Collapsed by default (JP: "I've already researched this"); expanding
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
        // ingredient -- per JP's call, it belongs in the Workstations
        // section like any other, not nested inside Crafting Cost. Reuses
        // the exact same registration buildWorkstationNode already knows
        // how to expand and cascade further back (Tier 1, if this is Tier
        // 3), rather than a separate nested-tree code path for it.
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
      // No "raw material -- no recipe" note here anymore (JP's call): the
      // absence of a Craft acquisition badge already says that. Circular
      // reference stays -- it's a real edge case the badges don't cover.
      const tag = node.circular ? ` <span class="req-flag">(circular reference &mdash; counted as raw here)</span>` : "";
      return `<li class="req-leaf">${reportRowIcon(node.name)}<span class="ing-count">${qtyLabel(node.qty)}&times;</span>${jumpSpan(node.name, displayName(node.name))}${tag} ${acquisitionBadges(node.name)}</li>`;
    }
    // Plain text, not jumpSpan: this whole row is a click-to-toggle target,
    // and a nested navigate-away link on the name made clicking anywhere
    // near it a gamble between expanding and leaving the report entirely.
    // (Recipe-variant/always-unlocked detail used to show here as a
    // parenthetical -- dropped per JP's call: it wasn't telling you anything
    // the acquisition badges don't already cover, just crowding the row.)
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
    // Green font, no icon ring: per JP's call, a workstation is fundamentally
    // "an item" here (same as in the Ingredient Breakdown's nested tier
    // requirement), so it doesn't get the research-style ring treatment.
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
    // Blue pill around icon + name, per JP's call: the Unlock Chain mixes
    // research nodes with the plain items they cost, and with so many
    // research entries cascading through one item's chain, the two need to
    // read as visually distinct at a glance.
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
  function renderTotalsCard(title, totalsMap, emptyLabel) {
    const rows = [...totalsMap.entries()].sort((a, b) => b[1] - a[1]);
    let html = `<div class="variant-card">`;
    html += `<div class="section-label">${title}${rows.length ? ` (${rows.length} distinct)` : ""}</div>`;
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
  // ingredient can be. Per JP's 2026-09-05 call: shown as part of an item's
  // own page, same convention as Workstations/Tools below (always shows the
  // section, with a plain "not recyclable" note rather than omitting it).
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

  // One-Time Totals lives in the left nav now, below the results list,
  // rather than at the bottom of the report -- it's a running summary you
  // want visible while you're browsing/expanding, not something to scroll
  // all the way down to see. Re-rendered alongside the report itself since
  // it reflects the exact same expand state.
  function renderTotalsPanel(report) {
    const panel = document.getElementById("totals-panel");
    if (!panel) return;
    // Merges the per-craft Crafting Cost total in with the one-time
    // research/workstation/tool total, per JP's call: a recipe's own direct
    // ingredients are always counted here (root children are never
    // collapsed away), so opening a recipe with nothing expanded shows
    // exactly what it costs to make one -- expanding anything just adds to
    // the same running total instead of needing a second card to check.
    const combined = new Map(report.oneTimeTotals);
    for (const [k, v] of report.constructionTotals) {
      combined.set(k, (combined.get(k) || 0) + v);
    }
    panel.innerHTML = renderTotalsCard("One-Time Totals", combined, "None currently expanded.");
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
    // per JP's call, so it's skipped there. Lives on the title row, pushed
    // to the right, rather than its own separate card further down.
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
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Workstations${report.workstationNodes.length ? ` (${report.workstationNodes.length})` : ""}</div>`;
      html += renderWorkstationsCard(report);
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Tools${report.toolNodes.length ? ` (${report.toolNodes.length})` : ""}</div>`;
      html += renderToolsCard(report);
    }

    // A research node isn't itself a recyclable item -- it just happens to
    // share its internal name with the item/recipe it unlocks, which is
    // where any recycleYields entry for that name actually belongs.
    if (kind !== "research") {
      const recycleOutputs = data.recycleYields && data.recycleYields[name];
      html += `<div class="section-label" style="font-size:15px;color:var(--accent);margin-top:20px;">Recycles Into${recycleOutputs ? ` (${recycleOutputs.length})` : ""}</div>`;
      html += renderRecycleYieldsCard(name);
    }

    detailEl.innerHTML = html;
    renderTotalsPanel(report);
  }

  // A research page's whole point is sizing up what that research itself
  // costs -- per JP's call, its own top-level Research Required entry
  // (just that one, not its ancestor cascade) starts expanded rather than
  // making that the first click every time you open one.
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
    // deliberately carry no jump-to-item link (JP's call: a click anywhere
    // on the row should toggle, never risk navigating away instead).
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
