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
// One picked folder handle is reused across visits: "Choose your install
// folder" first tries any previously-saved handle (re-confirming permission,
// which needs a user gesture -- this button click provides it) before ever
// falling back to a fresh directory picker, so a returning visitor only
// re-picks if permission was actually revoked.
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
  const unsupportedEl = $("#build-unsupported");
  const errorEl = $("#build-error");
  const statusEl = $("#build-status");
  const logEl = $("#build-log");

  const storage = window.ULModBuddyStorage;
  const builder = window.ULModBuddyBuilder;
  const supported = typeof window.showDirectoryPicker === "function";

  let allowCancel = false;

  function setBuilding(isBuilding) {
    chooseEl.disabled = isBuilding || !supported;
    chooseEl.textContent = isBuilding ? "Building…" : "Choose your install folder…";
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

  function open(opts) {
    opts = opts || {};
    allowCancel = !!opts.allowCancel;
    cancelEl.hidden = !allowCancel;
    clearError();
    statusEl.textContent = "";
    logEl.textContent = "";
    unsupportedEl.hidden = supported;
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

  // Reuses a previously-granted folder handle when possible -- queryPermission
  // never prompts, requestPermission does but only needs a user gesture,
  // which this button click already provides. Falls back to a fresh picker
  // whenever there's no saved handle, or permission for it was revoked.
  async function getDirectoryHandle() {
    const saved = await storage.getSavedRoot().catch(() => null);
    if (saved) {
      const already = await saved.queryPermission({ mode: "read" }).catch(() => "prompt");
      if (already === "granted") return saved;
      const granted = await saved.requestPermission({ mode: "read" }).catch(() => "denied");
      if (granted === "granted") return saved;
    }
    return await window.showDirectoryPicker();
  }

  chooseEl.addEventListener("click", async () => {
    clearError();
    setBuilding(true);
    statusEl.textContent = "Waiting for folder access…";
    logEl.textContent = "";
    try {
      const handle = await getDirectoryHandle();
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
