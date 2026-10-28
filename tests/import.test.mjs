import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseExportText } from '../src/data/import/parse.js';
import { buildPlan, describePlan, sameRecord } from '../src/data/import/plan.js';
import { commitPlan } from '../src/data/import/apply.js';
import { LIMITS, normalizeTask, normalizeSession, normalizeGoal, isTimeLabel } from '../src/data/import/schema.js';

const EMPTY = { tasks: [], goals: [], sessions: [], blocks: [] };

/* ---------- fixtures ---------- */

function makeTask(over = {}) {
  return {
    id: 't-1',
    title: 'Write the quarterly report',
    description: 'Draft and share',
    date: '2026-10-18',
    startTime: '09:00',
    endTime: '10:00',
    priority: 'High',
    status: 'todo',
    checklist: [{ id: 'c-1', text: 'Outline', done: true }],
    createdAt: '2026-10-17T09:00:00.000Z',
    updatedAt: '2026-10-17T09:00:00.000Z',
    ...over,
  };
}

function makeGoal(over = {}) {
  return {
    id: 'g-1',
    title: 'Ship the import feature',
    kind: 'active',
    note: 'export + import',
    progress: 40,
    target: 100,
    current: 40,
    unit: '%',
    done: false,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-16T08:00:00.000Z',
    ...over,
  };
}

function makeSession(over = {}) {
  return {
    id: 's-1',
    minutes: 50,
    startedAt: '2026-10-18T09:00:00.000Z',
    note: 'deep work',
    createdAt: '2026-10-18T10:00:00.000Z',
    ...over,
  };
}

function makeBlock(over = {}) {
  return {
    id: 'b-1',
    title: 'Morning planning',
    date: '2026-10-18',
    startTime: '08:00',
    endTime: '08:30',
    linkedTaskId: 't-1',
    createdAt: '2026-10-17T20:00:00.000Z',
    updatedAt: '2026-10-17T20:00:00.000Z',
    ...over,
  };
}

/** Exactly the shape settings.js exportData() writes to disk. */
function exportFile(over = {}) {
  return JSON.stringify({
    app: 'yumerise-next',
    version: 1,
    exportedAt: '2026-10-18T12:00:00.000Z',
    tasks: [],
    goals: [],
    sessions: [],
    blocks: [],
    ...over,
  }, null, 2);
}

/**
 * In-memory stand-in for IndexedDB, with optional injected failures.
 *
 * Faithful to the real adapter: writes are put()-by-id (records NOT present in
 * the payload are left alone) unless { replace: true } says to clear the store
 * first — so a replace-all that fails to delete is caught here, not masked.
 */
function fakeAdapter(initial = EMPTY) {
  const store = structuredClone(initial);
  let writes = 0;
  const adapter = {
    failNext: false,
    async readAll() { return structuredClone(store); },
    async writeAll(next, opts = {}) {
      if (adapter.failNext) throw new Error('simulated transaction abort');
      writes += 1;
      for (const key of Object.keys(next)) {
        if (opts.replace) {
          store[key] = structuredClone(next[key]);
          continue;
        }
        const byId = new Map(store[key].map((record) => [record.id, record]));
        for (const record of next[key]) byId.set(record.id, record);
        store[key] = [...byId.values()];
      }
    },
    writes: () => writes,
    raw: () => store,
  };
  return adapter;
}

async function runMerge(text, existing, options = {}) {
  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  const plan = buildPlan(parsed.payload, existing || EMPTY, options);
  return { parsed, plan };
}

/* ============ 1. valid export file ============ */

test('a file produced by YumeRise export parses, plans and imports', async () => {
  const text = exportFile({
    tasks: [makeTask()],
    goals: [makeGoal()],
    sessions: [makeSession()],
    blocks: [makeBlock()],
  });

  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.version, 1);
  assert.deepEqual(parsed.payload.counts, { tasks: 1, goals: 1, sessions: 1, blocks: 1 });
  assert.equal(parsed.payload.total, 4);
  assert.equal(parsed.payload.invalid.length, 0);

  const plan = buildPlan(parsed.payload, EMPTY);
  assert.equal(plan.totals.add, 4);
  assert.equal(plan.totals.conflicts, 0);

  const adapter = fakeAdapter();
  const result = await commitPlan(plan, adapter);

  assert.equal(result.committed, true);
  assert.equal(result.counts.added, 4);
  const stored = adapter.raw();
  assert.equal(stored.tasks.length, 1);
  assert.equal(stored.tasks[0].title, 'Write the quarterly report');
  assert.equal(stored.tasks[0].priority, 'High');
  assert.equal(stored.tasks[0].checklist[0].id, 'c-1', 'checklist ids are preserved');
  assert.equal(stored.goals[0].progress, 40);
  assert.equal(stored.sessions[0].minutes, 50);
  assert.equal(stored.blocks[0].linkedTaskId, 't-1');
});

/* ============ 2. empty / minimal dataset ============ */

test('an empty but valid export is accepted and changes nothing', async () => {
  const parsed = parseExportText(exportFile());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.total, 0);

  const adapter = fakeAdapter({ ...EMPTY, tasks: [makeTask()] });
  const plan = buildPlan(parsed.payload, adapter.raw());
  const result = await commitPlan(plan, adapter);

  assert.equal(result.committed, false);
  assert.equal(result.unchanged, true);
  assert.equal(adapter.writes(), 0, 'no write happened for an empty file');
  assert.equal(adapter.raw().tasks.length, 1, 'existing data untouched');
});

test('a minimal export with no collection keys is accepted', () => {
  const parsed = parseExportText(JSON.stringify({ app: 'yumerise-next', version: 1 }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.total, 0);
});

/* ============ 3. malformed / truncated files ============ */

test('truncated and non-JSON files are rejected with a readable error', () => {
  const full = exportFile({ tasks: [makeTask()] });

  const truncated = parseExportText(full.slice(0, Math.floor(full.length / 2)));
  assert.equal(truncated.ok, false);
  assert.match(truncated.error, /valid JSON/i);

  const garbage = parseExportText('x'); // not JSON at all
  assert.equal(garbage.ok, false);

  const empty = parseExportText('   ');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /empty/i);

  const notAnObject = parseExportText('[1,2,3]');
  assert.equal(notAnObject.ok, false);
  assert.match(notAnObject.error, /JSON object/i);
});

/* ============ 4. unsupported formats and versions ============ */

test('foreign files and unsupported schema versions are rejected before any write', () => {
  const cases = [
    [JSON.stringify({ app: 'other-app', version: 1 }), /not exported by YumeRise/i],
    [JSON.stringify({ version: 1 }), /not exported by YumeRise/i],
    [JSON.stringify({ app: 'yumerise-next', version: 2 }), /newer version/i],
    [JSON.stringify({ app: 'yumerise-next', version: '1' }), /export version/i],
    [JSON.stringify({ app: 'yumerise-next', version: 0.5 }), /export version/i],
    [JSON.stringify({ app: 'yumerise-next' }), /export version/i],
  ];
  for (const [text, pattern] of cases) {
    const parsed = parseExportText(text);
    assert.equal(parsed.ok, false, `should reject: ${text}`);
    assert.match(parsed.error, pattern);
  }
});

test('a newer export explains itself instead of failing silently', () => {
  const parsed = parseExportText(JSON.stringify({ app: 'yumerise-next', version: 2, tasks: [] }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.detail, /reads exports up to v1/i);
});

test('structurally wrong sections are rejected', () => {
  assert.equal(parseExportText(exportFile({ tasks: 'nope' })).ok, false);
  assert.equal(parseExportText(exportFile({ goals: { a: 1 } })).ok, false);
  assert.equal(parseExportText(exportFile({ exportedAt: 42 })).ok, false);
});

test('runaway record counts are rejected', () => {
  const many = Array.from({ length: LIMITS.maxRecordsPerCollection + 1 }, (_, i) => makeTask({ id: `t-${i}` }));
  const parsed = parseExportText(exportFile({ tasks: many }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /too many records/i);
});

/* ============ 5. missing fields and invalid data types ============ */

test('invalid records are skipped and reported; valid ones still import', () => {
  const text = exportFile({
    tasks: [
      makeTask({ id: 'good' }),
      makeTask({ id: 'no-title', title: '' }),
      makeTask({ id: 'bad-priority', priority: 'Urgent' }),
      makeTask({ id: 'bad-status', status: 'archived' }),
      makeTask({ id: 'bad-date', date: '2026-02-31' }),
      makeTask({ id: 'bad-time', startTime: '25:00' }),
      makeTask({ id: 'bad-checklist', checklist: [{ text: '' }] }),
      'not an object',
    ],
    sessions: [
      makeSession({ id: 's-good' }),
      makeSession({ id: 's-negative', minutes: -5 }),
      makeSession({ id: 's-huge', minutes: 999999 }),
      makeSession({ id: 's-string', minutes: '30' }),
    ],
    goals: [makeGoal({ id: 'g-bad-progress', progress: 'lots' })],
  });

  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true, 'a partly-bad file still parses');
  assert.equal(parsed.payload.counts.tasks, 1);
  assert.equal(parsed.payload.counts.sessions, 1);
  assert.equal(parsed.payload.counts.goals, 0);
  assert.equal(parsed.payload.invalid.length, 11);
  assert.ok(parsed.payload.invalid.every((row) => row.reason && row.collection));

  // The rejection reasons are human-readable, not stack traces.
  const reasons = parsed.payload.invalid.map((r) => r.reason).join(' | ');
  assert.match(reasons, /no usable title/);
  assert.match(reasons, /invalid priority/);
  assert.doesNotMatch(reasons, /at Object\.|\.js:\d+/);
});

test('types are normalised, not trusted (missing timestamps use export time)', () => {
  const strict = normalizeTask(makeTask(), { now: '2026-10-18T12:00:00.000Z' });
  assert.equal(strict.ok, true);
  assert.equal(strict.record.status, 'todo');

  const noStamps = normalizeTask(makeTask({ createdAt: undefined, updatedAt: undefined }), { now: '2026-10-18T12:00:00.000Z' });
  assert.equal(noStamps.ok, true);
  assert.equal(noStamps.record.createdAt, '2026-10-18T12:00:00.000Z', 'falls back to the export time');

  const badSession = normalizeSession(makeSession({ minutes: '30' }));
  assert.equal(badSession.ok, false);
  assert.match(badSession.reason, /invalid duration/);
});

test('imported content cannot pollute Object.prototype', () => {
  // A raw hostile JSON string: "__proto__" as an own key, plus a benign
  // unknown field so the unknown-field report is exercised too.
  const hostile = '{"app":"yumerise-next","version":1,"exportedAt":"2026-10-18T12:00:00.000Z",'
    + '"tasks":[{"id":"t-hostile","title":"Hostile","description":"","date":"2026-10-18",'
    + '"startTime":"09:00","endTime":"10:00","priority":"High","status":"todo","checklist":[],'
    + '"createdAt":"2026-10-17T09:00:00.000Z","updatedAt":"2026-10-17T09:00:00.000Z",'
    + '"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"evil":"boo"}]}';
  const parsed = parseExportText(hostile);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.counts.tasks, 1);
  assert.equal({}.polluted, undefined, 'Object.prototype was not polluted');
  const stored = parsed.payload.records.tasks[0];
  assert.equal(Object.prototype.hasOwnProperty.call(stored, '__proto__'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'evil'), false, 'unknown field dropped');
  assert.equal(stored.polluted, undefined);

  // Unknown fields are dropped and explained, never carried into storage.
  assert.ok(parsed.payload.notes.some((n) => /fields this version does not use/i.test(n)));
});

/* ============ 6. duplicates and id collisions ============ */

test('identical records are duplicates; same id with different content is a conflict', async () => {
  const text = exportFile({ tasks: [makeTask(), makeTask({ id: 't-2', title: 'Other task' })] });
  const existing = { ...EMPTY, tasks: [makeTask()] };

  const { plan } = await runMerge(text, existing);
  assert.equal(plan.totals.identical, 1, 'byte-identical record counted as duplicate');
  assert.equal(plan.totals.add, 1);
  assert.equal(plan.totals.conflicts, 0);

  // Same id, different contents -> conflict, resolved by policy.
  const conflicting = exportFile({ tasks: [makeTask({ title: 'Renamed task' })] });
  const keepPlan = buildPlan(parseExportText(conflicting).payload, existing);
  assert.equal(keepPlan.totals.conflicts, 1);
  assert.equal(keepPlan.totals.update, 0, 'keepExisting is the default');
  assert.equal(keepPlan.totals.conflictsKept, 1);

  const usePlan = buildPlan(parseExportText(conflicting).payload, existing, { conflictPolicy: 'useImported' });
  assert.equal(usePlan.totals.conflicts, 1);
  assert.equal(usePlan.totals.update, 1);
  assert.equal(usePlan.totals.conflictsUpdated, 1);

  assert.ok(sameRecord(makeTask(), makeTask()));
  assert.ok(!sameRecord(makeTask(), makeTask({ title: 'x' })));
});

/* ============ 7. merge behaviour with existing data ============ */

test('merge adds new records and leaves unrelated existing data alone', async () => {
  const existing = {
    ...EMPTY,
    tasks: [makeTask({ id: 't-keep' }), makeTask({ id: 't-both', title: 'Old title' })],
    goals: [makeGoal({ id: 'g-keep' })],
  };
  const text = exportFile({ tasks: [makeTask({ id: 't-both', title: 'New title' }), makeTask({ id: 't-new' })] });

  const { plan } = await runMerge(text, existing, { strategy: 'merge' });
  const adapter = fakeAdapter(existing);
  const result = await commitPlan(plan, adapter);

  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.updated, 0, 'keepExisting default means no update');
  assert.match(describePlan(plan), /1 new/);

  const stored = adapter.raw();
  assert.equal(stored.tasks.length, 3, 'existing 2 tasks + 1 added, no duplicate created');
  assert.equal(stored.tasks.filter((t) => t.id === 't-both').length, 1, 'conflicting id appears once');
  assert.equal(stored.tasks.find((t) => t.id === 't-both').title, 'Old title', 'existing record kept');
  assert.equal(stored.tasks.find((t) => t.id === 't-new').title, 'Write the quarterly report');
  assert.equal(stored.goals.length, 1, 'untouched collection preserved');
  assert.equal(stored.goals[0].id, 'g-keep');
});

test('merge with useImported overwrites only the conflicting record', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-both', title: 'Old title' })] };
  const text = exportFile({ tasks: [makeTask({ id: 't-both', title: 'New title' })] });

  const { plan } = await runMerge(text, existing, { conflictPolicy: 'useImported' });
  const adapter = fakeAdapter(existing);
  const result = await commitPlan(plan, adapter);

  assert.equal(result.counts.updated, 1);
  assert.equal(adapter.raw().tasks.length, 1);
  assert.equal(adapter.raw().tasks[0].title, 'New title');
});

test('replace swaps the whole dataset and reports what it removed', async () => {
  const existing = {
    ...EMPTY,
    tasks: [makeTask({ id: 't-gone' })],
    goals: [makeGoal({ id: 'g-gone' })],
  };
  const text = exportFile({ tasks: [makeTask({ id: 't-new' })] });

  const { plan } = await runMerge(text, existing, { strategy: 'replace' });
  assert.equal(plan.totals.removed, 2, 'one task and one goal disappear');
  assert.match(describePlan(plan), /Replace all data/);

  const adapter = fakeAdapter(existing);
  const result = await commitPlan(plan, adapter);

  assert.equal(result.counts.removed, 2);
  const stored = adapter.raw();
  assert.deepEqual(stored.tasks.map((t) => t.id), ['t-new']);
  assert.deepEqual(stored.goals, [], 'goals replaced by the (empty) file section');
});

test('replace carries over records that are identical to stored ones', () => {
  const existing = { ...EMPTY, tasks: [makeTask()] };
  const text = exportFile({ tasks: [makeTask()] });
  const plan = buildPlan(parseExportText(text).payload, existing, { strategy: 'replace' });

  assert.equal(plan.totals.identical, 1);
  assert.deepEqual(plan.collections.tasks.dataset.map((t) => t.id), ['t-1'], 'identical record still in the dataset');
});

/* ============ 8. cancellation changes nothing ============ */

test('cancelling before the final step leaves storage untouched', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-keep' })] };
  const adapter = fakeAdapter(existing);
  const before = structuredClone(adapter.raw());

  const text = exportFile({ tasks: [makeTask({ id: 't-extra' })] });
  // Building a preview (and rebuilding it repeatedly, as the UI does when the
  // user flips strategy radios) must never mutate what is stored.
  const parsed = parseExportText(text);
  const planA = buildPlan(parsed.payload, await adapter.readAll(), { strategy: 'merge' });
  const planB = buildPlan(parsed.payload, await adapter.readAll(), { strategy: 'replace' });
  assert.ok(planA && planB);

  assert.equal(adapter.writes(), 0, 'no commit was attempted on cancel');
  assert.deepEqual(adapter.raw(), before, 'stored data is byte-identical');
  assert.deepEqual(parsed.payload.records.tasks[0], planA.collections.tasks.add[0],
    'planning does not mutate the parsed payload either');
});

test('buildPlan does not mutate the existing records it inspects', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-a' })] };
  const snapshot = structuredClone(existing);
  const parsed = parseExportText(exportFile({
    tasks: [makeTask({ id: 't-a', title: 'changed' }), makeTask({ id: 't-b' })],
    blocks: [makeBlock({ id: 'b-dangling', linkedTaskId: 'missing-task' })],
  }));
  buildPlan(parsed.payload, existing, { conflictPolicy: 'useImported' });
  assert.deepEqual(existing, snapshot, 'existing data not mutated by planning');
});

/* ============ 9. failed persistence ============ */

test('a failed write reports failure and leaves existing data intact', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-keep' })] };
  const text = exportFile({ tasks: [makeTask({ id: 't-new' })] });
  const { plan } = await runMerge(text, existing);

  const adapter = fakeAdapter(existing);
  adapter.failNext = true;

  await assert.rejects(() => commitPlan(plan, adapter), (err) => {
    assert.match(err.message, /not changed/i);
    assert.ok(!/\bat \w+\.js:\d+/.test(err.message), 'no stack trace shown to the user');
    return true;
  });

  assert.equal(adapter.writes(), 0, 'the failed attempt recorded no successful write');
  assert.deepEqual(adapter.raw(), existing, 'storage still holds the original data');
});

test('failed persistence leaves no partial import behind', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-keep' })] };
  const text = exportFile({
    tasks: [makeTask({ id: 't-1' }), makeTask({ id: 't-2' })],
    goals: [makeGoal({ id: 'g-1' })],
    sessions: [makeSession({ id: 's-1' })],
  });
  const { plan } = await runMerge(text, existing);

  const adapter = fakeAdapter(existing);
  adapter.failNext = true;
  await assert.rejects(() => commitPlan(plan, adapter));

  const stored = adapter.raw();
  assert.equal(stored.tasks.length, 1, 'no task was added');
  assert.equal(stored.goals.length, 0, 'no goal was added');
  assert.equal(stored.sessions.length, 0, 'no session was added');
});

/* ============ 10. re-importing the same file ============ */

test('re-importing the same file is a no-op', async () => {
  const text = exportFile({
    tasks: [makeTask()],
    goals: [makeGoal()],
    sessions: [makeSession()],
    blocks: [makeBlock()],
  });
  const adapter = fakeAdapter();

  const first = await commitPlan(buildPlan(parseExportText(text).payload, await adapter.readAll()), adapter);
  assert.equal(first.committed, true);
  assert.equal(adapter.writes(), 1);
  const afterFirst = structuredClone(adapter.raw());

  const planAgain = buildPlan(parseExportText(text).payload, await adapter.readAll());
  assert.equal(planAgain.totals.identical, 4, 'every record matches what is stored');
  assert.equal(planAgain.totals.add, 0);
  assert.equal(planAgain.totals.update, 0);
  assert.equal(planAgain.nothingToDo, true);

  const second = await commitPlan(planAgain, adapter);
  assert.equal(second.committed, false);
  assert.equal(second.unchanged, true);
  assert.equal(adapter.writes(), 1, 'second import wrote nothing');
  assert.deepEqual(adapter.raw(), afterFirst, 'data unchanged');
});

test('parse is deterministic: two parses of the same file produce equal records', () => {
  const text = exportFile({ tasks: [makeTask()] });
  const a = parseExportText(text).payload.records;
  const b = parseExportText(text).payload.records;
  assert.ok(sameRecord(a.tasks[0], b.tasks[0]));
});

test('records without timestamps still compare equal across parses', () => {
  const text = exportFile({
    tasks: [{ id: 't-x', title: 'No stamps', priority: 'Low', status: 'todo', date: '2026-10-18' }],
  });
  const a = parseExportText(text).payload.records;
  const b = parseExportText(text).payload.records;
  assert.ok(sameRecord(a.tasks[0], b.tasks[0]), 'exportedAt-based stamping keeps records stable');
});

/* ============ 11. persistence and state refresh ============ */

test('imported data survives a re-read (as after a page refresh)', async () => {
  const adapter = fakeAdapter();
  const text = exportFile({ tasks: [makeTask()], goals: [makeGoal()] });
  await commitPlan(buildPlan(parseExportText(text).payload, EMPTY), adapter);

  // A "restart": a brand new read from the same backing store.
  const afterRestart = await fakeAdapter(adapter.raw()).readAll();
  assert.equal(afterRestart.tasks.length, 1);
  assert.equal(afterRestart.goals.length, 1);
  assert.equal(afterRestart.tasks[0].id, 't-1');
  assert.equal(afterRestart.tasks[0].checklist[0].text, 'Outline');
});

test('plan blocks referencing unknown tasks are detached, not imported broken', async () => {
  const text = exportFile({ blocks: [makeBlock({ id: 'b-dangling', linkedTaskId: 'nope' })] });
  const { plan } = await runMerge(text, EMPTY);
  assert.equal(plan.collections.blocks.add[0].linkedTaskId, null);
  assert.ok(plan.notes.some((n) => /unlinked/.test(n)));
});

test('plan blocks referencing an existing local task keep their link', async () => {
  const existing = { ...EMPTY, tasks: [makeTask({ id: 't-1' })] };
  const text = exportFile({ blocks: [makeBlock({ id: 'b-ok', linkedTaskId: 't-1' })] });
  const { plan } = await runMerge(text, existing);
  assert.equal(plan.collections.blocks.add[0].linkedTaskId, 't-1');
});

test('unknown top-level sections are ignored and reported', () => {
  const parsed = parseExportText(exportFile({ categories: [{ id: 'x' }], settings: { theme: 'dark' } }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.counts.tasks, 0);
  assert.ok(parsed.payload.notes.some((n) => /categories/.test(n)));
  assert.ok(parsed.payload.notes.some((n) => /appearance and preferences were left unchanged/i.test(n)));
});

/* ============ 12. import interface wiring, theme and responsiveness ============ */

test('the import UI is wired into Settings and export still works', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const settings = await readFile(path.join(root, '../src/views/settings.js'), 'utf8');
  assert.match(settings, /Import data/);
  assert.match(settings, /openImportDialog/);
  assert.match(settings, /icon\('upload'\)/);

  // Export must still be present and unchanged in behaviour.
  assert.match(settings, /Export data/);
  assert.match(settings, /yumerise-next-export-/);

  const icons = await readFile(path.join(root, '../src/core/icons.js'), 'utf8');
  assert.match(icons, /upload:/);
});

test('the import UI uses theme tokens (no hard-coded colors) and adapts to narrow screens', async () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const css = await readFile(path.join(root, '../src/styles/components.css'), 'utf8');

  const start = css.indexOf('/* ---------- Import dialog ----------');
  assert.ok(start > 0, 'import styles exist');
  const section = css.slice(start);

  assert.match(section, /\.import-drop\b/, 'drop zone is styled');
  assert.match(section, /\.import-radio\b/, 'strategy choices are styled');
  assert.match(section, /@media \(max-width: 420px\)/, 'narrow-screen rules exist');

  // Theme reactivity: every color must come from a token so Light/Dark and
  // both dark accent palettes restyle the dialog automatically.
  const literalColors = section.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || [];
  assert.deepEqual(literalColors, [], 'no hard-coded colors in import styles');
  assert.match(section, /var\(--accent/);
  assert.match(section, /var\(--error/);
});

/* ============ validation regressions (audit) ========== */

test('isTimeLabel accepts real clock values only', () => {
  assert.equal(isTimeLabel('09:00'), true);
  assert.equal(isTimeLabel('23:59'), true);
  assert.equal(isTimeLabel(''), true);
  // These all used to pass (only the total against 1440 was checked).
  assert.equal(isTimeLabel('12:99'), false, 'minutes >= 60 rejected');
  assert.equal(isTimeLabel('24:00'), false, 'hour >= 24 rejected');
  assert.equal(isTimeLabel('9:05'), false, 'two-digit hours required by the export format');
});

test('a task with impossible time labels is rejected, not coerced', () => {
  const badStart = normalizeTask(makeTask({ startTime: '12:99' }));
  assert.equal(badStart.ok, false);
  assert.match(badStart.reason, /start time/);

  const badEnd = normalizeTask(makeTask({ endTime: '24:00' }));
  assert.equal(badEnd.ok, false);
  assert.match(badEnd.reason, /end time/);

  const valid = normalizeTask(makeTask({ startTime: '12:59', endTime: '13:00' }));
  assert.equal(valid.ok, true);
});

test('string "false" is not read as done, in goals or checklists', () => {
  const goal = normalizeGoal(makeGoal({ done: 'false' }));
  assert.equal(goal.ok, true);
  assert.equal(goal.record.done, false, 'the string "false" must not mean done');

  const goalTrue = normalizeGoal(makeGoal({ done: true }));
  assert.equal(goalTrue.record.done, true);

  const task = normalizeTask(makeTask({
    checklist: [
      { id: 'c-1', text: 'unchecked', done: 'false' },
      { id: 'c-2', text: 'checked', done: true },
    ],
  }));
  assert.equal(task.ok, true);
  assert.equal(task.record.checklist[0].done, false);
  assert.equal(task.record.checklist[1].done, true);
});

test('negative goal targets/current values are clamped to zero', () => {
  const goal = normalizeGoal(makeGoal({ target: -5, current: -3, progress: -20 }));
  assert.equal(goal.ok, true);
  assert.equal(goal.record.target, 0);
  assert.equal(goal.record.current, 0);
  assert.equal(goal.record.progress, 0);
});

test('sub-minute sessions are stored as a whole minute, never 0', () => {
  const tiny = normalizeSession({
    id: 's-sub', minutes: 0.4, startedAt: '2026-10-18T10:00:00.000Z',
  });
  assert.equal(tiny.ok, true);
  assert.equal(tiny.record.minutes, 1, 'the repository invariant is minutes >= 1');
});

test('duplicate ids inside one file collapse to the last record, with a note', () => {
  const text = exportFile({
    tasks: [
      makeTask({ id: 'dup-1', title: 'First version' }),
      makeTask({ id: 'dup-1', title: 'Second version' }),
    ],
  });
  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.counts.tasks, 1, 'one record, not two');
  assert.equal(parsed.payload.records.tasks[0].title, 'Second version', 'last occurrence wins');
  assert.ok(
    parsed.payload.notes.some((n) => /more than once/.test(n)),
    'the collapse is reported to the user'
  );
});

test('replace-mode commit actually deletes records absent from the file', async () => {
  // The fake adapter now emulates put()-by-id semantics, so this asserts the
  // REAL IndexedDB contract: without the clear pass, t-gone/g-gone survive.
  const existing = {
    ...EMPTY,
    tasks: [makeTask({ id: 't-gone' }), makeTask({ id: 't-keep' })],
    sessions: [{ id: 's-gone', minutes: 25, startedAt: '2026-10-10T10:00:00.000Z', note: '', createdAt: '2026-10-10T10:00:00.000Z' }],
  };
  const text = exportFile({ tasks: [makeTask({ id: 't-keep' })] });
  const plan = buildPlan(parseExportText(text).payload, existing, { strategy: 'replace' });

  const adapter = fakeAdapter(existing);
  const result = await commitPlan(plan, adapter);

  assert.equal(result.committed, true);
  assert.deepEqual(adapter.raw().tasks.map((t) => t.id), ['t-keep']);
  assert.deepEqual(adapter.raw().sessions, [], 'sessions absent from the file are deleted');
  assert.deepEqual(adapter.raw().goals, []);
});

/* ============ ChatGPT data exchange (enhancement) ============ */

/** A plan file in exactly the shape docs/YUMERISE-PLAN-SCHEMA.md documents. */
function chatGptPlan(over = {}) {
  return exportFile({
    kind: 'chatgpt-plan',
    tasks: [
      makeTask({ id: 't-p1', title: 'Outline the launch post', date: '2026-10-27', status: 'todo', priority: 'High' }),
      makeTask({ id: 't-p2', title: 'Review budget', date: '2026-10-28', status: 'todo', priority: 'Medium' }),
    ],
    blocks: [makeBlock({ id: 'b-p1', date: '2026-10-27', linkedTaskId: 't-p1' })],
    sessions: [],
    goals: [],
    ...over,
  });
}

test('a ChatGPT plan file parses and merges its future records', async () => {
  const { parsed, plan } = await runMerge(chatGptPlan(), EMPTY);
  assert.equal(parsed.payload.counts.tasks, 2);
  assert.equal(parsed.payload.counts.blocks, 1);
  assert.equal(parsed.payload.counts.sessions, 0, 'plans contribute no sessions');
  assert.equal(plan.totals.add, 3);

  // Future records arrive as themselves: never back-dated, never pre-completed.
  const t = parsed.payload.records.tasks[0];
  assert.equal(t.status, 'todo');
  assert.equal(t.date, '2026-10-27');

  const adapter = fakeAdapter();
  const result = await commitPlan(plan, adapter);
  assert.equal(result.committed, true);
  assert.equal(adapter.raw().tasks.length, 2);
  assert.equal(adapter.raw().sessions.length, 0);
});

test('a chatgpt-plan file can never create focus sessions', () => {
  // ChatGPT is instructed not to include sessions — but if it invents them
  // anyway (valid OR invalid), they must be dropped before validation runs.
  const text = chatGptPlan({
    sessions: [
      makeSession({ id: 'fake-1', minutes: 50, startedAt: '2026-10-10T09:00:00.000Z' }),
      { id: 'fake-2', minutes: 'not even a number' },
    ],
  });
  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.counts.sessions, 0, 'no session survives');
  assert.equal(parsed.payload.total, 3, 'sessions are not counted anywhere');
  assert.ok(
    parsed.payload.notes.some((n) => /focus sessions?.*ignored/i.test(n)),
    'the user is told the sessions were ignored'
  );
});

test('a chatgpt-export file round-trips and its guide is documentation only', async () => {
  const text = exportFile({
    kind: 'chatgpt-export',
    guide: { about: 'Upload this file for analysis', tasks: 'id, title, ...' },
    sessions: [makeSession()],
    tasks: [makeTask()],
  });
  const { parsed, plan } = await runMerge(text, EMPTY);

  assert.equal(parsed.payload.counts.sessions, 1, 'a full export keeps its sessions');
  assert.equal(parsed.payload.counts.tasks, 1);
  assert.ok(
    parsed.payload.notes.some((n) => /guide is documentation only/i.test(n)),
    'the guide is reported as ignored, not imported'
  );
  assert.ok(
    !parsed.payload.notes.some((n) => /Ignored unsupported sections/.test(n)),
    'kind/guide are known keys — no scary "unsupported sections" note'
  );

  // Full round-trip through the real commit path.
  const adapter = fakeAdapter();
  const result = await commitPlan(plan, adapter);
  assert.equal(result.committed, true);
  assert.equal(adapter.raw().sessions.length, 1);
  assert.equal(adapter.raw().tasks[0].title, 'Write the quarterly report');
});

test('unknown file kinds are noted but still strictly validated', () => {
  const text = exportFile({
    kind: 'acme-mindmap',
    tasks: [makeTask({ id: 't-ok' }), makeTask({ id: 't-bad', priority: 'Urgent' }), makeTask({ id: 't-bad2', date: '2026-13-40' })],
  });
  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true, 'the file is still examined');
  assert.ok(parsed.payload.notes.some((n) => /does not recognise/.test(n)));
  assert.equal(parsed.payload.counts.tasks, 1, 'only the valid record is kept');
  assert.equal(parsed.payload.invalid.length, 2, 'both invalid records are reported');
});

test('invalid records in a plan file are rejected before any write', async () => {
  const text = chatGptPlan({
    tasks: [
      makeTask({ id: 't-bad', title: 'Missing everything' , date: null, priority: 'Urgent', status: 'todo', startTime: null, endTime: null, checklist: null, createdAt: null, updatedAt: null }),
      { title: 'no id at all', date: '2026-10-30', priority: 'Low', status: 'todo' },
      makeTask({ id: 't-good', title: 'Valid task', date: '2026-10-30', status: 'todo' }),
    ],
    blocks: [{ id: 'b-bad', title: 'Broken block', date: '10/30/2026', startTime: '9am', endTime: '' }],
  });
  const parsed = parseExportText(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.payload.counts.tasks, 1, 'only the valid task passes');
  assert.equal(parsed.payload.counts.blocks, 0, 'the malformed block never reaches storage');
  assert.equal(parsed.payload.invalid.length, 3, 'every rejection is reported by name');

  const plan = buildPlan(parsed.payload, EMPTY, { strategy: 'merge' });
  const adapter = fakeAdapter();
  const result = await commitPlan(plan, adapter);
  assert.equal(result.counts.added, 1, 'one record written, exactly as previewed');
  assert.equal(adapter.raw().tasks[0].id, 't-good');
});
