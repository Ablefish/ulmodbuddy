// UL Mod Buddy -- Total Requirements Report engine.
//
// Pure logic, no DOM dependency, so it can be loaded in the browser app AND
// required directly under Node for automated verification against a real
// built data.js (see verify_report.js).
//
// Two separate passes over the same dependency graph:
//
//   1. CONSTRUCTION COSTS -- "if all research were known and all
//      workstations already built, what does it cost to make N of this?"
//      Follows Ingredient edges ONLY (consumed, quantity multiplies through
//      recursion). Tool and Workstation edges are never expanded here --
//      they're one-time investments, not part of the per-craft cost.
//
//   2. RESEARCH & WORKSTATIONS -- everything one-time you need to acquire
//      before you can craft this at all: the research chain that unlocks
//      it, every workstation (with its own base-tier unlock + upgrade-step
//      chain), and every tool (owned, not consumed -- treated like a small
//      workstation: it has its own one-time construction cost and can in
//      turn need its own research/workstation/tool). This is a FULL
//      recursive walk: research needed to unlock a nested tool or
//      ingredient, or a workstation needed to craft one, is included too,
//      not just the top-level target's own chain.
//
// Both passes run together in one buildReport() call so the recursive walk
// only happens once; `registerInfrastructure()` is the hook that feeds pass
// 2 as a side effect of pass 1's own recursion (and of pass 2's own nested
// one-time builds), which is what makes the "full recursive accounting"
// work without walking the graph twice.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ULModBuddyReportEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_DEPTH = 40;

  function createReportEngine(data) {
    // ---- static indices, built once per data.js load ----------------
    const upgradeByNext = {};
    Object.values(data.upgrades || {}).forEach((u) => {
      if (u.next) upgradeByNext[u.next] = u;
    });

    const directlyNamed = new Set();
    Object.values(data.research || {}).forEach((node) => {
      directlyNamed.add(node.name);
      (node.unlocks || []).forEach((u) => {
        if (u.name) directlyNamed.add(u.name);
      });
    });

    const alwaysAvailable = new Set(data.alwaysAvailableStations || []);

    const stationChainCache = new Map();

    function findResearchFor(name) {
      if (data.research[name]) return data.research[name];
      for (const node of Object.values(data.research)) {
        if ((node.unlocks || []).some((u) => u.name === name)) return node;
      }
      return null;
    }

    function baseTierUnlock(stationName) {
      if (alwaysAvailable.has(stationName)) return { type: "always", via: null };
      if (directlyNamed.has(stationName)) {
        const node = findResearchFor(stationName);
        return { type: "direct", via: node ? node.name : null };
      }
      return { type: "unknown", via: null };
    }

    // Walk backwards from `area` through upgrades indexed by `next` until
    // reaching a tier nothing upgrades into -- that's the base tier. Returns
    // the ordered (base -> area) list of upgrade steps plus the base tier's
    // own unlock info.
    function stationChain(area) {
      if (stationChainCache.has(area)) return stationChainCache.get(area);
      const steps = [];
      let cur = area;
      const seen = new Set();
      while (upgradeByNext[cur] && !seen.has(cur)) {
        seen.add(cur);
        const up = upgradeByNext[cur];
        steps.unshift(up);
        cur = up.block;
      }
      const result = { baseTier: cur, unlock: baseTierUnlock(cur), steps };
      stationChainCache.set(area, result);
      return result;
    }

    function bump(map, key, qty) {
      map.set(key, (map.get(key) || 0) + qty);
    }

    function pickDefaultRecipe(ids) {
      for (const id of ids) {
        if (data.recipes[id].always_unlocked) return data.recipes[id];
      }
      return data.recipes[ids[0]];
    }

    // ---- infra (pass 2) helpers ----------------------------------------

    // Root-first dependency chain: walk `parent` (and `requires`, if it
    // resolves to another research node) before inserting `name` itself.
    // Skips names already present so shared ancestors across branches are
    // only listed once, in their first-reached position. Whenever a name is
    // newly inserted, also expands ITS OWN research-cost ingredients (one
    // time, feeding infra.oneTimeTotals) -- this is the "walk the previous
    // researches, and cost their own ingredients" part of the design.
    //
    // `name` is resolved through findResearchFor() rather than looked up
    // directly: a recipe's own unlock.via is only sometimes a research
    // node's own key (the self-name-match case) -- when the node instead
    // names the recipe via an <unlocks> child, `via` is the RECIPE's name,
    // and data.research[name] would miss entirely, silently dropping the
    // whole chain.
    function addResearchChain(name, infra, visiting) {
      const node = findResearchFor(name);
      if (!node || infra.researchSet.has(node.name)) return;
      if (visiting.has(node.name)) return; // cycle guard
      visiting.add(node.name);
      if (node.parent) addResearchChain(node.parent, infra, visiting);
      if (node.requires && node.requires !== node.parent) {
        addResearchChain(node.requires, infra, visiting);
      }
      visiting.delete(node.name);
      if (!infra.researchSet.has(node.name)) {
        infra.researchSet.add(node.name);
        infra.researchOrder.push(node.name);
        const costChildren = (node.ingredients || [])
          .filter((ing) => ing.name)
          .map((ing) =>
            expandConstruction(
              ing.name,
              parseFloat(ing.count) || 1,
              infra.oneTimeTotals,
              infra,
              new Set(),
              0
            )
          );
        infra.researchIngredientTrees[node.name] = costChildren;
        // A research node is itself performed at a bench (e.g. a Research
        // Table tier) exactly the way a recipe is performed at its `area` --
        // register that bench as a workstation dependency too, so its own
        // base-tier unlock / upgrade-step cost is accounted for.
        if (node.area) {
          infra.researchArea[node.name] = node.area;
          expandInfraWorkstation(node.area, infra);
        }
      }
    }

    // Registers the one-time infrastructure a recipe needs (research, tool,
    // workstation) into `infra`, recursing into each. Called for every
    // recipe node touched anywhere -- the top-level target, any nested
    // ingredient, any tool's own recipe, any workstation-upgrade-step
    // ingredient -- which is what makes the accounting "full recursive"
    // rather than just covering the top-level target.
    function registerInfrastructure(recipe, infra) {
      if (recipe.unlock && recipe.unlock.type === "direct" && recipe.unlock.via) {
        addResearchChain(recipe.unlock.via, infra, new Set());
      } else if (recipe.unlock && recipe.unlock.type === "unknown") {
        infra.unresolved.add(recipe.name);
      }
      if (recipe.tool) expandInfraTool(recipe.tool, infra);
      if (recipe.area) expandInfraWorkstation(recipe.area, infra);
    }

    // A tool: owned, not consumed. Treated like a small workstation -- it
    // has its own one-time construction cost (via expandConstruction, fed
    // into infra.oneTimeTotals rather than the caller's per-craft totals)
    // and can itself need research/a workstation/another tool, which
    // registerInfrastructure recurses into. Deduplicated globally: the same
    // tool needed by multiple branches is only built out once.
    function expandInfraTool(name, infra) {
      const key = "tool:" + name;
      if (infra.builtOnce.has(key)) return;
      infra.builtOnce.add(key);
      const ids = data.recipesByName[name];
      const node = { kind: "tool", name, children: [] };
      if (ids && ids.length) {
        const recipe = pickDefaultRecipe(ids);
        registerInfrastructure(recipe, infra);
        node.children.push(
          expandConstruction(name, 1, infra.oneTimeTotals, infra, new Set(), 0, recipe)
        );
      } else {
        bump(infra.oneTimeTotals, name, 1);
        node.children.push({ kind: "material", name, qty: 1 });
      }
      infra.toolNodes.push(node);
    }

    // A workstation: base tier's own unlock (research or always-available),
    // then every upgrade step from base up to the required tier, each with
    // its own one-time ingredient cost (recursed via expandConstruction,
    // which also registers infra for anything those ingredients need) and
    // its own tools OR-list (first tool fully expanded and counted; any
    // further alternatives shown for information only, via a scratch infra
        // so they never pollute the real totals/dedup state).
    function expandInfraWorkstation(area, infra) {
      const key = "station:" + area;
      if (infra.builtOnce.has(key)) return;
      infra.builtOnce.add(key);

      const chain = stationChain(area);
      if (chain.unlock.type === "direct" && chain.unlock.via) {
        addResearchChain(chain.unlock.via, infra, new Set());
      } else if (chain.unlock.type === "unknown") {
        infra.unresolved.add(chain.baseTier);
      }

      const node = {
        kind: "workstation",
        name: area,
        baseTier: chain.baseTier,
        unlock: chain.unlock,
        children: [],
      };

      for (const step of chain.steps) {
        const stepNode = { kind: "upgradeStep", block: step.block, next: step.next, children: [] };
        for (const ing of step.ingredients) {
          if (!ing.name) continue;
          const subQty = parseFloat(ing.count) || 1;
          stepNode.children.push(
            expandConstruction(ing.name, subQty, infra.oneTimeTotals, infra, new Set(), 0)
          );
        }
        if (step.tools.length) {
          const [primary, ...alternatives] = step.tools;
          expandInfraTool(primary, infra);
          stepNode.toolRef = primary;
          stepNode.toolAlternatives = alternatives.map((t) => {
            const scratchInfra = {
              researchSet: new Set(infra.researchSet),
              researchOrder: [],
              researchIngredientTrees: {},
              researchArea: {},
              oneTimeTotals: new Map(),
              builtOnce: new Set(infra.builtOnce),
              toolNodes: [],
              workstationNodes: [],
              unresolved: new Set(),
            };
            expandInfraTool(t, scratchInfra);
            return scratchInfra.toolNodes[0] || { kind: "tool", name: t, children: [] };
          });
        }
        node.children.push(stepNode);
      }

      infra.workstationNodes.push(node);
    }

    // ---- construction cost pass (pass 1) --------------------------------
    // Ingredient edges ONLY. As a side effect, every recipe touched also
    // registers its own tool/workstation/research needs into `infra`
    // (shared across both passes) -- this is what makes pass 2 a "full
    // recursive" accounting rather than just the top-level target.
    function expandConstruction(name, qty, totalsMap, infra, ancestry, depth, forcedRecipe) {
      const ids = data.recipesByName[name];
      if (!forcedRecipe && (!ids || !ids.length)) {
        bump(totalsMap, name, qty);
        return { kind: "material", name, qty };
      }
      if (!forcedRecipe && (ancestry.has(name) || depth > MAX_DEPTH)) {
        bump(totalsMap, name, qty);
        return { kind: "material", name, qty, circular: true };
      }

      const recipe = forcedRecipe || pickDefaultRecipe(ids);
      registerInfrastructure(recipe, infra);

      const variantCount = ids ? ids.length : 1;
      const node = {
        kind: "recipe",
        name,
        recipeId: recipe.id,
        qty,
        alwaysUnlocked: recipe.always_unlocked,
        variantCount,
        children: [],
      };

      const newAncestry = new Set(ancestry);
      newAncestry.add(name);

      for (const ing of recipe.ingredients) {
        if (!ing.name) continue;
        const subQty = (parseFloat(ing.count) || 1) * qty;
        node.children.push(
          expandConstruction(ing.name, subQty, totalsMap, infra, newAncestry, depth + 1)
        );
      }

      return node;
    }

    function newInfra() {
      return {
        researchSet: new Set(),
        researchOrder: [],
        researchIngredientTrees: {},
        researchArea: {},
        oneTimeTotals: new Map(),
        builtOnce: new Set(),
        toolNodes: [],
        workstationNodes: [],
        unresolved: new Set(),
      };
    }

    // ---- top-level entry point ------------------------------------------
    // kind: "recipe" | "research" | "upgrade"
    // name: internal item/research/block name
    // recipeId: optional explicit recipe variant id (recipe target only)
    // qty: how many of the target to produce (recipe target only; ignored otherwise)
    function buildReport(kind, name, recipeId, qty) {
      qty = qty && qty > 0 ? qty : 1;
      const infra = newInfra();
      const constructionTotals = new Map();
      let constructionTree = null;
      let targetUnlock = null;

      if (kind === "recipe") {
        const forced = recipeId ? data.recipes[recipeId] : null;
        const ids = data.recipesByName[name];
        const recipeForUnlock = forced || (ids && ids.length ? pickDefaultRecipe(ids) : null);
        targetUnlock = recipeForUnlock ? recipeForUnlock.unlock : null;
        constructionTree = expandConstruction(
          name,
          qty,
          constructionTotals,
          infra,
          new Set(),
          0,
          forced
        );
      } else if (kind === "upgrade") {
        const up = data.upgrades[name];
        if (up) expandInfraWorkstation(up.next, infra);
        targetUnlock = null;
      } else if (kind === "research") {
        targetUnlock = { type: "direct", via: name };
        addResearchChain(name, infra, new Set());
      }

      return {
        construction: { tree: constructionTree, totals: constructionTotals },
        infrastructure: {
          targetUnlock,
          researchOrder: infra.researchOrder,
          researchIngredientTrees: infra.researchIngredientTrees,
          researchArea: infra.researchArea,
          toolNodes: infra.toolNodes,
          workstationNodes: infra.workstationNodes,
          totals: infra.oneTimeTotals,
        },
        unresolved: infra.unresolved,
      };
    }

    return { buildReport, stationChain, baseTierUnlock, addResearchChain, findResearchFor, pickDefaultRecipe };
  }

  return { createReportEngine };
});
