/**
 * Import — storage adapter.
 *
 * Bridges the pure import core (parse/plan/apply) to IndexedDB. Keeping the
 * IndexedDB calls out of the core is what lets the whole workflow be tested
 * in Node with an in-memory fake.
 */

import { STORES, getAll, atomicWrite } from '../../core/db.js';

export const COLLECTIONS = ['tasks', 'goals', 'sessions', 'blocks'];

/** Current contents of every collection that an import can touch. */
export async function readAll() {
  const [tasks, goals, sessions, blocks] = await Promise.all([
    getAll(STORES.tasks),
    getAll(STORES.goals),
    getAll(STORES.sessions),
    getAll(STORES.blocks),
  ]);
  return { tasks, goals, sessions, blocks };
}

/**
 * Persist the final datasets in a single transaction (all-or-nothing).
 * Only collections present in `data` are written; omitted ones stay as they
 * are, so a merge that touches nothing leaves the other stores untouched.
 *
 * `replace: true` (replace-all imports) clears each written store before the
 * puts, inside the same transaction, so records absent from the file are
 * actually deleted — the file truly becomes the dataset.
 */
export async function writeAll(data, { replace = false } = {}) {
  const byStore = {};
  for (const name of COLLECTIONS) {
    if (Array.isArray(data[name])) byStore[STORES[name]] = data[name];
  }
  await atomicWrite(byStore, { replaceStores: replace ? Object.keys(byStore) : [] });
}

export function makeAdapter() {
  return { readAll, writeAll };
}
