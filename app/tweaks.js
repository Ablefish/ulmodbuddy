// UL Mod Buddy -- "Tweaks": scale the Old Book and research-data costs in
// research nodes, workstation upgrades and maintenance-bench upgrades, then
// hand back a small standalone mod (a zip) of XML patches.
//
// Nothing here touches the player's install. The generated mod is a separate
// folder that loads after Undead Legacy and rewrites the ingredient counts it
// was asked to change, so deleting that folder undoes everything. The new
// counts are computed here from the dataset (XML patches can't do arithmetic),
// one <setattribute> or <remove> per ingredient line.
//
// Exposes window.ULModBuddyTweaks.init(data), called once from app.js.
window.ULModBuddyTweaks = (function () {
  "use strict";

  const MOD_FOLDER = "zz_ULModBuddyTweaks";
  const STORAGE_KEY = "ulmodbuddy.tweaks.v1";
  const BOOK_NAME = "ulmResourceBook";
  // "Data" = the research-point items. The 23 other ulmResourceBook* names are
  // loot items that scrap into these, never ingredients, so they aren't here.
  const DATA_NAMES = new Set([
    "ulmResourceResearch",
    "ulmResourceResearchEngineering",
    "ulmResourceResearchAdvanced",
    "ulmResourceResearchArmor",
    "ulmResourceResearchTools",
    "ulmResourceResearchGuns",
    "ulmResourceResearchChemistry",
    "ulmResourceResearchBiology",
  ]);

  const CATEGORIES = [
    { key: "research", label: "Research tree", hint: "Cost to research each node" },
    { key: "workstation", label: "Workstation upgrades", hint: "Cost to upgrade a workstation to its next tier" },
    { key: "maintenance", label: "Maintenance bench", hint: "Cost to upgrade a weapon, armor or tool to its next grade" },
  ];
  const KINDS = [
    { key: "books", label: "Books", hint: "Old Books", match: (n) => n === BOOK_NAME },
    { key: "data", label: "Data", hint: "Basic, Engineering, Advanced, Armor, Tools, Guns, Chemistry and Biology research", match: (n) => DATA_NAMES.has(n) },
  ];

  const fieldKey = (cat, kind) => `${cat}.${kind}`;

  // New count for a line, or null to remove it. Whole percents only, so the
  // arithmetic stays in integers (no 0.1 * 30 style float drift).
  function scaleCount(count, pct) {
    if (pct === 0) return null;
    return Math.ceil((count * pct) / 100);
  }

  const xq = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

  // One entry = a list of ingredient lines under a shared xpath prefix. The
  // 1-based position among same-named lines keeps the patch exact when an
  // entry lists an ingredient twice (several armor upgrades do).
  function entryPatches(prefix, ingredients, settings, catKey, stats) {
    const patches = [];
    const seen = {};
    const lines = ingredients.map((ing) => {
      seen[ing.name] = (seen[ing.name] || 0) + 1;
      return { ing, pos: seen[ing.name] };
    });
    const kindOf = (name) => KINDS.find((k) => k.match(name));
    const removals = [];
    let kept = lines.length;
    for (const { ing, pos } of lines) {
      const kind = kindOf(ing.name);
      if (!kind) continue;
      const pct = settings[fieldKey(catKey, kind.key)];
      if (pct === 100) continue;
      const old = parseInt(ing.count, 10);
      if (!Number.isFinite(old)) continue;
      const next = scaleCount(old, pct);
      const xpath = `${prefix}/ingredient[@name='${ing.name}'][${pos}]`;
      if (next === null) {
        removals.push({ xpath, kind: kind.key });
        kept--;
      } else if (next !== old) {
        patches.push(`<setattribute xpath="${xq(xpath)}" name="count">${next}</setattribute>`);
        stats[catKey][kind.key].changed++;
      }
    }
    // A recipe with nothing left in it is worse than one with a leftover
    // line, so if every ingredient would go, the last one stays untouched.
    if (kept === 0 && removals.length) {
      removals.pop();
      stats[catKey].kept++;
    }
    // Highest position first: removing [1] would otherwise renumber [2].
    for (const r of removals.reverse()) {
      patches.push(`<remove xpath="${xq(r.xpath)}"/>`);
      stats[catKey][r.kind].removed++;
    }
    return patches;
  }

  function emptyStats() {
    const s = {};
    for (const c of CATEGORIES) s[c.key] = { kept: 0, books: { changed: 0, removed: 0 }, data: { changed: 0, removed: 0 } };
    return s;
  }

  function buildPatches(fullData, settings) {
    // Patch the game's own counts: if another mod (even an earlier Tweaks zip)
    // already changed what the app shows, scaling those would compound.
    const data = Object.assign({}, fullData, fullData.tweakBase || {});
    const stats = emptyStats();
    const out = [];
    const active = (cat) => KINDS.some((k) => settings[fieldKey(cat, k.key)] !== 100);

    if (active("research")) {
      out.push("<!-- Research tree -->");
      for (const node of Object.values(data.research || {})) {
        out.push(...entryPatches(`/recipes/research[@name='${node.name}']`, node.ingredients, settings, "research", stats));
      }
    }
    if (active("workstation")) {
      out.push("<!-- Workstation upgrades -->");
      for (const up of Object.values(data.upgrades || {})) {
        out.push(...entryPatches(`/recipes/upgrade[@block='${up.block}']`, up.ingredients, settings, "workstation", stats));
      }
    }
    if (active("maintenance")) {
      out.push("<!-- Maintenance bench -->");
      // `copy` indexes duplicate <modify group> blocks, so each is patched
      // on its own (they hold different counts and different research items).
      for (const block of data.maintenance || []) {
        for (const up of block.upgrades) {
          const sel = block.group ? `@group='${block.group}'` : `@name='${block.name}'`;
          const prefix = `/recipes/modify[${sel}][${block.copy}]/upgrade[@quality='${up.quality}']`;
          out.push(...entryPatches(prefix, up.ingredients, settings, "maintenance", stats));
        }
      }
    }
    return { patches: out.filter((p) => !p.startsWith("<!--")).length ? out : [], stats };
  }

  const pctLabel = (p) => `${p}%`;

  function settingsSummary(settings) {
    return CATEGORIES.map(
      (c) => `  ${c.label}: Books ${pctLabel(settings[fieldKey(c.key, "books")])}, Data ${pctLabel(settings[fieldKey(c.key, "data")])}`
    ).join("\n");
  }

  function modInfoXml(data) {
    return (
      `<?xml version="1.0" encoding="UTF-8" ?>\n<xml>\n` +
      `\t<Version value="1.0.0"/>\n` +
      `\t<Name value="${MOD_FOLDER}"/>\n` +
      `\t<DisplayName value="UL Mod Buddy Tweaks - book and data cost scaling"/>\n` +
      `\t<Author value="UL Mod Buddy"/>\n` +
      `</xml>\n`
    );
  }

  function recipesXml(patches) {
    return `<?xml version="1.0" encoding="UTF-8" ?>\n<configs>\n${patches.map((p) => (p.startsWith("<!--") ? `\n${p}` : p)).join("\n")}\n</configs>\n`;
  }

  function readmeText(data, settings, stats) {
    const lines = [
      "UL Mod Buddy Tweaks",
      "",
      "Generated by UL Mod Buddy from your own install. Scales how many Old Books",
      "and research-data items (Basic, Engineering, Advanced, Armor, Tools, Guns,",
      "Chemistry, Biology) the game asks for. Nothing else is changed.",
      "",
      "Settings used (100% = unchanged, 0% = removed, otherwise rounded up):",
      settingsSummary(settings),
      "",
      "Install: this folder must end up as Mods\\" + MOD_FOLDER + " (next to UndeadLegacy),",
      "with ModInfo.xml directly inside it -- not one folder deeper. Then restart the game.",
      "To undo it, delete the folder.",
      "",
      "Generated against: " + ((data.meta && data.meta.sourceVersion) || "your installed Undead Legacy") + ".",
      "After updating Undead Legacy, generate this mod again.",
      "",
    ];
    return lines.join("\n");
  }

  // ---------------------------------------------------------------------
  // Minimal store-only zip writer -- no compression, so no library needed.
  // ---------------------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function makeZip(files) {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.path);
      const body = enc.encode(f.content);
      const crc = crc32(body);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // UTF-8 names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, body.length, true);
      local.setUint32(22, body.length, true);
      local.setUint16(26, name.length, true);
      chunks.push(new Uint8Array(local.buffer), name, body);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, body.length, true);
      cd.setUint32(24, body.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), name);
      offset += 30 + name.length + body.length;
    }
    const cdSize = central.reduce((n, c) => n + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: "application/zip" });
  }

  function generateMod(data, settings) {
    const { patches, stats } = buildPatches(data, settings);
    const files = [
      { path: "ModInfo.xml", content: modInfoXml(data) },
      { path: "Config/recipes.xml", content: recipesXml(patches) },
      { path: "README.txt", content: readmeText(data, settings, stats) },
    ];
    return { files, stats, patchCount: patches.filter((p) => !p.startsWith("<!--")).length };
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  function defaultSettings() {
    const s = {};
    for (const c of CATEGORIES) for (const k of KINDS) s[fieldKey(c.key, k.key)] = 100;
    return s;
  }

  function loadSettings() {
    const s = defaultSettings();
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      for (const key in s) {
        const v = saved[key];
        if (Number.isInteger(v) && v >= 0 && v <= 200 && v % 10 === 0) s[key] = v;
      }
    } catch (e) {
      /* private mode or corrupt value: fall back to defaults */
    }
    return s;
  }

  function saveSettings(s) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch (e) {
      /* not critical */
    }
  }

  function init(data) {
    const btn = document.getElementById("tweaks-btn");
    const modal = document.getElementById("tweaks-modal");
    if (!btn || !modal) return;
    const body = document.getElementById("tweaks-body");
    const closeBtn = document.getElementById("tweaks-modal-close");
    const settings = loadSettings();
    const hasMaintenance = Array.isArray(data.maintenance) && data.maintenance.length > 0;

    btn.hidden = false;
    btn.addEventListener("click", () => {
      render();
      modal.hidden = false;
    });
    closeBtn.addEventListener("click", () => (modal.hidden = true));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.hidden = true;
    });

    function render() {
      const rows = CATEGORIES.map((c) => {
        const cells = KINDS.map((k) => {
          const id = `tweak-${c.key}-${k.key}`;
          const v = settings[fieldKey(c.key, k.key)];
          return (
            `<label class="tweak-slider" for="${id}" title="${k.hint}">` +
            `<span class="tweak-slider-label">${k.label}</span>` +
            `<input type="range" id="${id}" min="0" max="200" step="10" value="${v}" data-cat="${c.key}" data-kind="${k.key}">` +
            `<span class="tweak-slider-value" id="${id}-val">${pctLabel(v)}</span></label>`
          );
        }).join("");
        return `<div class="tweak-row"><div class="tweak-row-title">${c.label}<span class="tweak-row-hint">${c.hint}</span></div>${cells}</div>`;
      }).join("");
      const missing = hasMaintenance
        ? ""
        : `<div class="build-error">Maintenance data isn't in your saved dataset yet. Click <strong>Rebuild data</strong> in the header to include it.</div>`;
      body.innerHTML =
        `<p class="build-intro">Scale how many <strong>Old Books</strong> and <strong>research data</strong> items ` +
        `the game asks for. 100% leaves a cost alone, 0% removes it, anything else is rounded up so a cost never ` +
        `silently vanishes. This builds a separate mod you drop into <code>Mods</code>; your install is not touched.</p>` +
        `<p class="build-intro">Install: right-click the zip, <em>Extract All&hellip;</em>, and extract it into your game's ` +
        `<code>Mods</code> folder. You should end up with <code>Mods\\${MOD_FOLDER}\\ModInfo.xml</code> (not one folder deeper).</p>` +
        missing + rows +
        `<div class="tweak-summary" id="tweaks-summary"></div>` +
        `<div class="tweak-actions"><button type="button" id="tweaks-reset" class="rebuild-btn">Reset all to 100%</button>` +
        `<button type="button" id="tweaks-download" class="rebuild-btn tweak-download">Download mod (.zip)</button></div>`;

      body.querySelectorAll("input[type=range]").forEach((el) => {
        el.addEventListener("input", () => {
          const v = parseInt(el.value, 10);
          settings[fieldKey(el.dataset.cat, el.dataset.kind)] = v;
          document.getElementById(`${el.id}-val`).textContent = pctLabel(v);
          saveSettings(settings);
          refreshSummary();
        });
      });
      document.getElementById("tweaks-reset").addEventListener("click", () => {
        Object.assign(settings, defaultSettings());
        saveSettings(settings);
        render();
      });
      document.getElementById("tweaks-download").addEventListener("click", download);
      refreshSummary();
    }

    function refreshSummary() {
      const { stats, patchCount } = generateMod(data, settings);
      const el = document.getElementById("tweaks-summary");
      const dl = document.getElementById("tweaks-download");
      if (dl) dl.disabled = patchCount === 0;
      if (patchCount === 0) {
        el.textContent = "Every slider is at 100%, so there is nothing to change yet.";
        return;
      }
      const lines = CATEGORIES.map((c) => {
        const s = stats[c.key];
        const parts = KINDS.map((k) => {
          const x = s[k.key];
          return x.changed || x.removed ? `${k.label.toLowerCase()}: ${x.changed} changed, ${x.removed} removed` : null;
        }).filter(Boolean);
        return parts.length ? `${c.label} -- ${parts.join("; ")}` : null;
      }).filter(Boolean);
      el.innerHTML = `<strong>${patchCount.toLocaleString()} cost lines will change</strong><br>${lines.join("<br>")}`;
    }

    function download() {
      const { files } = generateMod(data, settings);
      const url = URL.createObjectURL(makeZip(files));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${MOD_FOLDER}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  return { init, generateMod, scaleCount, makeZip };
})();
