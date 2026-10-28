/**
 * Import — merge planning and conflict resolution.
 *
 * Pure: takes a validated payload plus the records already in storage, and
 * decides what would change. Never touches storage, so the UI can show a
 * full preview and let the user cancel without any side effects.
 *
 * Matching policy (deterministic):
 *   - Records are matched by stable id.
 *   - Same id + identical content  -> skipped as a duplicate (no write).
 *   - Same id + different content  -> conflict, resolved by the chosen policy:
 *       'keepExisting' (default) -> the existing record wins, nothing written
 *       'useImported'            -> the imported record replaces it
 *   - Unknown id                  -> added as a new record
 */

const COLLECTIONS = ['tasks', 'goals', 'sessions', 'blocks'];

/** Stable stringify so identical records compare equal regardless of key order. */
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}

export function sameRecord(a, b) {
  return stable(a) === stable(b);
}

function indexById(list) {
  const map = new Map();
  for (const record of list || []) {
    if (record && typeof record.id === 'string') map.set(record.id, record);
  }
  return map;
}

/**
 * @param {object} payload - result of parseExportText().payload
 * @param {object} existing - { tasks, goals, sessions, blocks } currently stored
 * @param {{ strategy?: 'merge'|'replace', conflictPolicy?: 'keepExisting'|'useImported' }} [options]
 */
export function buildPlan(payload, existing = {}, options = {}) {
  const strategy = options.strategy === 'replace' ? 'replace' : 'merge';
  const conflictPolicy = options.conflictPolicy === 'useImported' ? 'useImported' : 'keepExisting';

  const collections = {};
  const totals = {
    add: 0, update: 0, identical: 0, conflicts: 0, conflictsUpdated: 0,
    conflictsKept: 0, invalid: (payload.invalid || []).length, removed: 0,
  };
  const notes = [];

  for (const name of COLLECTIONS) {
    const incoming = payload.records?.[name] || [];
    const current = existing[name] || [];
    const currentById = indexById(current);

    const add = [];
    const update = [];
    const conflictRows = [];
    let identical = 0;

    for (const record of incoming) {
      const prior = currentById.get(record.id);
      if (!prior) {
        add.push(record);
      } else if (sameRecord(prior, record)) {
        identical += 1;
      } else {
        conflictRows.push({ id: record.id, existing: prior, incoming: record });
        if (strategy === 'replace' || conflictPolicy === 'useImported') {
          update.push(record);
          totals.conflictsUpdated += 1;
        } else {
          totals.conflictsKept += 1;
        }
      }
    }

    if (strategy === 'replace') {
      // Replacement: the file becomes the whole dataset, so anything already
      // stored but absent from the file is dropped.
      const incomingIds = new Set(incoming.map((r) => r.id));
      totals.removed += current.filter((r) => !incomingIds.has(r.id)).length;
    }

    totals.add += add.length;
    totals.update += update.length;
    totals.identical += identical;
    totals.conflicts += conflictRows.length;

    collections[name] = {
      add, update, identical, conflicts: conflictRows,
      // Replacement dataset: the file's records become the whole store, so
      // identical records must be carried across too (they are still written).
      dataset: strategy === 'replace' ? incoming.slice() : null,
    };
  }

  if (strategy === 'replace') {
    totals.kept = COLLECTIONS.reduce((sum, name) => sum + (collections[name].dataset?.length || 0), 0);
  }

  /* Cross-record references: a plan block may point at a task that exists
     either in the file or on this device. Anything else is detached. */
  const knownTaskIds = new Set([
    ...(existing.tasks || []).map((t) => t.id),
    ...(payload.records?.tasks || []).map((t) => t.id),
  ]);
  let detached = 0;
  for (const list of [collections.blocks.add, collections.blocks.update]) {
    for (const block of list) {
      if (block.linkedTaskId && !knownTaskIds.has(block.linkedTaskId)) {
        block.linkedTaskId = null;
        detached += 1;
      }
    }
  }
  if (detached) {
    notes.push(`${detached} plan block${detached === 1 ? '' : 's'} pointed at a task that no longer exists and will be unlinked.`);
  }

  const nothingToDo = strategy === 'merge' && totals.add === 0 && totals.update === 0;
  if (nothingToDo) {
    notes.push(totals.identical
      ? 'Everything in this file is already saved — importing it again would change nothing.'
      : 'This export contains no records to import.');
  }

  return { strategy, conflictPolicy, collections, totals, notes, nothingToDo };
}

/** Human summary of what a plan would do, for the confirm step. */
export function describePlan(plan) {
  const { totals, strategy } = plan;
  if (strategy === 'replace') {
    const kept = totals.kept ?? (totals.add + totals.update);
    return `Replace all data with this file: ${kept} record${kept === 1 ? '' : 's'} from the file, ${totals.removed} existing record${totals.removed === 1 ? '' : 's'} removed.`;
  }
  const parts = [];
  if (totals.add) parts.push(`${totals.add} new`);
  if (totals.update) parts.push(`${totals.update} updated`);
  if (totals.identical) parts.push(`${totals.identical} already saved`);
  if (totals.conflictsKept) parts.push(`${totals.conflictsKept} conflicting kept as-is`);
  const summary = parts.length ? parts.join(', ') : 'no changes';
  return `Merge into your data: ${summary}.`;
}

export { COLLECTIONS };
