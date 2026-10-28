/**
 * Import — file parsing and structural validation.
 *
 * Turns raw file text into a normalized payload, or a clear rejection.
 * Nothing is written to storage here: parsing either succeeds completely
 * (with per-record results) or fails before any persistent change exists.
 *
 * Compatibility policy for export files:
 *   - app must be 'yumerise-next'; version must be 1 (SUPPORTED_VERSION).
 *   - version > 1  → rejected: "created by a newer YumeRise".
 *   - version < 1 or missing / not an integer → rejected as not an export.
 *   - `kind` (optional) labels ChatGPT files: 'chatgpt-export' imports like a
 *     standard export; 'chatgpt-plan' drops any focus sessions before
 *     validation (plans must never create focus history).
 *   - Unknown top-level keys are ignored and reported as skipped.
 *   - Unknown record fields are dropped during normalization and counted.
 *   - A record that fails validation is skipped and reported; it never
 *     aborts the whole file, and it never partially imports.
 */

import {
  EXPORT_APP_ID,
  LIMITS,
  NORMALIZERS,
  SUPPORTED_VERSION,
  isDateLabel,
  isPlainObject,
  safeKeys,
} from './schema.js';

const COLLECTIONS = ['tasks', 'goals', 'sessions', 'blocks'];
const KNOWN_KEYS = new Set(['app', 'version', 'exportedAt', 'kind', 'guide', ...COLLECTIONS]);

/* File kinds this build understands. Anything else is noted and treated as a
   standard export (records are still individually validated either way):
     chatgpt-export — a full YumeRise "Export for ChatGPT" (imports as-is).
     chatgpt-plan   — a plan ChatGPT prepared: its focus-session section is
                      dropped before validation, because plans must never be
                      able to create focus history that never happened. */
const KNOWN_KINDS = new Set(['chatgpt-export', 'chatgpt-plan']);
const PLAN_KIND = 'chatgpt-plan';

/** Extra fields on a record that this schema does not know about. */
function unknownFields(record, known) {
  return safeKeys(record).filter((key) => !known.has(key)).length;
}

const KNOWN_TASK_FIELDS = new Set(['id', 'title', 'description', 'date', 'startTime', 'endTime', 'priority', 'status', 'checklist', 'createdAt', 'updatedAt']);
const KNOWN_GOAL_FIELDS = new Set(['id', 'title', 'kind', 'note', 'progress', 'target', 'current', 'unit', 'done', 'createdAt', 'updatedAt']);
const KNOWN_SESSION_FIELDS = new Set(['id', 'minutes', 'startedAt', 'note', 'createdAt']);
const KNOWN_BLOCK_FIELDS = new Set(['id', 'title', 'date', 'startTime', 'endTime', 'linkedTaskId', 'createdAt', 'updatedAt']);
const KNOWN_FIELDS = { tasks: KNOWN_TASK_FIELDS, goals: KNOWN_GOAL_FIELDS, sessions: KNOWN_SESSION_FIELDS, blocks: KNOWN_BLOCK_FIELDS };

/**
 * @param {string} text - raw file contents
 * @param {{ now?: string }} [options] - `now` is injected for determinism
 * @returns {{ ok: true, payload: object } | { ok: false, error: string, detail?: string }}
 */
export function parseExportText(text, { now } = {}) {
  const stamp = now || new Date().toISOString();

  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'The file is empty.' };
  }
  if (text.length > LIMITS.maxTextChars) {
    return { ok: false, error: 'The file is too large to read safely.' };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    // Truncated, corrupted or non-JSON files land here.
    return { ok: false, error: 'This file is not valid JSON.', detail: String(err && err.message ? err.message : err).slice(0, 160) };
  }

  if (!isPlainObject(data)) {
    return { ok: false, error: 'This file is not a YumeRise export (expected a JSON object).' };
  }
  if (data.app !== EXPORT_APP_ID) {
    return { ok: false, error: 'This file was not exported by YumeRise Next.' };
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    return { ok: false, error: 'This file has no readable export version.' };
  }
  if (data.version > SUPPORTED_VERSION) {
    return {
      ok: false,
      error: `This export was created by a newer version of YumeRise (v${data.version}).`,
      detail: `This build reads exports up to v${SUPPORTED_VERSION}. Update YumeRise, then try again.`,
    };
  }

  /* Structural checks: every collection must be an array when present. */
  for (const name of COLLECTIONS) {
    const value = data[name];
    if (value != null && !Array.isArray(value)) {
      return { ok: false, error: `The export's "${name}" section is not a list.` };
    }
  }
  if (data.exportedAt != null && typeof data.exportedAt !== 'string') {
    return { ok: false, error: 'The export timestamp is unreadable.' };
  }
  if (data.kind != null && typeof data.kind !== 'string') {
    return { ok: false, error: 'The file kind is unreadable.' };
  }

  const notes = [];
  const kind = typeof data.kind === 'string' ? data.kind : null;
  if (kind != null && !KNOWN_KINDS.has(kind)) {
    notes.push(`This file is labelled "${String(kind).slice(0, 40)}", which YumeRise does not recognise; it was treated as a standard export.`);
  }
  if (data.guide != null) {
    notes.push("The file's analysis guide is documentation only \u2014 nothing from it was imported.");
  }

  /* ChatGPT plan files: focus sessions are dropped BEFORE validation, so a
     generated plan can never fabricate historical focus activity. */
  let sessionList = data.sessions || [];
  if (kind === PLAN_KIND && sessionList.length > 0) {
    notes.push(
      `${sessionList.length} focus session${sessionList.length === 1 ? '' : 's'} in this plan file ${
        sessionList.length === 1 ? 'was' : 'were'
      } ignored \u2014 plans add future records and cannot create focus history.`
    );
    sessionList = [];
  }

  let total = 0;
  for (const name of COLLECTIONS) {
    const list = name === 'sessions' ? sessionList : data[name] || [];
    total += list.length;
    if (list.length > LIMITS.maxRecordsPerCollection) {
      return { ok: false, error: `The "${name}" section has too many records (${list.length}).` };
    }
  }
  if (total > LIMITS.maxTotalRecords) {
    return { ok: false, error: `This export contains too many records (${total}).` };
  }

  /* Per-record validation. */
  // Records missing timestamps are stamped with the file's own export time
  // (falling back to the parse time), never a fresh value — so re-importing
  // the same file twice produces byte-identical records and is a no-op.
  const exportedAt = typeof data.exportedAt === 'string' && !Number.isNaN(Date.parse(data.exportedAt))
    ? new Date(data.exportedAt).toISOString()
    : null;
  const recordNow = exportedAt || stamp;

  const records = {};
  const invalid = [];
  let unknownFieldRecords = 0;
  let duplicateIds = 0;

  for (const name of COLLECTIONS) {
    const list = name === 'sessions' ? sessionList : data[name] || [];
    const normalize = NORMALIZERS[name];
    // Keyed by id so a file listing the same id twice collapses to ONE record
    // (the last occurrence wins — deterministic) instead of importing duplicates.
    const byId = new Map();
    for (const raw of list) {
      const result = normalize(raw, { now: recordNow });
      if (!result.ok) {
        invalid.push({ collection: name, reason: result.reason });
        continue;
      }
      if (isPlainObject(raw) && unknownFields(raw, KNOWN_FIELDS[name]) > 0) unknownFieldRecords += 1;
      if (byId.has(result.record.id)) duplicateIds += 1;
      byId.set(result.record.id, result.record);
    }
    records[name] = [...byId.values()];
  }

  if (duplicateIds > 0) {
    notes.push(`${duplicateIds} record${duplicateIds === 1 ? '' : 's'} appeared more than once in the file with the same id; the last occurrence of each was kept.`);
  }

  if (unknownFieldRecords > 0) {
    notes.push(`${unknownFieldRecords} record${unknownFieldRecords === 1 ? '' : 's'} contained fields this version does not use; they were ignored.`);
  }

  const skippedKeys = safeKeys(data).filter((key) => !KNOWN_KEYS.has(key));
  if (skippedKeys.length) {
    notes.push(`Ignored unsupported sections: ${skippedKeys.slice(0, 6).join(', ')}.`);
  }
  if (data.settings != null) {
    notes.push('Settings are not part of a YumeRise export, so appearance and preferences were left unchanged.');
  }

  return {
    ok: true,
    payload: {
      version: data.version,
      exportedAt,
      records,
      invalid,
      notes,
      counts: Object.fromEntries(COLLECTIONS.map((name) => [name, records[name].length])),
      total: COLLECTIONS.reduce((sum, name) => sum + records[name].length, 0),
      parsedAt: stamp,
    },
  };
}

export { COLLECTIONS };
