// UL Mod Buddy build-setup flow -- the "point me at your install" modal.
//
// A fresh checkout of this repo ships with no data.js at all (see the repo
// README: no mod content is ever bundled). This file owns everything about
// getting that data built: it opens automatically (with no way to cancel,
// since there's nothing usable behind it yet) when window.ULMODBUDDY_DATA is
// missing, and exposes window.ULModBuddySetup.open({allowCancel}) so app.js
// can reopen the same modal later from its "Rebuild data" button. Loaded
// before app.js -- see index.html's script order.
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const modalEl = $("#build-modal");
  const cancelEl = $("#build-cancel");
  const formEl = $("#build-form");
  const pathInputEl = $("#build-path-input");
  const submitEl = $("#build-submit");
  const errorEl = $("#build-error");
  const statusEl = $("#build-status");
  const logEl = $("#build-log");

  let allowCancel = false;

  function setBuilding(isBuilding) {
    pathInputEl.disabled = isBuilding;
    submitEl.disabled = isBuilding;
    submitEl.textContent = isBuilding ? "Building..." : "Build";
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  function clearError() {
    errorEl.hidden = true;
    errorEl.textContent = "";
  }

  function open(opts) {
    opts = opts || {};
    allowCancel = !!opts.allowCancel;
    cancelEl.hidden = !allowCancel;
    clearError();
    statusEl.textContent = "";
    logEl.textContent = "";
    modalEl.hidden = false;
    // Prefill from whatever install path (if any) the server already has on
    // file, so this isn't a fresh blank field on every "Rebuild data" click.
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        if (data && data.installRoot) pathInputEl.value = data.installRoot;
        pathInputEl.focus();
      })
      .catch(() => {});
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

  formEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const installRoot = pathInputEl.value.trim();
    if (!installRoot) {
      showError("Enter a folder path first.");
      return;
    }
    clearError();
    setBuilding(true);
    statusEl.textContent = "Building…";
    logEl.textContent = "";
    fetch("/api/build", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ installRoot }),
    })
      .then((r) => r.json())
      .then((body) => {
        logEl.textContent = (body.log || []).join("\n");
        logEl.scrollTop = logEl.scrollHeight;
        if (body.ok) {
          statusEl.textContent = "Build succeeded — reloading…";
          // Brief pause so the success line is actually readable before the
          // page swaps out from under it. server.py already sends
          // Cache-Control: no-store, so no extra cache-busting is needed to
          // pick up the freshly written data.js.
          setTimeout(() => window.location.reload(), 600);
        } else {
          setBuilding(false);
          statusEl.textContent = "";
          showError(body.error || "Build failed.");
        }
      })
      .catch((err) => {
        setBuilding(false);
        statusEl.textContent = "";
        showError("Couldn't reach the local server: " + err.message);
      });
  });

  window.ULModBuddySetup = { open };

  if (!window.ULMODBUDDY_DATA) {
    open({ allowCancel: false });
  }
})();
