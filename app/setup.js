// UL Mod Buddy build-setup flow -- the "point me at your install" modal.
//
// Zero-install version: there's no server, no data.js generated ahead of
// time -- the dataset is either read back from IndexedDB (a previous visit's
// build, cached by storage.js) or built live in the browser (build.js)
// against a folder the user grants access to via the File System Access
// API. This file owns the whole flow: it opens the modal automatically (no
// way to cancel, since there's nothing usable behind it yet) when no cached
// dataset exists, and exposes window.ULModBuddySetup.open({allowCancel}) so
// app.js's "Rebuild data" button can reopen it later.
//
// One picked folder handle is reused across visits. Once a folder's been
// picked once, the modal offers two explicit choices rather than silently
// guessing which one you want: "Rebuild from current folder" (re-confirms
// permission on the saved handle -- needs a user gesture, which this button
// click provides) or "Choose a different folder..." (always opens a fresh
// picker, e.g. switching between a live install and a test/clone one).
// First-run setup has no saved folder yet, so it's just the one button.
//
// window.ULModBuddyApp.init(data) is called EXACTLY ONCE per real page load
// -- a first-run build calls it directly (nothing has initialized yet this
// load), while a "Rebuild data" success always reloads instead, so app.js's
// event listeners are never registered twice. Loaded before app.js -- see
// index.html's script order.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const modalEl = $("#build-modal");
  const cancelEl = $("#build-cancel");
  const chooseEl = $("#build-choose");
  const chooseNewEl = $("#build-choose-new");
  const unsupportedEl = $("#build-unsupported");
  const errorEl = $("#build-error");
  const statusEl = $("#build-status");
  const logEl = $("#build-log");

  const storage = window.ULModBuddyStorage;
  const builder = window.ULModBuddyBuilder;
  const supported = typeof window.showDirectoryPicker === "function";

  let allowCancel = false;
  // Whether a saved root exists is what decides the modal's button layout
  // (see open() below) -- re-checked every time the modal opens, since
  // "Rebuild data" can run long after the initial pick.
  let hasSavedRoot = false;

  function setBuilding(isBuilding) {
    chooseEl.disabled = isBuilding || !supported;
    chooseNewEl.disabled = isBuilding || !supported;
    chooseEl.textContent = isBuilding
      ? "Building…"
      : hasSavedRoot
      ? "Rebuild from current folder"
      : "Choose your install folder…";
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function appendLog(line) {
    logEl.textContent += (logEl.textContent ? "\n" : "") + line;
    logEl.scrollTop = logEl.scrollHeight;
  }

  async function open(opts) {
    opts = opts || {};
    allowCancel = !!opts.allowCancel;
    cancelEl.hidden = !allowCancel;
    clearError();
    statusEl.textContent = "";
    logEl.textContent = "";
    unsupportedEl.hidden = supported;
    const saved = await storage.getSavedRoot().catch(() => null);
    hasSavedRoot = !!saved;
    // Only worth offering a choice once there's a *current* folder to
    // rebuild from -- first-run setup has nothing to contrast "a different
    // folder" against, so it stays a single button there.
    chooseNewEl.hidden = !hasSavedRoot;
    setBuilding(false);
    modalEl.hidden = false;
  }

  function close() {
    if (!allowCancel) return; // nothing to fall back to on first-run setup
    modalEl.hidden = true;
  }

  cancelEl.addEventListener("click", close);
  modalEl.addEventListener("click", (e) => {
    if (e.target === modalEl) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modalEl.hidden) close();
  });

  // Re-confirms permission on the already-saved root -- queryPermission
  // never prompts, requestPermission does but only needs a user gesture,
  // which this button click provides. No picker fallback here: "rebuild
  // from the current folder" should mean exactly that; pickNewHandle()
  // below is the explicit "no, a different folder" path. Returns null if
  // permission isn't granted, so the caller can surface that rather than
  // silently doing nothing.
  async function getSavedHandle() {
    const saved = await storage.getSavedRoot().catch(() => null);
    if (!saved) return null;
    const already = await saved.queryPermission({ mode: "read" }).catch(() => "prompt");
    if (already === "granted") return saved;
    const granted = await saved.requestPermission({ mode: "read" }).catch(() => "denied");
    return granted === "granted" ? saved : null;
  }

  async function pickNewHandle() {
    return await window.showDirectoryPicker();
  }

  async function runBuild(getHandle) {
    clearError();
    setBuilding(true);
    statusEl.textContent = "Waiting for folder access…";
    logEl.textContent = "";
    try {
      const handle = await getHandle();
      if (!handle) {
        setBuilding(false);
        statusEl.textContent = "";
        showError("Couldn't reuse the saved folder (permission wasn't granted) -- try “Choose a different folder…” instead.");
        return;
      }
      statusEl.textContent = "Building…";
      const dataset = await builder.build(handle, appendLog);
      await storage.saveRoot(handle);
      await storage.saveCachedDataset(dataset);
      statusEl.textContent = "Build succeeded.";
      if (allowCancel) {
        // Re-opened from an already-running app ("Rebuild data") -- app.js
        // has already registered its event listeners once this page load,
        // so a fresh in-place init() would double-register them. Reload
        // instead, exactly like a first-run build's only path ever worked.
        statusEl.textContent = "Build succeeded — reloading…";
        setTimeout(() => window.location.reload(), 600);
      } else {
        modalEl.hidden = true;
        window.ULModBuddyApp.init(dataset);
      }
    } catch (err) {
      setBuilding(false);
      statusEl.textContent = "";
      if (err && err.name === "AbortError") {
        // User dismissed the folder picker -- not a real error, say nothing.
        return;
      }
      if (builder && err instanceof builder.InstallRootError) {
        showError(err.message);
      } else {
        showError("Build failed: " + (err && err.message ? err.message : err));
      }
    }
  }

  // Primary button: reuse the saved folder once one exists; first-run
  // setup has none yet, so it's just a picker there too.
  chooseEl.addEventListener("click", () => {
    runBuild(hasSavedRoot ? getSavedHandle : pickNewHandle);
  });

  // Secondary button, shown only once a saved folder exists: always opens
  // a fresh picker, ignoring whatever's currently saved.
  chooseNewEl.addEventListener("click", () => {
    runBuild(pickNewHandle);
  });

  async function main() {
    if (!storage || !builder) {
      document.getElementById("detail").textContent =
        "storage.js/build.js did not load -- are they included in index.html before setup.js?";
      return;
    }
    const cached = await storage.getCachedDataset().catch(() => null);
    if (cached) {
      window.ULModBuddyApp.init(cached);
    } else {
      open({ allowCancel: false });
    }
  }

  window.ULModBuddySetup = { open };
  main();
})();
