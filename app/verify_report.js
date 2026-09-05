// Node-only verification harness for reportEngine.js -- run on the device
// against the real built data.js. Not shipped to the browser app.
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "data.js");
let src = fs.readFileSync(dataPath, "utf8");
src = src.replace(/^\/\/.*$/m, "").trim();
src = src.replace(/^window\.COOKBOOK_DATA\s*=\s*/, "").replace(/;\s*$/, "");
const data = JSON.parse(src);

const { createReportEngine } = require("./reportEngine.js");
const engine = createReportEngine(data);

function displayName(name) {
  return (data.names && data.names[name]) || name;
}

function printReport(label, kind, name) {
  console.log(`\n=== ${label} (${kind}:${name}) ===`);
  const report = engine.buildReport(kind, name, null, 1);

  console.log("-- Research Requirements (order) --");
  if (!report.researchOrder.length) console.log("  (none)");
  report.researchOrder.forEach((n, i) => console.log(`  ${i + 1}. ${displayName(n)} [${n}]`));

  console.log("-- Material Requirements (totals) --");
  const rows = [...report.materialTotals.entries()].sort((a, b) => b[1] - a[1]);
  for (const [n, qty] of rows) {
    console.log(`  ${qty}x ${displayName(n)} [${n}]`);
  }

  if (report.unresolved.size) {
    console.log("-- UNRESOLVED (no traceable unlock) --");
    for (const n of report.unresolved) console.log(`  ${n}`);
  }

  return report;
}

// Worked example from project memory: Wood Storage -> Carpenter's Table
// T1->2 upgrade -> Carpenter's Axe + Saw -> Axe needs Blacksmith's Forge.
const woodStorageName = Object.keys(data.recipesByName).find((n) =>
  n.toLowerCase().includes("storagewood") || n.toLowerCase() === "ulmstoragewoodvarianthelper"
);
console.log("Resolved Wood Storage internal name:", woodStorageName);
const report = printReport("Wood Storage", "recipe", woodStorageName);

function treeContainsName(node, name) {
  if (!node) return false;
  if (node.name === name) return true;
  return (node.children || []).some((c) => treeContainsName(c, name));
}

const checks = [
  ["tree reaches ulmStationCarpenter_2 workstation", treeContainsName(report.tree, "ulmStationCarpenter_2")],
  ["research list non-empty", report.researchOrder.length > 0],
  ["material totals non-empty", report.materialTotals.size > 0],
];

// Does the tree/aggregate reach the Carpenter's Axe and Forge chain?
function collectAllNames(node, out) {
  if (!node) return out;
  if (node.name) out.add(node.name);
  (node.children || []).forEach((c) => collectAllNames(c, out));
  if (node.tool) collectAllNames(node.tool, out);
  (node.toolAlternatives || []).forEach((c) => collectAllNames(c, out));
  return out;
}
const allNames = collectAllNames(report.tree, new Set());
const axeName = [...allNames].find((n) => n.toLowerCase().includes("carpenter") && n.toLowerCase().includes("axe"));
checks.push(["tree includes a Carpenter's Axe-ish tool", !!axeName]);
if (axeName) {
  const forgeReport = null; // axe's own forge requirement is nested; just confirm forge station appears somewhere
}
checks.push(["tree includes ulmStationForge_1 (or any Forge tier) somewhere", [...allNames].some((n) => n.toLowerCase().includes("forge"))]);

console.log("\n=== Sanity checks ===");
let allPass = true;
for (const [label, pass] of checks) {
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass) allPass = false;
}
console.log(allPass ? "\nALL CHECKS PASSED" : "\nSOME CHECKS FAILED");
process.exit(allPass ? 0 : 1);
