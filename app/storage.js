// UL Mod Buddy -- tiny IndexedDB wrapper for the browser-only build flow.
//
// Two things get persisted so a returning visit doesn't start from scratch:
//   - the picked FileSystemDirectoryHandle itself (structured-clone-storable
//     in browsers that support the File System Access API), so "Rebuild
//     data" only needs one permission-reconfirmation click, never a re-pick;
//   - the last built dataset, so a returning visit loads instantly without
//     re-parsing any XML at all, unless the user explicitly clicks Rebuild.
window.ULModBuddyStorage = (function () {
  "use strict";

  const DB_NAME = "ulmodbuddy";
  const DB_VERSION = 1;
  const STORE = "kv";
  const ROOT_KEY = "installRootHandle";
  const DATASET_KEY = "dataset";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function set(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function del(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // A dataset's `icons` values are blob: URLs, which are only valid for the
  // document that minted them -- one read back verbatim from a previous
  // page load is already dead. The actual bytes survive fine in IndexedDB
  // as `iconBlobs` (Blobs are structured-clone-storable), so every read
  // mints fresh, working URLs from those before handing the dataset back.
  async function getCachedDataset() {
    const dataset = await get(DATASET_KEY);
    if (dataset && dataset.iconBlobs) {
      const icons = {};
      for (const name in dataset.iconBlobs) {
        icons[name] = URL.createObjectURL(dataset.iconBlobs[name]);
      }
      dataset.icons = icons;
    }
    return dataset;
  }

  return {
    getSavedRoot: () => get(ROOT_KEY),
    saveRoot: (handle) => set(ROOT_KEY, handle),
    clearRoot: () => del(ROOT_KEY),
    getCachedDataset,
    saveCachedDataset: (obj) => set(DATASET_KEY, obj),
    clearCachedDataset: () => del(DATASET_KEY),
  };
})();
