// UL Mod Buddy build-setup flow -- the "point me at your install" modal.
//
// Two independent ways to get a dataset, gated entirely on File System
// Access API support (`supported`, below) -- exactly one is ever wired up
// and visible per page load:
//   - Supported (Chrome/Edge/Brave-with-the-flag): zero-install. The
//     dataset is either read back from IndexedDB (a previous visit's
//     build, cached by storage.js) or built live in the browser (build.js)
//     against a folder the user grants access to via showDirectoryPicker().
//   - Unsupported (Firefox/Safari/Brave-without-the-flag): the Python
//     fallback. Only works when this page is actually being served by
//     `python app/server.py` -- POSTs the typed install path to its
//     /api/build, which runs build/build.py in-process and writes
//     app/data.js, then loaded here as a fresh <script> tag (never a
//     static index.html reference, so a page that's never built yet
//     doesn't 404 on load). /api/config best-effort prefills the input
//     from server.py's own remembered last-used path.
//
// This file owns the whole flow either way: it opens the modal
// automatically (no way to cancel, since there's nothing usable behind it
// yet) when no cached/existing dataset is found, and exposes
// window.ULModBuddySetup.open({allowCancel}) so app.js's "Rebuild data"
// button can reopen it later.
//
// Supported-path detail: one picked folder handle is reused across visits.
// Once a folder's been picked once, the modal offers two explicit choices
// rather than silently guessing which one you want: "Rebuild from current
// folder" (re-confirms permission on the saved handle -- needs a user
// gesture, which this button click provides) or "Choose a different
// folder..." (always opens a fresh picker, e.g. switching between a live
// install and a test/clone one). First-run setup has no saved folder yet,
// so it's just the one button.
//
// window.ULModBuddyApp.init(data) is called EXACTLY ONCE per real page load
// -- a first-run build calls it directly (nothing has initialized yet this
// load), while a "Rebuild data" success always reloads instead, so app.js's
// event listeners are never registered twice. Loaded AFTER app.js -- see
// index.html's script order -- so window.ULModBuddyApp already exists by
// the time main() (below) might synchronously resolve a cached dataset and
// call .init() on it.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const modalEl = $("#build-modal");
  const cancelEl = $("#build-cancel");
  const chooseEl = $("#build-choose");
  const chooseNewEl = $("#build-choose-new");
  const chooseRowEl = $("#build-choose-row");
  const unsupportedEl = $("#build-unsupported");
  const formEl = $("#build-form");
  const pathInputEl = $("#build-path-input");
  const submitEl = $("#build-submit");
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
    // The picker flow and the Python-fallback form are mutually exclusive --
    // exactly one is ever shown, based on File System Access API support.
    chooseRowEl.hidden = !supported;
    formEl.hidden = supported;
    if (supported) {
      const saved = await storage.getSavedRoot().catch(() => null);
      hasSavedRoot = !!saved;
      // Only worth offering a choice once there's a *current* folder to
      // rebuild from -- first-run setup has nothing to contrast "a different
      // folder" against, so it stays a single button there.
      chooseNewEl.hidden = !hasSavedRoot;
      setBuilding(false);
    } else {
      prefillServerPath();
    }
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

  // ---------------------------------------------------------------------
  // Python fallback (Firefox/Safari/Brave-without-the-flag) -- only ever
  // reached when the File System Access API isn't available. Talks to
  // server.py's /api/build and /api/config, which only exist when this
  // page is actually being served by `python app/server.py`; nothing
  // above this point (the picker flow) touches any of it.
  // ---------------------------------------------------------------------

  // Best-effort: prefill the input with whatever install path server.py
  // remembers from the last successful build. Silently does nothing if
  // there's no server behind this page at all (e.g. someone reached this
  // branch via the hosted static site).
  function prefillServerPath() {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (cfg && cfg.installRoot && !pathInputEl.value) pathInputEl.value = cfg.installRoot;
      })
      .catch(() => {});
  }

  // build.py writes app/data.js as `window.ULMODBUDDY_DATA = <JSON>;` (the
  // dataset itself is written via json.dump, so everything after that
  // prefix is plain JSON, never arbitrary JS) -- fetched fresh (cache-
  // busted) and JSON.parse()d directly rather than loaded as a <script>
  // tag, since a newly inserted <script> can queue for a long time behind
  // whatever same-origin requests (e.g. pending icon <img> loads) are
  // already saturating the browser's per-host connection limit.
  async function loadDataJs() {
    const resp = await fetch("data.js?t=" + Date.now());
    if (!resp.ok) throw new Error(`data.js not found (HTTP ${resp.status})`);
    const text = await resp.text();
    const marker = "window.ULMODBUDDY_DATA = ";
    const idx = text.indexOf(marker);
    if (idx === -1) throw new Error("data.js doesn't look like a UL Mod Buddy dataset");
    let jsonText = text.slice(idx + marker.length).trim();
    if (jsonText.endsWith(";")) jsonText = jsonText.slice(0, -1);
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      throw new Error("data.js couldn't be parsed: " + e.message);
    }
  }

  function setServerBuilding(isBuilding) {
    pathInputEl.disabled = isBuilding;
    submitEl.disabled = isBuilding;
    submitEl.textContent = isBuilding ? "Building…" : "Build";
  }

  async function runServerBuild(installRoot) {
    clearError();
    setServerBuilding(true);
    statusEl.textContent = "Building…";
    logEl.textContent = "";
    try {
      const resp = await fetch("/api/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ installRoot }),
      });
      const body = await resp.json().catch(() => null);
      if (body && body.log) body.log.forEach(appendLog);
      if (!body || !body.ok) {
        throw new Error((body && body.error) || `Build failed (HTTP ${resp.status}).`);
      }
      statusEl.textContent = "Build succeeded.";
      if (allowCancel) {
        // Same reasoning as the picker flow's runBuild(): app.js's event
        // listeners are already registered this page load, so reload
        // rather than risk double-registering them with a second init().
        // Reloading also avoids fetching data.js while the page's own
        // pending icon <img> requests are saturating the connection limit --
        // a fresh page load has no such queue, so main()'s own loadDataJs()
        // call picks up the new data.js cleanly.
        statusEl.textContent = "Build succeeded — reloading…";
        setTimeout(() => window.location.reload(), 600);
      } else {
        // First run: nothing has rendered yet, so there's no icon-request
        // queue to compete with -- safe to fetch it directly here.
        const dataset = await loadDataJs();
        modalEl.hidden = true;
        window.ULModBuddyApp.init(dataset);
      }
    } catch (err) {
      statusEl.textContent = "";
      showError(
        "Build failed: " +
          (err && err.message ? err.message : err) +
          " -- make sure you're running this via `python app/server.py` and viewing it at that server's own URL (not a file opened directly, and not the hosted static site)."
      );
    } finally {
      setServerBuilding(false);
    }
  }

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const path = pathInputEl.value.trim();
    if (!path) {
      showError("Enter a folder path first.");
      return;
    }
    runServerBuild(path);
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
      return;
    }
    // Unsupported-browser returning visit: server.py may already have
    // app/data.js on disk from a previous build (its own persistence,
    // parallel to the picker flow's IndexedDB cache) -- load it directly
    // rather than making a return visitor click through the form again.
    // Falls through to the form on any failure (first run, no server.py
    // behind this page, etc.), same as the picker flow falls through to
    // its own first-run button.
    if (!supported) {
      try {
        const dataset = await loadDataJs();
        window.ULModBuddyApp.init(dataset);
        return;
      } catch (e) {
        /* no existing data.js yet -- show the form below */
      }
    }
    open({ allowCancel: false });
  }

  window.ULModBuddySetup = { open };
  main();
})();
