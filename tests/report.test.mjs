/**
 * PDF report regressions (Enhancement 2, part C).
 *
 * jsPDF is isomorphic, so the REAL renderer runs here in Node with
 * `compress: false` (what the module uses), which lets the assertions read
 * the document's actual text layer — not just its magic bytes. What these
 * tests cannot judge is visual quality (spacing, chart balance): that is
 * verified separately by opening generated pages.
 *
 * The analytics fixtures mirror tests/analytics.test.mjs: timezone-naive
 * timestamps, deterministic TODAY.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange, buildAnalytics } from '../src/data/analytics.js';
import { renderProgressPdf, pdfFileName, pdfText } from '../src/features/report/pdfReport.js';

const TODAY = '2026-10-18'; // Sunday: the week under test is Mon 12 – Sun 18 Oct

const task = (id, date, priority, status, extra = {}) => ({
  id, title: `Task ${id}`, date, priority, status, createdAt: `${date}T12:00:00.000`, ...extra,
});

function richData() {
  return {
    tasks: [
      task('h1', '2026-10-15', 'High', 'done'),
      task('h2', '2026-10-15', 'High', 'done', { startTime: '15:00', endTime: '16:00' }),
      task('h3', '2026-10-15', 'High', 'done'),
      task('m1', '2026-10-15', 'Medium', 'done', { startTime: '10:00', endTime: '11:00' }),
      task('m2', '2026-10-15', 'Medium', 'done'),
      task('l1', '2026-10-15', 'Low', 'done'),
      task('m3', '2026-10-16', 'Medium', 'todo'),
      task('l2', '2026-10-16', 'Low', 'todo'),
      task('h0', '2026-10-07', 'High', 'done'),
      task('m0', '2026-10-07', 'Medium', 'done'),
      task('l0', '2026-10-08', 'Low', 'todo'),
    ],
    sessions: [
      { id: 'ses1', minutes: 90, startedAt: '2026-10-15T14:30:00' },
      { id: 'ses2', minutes: 45, startedAt: '2026-10-16T09:00:00' },
      { id: 'ses3', minutes: 60, startedAt: '2026-10-07T20:00:00' },
    ],
    goals: [
      { id: 'g1', title: 'Run 10 km', kind: 'active', progress: 40, target: 10, current: 4, unit: 'km', done: false },
      { id: 'g2', title: 'Inbox zero', kind: 'active', progress: 100, target: 0, current: 0, unit: '', done: true },
    ],
    blocks: [
      { id: 'b1', date: '2026-10-15', startTime: '14:00', endTime: '16:00', linkedTaskId: 'h1' },
      { id: 'b4', date: '2026-10-15', startTime: '10:00', endTime: '11:00', linkedTaskId: 'm1' },
      { id: 'b2', date: '2026-10-16', startTime: '09:00', endTime: '10:00' },
      { id: 'b3', date: '2026-10-07', startTime: '09:00', endTime: '11:00', linkedTaskId: 'h0' },
    ],
  };
}

/** One open task due today; no sessions, goals or planning. */
function sparseData() {
  return {
    tasks: [task('only', '2026-10-18', 'Low', 'todo')],
    sessions: [],
    goals: [],
    blocks: [],
  };
}

/** Mirror of the Progress view's dataStart derivation + range resolution. */
function build(data) {
  let dataStart = null;
  const note = (label) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(label) && (!dataStart || label < dataStart)) dataStart = label;
  };
  for (const rec of [...data.tasks, ...data.goals, ...data.blocks]) note(String(rec.createdAt || '').slice(0, 10));
  for (const s of data.sessions) note(String(s.startedAt || '').slice(0, 10));
  const range = resolveRange('week', 0, TODAY, dataStart);
  return buildAnalytics(data, range, { today: TODAY });
}

const ascii = (bytes) => Buffer.from(bytes).toString('latin1');

/* ---------------- full report ---------------- */

test('a full report renders as a real multi-page PDF with every expected section', async () => {
  const a = build(richData());
  assert.equal(a.totals.focus, 135, '90 + 45 in this week (60 is the previous week)');
  assert.equal(a.totals.done, 6);
  assert.equal(a.totals.due, 8);

  const { bytes, pages } = await renderProgressPdf(a);
  const text = ascii(bytes);

  assert.ok(text.startsWith('%PDF-'), 'valid PDF magic');
  assert.ok(pages >= 2, `cover + content expected, got ${pages} page(s)`);

  const markers = [
    'YumeRise',
    'PROGRESS REPORT',            // cover eyebrow
    'Executive summary',
    'Productivity overview',
    'Focus analysis',
    'Goals and planning',
    'Historical trends',
    'Methodology and data notes',
    'Generated',                  // generation date present
    '2h 15m',                     // focus total = 135 min, same figure as the page
    '6 of 8',                     // completed of due, same figure as the page
    'Previous window',            // comparison series legend
  ];
  for (const marker of markers) {
    assert.ok(text.includes(marker), `PDF text layer missing "${marker}"`);
  }
  assert.match(text, /Page 1 of \d+/, 'page numbering on the cover');
  assert.match(text, /Page \d+ of \d+/, 'page numbering everywhere');
});

test('the report states its methodology and local-generation note', async () => {
  const { bytes } = await renderProgressPdf(build(richData()));
  const text = ascii(bytes);
  assert.ok(/Reporting period:/.test(text), 'reporting period defined');
  assert.ok(/Definitions/.test(text), 'metric definitions included');
  assert.ok(/no data was sent to any service/i.test(text), 'local-generation note included');
  assert.ok(/Limitations/.test(text), 'honest limitations included');
});

/* ---------------- sparse data ---------------- */

test('sparse data omits empty sections instead of forcing them', async () => {
  const a = build(sparseData());
  assert.equal(a.totals.done, 0);
  assert.equal(a.totals.sessions, 0);

  const { bytes, pages } = await renderProgressPdf(a);
  const text = ascii(bytes);

  assert.ok(text.startsWith('%PDF-'));
  assert.ok(pages >= 1);
  assert.ok(text.includes('Productivity overview'), 'the one section with data is kept');
  assert.ok(text.includes('Methodology and data notes'), 'methodology always explains the period');
  assert.ok(!text.includes('Focus analysis'), 'no focus section without sessions');
  assert.ok(!text.includes('Goals and planning'), 'no goals section without goals or planning');
  assert.ok(!text.includes('Historical trends'), 'no trends section without completed work or focus');
  assert.ok(!text.includes('Previous window'), 'no invented comparison against an empty window');
  assert.ok(/no recorded activity/.test(text), 'the missing comparison is labelled, not faked');
});

/* ---------------- text safety ---------------- */

test('pdfText maps typographic glyphs to printable characters', () => {
  assert.equal(
    pdfText('it\u2019s \u201cquoted\u201d \u2013 a dash\u2026 \u00b7 bullet'),
    'it\'s "quoted" - a dash... \u00b7 bullet' // \u00b7 is Latin-1: printable, kept
  );
  const hostile = pdfText('plan <script>alert(1)</script> \u2764 \u4f60\u597d');
  assert.ok(!/[^\x20-\x7E]/.test(hostile), 'no non-ASCII bytes reach the PDF text layer');
  assert.ok(hostile.includes('<script>'), 'HTML is inert text — never markup (it is drawn, not parsed)');
});

test('the download file name is dated and stable', () => {
  assert.equal(pdfFileName(new Date('2026-10-18T10:00:00')), 'yumerise-progress-2026-10-18.pdf');
});

/* ---------------- analytics compatibility (Enhancement 1) ---------------- */

test('analytics focus totals use each session\u2019s actual minutes, never a fixed length', () => {
  const data = {
    tasks: [], goals: [], blocks: [],
    sessions: [
      { id: 'x1', minutes: 17, startedAt: '2026-10-15T09:00:00' },
      { id: 'x2', minutes: 43, startedAt: '2026-10-16T09:00:00' },
    ],
  };
  const a = build(data);
  assert.equal(a.totals.sessions, 2);
  assert.equal(a.totals.focus, 60, '17 + 43 = 60; a fixed 25-minute assumption would report 50');
  assert.equal(a.totals.avgSession, 30, 'average of the actual durations');
});
