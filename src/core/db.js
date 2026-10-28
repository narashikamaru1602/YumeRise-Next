/**
 * IndexedDB layer — the local-first data store for YumeRise Next.
 *
 * The legacy web client had NO offline storage (no IndexedDB, no service
 * worker); its data lived behind an authenticated API. YumeRise Next stores
 * everything locally first, so it works offline and inside the Capacitor
 * WebView without a network. There is no legacy IndexedDB schema to stay
 * compatible with — this is a fresh, versioned schema.
 *
 * No external dependency: a small promise wrapper over raw IndexedDB.
 */

const DB_NAME = 'yumerise-next';
const DB_VERSION = 1;

export const STORES = Object.freeze({
  tasks: 'tasks',
  goals: 'goals',
  sessions: 'sessions',   // focus sessions
  blocks: 'blocks',       // planned time blocks (plan view)
  settings: 'settings',
});

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.tasks)) {
        const tasks = db.createObjectStore(STORES.tasks, { keyPath: 'id' });
        tasks.createIndex('date', 'date', { unique: false });
        tasks.createIndex('status', 'status', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.goals)) {
        const goals = db.createObjectStore(STORES.goals, { keyPath: 'id' });
        goals.createIndex('kind', 'kind', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.sessions)) {
        const sessions = db.createObjectStore(STORES.sessions, { keyPath: 'id' });
        sessions.createIndex('startedAt', 'startedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.blocks)) {
        const blocks = db.createObjectStore(STORES.blocks, { keyPath: 'id' });
        blocks.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.settings)) {
        db.createObjectStore(STORES.settings, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        let result;
        try {
          result = fn(store);
        } catch (err) {
          reject(err);
          return;
        }
        transaction.oncomplete = () => resolve(result?.result ?? result);
        transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
      })
  );
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAll(storeName) {
  const db = await open();
  const txr = db.transaction(storeName, 'readonly');
  return reqToPromise(txr.objectStore(storeName).getAll());
}

export async function get(storeName, key) {
  const db = await open();
  const txr = db.transaction(storeName, 'readonly');
  return reqToPromise(txr.objectStore(storeName).get(key));
}

export function put(storeName, value) {
  return tx(storeName, 'readwrite', (store) => store.put(value));
}

export function del(storeName, key) {
  return tx(storeName, 'readwrite', (store) => store.delete(key));
}

export async function clear(storeName) {
  const db = await open();
  const txr = db.transaction(storeName, 'readwrite');
  const request = txr.objectStore(storeName).clear();
  // Errors propagate: callers (e.g. "Delete all data") must be able to tell a
  // real clear from a silent partial failure.
  return reqToPromise(request);
}

/**
 * Clear several stores in ONE transaction: "delete all data" is either fully
 * applied or nothing changes (never half-deleted).
 */
export async function clearAll(storeNames) {
  const db = await open();
  const txr = db.transaction(storeNames, 'readwrite');
  for (const name of storeNames) txr.objectStore(name).clear();
  return new Promise((resolve, reject) => {
    txr.oncomplete = () => resolve();
    txr.onerror = () => reject(txr.error || new Error('clear all failed'));
    txr.onabort = () => reject(txr.error || new Error('clear all aborted'));
  });
}

/**
 * Write every collection in ONE IndexedDB transaction.
 *
 * IndexedDB transactions are atomic: if any put fails, or the transaction
 * aborts, none of the writes are applied. This is what makes an import (or a
 * replace-all) all-or-nothing — callers can rely on "either the whole change
 * landed or nothing did".
 *
 * Every store here is keyed by a keyPath, so values are passed to put() on
 * their own (the key is read from the record itself).
 *
 * @param {Record<string, Array<object>>} byStore
 *        e.g. { tasks: [...], goals: [...] }. A store omitted from the map is
 *        left untouched.
 * @param {{ replaceStores?: string[] }} [options]
 *        Stores listed here are cleared first, inside the SAME transaction,
 *        before their records are written. This is what makes a replace-all
 *        import genuinely replace: records absent from the file are deleted,
 *        not left behind by the put()s.
 */
export async function atomicWrite(byStore, { replaceStores = [] } = {}) {
  const storeNames = Object.keys(byStore);
  if (!storeNames.length) return;
  for (const name of storeNames) {
    if (!Object.values(STORES).includes(name)) {
      throw new Error(`Unknown store: ${name}`);
    }
  }
  const db = await open();
  await new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = db.transaction(storeNames, 'readwrite');
    } catch (err) {
      reject(err || new Error('Could not start write transaction'));
      return;
    }
    let failed = null;
    try {
      for (const name of storeNames) {
        const store = transaction.objectStore(name);
        if (replaceStores.includes(name)) store.clear();
        for (const value of byStore[name] || []) store.put(value);
      }
    } catch (err) {
      failed = err;
      try { transaction.abort(); } catch { /* already aborting */ }
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Write transaction failed'));
    transaction.onabort = () => reject(failed || transaction.error || new Error('Write transaction aborted'));
  });
}

/** Settings helpers (key/value, JSON-encoded). */
export async function getSetting(key, fallback = null) {
  const row = await get(STORES.settings, key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return fallback; }
}

export async function setSetting(key, value) {
  return put(STORES.settings, { key, value: JSON.stringify(value) });
}
