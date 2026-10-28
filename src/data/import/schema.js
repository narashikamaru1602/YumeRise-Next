/**
 * Import — record schema, limits and normalization.
 *
 * Treats every imported record as UNTRUSTED input. Each normalizer returns
 * either { ok: true, record } (a record that matches the shape the app's own
 * repositories create) or { ok: false, reason } (a human-readable rejection).
 *
 * Nothing here executes imported content: values are only read, type-checked,
 * clamped and copied into a fresh object built from known fields.
 */

export const SUPPORTED_VERSION = 1;
export const EXPORT_APP_ID = 'yumerise-next';

/* Configurable safety limits. Exported so the UI can explain them. */
export const LIMITS = Object.freeze({
  maxFileBytes: 5 * 1024 * 1024,   // 5 MB
  maxTextChars: 10 * 1024 * 1024,  // parsed text ceiling
  maxRecordsPerCollection: 20000,
  maxTotalRecords: 60000,
  maxStringLength: 8192,
  maxChecklistItems: 200,
  maxMinutes: 10080,               // one week of focused minutes
});

/* Own-keys that must never be copied out of an imported object. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const DATE_LABEL = /^\d{4}-\d{2}-\d{2}$/;
const TIME_LABEL = /^(\d{2}):(\d{2})$/;

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Drop prototype-polluting keys and cap runaway string lengths. */
export function safeKeys(obj) {
  return Object.keys(obj).filter((key) => !FORBIDDEN_KEYS.has(key));
}

export function isNonEmptyString(value, max = LIMITS.maxStringLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function isOptionalString(value, max = LIMITS.maxStringLength) {
  return value == null || (typeof value === 'string' && value.length <= max);
}

/** Strict calendar label: 'YYYY-MM-DD' and a real date. */
export function isDateLabel(value) {
  if (typeof value !== 'string' || !DATE_LABEL.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 'HH:MM' within a day, or '' for "no time". */
export function isTimeLabel(value) {
  if (value === '') return true;
  const match = TIME_LABEL.exec(String(value || ''));
  if (!match) return false;
  // Both fields must be real clock values: '12:99' and '24:00' are rejected
  // (previously any total < 1440 passed, so '12:99' was accepted).
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  return hh >= 0 && hh < 24 && mm >= 0 && mm < 60;
}

/** ISO-ish timestamp that Date can actually read. */
export function isTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  return !Number.isNaN(Date.parse(value));
}

function optionalTimestamp(value) {
  return isTimestamp(value) ? new Date(value).toISOString() : null;
}

/* ---------------- Tasks ---------------- */

const PRIORITIES = ['Low', 'Medium', 'High'];
const STATUSES = ['todo', 'done'];

export function normalizeTask(raw, { now } = {}) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'Task is not an object' };
  if (!isNonEmptyString(raw.id, 128)) return { ok: false, reason: 'Task id is missing or invalid' };
  if (!isNonEmptyString(raw.title, 500)) return { ok: false, reason: `Task "${short(raw.id)}" has no usable title` };
  if (!isOptionalString(raw.description, 5000)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid description` };
  if (raw.date != null && !isDateLabel(raw.date)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid date` };
  if (!isTimeLabel(raw.startTime)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid start time` };  if (!isTimeLabel(raw.endTime)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid end time` };
  if (!PRIORITIES.includes(raw.priority)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid priority` };
  if (!STATUSES.includes(raw.status)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid status` };

  let checklist = [];
  if (raw.checklist != null) {
    if (!Array.isArray(raw.checklist)) return { ok: false, reason: `Task "${short(raw.title)}" has an invalid checklist` };
    if (raw.checklist.length > LIMITS.maxChecklistItems) return { ok: false, reason: `Task "${short(raw.title)}" has too many checklist items` };
    for (const entry of raw.checklist) {
      const text = isPlainObject(entry) ? entry.text : entry;
      if (!isNonEmptyString(text, 300)) return { ok: false, reason: `Task "${short(raw.title)}" has an unusable checklist item` };
      const entryId = isPlainObject(entry) && isNonEmptyString(entry.id, 128) ? entry.id : null;
      // `=== true` so the string "false" (or 1/0) is not coerced to true.
      checklist.push({ id: entryId, text: text.trim(), done: isPlainObject(entry) && entry.done === true });
    }
  }

  const stamp = now || new Date().toISOString();
  return {
    ok: true,
    record: {
      id: raw.id,
      title: raw.title.trim(),
      description: String(raw.description || '').trim(),
      date: raw.date || labelFromStamp(now),
      startTime: raw.startTime || '',
      endTime: raw.endTime || '',
      priority: raw.priority,
      status: raw.status,
      // Checklist item ids are kept when the file provides them (so content
      // comparison stays stable across re-imports) and generated only when
      // missing, so no two records ever collide on the same checklist id.
      checklist: checklist.map((item) => ({ ...item, id: item.id || localId() })),
      createdAt: optionalTimestamp(raw.createdAt) || stamp,
      updatedAt: optionalTimestamp(raw.updatedAt) || stamp,
    },
  };
}

/* ---------------- Goals ---------------- */

const KINDS = ['active', 'long'];

export function normalizeGoal(raw, { now } = {}) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'Goal is not an object' };
  if (!isNonEmptyString(raw.id, 128)) return { ok: false, reason: 'Goal id is missing or invalid' };
  if (!isNonEmptyString(raw.title, 500)) return { ok: false, reason: `Goal "${short(raw.id)}" has no usable title` };
  if (!isOptionalString(raw.note, 5000)) return { ok: false, reason: `Goal "${short(raw.title)}" has an invalid note` };
  if (!KINDS.includes(raw.kind)) return { ok: false, reason: `Goal "${short(raw.title)}" has an invalid kind` };
  if (!isFiniteNumber(raw.progress)) return { ok: false, reason: `Goal "${short(raw.title)}" has invalid progress` };
  if (raw.target != null && !isFiniteNumber(raw.target)) return { ok: false, reason: `Goal "${short(raw.title)}" has an invalid target` };
  if (raw.current != null && !isFiniteNumber(raw.current)) return { ok: false, reason: `Goal "${short(raw.title)}" has an invalid current value` };
  if (!isOptionalString(raw.unit, 40)) return { ok: false, reason: `Goal "${short(raw.title)}" has an invalid unit` };

  const stamp = now || new Date().toISOString();
  return {
    ok: true,
    record: {
      id: raw.id,
      title: raw.title.trim(),
      kind: raw.kind,
      note: String(raw.note || '').trim(),
      progress: Math.min(100, Math.max(0, Math.round(Number(raw.progress)))),
      // Clamped at 0: negative targets/counts are meaningless and used to flow
      // straight into the UI and analytics.
      target: Math.max(0, Number(raw.target) || 0),
      current: Math.max(0, Number(raw.current) || 0),
      unit: String(raw.unit || '').trim(),
      // `=== true` so the string "false" is not read as done.
      done: raw.done === true,
      createdAt: optionalTimestamp(raw.createdAt) || stamp,
      updatedAt: optionalTimestamp(raw.updatedAt) || stamp,
    },
  };
}

/* ---------------- Focus sessions ---------------- */

export function normalizeSession(raw, { now } = {}) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'Session is not an object' };
  if (!isNonEmptyString(raw.id, 128)) return { ok: false, reason: 'Session id is missing or invalid' };
  // Strict on purpose: untrusted input must be a real number, not something
  // coerced with Number() — a type mismatch is reported rather than guessed at.
  if (!isFiniteNumber(raw.minutes) || raw.minutes <= 0 || raw.minutes > LIMITS.maxMinutes) {
    return { ok: false, reason: `Session "${short(raw.id)}" has an invalid duration` };
  }
  const minutes = raw.minutes;
  if (raw.startedAt != null && !isTimestamp(raw.startedAt)) return { ok: false, reason: `Session "${short(raw.id)}" has an invalid start time` };
  if (!isOptionalString(raw.note, 500)) return { ok: false, reason: `Session "${short(raw.id)}" has an invalid note` };

  const stamp = now || new Date().toISOString();
  return {
    ok: true,
    record: {
      id: raw.id,
      // Sessions are whole minutes and at least 1 (the repository's own
      // invariant): 0.4 minutes must not be stored as a 0-minute session.
      minutes: Math.max(1, Math.round(minutes)),
      startedAt: optionalTimestamp(raw.startedAt) || stamp,
      note: String(raw.note || '').trim(),
      createdAt: optionalTimestamp(raw.createdAt) || stamp,
    },
  };
}

/* ---------------- Plan blocks ---------------- */

export function normalizeBlock(raw, { now } = {}) {
  if (!isPlainObject(raw)) return { ok: false, reason: 'Block is not an object' };
  if (!isNonEmptyString(raw.id, 128)) return { ok: false, reason: 'Block id is missing or invalid' };
  if (!isNonEmptyString(raw.title, 500)) return { ok: false, reason: `Block "${short(raw.id)}" has no usable title` };
  if (raw.date != null && !isDateLabel(raw.date)) return { ok: false, reason: `Block "${short(raw.title)}" has an invalid date` };
  if (raw.startTime != null && !isTimeLabel(raw.startTime)) return { ok: false, reason: `Block "${short(raw.title)}" has an invalid start time` };
  if (!isTimeLabel(raw.endTime)) return { ok: false, reason: `Block "${short(raw.title)}" has an invalid end time` };
  if (raw.linkedTaskId != null && !isNonEmptyString(raw.linkedTaskId, 128)) {
    return { ok: false, reason: `Block "${short(raw.title)}" has an invalid task link` };
  }

  const stamp = now || new Date().toISOString();
  return {
    ok: true,
    record: {
      id: raw.id,
      title: raw.title.trim(),
      date: raw.date || null,
      startTime: raw.startTime || '09:00',
      endTime: raw.endTime || '',
      linkedTaskId: raw.linkedTaskId || null,
      createdAt: optionalTimestamp(raw.createdAt) || stamp,
      updatedAt: optionalTimestamp(raw.updatedAt) || stamp,
    },
  };
}

/* ---------------- helpers ---------------- */

export const NORMALIZERS = Object.freeze({
  tasks: normalizeTask,
  goals: normalizeGoal,
  sessions: normalizeSession,
  blocks: normalizeBlock,
});

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Short, safe excerpt of a user-supplied string for error messages. */
function short(value, max = 28) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Local YYYY-MM-DD label for a timestamp (mirrors core/utils todayLabel). */
function labelFromStamp(stamp) {
  const date = stamp ? new Date(stamp) : new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local id generator, injected so tests stay deterministic. */
let idFactory = null;
export function setIdFactory(fn) { idFactory = fn; }
function localId() {
  if (idFactory) return idFactory();
  return `c-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}
