/**
 * Import — committing a plan to storage.
 *
 * All-or-nothing by construction: the final datasets are computed in memory
 * and handed to the adapter as ONE write. In the app the adapter is
 * core/db.js atomicWrite(), a single IndexedDB transaction across every
 * store, so a failure leaves the previous data untouched. There is no
 * partial import path.
 */

const COLLECTIONS = ['tasks', 'goals', 'sessions', 'blocks'];

/**
 * @param {object} plan - result of buildPlan()
 * @param {{ readAll: () => Promise<object>, writeAll: (data: object) => Promise<void> }} adapter
 * @returns {Promise<object>} summary of what was actually written
 */
export async function commitPlan(plan, adapter) {
  const existing = await adapter.readAll();

  /* Nothing to do: skip the write entirely rather than claiming success
     for a transaction that changed nothing. */
  if (plan.strategy === 'merge' && plan.totals.add === 0 && plan.totals.update === 0) {
    return {
      committed: false,
      unchanged: true,
      strategy: plan.strategy,
      counts: { added: 0, updated: 0, identical: plan.totals.identical, removed: 0 },
      perCollection: {},
      notes: plan.notes,
    };
  }

  const finalData = {};
  for (const name of COLLECTIONS) {
    const current = existing[name] || [];
    const change = plan.collections[name];

    if (plan.strategy === 'replace') {
      // The file becomes the dataset; existing records are dropped.
      finalData[name] = change.dataset || [];
      continue;
    }

    const updateById = new Map(change.update.map((r) => [r.id, r]));
    // Existing records keep their order; conflicting ones are swapped in
    // place, and new records are appended.
    finalData[name] = current.map((record) => updateById.get(record.id) || record).concat(change.add);
  }

  try {
    // Replace-all must DELETE records that are absent from the file, so the
    // adapter is told to clear each store before writing (same transaction).
    await adapter.writeAll(finalData, { replace: plan.strategy === 'replace' });
  } catch (err) {
    // The adapter guarantees a single transaction, so nothing was persisted.
    const error = new Error('Import could not be saved. Your existing data was not changed.');
    error.cause = err;
    throw error;
  }

  const perCollection = {};
  for (const name of COLLECTIONS) {
    perCollection[name] = {
      added: plan.collections[name].add.length,
      updated: plan.collections[name].update.length,
    };
  }

  return {
    committed: true,
    unchanged: false,
    strategy: plan.strategy,
    counts: {
      added: plan.totals.add,
      updated: plan.totals.update,
      identical: plan.totals.identical,
      removed: plan.strategy === 'replace' ? plan.totals.removed : 0,
      conflictsKept: plan.totals.conflictsKept,
      conflictsUpdated: plan.totals.conflictsUpdated,
      invalid: plan.totals.invalid,
    },
    perCollection,
    notes: plan.notes,
  };
}
