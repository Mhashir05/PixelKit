// Persistence helpers. Original images go to IndexedDB, project metadata to localStorage.
// Every function can throw (storage blocked, full, missing); callers must catch.
const DB_NAME = "pixelkit";
const STORE = "images";
const PROJECTS_KEY = "pixelkit.projects";

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("IndexedDB is not available"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Runs one request inside a transaction and resolves with its result once the transaction commits.
async function run(mode, makeRequest) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = makeRequest(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const saveImage = (id, blob) => run("readwrite", (store) => store.put(blob, id));
export const loadImage = (id) => run("readonly", (store) => store.get(id)); // undefined if missing
export const deleteImage = (id) => run("readwrite", (store) => store.delete(id));

export const loadProjects = () => JSON.parse(localStorage.getItem(PROJECTS_KEY) || "[]");
export const saveProjects = (list) => localStorage.setItem(PROJECTS_KEY, JSON.stringify(list));
