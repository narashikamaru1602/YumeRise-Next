/**
 * Progress screen — full analytics report (overview + sections A–L).
 *
 * Every figure, chart and sentence is computed by src/data/analytics.js
 * from the records actually stored on this device. Nothing is sampled,
 * estimated or carried over from the design reference. When the data
 * model cannot support a view (no plan blocks, no previous period, no
 * goals), the section says so instead of inventing numbers.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHead } from '../ui/components.js';
import { emptyState, loadingState, errorState, segmented, toast } from '../ui/kit.js';
import {
  groupedBars, areaLine, dualAxis, hBars, donutLegend, hourHeat, showTipAt, hideTip,
} from '../ui/charts.js';
import { listTasks, listSessions, listGoals, listBlocks } from '../data/repositories.js';
import {
  RANGES, resolveRange, buildAnalytics, dayList, dayShort, pctChange,
  activeDaysIn, longestRun, longestGap,
} from '../data/analytics.js';
import { todayLabel, formatDuration, labelToDate } from '../core/utils.js';
import { renderProgressPdf, loadLogoDataUrl, pdfFileName } from '../features/report/pdfReport.js';

/* ---------------- palette (tokens only — correct in every theme) ---------------- */

const C = {
  primary: 'var(--chart-1)',     // accent series (purple / rose / graphite)
  prev: 'var(--text-faint)',     // previous-period bars
  prevLine: 'var(--text-muted)', // previous-period line
  planned: 'var(--accent-2)',    // muted planned series
  secondary: 'var(--chart-2)',   // green (light) / tan (dark) contrast series
  High: 'var(--rose)',
  Medium: 'var(--amber)',
  Low: 'var(--blue)',
  unlinked: 'var(--text-muted)',
  unmatched: 'var(--text-faint)',
};

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/* ---------------- formatting (never fabricates a number it does not have) ---------------- */

const pctText = (v) => (v == null ? '—' : `${v}%`);

function fmtSigned(n, decimals = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(decimals)}`;
}

/** '+16%' / '−4%' / 'no baseline' — null when the previous value was 0. */
const signedPct = (v) => (v == null ? 'no baseline' : `${fmtSigned(v)}%`);

/** '+3 pp' / '−3 pp' / '—' — percentage points. */
const ppText = (v) => (v == null ? '—' : `${fmtSigned(v)} pp`);

/** Mid-sentence form of x.winNote (lowercase first letter). */
const winNoteLower = (x) => x.winNote.charAt(0).toLowerCase() + x.winNote.slice(1);

/** Signed duration: +1h 30m / −45m / 0m. */
function fmtSignedDur(min) {
  if (min == null || Number.isNaN(min)) return '—';
  if (min === 0) return '0m';
  const sign = min > 0 ? '+' : '−';
  return `${sign}${formatDuration(Math.abs(min))}`;
}

const dur = (min) => formatDuration(min || 0);
const hhmm = (hour) => `${String(hour).padStart(2, '0')}:00`;

function dayName(label) {
  return labelToDate(label).toLocaleDateString(undefined, { weekday: 'long' });
}

/** Per-calendar-day averages (the engine's totals.avg* are per bucket). */
const dayAvg = (value, days) => (days > 0 ? Math.round((value / days) * 10) / 10 : 0);
const dayAvgMin = (value, days) => (days > 0 ? Math.round(value / days) : 0);

/* ---------------- DOM helpers ---------------- */

/** '**bold** plain' → [text, <strong>bold</strong>, text] — no innerHTML. */
function strongNodes(text) {
  return String(text)
    .split('**')
    .map((seg, i) => (i % 2 ? h('strong', {}, seg) : seg));
}

function proseP(...texts) {
  return h('p', {}, texts.map((t) => strongNodes(t)));
}

function kpi(label, value, note, cls = '') {
  return h(
    'div',
    { class: `pg-kpi ${cls}`.trim() },
    h('div', { class: 'k-label' }, label),
    h('div', { class: 'k-value' }, value),
    note ? h('div', { class: 'k-note' }, note) : null
  );
}

function sw(label, color, kind = '') {
  return h('span', {}, h('i', { class: kind, style: kind ? {} : { background: color } }), label);
}

/** Honest unavailable-data block inside a section's graph column. */
function na(title, why) {
  return h('div', { class: 'pg-na' }, h('b', {}, title), h('span', {}, why));
}

/** Visible text alternative under a chart (values in reading order). */
function chartNote(text) {
  return h('p', { class: 'pg-chart-note' }, text);
}

function noteNode(text, tone = '') {
  return h('li', { class: tone }, strongNodes(text));
}

function sectionEl({ letter, title, sub, legend = [], graph, kpis = [], prose = [], notes = [] }) {
  return h(
    'section',
    { class: 'pg-sec', 'aria-labelledby': `pg-sec-${letter}-h` },
    h(
      'header',
      { class: 'pg-sec-head' },
      h('span', { class: 'pg-badge', 'aria-hidden': 'true' }, letter),
      h(
        'div',
        { class: 'titles' },
        h('h2', { id: `pg-sec-${letter}-h` }, title),
        h('p', { class: 'sub' }, sub)
      ),
      legend.length ? h('div', { class: 'pg-legend' }, legend) : null
    ),
    h(
      'div',
      { class: 'pg-sec-body' },
      h('div', { class: 'pg-graph' }, graph),
      h(
        'div',
        { class: 'pg-analysis' },
        h('p', { class: 'pg-eyebrow' }, 'What the numbers say'),
        kpis.length ? h('div', { class: 'pg-kpis' }, kpis) : null,
        h('div', { class: 'pg-prose' }, prose),
        notes.length
          ? h('ul', { class: 'pg-notes' }, notes.map((n) => (typeof n === 'string' ? h('li', {}, n) : n)))
          : null
      )
    )
  );
}

/* ---------------- overview pieces ---------------- */

/** delta is a per-metric {abs, pct} object, or null when no comparison exists. */
function deltaChip(delta, format) {
  if (!delta || delta.abs == null) return null;
  const tone = delta.abs > 0 ? 'up' : delta.abs < 0 ? 'down' : 'flat';
  return h('span', { class: `pg-chip ${tone}` }, format(delta));
}

function metricCard({ label, iconName, value, chip, prevText, ok }) {
  return h(
    'article',
    { class: 'pg-metric' },
    h(
      'div',
      { class: 'm-top' },
      h('span', { class: 'm-label' }, label),
      h('span', { class: `m-ico ${ok ? 'ok' : ''}`.trim(), 'aria-hidden': 'true' }, icon(iconName))
    ),
    h('p', { class: 'm-value' }, value),
    h('div', { class: 'm-foot' }, chip, prevText ? h('span', { class: 'm-prev' }, prevText) : null)
  );
}

function rangeControls({ rangeKey, offset }, onChange) {
  const seg = segmented(
    RANGES.map((r) => ({ value: r.key, label: r.label })),
    {
      value: rangeKey,
      label: 'Reporting range',
      onChange: (value) => onChange({ rangeKey: value, offset: 0, focus: `#pg-seg-${value}` }),
    }
  );
  // Stable ids so keyboard focus can be restored after re-render.
  [...seg.children].forEach((btn, i) => {
    btn.id = `pg-seg-${RANGES[i].key}`;
  });

  const isAll = rangeKey === 'all';
  const stepper = h(
    'div',
    { class: 'pg-stepper' },
    h(
      'button',
      {
        type: 'button', 'data-step': 'prev', 'aria-label': 'Previous period',
        disabled: isAll || undefined,
        onClick: () => onChange({ rangeKey, offset: offset + 1, focus: '.pg-stepper [data-step="prev"]' }),
      },
      icon('chevronLeft')
    ),
    h(
      'button',
      {
        type: 'button', 'data-step': 'next', 'aria-label': 'Next period',
        disabled: isAll || offset === 0 || undefined,
        onClick: () => onChange({ rangeKey, offset: Math.max(0, offset - 1), focus: '.pg-stepper [data-step="next"]' }),
      },
      icon('chevronRight')
    )
  );

  return h('div', { class: 'pg-controls' }, seg, stepper);
}

function rangePill(a) {
  return h('span', { class: 'pg-range' }, icon('calendar'), a.range.label);
}

/* ============================================================
   Section builders — each returns one .pg-sec element.
   `a` is the analytics result; `x` holds shared derived facts.
   ============================================================ */

function sectionA(a, x) {
  if (a.totals.due === 0) {
    return sectionEl({
      letter: 'A',
      title: 'Task completion',
      sub: `${a.range.label} · tasks finished per ${x.bucketWord}`,
      graph: na('No tasks in this period', 'Tasks appear here once you add them and set a due date inside the selected range.'),
      prose: [proseP('No tasks were due in this period, so there is nothing to complete or compare.')],
    });
  }

  const series = [{ name: 'Completed', color: C.primary, values: a.series.map((b) => b.done) }];
  if (x.prevAligned) {
    series.push({ name: 'Previous period', color: C.prev, values: a.prevSeries.map((b) => b.done) });
  }

  const graph = h(
    'div',
    {},
    groupedBars({
      labels: x.labels,
      series,
      avg: a.totals.avgDone,
      avgLabel: `avg ${a.totals.avgDone}/${x.bucketWord}`,
      aria: `Bar chart of tasks completed per ${x.bucketWord} across ${a.range.label}. Values: ${a.series
        .map((b) => `${b.full} ${b.done}`)
        .join(', ')}.`,
      tip: (s, i, v) => {
        const lines = [a.series[i].full, `${s.name}: ${v} tasks`];
        if (x.prevAligned && a.prevSeries[i] && s.name === 'Completed') {
          lines.push(`${fmtSigned(v - a.prevSeries[i].done)} vs ${x.prevWord}`);
        }
        return lines;
      },
    }),
    chartNote(
      `Completed per ${x.bucketWord}: ${series[0].values.join(', ')}` +
        (x.prevAligned ? ` · previous: ${series[1].values.join(', ')}` : ' · no comparable previous period')
    )
  );

  const beats = x.prevAligned ? a.series.filter((b, i) => b.done > a.prevSeries[i].done).length : null;
  const ties = x.prevAligned ? a.series.filter((b, i) => b.done === a.prevSeries[i].done).length : null;
  const losses = x.prevAligned ? a.series.filter((b, i) => b.done < a.prevSeries[i].done).length : null;

  const prose = [
    proseP(
      `You finished **${a.totals.done} tasks** between ${a.range.label}` +
        (a.prev
          ? `, against **${a.prev.done} in the ${x.prevWord}** — a change of ${fmtSigned(a.deltas.done.abs)} tasks${
              x.sameDays
                ? ` (${signedPct(a.deltas.done.pct)}).`
                : ` in raw totals; ${winNoteLower(x)}`
            }`
          : '.'),
      a.prev
        ? ` Output averaged **${x.curAvgDone} a day** (previously ${x.prevAvgDone}).`
        : ' Once a previous period exists, day-by-day comparison appears here.'
    ),
    proseP(
      `The busiest bucket was **${a.bestTaskDay.done} tasks on ${dayShort(a.bestTaskDay.label)}**` +
        (a.worstTaskDay.done !== a.bestTaskDay.done
          ? `, the quietest ${a.worstTaskDay.done} on ${dayShort(a.worstTaskDay.label)}.`
          : '.'),
      x.prevAligned
        ? ` ${beats} of ${a.series.length} ${x.bucketWord}s beat the ${x.prevWord}, ${ties} matched it and ${losses} fell behind.`
        : x.prev
          ? ` The ${x.prevWord} spans a different number of ${x.bucketWord}s, so the comparison is shown as totals rather than a bucket-by-bucket overlay.`
          : ''
    ),
  ];

  return sectionEl({
    letter: 'A',
    title: 'Task completion',
    sub: `${a.range.label} · tasks finished per ${x.bucketWord}` + (a.prev ? ` vs the ${x.prevWord}` : ''),
    legend: [
      sw('Completed', C.primary),
      ...(x.prevAligned ? [sw('Previous period', C.prev)] : []),
      sw(`Average / ${x.bucketWord}`, '', 'dash'),
    ],
    graph,
    kpis: [
      kpi('Tasks completed', String(a.totals.done), a.prev ? `previous ${a.prev.done}` : 'no previous period'),
      kpi(
        'Change vs previous',
        a.deltas ? fmtSigned(a.deltas.done.abs) : '—',
        a.deltas
          ? x.sameDays
            ? signedPct(a.deltas.done.pct)
            : `${x.daysIn}-day vs ${x.daysPrev}-day windows`
          : 'first period',
        a.deltas && a.deltas.done.abs > 0 ? 'ok' : a.deltas && a.deltas.done.abs < 0 ? 'pink' : ''
      ),
      kpi('Daily average', String(x.curAvgDone), a.prev ? `was ${x.prevAvgDone}` : 'per calendar day'),
      kpi('Best bucket', String(a.bestTaskDay.done), dayShort(a.bestTaskDay.label), 'ok'),
    ],
    prose,
    notes: [
      noteNode(`Best bucket: ${dayShort(a.bestTaskDay.label)} with ${a.bestTaskDay.done} completions.`, 'ok'),
      noteNode(`Quietest bucket: ${dayShort(a.worstTaskDay.label)} with ${a.worstTaskDay.done} completions.`),
      a.prev
        ? noteNode(
            `Change vs ${x.prevWord}: ${fmtSigned(a.deltas.done.abs)} tasks${
              x.sameDays ? ` (${signedPct(a.deltas.done.pct)})` : ' in raw totals — window lengths differ, so weigh the daily averages'
            }.`,
            a.deltas.done.abs >= 0 ? 'ok' : 'warn'
          )
        : noteNode(`No ${x.prevWord} data — comparisons appear once that period has activity.`),
    ],
  });
}

function sectionB(a, x) {
  if (a.totals.focus <= 0) {
    return sectionEl({
      letter: 'B',
      title: 'Focus time',
      sub: `${a.range.label} · deep-work minutes per ${x.bucketWord}`,
      graph: na('No focus sessions in this period', 'Start a focus session (or finish one from the Focus screen) and the daily curve appears here.'),
      prose: [proseP('No focus time was recorded in this period, so there is no curve to draw or comparison to make.')],
    });
  }

  const series = [{ name: 'This period', color: C.primary, values: a.series.map((b) => b.focus), fill: true }];
  if (x.prevAligned) {
    series.push({ name: x.prevLabel, color: C.prevLine, values: a.prevSeries.map((b) => b.focus), dash: true, points: false });
  }

  const light = a.series.reduce((m, b) => (b.focus < m.focus ? b : m), a.series[0]);

  const graph = h(
    'div',
    {},
    areaLine({
      labels: x.labels,
      series,
      yFmt: (v) => (v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${v}m`),
      aria: `Line chart of focus minutes per ${x.bucketWord} for ${a.range.label}. Values: ${a.series
        .map((b) => `${b.full} ${dur(b.focus)}`)
        .join(', ')}.`,
      tip: (s, i, v) => {
        const lines = [a.series[i].full, `${s.name}: ${dur(v)}`];
        if (x.prevAligned && a.prevSeries[i] && s.name === 'This period') {
          lines.push(`${fmtSignedDur(v - a.prevSeries[i].focus)} vs ${x.prevWord}`);
        }
        return lines;
      },
    }),
    chartNote(`Focus per ${x.bucketWord}: ${a.series.map((b) => dur(b.focus)).join(', ')}.`)
  );

  const planBuckets = a.series.filter((b) => b.planned > 0);
  const metPlan = planBuckets.filter((b) => b.focus >= b.planned).length;

  const prose = [
    proseP(
      `Total focus time reached **${dur(a.totals.focus)}** across ${a.totals.sessions} session${a.totals.sessions === 1 ? '' : 's'} in ${a.range.label}.`,
      a.deltas
        ? ` That is ${fmtSignedDur(a.deltas.focus.abs)} against the ${x.prevWord}${
            x.sameDays ? ` (${signedPct(a.deltas.focus.pct)}).` : ` in raw totals — ${winNoteLower(x)}`
          }`
        : '',
      ` The daily average settled at **${dur(x.curAvgFocus)}**`,
      x.prevAvgFocus != null ? `, previously ${dur(x.prevAvgFocus)}.` : '.'
    ),
    proseP(
      `The strongest day was **${dur(a.bestFocusDay.focus)} on ${dayShort(a.bestFocusDay.label)}**; the lightest ${x.bucketWord} was ${dur(light.focus)} (${light.full}).`,
      planBuckets.length
        ? ` Focus met or exceeded the plan on ${metPlan} of ${planBuckets.length} planned ${x.bucketWord}s.`
        : ' No planned focus exists for this range, so no plan achievement is claimed.',
      ` Average session length: ${dur(a.totals.avgSession)}.`
    ),
  ];

  return sectionEl({
    letter: 'B',
    title: 'Focus time',
    sub: `${a.range.label} · deep-work minutes per ${x.bucketWord}` + (a.prev ? ` vs the ${x.prevWord}` : ''),
    legend: [
      sw('This period', C.primary),
      ...(x.prevAligned ? [sw(x.prevLabel, C.prevLine, 'dash')] : []),
    ],
    graph,
    kpis: [
      kpi('Focus time', dur(a.totals.focus), a.prev ? `previous ${dur(a.prev.focus)}` : 'this period'),
      kpi(
        'Change vs previous',
        a.deltas ? fmtSignedDur(a.deltas.focus.abs) : '—',
        a.deltas
          ? x.sameDays
            ? signedPct(a.deltas.focus.pct)
            : `${x.daysIn}-day vs ${x.daysPrev}-day windows`
          : 'no previous period',
        a.deltas && a.deltas.focus.abs > 0 ? 'ok' : a.deltas && a.deltas.focus.abs < 0 ? 'pink' : ''
      ),
      kpi('Daily average', dur(x.curAvgFocus), x.prevAvgFocus != null ? `was ${dur(x.prevAvgFocus)}` : 'per calendar day'),
      kpi('Sessions', String(a.totals.sessions), `avg ${dur(a.totals.avgSession)}`),
    ],
    prose,
    notes: [
      noteNode(`Best focus day: ${dayShort(a.bestFocusDay.label)} with ${dur(a.bestFocusDay.focus)}.`, 'ok'),
      noteNode(`Lightest ${x.bucketWord}: ${light.full} with ${dur(light.focus)}.`),
      planBuckets.length
        ? noteNode(`Planned focus exists for ${planBuckets.length} of ${a.series.length} ${x.bucketWord}s.`, 'ok')
        : noteNode('Plan data (time blocks / scheduled times) is missing for this range — section D fills in once it exists.'),
    ],
  });
}

function sectionC(a) {
  const months = a.months;
  if (months.length === 0) {
    return sectionEl({
      letter: 'C',
      title: 'Monthly trends',
      sub: 'Full history, independent of the selected range',
      graph: na('Not enough history yet', 'Monthly trends appear after your first completed task or focus session is stored.'),
      prose: [proseP('There is no completed activity anywhere in your history yet, so no monthly trend can be shown.')],
    });
  }
  if (months.length === 1) {
    return sectionEl({
      letter: 'C',
      title: 'Monthly trends',
      sub: `${months[0].full} · full history, independent of the selected range`,
      graph: h(
        'div',
        {},
        chartNote(`Only one month of history: ${months[0].full} — ${months[0].tasks} tasks, ${dur(months[0].focus)} focus.`),
        na('A trend needs two months', 'Charts compare movement over time; with a single month there is nothing to compare yet.')
      ),
      prose: [
        proseP(
          `Your history holds **one month so far** — ${months[0].full} with ${months[0].tasks} completed tasks and ${dur(months[0].focus)} of focus. The trend line appears as soon as a second month has activity.`
        ),
      ],
      notes: [noteNode('Month-to-date values are marked with * once the current month is included.', 'ok')],
    });
  }

  const complete = months.filter((m) => !m.isMtd);
  const bestTasks = complete.reduce((best, m) => (m.tasks > best.tasks ? m : best), complete[0]);
  const bestFocus = complete.reduce((best, m) => (m.focus > best.focus ? m : best), complete[0]);
  const mtd = months.find((m) => m.isMtd) || null;
  const prevMonth = mtd && months.length >= 2 ? months[months.length - 2] : months[months.length - 2] || null;

  const graph = h(
    'div',
    {},
    dualAxis({
      labels: months.map((m) => m.label + (m.isMtd ? '*' : '')),
      bars: { values: months.map((m) => m.tasks), color: C.planned },
      line: { values: months.map((m) => Math.round((m.focus / 60) * 10) / 10), color: C.secondary },
      yFmtB: (v) => `${v}h`,
      aria: `Monthly tasks completed (bars) and focus hours (line): ${months
        .map((m) => `${m.full} ${m.tasks} tasks, ${dur(m.focus)} focus${m.isMtd ? ' month-to-date' : ''}`)
        .join('; ')}.`,
      tipBar: (i, v) => [
        months[i].full + (months[i].isMtd ? ' (month-to-date)' : ''),
        `${v} tasks completed`,
        months[i].isMtd ? 'partial month — still running' : '',
      ].filter(Boolean),
      tipLine: (i, v) => [
        months[i].full + (months[i].isMtd ? ' (month-to-date)' : ''),
        `${v}h focus (${dur(Math.round(v * 60))})`,
        months[i].isMtd ? 'partial month — still running' : '',
      ].filter(Boolean),
    }),
    chartNote(
      `${months.length} months of history: tasks ${months.map((m) => m.tasks).join(', ')} · focus ${months
        .map((m) => dur(m.focus))
        .join(', ')}. * = month-to-date.`
    )
  );

  const latest = months[months.length - 1];
  const prose = [
    proseP(
      mtd
        ? `**${mtd.full} is month-to-date**: ${mtd.tasks} tasks and ${dur(mtd.focus)} of focus so far, against ${
            prevMonth ? `${prevMonth.tasks} tasks and ${dur(prevMonth.focus)} in ${prevMonth.full}` : 'no earlier full month'
          }.`
        : `The most recent month shown is **${latest.full}** with ${latest.tasks} tasks and ${dur(latest.focus)} of focus.`,
      ` Across ${complete.length} complete month${complete.length === 1 ? '' : 's'}, the high-water marks are **${bestTasks.full}** for tasks (${bestTasks.tasks}) and **${bestFocus.full}** for focus (${dur(bestFocus.focus)}).`
    ),
    proseP(
      mtd
        ? 'Month-to-date figures naturally trail full months — compare them as pace, not as a decline.'
        : 'Every month shown is complete, so the comparison is like-for-like.'
    ),
  ];

  return sectionEl({
    letter: 'C',
    title: 'Monthly trends',
    sub: 'Tasks completed (bars) and focus hours (line) across your full history · * month-to-date',
    legend: [sw('Tasks completed', C.planned), sw('Focus hours', C.secondary)],
    graph,
    kpis: [
      kpi(mtd ? `${mtd.label} so far` : 'Latest month', `${(mtd || latest).tasks} tasks`, mtd ? 'month-to-date' : 'complete month'),
      kpi('Previous month', prevMonth ? `${prevMonth.tasks} tasks` : '—', prevMonth ? prevMonth.full : 'no earlier month'),
      kpi('Focus, latest month', dur((mtd || latest).focus), mtd ? 'month-to-date' : 'complete month', 'ok'),
      kpi('Best complete month', `${bestTasks.tasks} tasks`, bestTasks.full),
    ],
    prose,
    notes: [
      noteNode('* Current month is month-to-date; every other month is complete.', 'ok'),
      noteNode(`Highest complete month for tasks: ${bestTasks.full} with ${bestTasks.tasks} completions.`, 'ok'),
      noteNode(`Highest complete month for focus: ${bestFocus.full} with ${dur(bestFocus.focus)}.`),
    ],
  });
}

function sectionD(a, x) {
  if (a.totals.planned <= 0) {
    return sectionEl({
      letter: 'D',
      title: 'Planned vs actual',
      sub: `${a.range.label} · scheduled focus against real focus time`,
      graph: na(
        'No plan data in this period',
        'Planned time comes from time blocks and scheduled tasks (start and end times). Add them in Plan, and this comparison fills in automatically.'
      ),
      prose: [
        proseP(
          'Nothing was scheduled in this period, so there is no plan to compare against. This section measures real focus only once a plan exists — it will not guess a target.'
        ),
      ],
      notes: [noteNode('Plan a day in the Plan screen to enable planned-vs-actual comparisons.', 'ok')],
    });
  }

  const graph = h(
    'div',
    {},
    groupedBars({
      labels: x.labels,
      series: [
        { name: 'Planned', color: C.planned, values: a.series.map((b) => b.planned) },
        { name: 'Actual', color: C.primary, values: a.series.map((b) => b.focus) },
      ],
      max: Math.max(...a.series.flatMap((b) => [b.planned, b.focus]), 1) * 1.18,
      yFmt: (v) => (v >= 60 ? `${Math.round((v / 60) * 10) / 10}h` : `${v}m`),
      aria: `Planned versus actual focus per ${x.bucketWord}. ${a.series
        .map((b) => `${b.full}: planned ${dur(b.planned)}, actual ${dur(b.focus)}`)
        .join('; ')}.`,
      tip: (s, i) => {
        const b = a.series[i];
        const delta = b.focus - b.planned;
        return [
          b.full,
          `Planned ${dur(b.planned)} · actual ${dur(b.focus)}`,
          delta === 0 ? 'Exactly on plan' : `${fmtSignedDur(delta)} ${delta > 0 ? 'over plan' : 'under plan'}`,
        ];
      },
    }),
    chartNote(
      `Plan achievement: ${pctText(
        a.totals.planned ? Math.round((a.totals.focus / a.totals.planned) * 100) : null
      )} of planned focus (${dur(a.totals.planned)} planned · ${dur(a.totals.focus)} actual).`
    )
  );

  const planPct = a.totals.planned ? Math.round((a.totals.focus / a.totals.planned) * 100) : null;
  const plannedRows = a.series.filter((b) => b.planned > 0);
  const metPlan = plannedRows.filter((b) => b.focus >= b.planned).length;
  const overRows = plannedRows
    .map((b) => ({ b, v: b.focus - b.planned }))
    .filter((r) => r.v > 0)
    .sort((p, q) => q.v - p.v);

  const prose = [
    proseP(
      `The plan asked for **${dur(a.totals.planned)}** of focus this period; you delivered **${dur(a.totals.focus)}** — **${pctText(planPct)} of the plan** (${fmtSignedDur(a.totals.focus - a.totals.planned)}).`,
      ` Focus landed on or above target on **${metPlan} of ${plannedRows.length} planned ${x.bucketWord}s**.`
    ),
    proseP(
      overRows.length
        ? `The biggest overrun was ${fmtSignedDur(overRows[0].v)} on ${overRows.slice(0, 3).map((r) => r.b.full).join(', ')}.`
        : 'No planned bucket ran over its target this period.',
      ' Planned minutes count time blocks and scheduled tasks that were not double-counted against their blocks.'
    ),
  ];

  return sectionEl({
    letter: 'D',
    title: 'Planned vs actual',
    sub: `${a.range.label} · scheduled focus against real focus time per ${x.bucketWord}`,
    legend: [sw('Planned', C.planned), sw('Actual', C.primary)],
    graph,
    kpis: [
      kpi('Planned focus', dur(a.totals.planned), 'blocks + scheduled times'),
      kpi('Actual focus', dur(a.totals.focus), `${fmtSignedDur(a.totals.focus - a.totals.planned)} vs plan`, 'ok'),
      kpi('Plan achieved', pctText(planPct), 'of planned focus', planPct != null && planPct >= 100 ? 'ok' : ''),
      kpi('Buckets on plan', `${metPlan} of ${plannedRows.length}`, 'at or above target'),
    ],
    prose,
    notes: [
      noteNode(
        `Actual focus vs plan: ${fmtSignedDur(a.totals.focus - a.totals.planned)} overall (${pctText(planPct)} achievement).`,
        planPct != null && planPct >= 100 ? 'ok' : 'warn'
      ),
      noteNode(`${plannedRows.length} of ${a.series.length} ${x.bucketWord}s carried planned time.`),
      noteNode('Planned minutes come only from stored blocks and scheduled task times — never estimated.'),
    ],
  });
}

function sectionE(a, x) {
  const due = a.totals.due;
  if (due === 0) {
    return sectionEl({
      letter: 'E',
      title: 'Task breakdown by priority',
      sub: `${a.range.label} · share of tasks due`,
      graph: na('No tasks due in this period', 'Tasks with a due date inside the selected range appear in this breakdown.'),
      prose: [proseP('Nothing was due in this period, so a breakdown by priority would only show zeros.')],
    });
  }

  const parts = a.priority
    .filter((p) => p.due > 0)
    .map((p) => ({
      label: `${p.name} priority`,
      value: p.due,
      color: C[p.name],
      note: `${p.done} of ${p.due} completed · ${pctText(Math.round((p.done / p.due) * 100))}`,
      right: `${Math.round((p.due / due) * 100)}% of due`,
      barFrac: p.due ? p.done / p.due : 0,
    }));

  const graph = h(
    'div',
    {},
    donutLegend({
      parts,
      center: due,
      centerSub: 'tasks due',
      aria: `Donut of ${due} tasks due by priority: ${parts
        .map((p) => `${p.label} ${p.value}, ${p.note}`)
        .join('; ')}.`,
      tip: (p) => [p.label, `${p.value} tasks due this period`, p.note],
    }),
    chartNote(
      `Due per priority: ${a.priority.map((p) => `${p.name} ${p.due}`).join(' · ')} · overall completion ${pctText(a.totals.completion)}.`
    )
  );

  const cleared = a.priority
    .filter((p) => p.due > 0)
    .map((p) => ({ ...p, rate: Math.round((p.done / p.due) * 100) }));
  const largest = cleared.reduce((best, p) => (p.due > best.due ? p : best), cleared[0]);
  const bestRate = cleared.reduce((best, p) => (p.rate > best.rate ? p : best), cleared[0]);
  const backlog = cleared.reduce((best, p) => (p.open > best.open ? p : best), cleared[0]);
  const open = due - a.totals.done;

  const prose = [
    proseP(
      `Of the **${due} tasks due** in this period you closed **${a.totals.done}** — a completion rate of **${pctText(a.totals.completion)}**.`,
      ` **${largest.name} priority** carries the largest share of the workload: ${largest.due} tasks, ${Math.round(
        (largest.due / due) * 100
      )}% of everything due.`
    ),
    proseP(
      `Clearance is strongest for **${bestRate.name} priority at ${bestRate.rate}%** (${bestRate.done} of ${bestRate.due}).`,
      open > 0
        ? ` ${open} task${open === 1 ? '' : 's'} remain open: ${cleared
            .map((p) => `${p.open} ${p.name.toLowerCase()}`)
            .join(', ')}.`
        : ' Everything due was cleared.'
    ),
  ];

  return sectionEl({
    letter: 'E',
    title: 'Task breakdown by priority',
    sub: `${a.range.label} · share of the ${due} tasks due, and how completely each priority was cleared`,
    legend: a.priority.filter((p) => p.due > 0).map((p) => sw(p.name, C[p.name])),
    graph,
    kpis: [
      kpi('Overall completion', pctText(a.totals.completion), `${a.totals.done} of ${due} tasks`, 'ok'),
      kpi('Largest priority', `${largest.name} · ${largest.due}`, `${Math.round((largest.due / due) * 100)}% of due`),
      kpi('Best clearance', `${bestRate.name} · ${bestRate.rate}%`, `${bestRate.done} of ${bestRate.due} cleared`, 'ok'),
      kpi('Still open', `${open} task${open === 1 ? '' : 's'}`, open ? 'carried forward' : 'all cleared', open ? 'pink' : 'ok'),
    ],
    prose,
    notes: [
      noteNode(`${bestRate.name} clears fastest: ${bestRate.done} of ${bestRate.due} done.`, 'ok'),
      noteNode(`${largest.name} carries the volume: ${largest.due} due, ${largest.done} completed, ${largest.open} left.`),
      open
        ? noteNode(`${open} open items remain — the largest backlog is ${backlog.name.toLowerCase()} priority (${backlog.open}).`, 'warn')
        : noteNode('No backlog: every task due in this period is complete.', 'ok'),
    ],
  });
}

function sectionF(a, x) {
  if (!a.focusPriority.supported) {
    return sectionEl({
      letter: 'F',
      title: 'Focus time by priority',
      sub: `${a.range.label} · attribution needs linked time blocks`,
      graph: na(
        'Cannot attribute focus yet',
        'Focus minutes are matched to priorities through time blocks that link a task. This range has no time blocks, so a per-priority split would be guesswork — section B still shows the total.'
      ),
      prose: [
        proseP(
          `**${dur(a.totals.focus)}** of focus was recorded, but none of it can be attributed to a priority: the selected range contains no time blocks linking focus sessions to tasks.`
        ),
      ],
      notes: [noteNode('Link a task to a time block in Plan, and focus splits by priority appear here.', 'ok')],
    });
  }
  if (a.focusPriority.total <= 0) {
    return sectionEl({
      letter: 'F',
      title: 'Focus time by priority',
      sub: `${a.range.label} · no focus to distribute`,
      graph: na('No focus sessions in this period', 'Sessions recorded inside linked time blocks will be split by task priority here.'),
      prose: [proseP('There is no focus time in this period to attribute.')],
    });
  }

  const total = a.focusPriority.total;
  const pctOf = (v) => Math.round((v / total) * 100);
  const rows = [
    ...a.focusPriority.rows.map((r) => ({
      label: `${r.name} priority`,
      value: r.minutes,
      color: C[r.name],
      right: `${dur(r.minutes)} · ${pctOf(r.minutes)}%`,
    })),
    ...(a.focusPriority.unlinked > 0
      ? [{
          label: 'Block, no task link',
          value: a.focusPriority.unlinked,
          color: C.unlinked,
          right: `${dur(a.focusPriority.unlinked)} · ${pctOf(a.focusPriority.unlinked)}%`,
        }]
      : []),
    ...(a.focusPriority.unmatched > 0
      ? [{
          label: 'Outside any block',
          value: a.focusPriority.unmatched,
          color: C.unmatched,
          right: `${dur(a.focusPriority.unmatched)} · ${pctOf(a.focusPriority.unmatched)}%`,
        }]
      : []),
  ];

  const attributed = a.focusPriority.rows.reduce((n, r) => n + r.minutes, 0);
  const attributedRows = a.focusPriority.rows.filter((r) => r.minutes > 0);
  const biggest = attributedRows.length
    ? attributedRows.reduce((best, r) => (r.minutes > best.minutes ? r : best), attributedRows[0])
    : null;
  const coverage = pctOf(attributed);

  const graph = h(
    'div',
    {},
    hBars({
      rows,
      aria: `Focus minutes by priority: ${rows.map((r) => `${r.label} ${r.right}`).join('; ')}.`,
      tip: (row) => [row.label, `${dur(row.value)} of focus`, `${pctOf(row.value)}% of period focus`],
    }),
    chartNote(
      `Method: each session is matched to the time block covering its start time, then to that block's linked task priority. Attributed ${dur(attributed)} of ${dur(total)}.`
    )
  );

  const prose = [
    proseP(
      `Of the **${dur(total)}** of focus in this period, **${dur(attributed)} (${coverage}%)** could be attributed to a priority.`,
      biggest
        ? ` **${biggest.name} priority absorbed the largest share: ${dur(biggest.minutes)} (${pctOf(biggest.minutes)}%)**.`
        : ''
    ),
    proseP(
      attributed === 0
        ? `None of it reached a priority: ${dur(a.focusPriority.unlinked)} sat in blocks with no linked task and ${dur(a.focusPriority.unmatched)} fell outside any block.`
        : a.focusPriority.unlinked + a.focusPriority.unmatched > 0
          ? `${dur(a.focusPriority.unlinked)} sat in blocks with no linked task and ${dur(a.focusPriority.unmatched)} fell outside any block — shown as separate rows rather than folded into a priority.`
          : 'Every session fell inside a block linked to a task, so attribution is complete for this period.',
      ' This is an estimate by time overlap: a session counts where it started, not how it was split.'
    ),
  ];

  return sectionEl({
    letter: 'F',
    title: 'Focus time by priority',
    sub: `${a.range.label} · where ${dur(total)} of focus went, matched through linked time blocks`,
    legend: rows.map((r) => sw(r.label, r.color)),
    graph,
    kpis: [
      kpi('Total focus', dur(total), `${a.totals.sessions} sessions`),
      biggest
        ? kpi('Largest share', `${biggest.name} · ${pctOf(biggest.minutes)}%`, dur(biggest.minutes), 'ok')
        : kpi('Largest share', '—', 'all focus unattributed'),
      kpi('Attributed', `${coverage}%`, `${dur(attributed)} linked to priorities`),
      kpi(
        'Unattributed',
        dur(a.focusPriority.unlinked + a.focusPriority.unmatched),
        'unlinked or outside blocks',
        a.focusPriority.unlinked + a.focusPriority.unmatched > 0 ? 'warm' : 'ok'
      ),
    ],
    prose,
    notes: [
      noteNode(`Attribution coverage: ${coverage}% of focus matched to a priority.`, coverage >= 80 ? 'ok' : 'warn'),
      a.focusPriority.unlinked
        ? noteNode(`${dur(a.focusPriority.unlinked)} in blocks without a linked task.`, 'warn')
        : noteNode('All in-range blocks link a task.', 'ok'),
      noteNode('Sessions are matched by start time inside a block — an honest approximation, not a stopwatch log.'),
    ],
  });
}

function sectionG(a, x) {
  if (a.totals.focus <= 0) {
    return sectionEl({
      letter: 'G',
      title: 'Focus by hour of day',
      sub: `${a.range.label} · when deep work happens`,
      graph: na('No focus sessions in this period', 'The hour heatmap fills in as soon as focus sessions are recorded.'),
      prose: [proseP('No focus sessions were recorded in this period, so there is no time-of-day pattern to describe.')],
    });
  }

  const totals = a.hours.totals;
  const peak = a.hours.peakHour;
  const totalFocus = a.totals.focus;
  const band = (from, to) => totals.slice(from, to).reduce((n, v) => n + v, 0);

  let quietIdx = 8;
  let quietVal = Infinity;
  for (let hour = 8; hour <= 21; hour += 1) {
    const pair = totals[hour] + (totals[hour + 1] || 0);
    if (pair < quietVal) {
      quietVal = pair;
      quietIdx = hour;
    }
  }

  const morning = band(6, 12);
  const afternoon = band(12, 18);
  const evening = band(18, 24);
  const night = band(23, 24);
  const pctOfTotal = (v) => Math.round((v / totalFocus) * 100);

  const graph = h(
    'div',
    {},
    hourHeat({
      matrix: a.hours.matrix,
      dayLabels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      aria: `Focus minutes by weekday and hour for ${a.range.label}. Peak hour ${
        peak != null ? `${hhmm(peak)}–${hhmm(peak + 1)} with ${dur(totals[peak])}` : 'unknown'
      }; total ${dur(totalFocus)}.`,
      tip: (dayIdx, hour, minutes) => [
        WEEKDAYS[dayIdx],
        `${hhmm(hour)}–${hhmm(hour + 1)}`,
        minutes > 0 ? `${dur(minutes)} focus` : 'No focus time',
      ],
    }),
    chartNote(
      `Peak hour ${peak != null ? `${hhmm(peak)}–${hhmm(peak + 1)} (${dur(totals[peak])})` : '—'} · mornings ${dur(
        morning
      )} · afternoons ${dur(afternoon)} · evenings ${dur(evening)}.`
    )
  );

  const prose = [
    proseP(
      `The single busiest hour is **${hhmm(peak)}–${hhmm(peak + 1)}**, which collected **${dur(totals[peak])}** across the period. The distribution leans ${
        afternoon >= morning ? 'afternoon' : 'morning'
      }: mornings hold ${dur(morning)} (${pctOfTotal(morning)}%), afternoons ${dur(afternoon)} (${pctOfTotal(
        afternoon
      )}%) and evenings ${dur(evening)} (${pctOfTotal(evening)}%).`,
      ` The quietest two-hour window is ${hhmm(quietIdx)}–${hhmm(quietIdx + 2)} with only ${dur(quietVal)}.`
    ),
    proseP(
      night > 0
        ? `Late nights stay mostly unused: ${dur(night)} between 23:00 and midnight across the whole period — a boundary worth protecting.`
        : 'Nothing at all was logged between 23:00 and midnight — evenings remain completely free.'
    ),
  ];

  return sectionEl({
    letter: 'G',
    title: 'Focus by hour of day',
    sub: `${a.range.label} · when deep work actually happens`,
    legend: [sw('More focus', C.primary), sw('Less focus', 'var(--accent-soft)')],
    graph,
    kpis: [
      kpi('Peak hour', `${hhmm(peak)}–${hhmm(peak + 1)}`, `${dur(totals[peak])} total`, 'ok'),
      kpi('Morning 06–12', dur(morning), `${pctOfTotal(morning)}% of focus`),
      kpi('Afternoon 12–18', dur(afternoon), `${pctOfTotal(afternoon)}% of focus`),
      kpi('Evening 18–24', dur(evening), `${pctOfTotal(evening)}% of focus`, 'ok'),
    ],
    prose,
    notes: [
      noteNode(`Peak focus hour: ${hhmm(peak)}–${hhmm(peak + 1)}, totalling ${dur(totals[peak])}.`, 'ok'),
      noteNode(`Quietest working window: ${hhmm(quietIdx)}–${hhmm(quietIdx + 2)}, holding ${dur(quietVal)}.`),
      night > 0 ? noteNode(`Between 23:00 and midnight there are just ${dur(night)} of focus.`) : noteNode('No focus between 23:00 and midnight at all.', 'ok'),
    ],
  });
}

function sectionH(a) {
  const stat = a.goals;
  if (stat.total === 0) {
    return sectionEl({
      letter: 'H',
      title: 'Goal progress',
      sub: 'Current state of your goals',
      graph: na('No goals yet', 'Create a goal on the Goals screen and its progress shows up here immediately.'),
      prose: [proseP('There are no goals to report on. Goals store only their current progress, so this section never invents a trend.')],
    });
  }
  if (stat.active === 0) {
    return sectionEl({
      letter: 'H',
      title: 'Goal progress',
      sub: `${stat.done} completed · ${stat.total} total`,
      graph: na('No active goals', `All ${stat.done} of your goals are marked complete — create a new goal to track ongoing progress.`),
      prose: [proseP(`Every goal you set is finished: **${stat.done} of ${stat.total} complete**. There is nothing currently in flight to measure.`)],
      notes: [noteNode('Completed goals stay on the Goals screen.', 'ok')],
    });
  }

  const rows = stat.rows;
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const near = stat.nearTarget.length;

  const graph = h(
    'div',
    { class: 'pg-goal-list' },
    ...rows.map((g) =>
      h(
        'div',
        { class: 'pg-goal-row' },
        h(
          'div',
          { class: 'pg-goal-top' },
          h('b', {}, g.title),
          h(
            'span',
            { class: 'pg-goal-meta' },
            h('span', {}, `${g.progress}%`),
            h('span', { class: `pg-tag ${g.progress >= 75 ? 'ok' : 'warn'}` }, g.progress >= 75 ? 'Near target' : 'In progress')
          )
        ),
        h(
          'div',
          {
            class: `pg-track ${g.progress >= 75 ? '' : 'behind'}`.trim(),
            role: 'progressbar',
            'aria-valuenow': String(g.progress),
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-label': `${g.title} progress`,
          },
          h('i', { style: { width: `${g.progress}%` } })
        ),
        h(
          'div',
          { class: 'pg-goal-top' },
          h(
            'span',
            { class: 'pg-goal-note' },
            g.target > 0
              ? `${g.current} of ${g.target}${g.unit ? ` ${g.unit}` : ''}${g.remaining != null ? ` · ${g.remaining} to go` : ''}`
              : g.kind === 'long'
                ? 'Long-term goal'
                : 'Active goal'
          )
        )
      )
    )
  );

  const prose = [
    proseP(
      `**${stat.active} goal${stat.active === 1 ? ' is' : 's are'} active**, averaging **${stat.avgProgress}% progress**.`,
      ` **${best.title} leads at ${best.progress}%**`,
      best.target > 0 ? ` (${best.current} of ${best.target}${best.unit ? ` ${best.unit}` : ''}).` : '.',
      ` ${near} of ${stat.active} sit at or above the 75% mark.`
    ),
    proseP(
      stat.active > 1
        ? `The lightest is **${worst.title} at ${worst.progress}%**${worst.remaining != null ? `, with ${worst.remaining} ${worst.unit || 'units'} left to reach ${worst.target}` : ''}.`
        : '',
      ' Goals only store their current value — no history exists, so no week-on-week change is claimed for them.'
    ),
  ];

  return sectionEl({
    letter: 'H',
    title: 'Goal progress',
    sub: `${stat.active} active goal${stat.active === 1 ? '' : 's'} · current progress (no history is stored for goals)`,
    legend: [sw('Near target (≥75%)', 'var(--success)'), sw('In progress', 'var(--amber)')],
    graph,
    kpis: [
      kpi('Active goals', String(stat.active), `${stat.done} completed`, 'ok'),
      kpi('Average progress', `${stat.avgProgress}%`, 'across active goals'),
      kpi('Furthest along', `${best.progress}%`, best.title, 'ok'),
      kpi('Near target', `${near} of ${stat.active}`, 'at ≥75% progress', near ? 'ok' : 'warm'),
    ],
    prose,
    notes: [
      noteNode(`${near} goal${near === 1 ? '' : 's'} at or above 75% — including ${best.title}.`, 'ok'),
      stat.active > 1
        ? noteNode(`${worst.title} is the longest way to go at ${worst.progress}%.`, worst.progress < 50 ? 'warn' : '')
        : noteNode('Single active goal — nothing to compare against.'),
      noteNode('Progress comes from the value you set on the Goals screen; the app never adjusts it for you.'),
    ],
  });
}

function sectionI(a, x) {
  const due = a.totals.due;
  if (due === 0) {
    return sectionEl({
      letter: 'I',
      title: 'Priority analysis',
      sub: `${a.range.label} · completed vs still open`,
      graph: na('No tasks due in this period', 'Priority analysis needs tasks with a due date inside the selected range.'),
      prose: [proseP('Nothing was due in this period, so there is no priority split to analyse.')],
    });
  }

  const graph = h(
    'div',
    {},
    groupedBars({
      labels: a.priority.map((p) => p.name),
      series: [
        { name: 'Completed', color: C.primary, values: a.priority.map((p) => p.done) },
        { name: 'Still due', color: C.prev, values: a.priority.map((p) => p.open) },
      ],
      max: Math.max(...a.priority.map((p) => p.due), 1) * 1.2,
      aria: `Completed versus still due per priority: ${a.priority
        .map((p) => `${p.name} ${p.done} of ${p.due} completed`)
        .join('; ')}.`,
      tip: (s, i) => {
        const p = a.priority[i];
        return [
          `${p.name} priority`,
          `${p.done} completed of ${p.due} due`,
          `${pctText(p.due ? Math.round((p.done / p.due) * 100) : null)} cleared · ${p.open} left open`,
        ];
      },
    }),
    chartNote(`Cleared per priority: ${a.priority.map((p) => `${p.name} ${p.done}/${p.due}`).join(' · ')}.`)
  );

  const rates = a.priority.filter((p) => p.due > 0).map((p) => ({ ...p, rate: Math.round((p.done / p.due) * 100) }));
  const openTotal = a.totals.due - a.totals.done;
  const backlog = rates.reduce((best, p) => (p.open > best.open ? p : best), rates[0]);
  const high = a.priority.find((p) => p.name === 'High');
  const ordered = [...rates].sort((m, n) => n.rate - m.rate);
  const orderingHolds =
    rates.length >= 2 && rates.every((p, i) => i === 0 || rates[i - 1].rate >= p.rate);

  const prose = [
    proseP(
      rates.length >= 2
        ? `Clearance by priority: ${rates.map((p) => `**${p.name} ${p.rate}%** (${p.done}/${p.due})`).join(', ')}. ${
            orderingHolds
              ? 'The ordering holds from highest to lowest priority — important work finished first.'
              : 'The order is not strictly by priority this period, so it is worth checking what crowded the top of the list.'
          }`
        : `Only ${rates[0].name} priority tasks were due: ${rates[0].done} of ${rates[0].due} cleared (${rates[0].rate}%).`
    ),
    proseP(
      openTotal > 0
        ? `Of the ${due} tasks due, **${openTotal} remain open** — the largest share sits with **${backlog.name.toLowerCase()} priority** (${backlog.open} items).`
        : `Everything due was cleared — **0 open items** across all priorities.`,
      high && high.open > 0
        ? ` ${high.open} high-priority item${high.open === 1 ? '' : 's'} still need attention.`
        : high && high.due > 0
          ? ' Every high-priority task due in this period is done.'
          : ''
    ),
  ];

  return sectionEl({
    letter: 'I',
    title: 'Priority analysis',
    sub: `${a.range.label} · what was completed out of the ${due} tasks due, split by priority`,
    legend: [sw('Completed', C.primary), sw('Still due', C.prev)],
    graph,
    kpis: [
      ...a.priority.map((p) =>
        kpi(
          `${p.name} priority`,
          p.due ? `${p.done}/${p.due}` : '—',
          p.due ? `${Math.round((p.done / p.due) * 100)}% cleared` : 'none due',
          p.due && p.open === 0 ? 'ok' : p.open > 0 ? '' : ''
        )
      ),
      kpi('Open items', String(openTotal), openTotal ? `${backlog.name} has the most` : 'all cleared', openTotal ? 'pink' : 'ok'),
    ],
    prose,
    notes: [
      noteNode(
        ordered[0].name === 'High' || rates.length < 2
          ? `Best clearance: ${ordered[0].name} at ${ordered[0].rate}%.`
          : `High priority leads on completion: ${ordered[0].rate}% cleared.`,
        'ok'
      ),
      high && high.open > 0
        ? noteNode(`Only ${high.open} high-priority task${high.open === 1 ? '' : 's'} remain.`, 'ok')
        : noteNode('No high-priority backlog.', 'ok'),
      openTotal
        ? noteNode(`${backlog.open} ${backlog.name.toLowerCase()}-priority items are open — the largest share of the backlog.`, 'warn')
        : noteNode('No open items in this period.', 'ok'),
    ],
  });
}

function sectionJ(a, x) {
  const cal = a.calendar;
  const total = cal.days.length;
  const noDataDays = cal.days.filter((d) => d.noData).length;
  const knownDays = total - noDataDays;

  if (cal.active === 0) {
    return sectionEl({
      letter: 'J',
      title: 'Consistency',
      sub: `${dayShort(cal.start)} – ${dayShort(cal.end)} · activity per day`,
      graph: na(
        'No activity in this window',
        `Nothing was completed or focused on between ${dayShort(cal.start)} and ${dayShort(cal.end)}. Empty days before your first record are not counted against you.`
      ),
      prose: [
        proseP(
          `No activity was recorded across the ${knownDays} tracked days from ${dayShort(cal.start)} to ${dayShort(cal.end)}. The window stays visible so the gap is honest rather than hidden.`
        ),
      ],
      notes: [noteNode('Consistency counts days with a completed task or a focus session.', 'ok')],
    });
  }

  /* group days into months for the grid */
  const groups = [];
  for (const cell of cal.days) {
    const key = cell.label.slice(0, 7);
    const last = groups[groups.length - 1];
    if (!last || last.key !== key) groups.push({ key, cells: [cell] });
    else last.cells.push(cell);
  }

  const level = (n) => (n === 0 ? '' : n <= 3 ? 'l1' : n <= 5 ? 'l2' : n <= 7 ? 'l3' : 'l4');

  const grid = h(
    'div',
    { class: 'pg-cal' },
    h(
      'div',
      { class: 'pg-cal-head', 'aria-hidden': 'true' },
      ...['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => h('span', { title: WEEKDAYS[i] }, d))
    ),
    ...groups.map((g) => {
      const firstDate = labelToDate(g.cells[0].label);
      const lead = (firstDate.getDay() + 6) % 7; // Monday-first weekday of first rendered day
      return h(
        'div',
        { class: 'pg-cal-group' },
        h('p', { class: 'pg-cal-month' }, firstDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        h(
          'div',
          { class: 'pg-cal-grid' },
          ...Array.from({ length: lead }, () => h('span', { class: 'pg-cal-cell void', 'aria-hidden': 'true' })),
          ...g.cells.map((cell) => {
            const dt = labelToDate(cell.label);
            const label = dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
            const body = cell.tasksDone > 0 ? String(cell.tasksDone) : cell.focus > 0 ? '·' : '';
            const cls = cell.noData
              ? 'void'
              : cell.tasksDone > 0
                ? level(cell.tasksDone)
                : cell.focus > 0
                  ? 'l1'
                  : '';
            const cellEl = h('span', { class: `pg-cal-cell ${cls}`.trim() }, body);
            const lines = [
              label,
              cell.noData
                ? 'Before your first record'
                : cell.tasksDone > 0
                  ? `${cell.tasksDone} task${cell.tasksDone === 1 ? '' : 's'} completed`
                  : 'No tasks completed',
              cell.focus > 0 ? `${dur(cell.focus)} focus` : '',
            ].filter(Boolean);
            cellEl.addEventListener('pointerenter', (ev) => showTipAt(ev.clientX, ev.clientY, lines));
            cellEl.addEventListener('pointermove', (ev) => showTipAt(ev.clientX, ev.clientY, lines));
            cellEl.addEventListener('pointerleave', hideTip);
            return cellEl;
          })
        )
      );
    }),
    h(
      'p',
      { class: 'pg-cal-scale' },
      h('i', {}),
      ' none ',
      h('i', { class: 'l1' }),
      ' 1–3 ',
      h('i', { class: 'l2' }),
      ' 4–5 ',
      h('i', { class: 'l3' }),
      ' 6–7 ',
      h('i', { class: 'l4' }),
      ' 8+ ',
      h('i', { class: 'l1' }),
      ' · = focus only'
    )
  );

  const graph = h(
    'div',
    {},
    grid,
    chartNote(
      `${cal.active} of ${knownDays} tracked days active · best run ${cal.run} day${cal.run === 1 ? '' : 's'}${
        cal.runStart ? ` from ${dayShort(cal.runStart)}` : ''
      }${cal.truncated ? ' · window capped at the most recent 90 days' : ''}.`
    )
  );

  const runLabel = cal.runStart ? dayShort(cal.runStart) : '—';
  const gapLabel =
    cal.gapStart && cal.gap > 0
      ? `${dayShort(cal.gapStart)} → ${dayShort(addDays(cal.gapStart, cal.gap - 1))}`
      : 'none';
  const quiet = knownDays - cal.active;
  const perActive = cal.active ? Math.round((cal.totalTasks / cal.active) * 10) / 10 : 0;
  const hasBestDay = cal.best && cal.max > 0;

  const prose = [
    proseP(
      `Across the ${knownDays} tracked days from ${dayShort(cal.start)} to ${dayShort(cal.end)} you were active on **${cal.active} days** and quiet on ${quiet}${
        noDataDays ? ` (a further ${noDataDays} days precede your first record and are excluded)` : ''
      }. Those active days produced **${cal.totalTasks} completed tasks**, an average of ${perActive} each.`,
      hasBestDay ? ` The best single day was **${dayName(cal.best.label)} ${dayShort(cal.best.label)} with ${cal.max} completions**.` : ''
    ),
    proseP(
      cal.gap >= 2
        ? `The longest quiet spell was **${cal.gap} days (${gapLabel})**.`
        : 'No multi-day gaps opened in this window.',
      cal.run >= 2 ? ` The longest active run stands at **${cal.run} days**, starting ${runLabel}.` : ''
    ),
  ];

  return sectionEl({
    letter: 'J',
    title: 'Consistency',
    sub: `${dayShort(cal.start)} – ${dayShort(cal.end)} · tasks completed per day${cal.truncated ? ' · most recent 90 days' : ''}`,
    legend: [sw('Active day', C.primary), sw('No activity', 'var(--surface-muted)')],
    graph,
    kpis: [
      kpi('Active days', `${cal.active} of ${knownDays}`, `${Math.round((cal.active / knownDays) * 100)}% of tracked days`, 'ok'),
      kpi('Longest run', `${cal.run} day${cal.run === 1 ? '' : 's'}`, cal.runStart ? `from ${dayShort(cal.runStart)}` : '—'),
      kpi('Longest gap', `${cal.gap} day${cal.gap === 1 ? '' : 's'}`, gapLabel, cal.gap >= 3 ? 'pink' : ''),
      kpi('Tasks in window', String(cal.totalTasks), `${perActive} per active day`),
    ],
    prose,
    notes: [
      noteNode(`Longest active run: ${cal.run} day${cal.run === 1 ? '' : 's'}${cal.runStart ? ` from ${dayShort(cal.runStart)}` : ''}.`, 'ok'),
      cal.gap >= 2 ? noteNode(`Longest gap: ${cal.gap} days (${gapLabel}).`, 'warn') : noteNode('No gap longer than a single day.', 'ok'),
      hasBestDay
        ? noteNode(`Best day: ${dayName(cal.best.label)} ${dayShort(cal.best.label)} with ${cal.max} completions.`)
        : noteNode('No tasks were completed in this window — activity was focus-only (marked with a dot).'),
    ],
  });
}

function sectionK(a, x) {
  if (!a.prev || !a.deltas) {
    return sectionEl({
      letter: 'K',
      title: 'Period-over-period comparison',
      sub: `${a.range.label} · no previous period to compare`,
      graph: na(
        'Nothing to compare yet',
        a.range.allTime
          ? 'All-time view spans your whole history, so there is no equivalent previous window. Pick Week, Month or 90 days to compare periods.'
          : `The ${x.prevWord} contains no tasks, sessions or plan data, so every change would read as −100%. The comparison appears as soon as that period has activity.`
      ),
      prose: [
        proseP(
          a.range.allTime
            ? 'The all-time range has no preceding window by definition. Switch to a bounded range to see change over time.'
            : `There is no data in the ${x.prevWord} to compare against — showing a percentage change now would be misleading.`
        ),
      ],
      notes: [noteNode('Comparisons use the immediately preceding window of equal length.', 'ok')],
    });
  }

  const rows = [
    { name: 'Tasks completed', a: a.totals.done, b: a.prev.done, fmt: (v) => String(v), delta: fmtSigned(a.deltas.done.abs) },
    { name: 'Focus time', a: a.totals.focus, b: a.prev.focus, fmt: dur, delta: fmtSignedDur(a.deltas.focus.abs) },
    { name: 'Completion rate', a: a.totals.completion, b: a.prev.completion, fmt: pctText, delta: ppText(a.deltas.completion.abs) },
    { name: 'Avg tasks / day', a: x.curAvgDone, b: x.prevAvgDone, fmt: (v) => v.toFixed(1), delta: fmtSigned(x.avgDoneDelta.abs, 1) },
    { name: 'Avg focus / day', a: x.curAvgFocus, b: x.prevAvgFocus, fmt: dur, delta: fmtSignedDur(x.avgFocusDelta.abs) },
    { name: 'Active days', a: a.totals.activeDays, b: a.prev.activeDays, fmt: (v) => String(v), delta: fmtSigned(a.deltas.activeDays.abs) },
  ];

  const comparable = rows.filter((r) => r.a != null && r.b != null);
  const improved = comparable.filter((r) => r.a > r.b).length;
  const regressed = comparable.filter((r) => r.a < r.b).length;
  const unchanged = comparable.length - improved - regressed;
  const biggest = comparable
    .filter((r) => r.b > 0)
    .reduce((best, r) => {
      const rel = (r.a - r.b) / r.b;
      return !best || rel > best.rel ? { ...r, rel } : best;
    }, null);

  const sameDays = x.daysIn === x.daysPrev;

  const graph = h(
    'div',
    { class: 'pg-wow' },
    h(
      'div',
      { class: 'pg-wow-row head' },
      h('span', {}, 'Metric'),
      h('span', {}, x.prevLabel),
      h('span', {}, 'This period'),
      h('span', {}, 'Change')
    ),
    ...rows.map((r) => {
      const max = Math.max(r.a || 0, r.b || 0, 1);
      return h(
        'div',
        { class: 'pg-wow-row' },
        h('span', { class: 'w-name' }, r.name),
        h('span', { class: 'pg-wow-bar prev', 'aria-label': `${x.prevLabel}: ${r.b == null ? '—' : r.fmt(r.b)}` }, h('i', { style: { width: `${((r.b || 0) / max) * 100}%` } })),
        h('span', { class: 'pg-wow-bar', 'aria-label': `This period: ${r.a == null ? '—' : r.fmt(r.a)}` }, h('i', { style: { width: `${((r.a || 0) / max) * 100}%` } })),
        h('span', { class: 'pg-wow-val' }, r.delta)
      );
    })
  );

  const prose = [
    proseP(
      `${improved} of ${comparable.length} tracked metrics improved against the ${x.prevWord}, ${unchanged} held and ${regressed} fell${
        biggest ? `. The largest relative move: **${biggest.name} — ${biggest.fmt(biggest.b)} → ${biggest.fmt(biggest.a)}** (${fmtSigned(Math.round(biggest.rel * 100))}%)` : ''
      }.`
    ),
    proseP(
      `Focus moved ${fmtSignedDur(a.deltas.focus.abs)}${
        sameDays ? ` (${signedPct(a.deltas.focus.pct)})` : ''
      } while tasks moved ${fmtSigned(
        a.deltas.done.abs
      )}${sameDays ? ` (${signedPct(a.deltas.done.pct)})` : ''}, and the completion rate shifted ${ppText(
        a.deltas.completion.abs
      )} to ${pctText(a.totals.completion)}. `,
      sameDays
        ? `Both windows span ${x.daysIn} day${x.daysIn === 1 ? '' : 's'}, so the totals are directly comparable.`
        : `This window spans ${x.daysIn} days while the ${x.prevWord} spans ${x.daysPrev} — compare the daily averages rather than the raw totals.`
    ),
  ];

  return sectionEl({
    letter: 'K',
    title: 'Period-over-period comparison',
    sub: `${a.range.label} vs ${x.prevLabel} · every headline metric`,
    legend: [sw(x.prevLabel, C.prev), sw('This period', C.primary)],
    graph,
    kpis: [
      kpi('Metrics improved', `${improved} of ${comparable.length}`, unchanged && !regressed ? `${unchanged} unchanged` : regressed ? `${regressed} declined` : 'none declined', 'ok'),
      kpi('Biggest gain', biggest ? biggest.name : '—', biggest ? biggest.delta : 'no comparable metric', 'ok'),
      kpi(
        'Tasks',
        fmtSigned(a.deltas.done.abs),
        sameDays ? signedPct(a.deltas.done.pct) : `${x.daysIn}-day vs ${x.daysPrev}-day windows`
      ),
      kpi('Completion rate', ppText(a.deltas.completion.abs), `${pctText(a.totals.completion)} vs ${pctText(a.prev.completion)}`, (a.deltas.completion.abs ?? 0) >= 0 ? 'ok' : 'pink'),
    ],
    prose,
    notes: [
      noteNode(`${improved} of ${comparable.length} metrics improved against the ${x.prevWord}.`, improved > regressed ? 'ok' : 'warn'),
      biggest ? noteNode(`Largest relative gain: ${biggest.name}, ${biggest.delta}.`, 'ok') : noteNode('No metric has a non-zero baseline to grow from.'),
      noteNode(`Completion rate ${pctText(a.prev.completion)} → ${pctText(a.totals.completion)} while tasks due moved ${fmtSigned(a.totals.due - a.prev.due)}.`),
      sameDays ? noteNode(`Both windows span ${x.daysIn} days — totals are comparable.`, 'ok') : noteNode(`Window lengths differ (${x.daysIn} vs ${x.daysPrev} days) — weigh the daily averages.`, 'warn'),
    ],
  });
}

function sectionL(a, x) {
  const deltas = a.deltas;
  const deltaRows = deltas
    ? [
        { name: 'Tasks completed', v: deltas.done.abs, txt: fmtSigned(deltas.done.abs) },
        { name: 'Focus time', v: deltas.focus.abs / 60, txt: fmtSignedDur(deltas.focus.abs) },
        ...(deltas.completion.abs != null
          ? [{ name: 'Completion rate', v: deltas.completion.abs, txt: ppText(deltas.completion.abs) }]
          : []),
        { name: 'Avg tasks / day', v: x.avgDoneDelta.abs, txt: fmtSigned(x.avgDoneDelta.abs, 1) },
        { name: 'Avg focus / day', v: x.avgFocusDelta.abs / 60, txt: fmtSignedDur(x.avgFocusDelta.abs) },
        { name: 'Active days', v: deltas.activeDays.abs, txt: fmtSigned(deltas.activeDays.abs) },
      ]
    : [];
  const maxDelta = Math.max(...deltaRows.map((d) => Math.abs(d.v)), 1);

  const cal = a.calendar;
  const milestones = [];
  if (cal.gap >= 2 && cal.gapStart) {
    milestones.push({
      date: dayShort(cal.gapStart),
      title: 'Longest quiet gap of the window begins',
      note: `${cal.gap} days with no completed tasks — work resumed on ${dayShort(addDays(cal.gapStart, cal.gap - 1))}.`,
    });
  }
  if (cal.run >= 2 && cal.runStart) {
    milestones.push({
      date: dayShort(cal.runStart),
      title: 'Longest active run starts',
      note: `Every day since then recorded activity — ${cal.run} days in total.`,
    });
  }
  if (cal.best && cal.max > 0) {
    milestones.push({
      date: dayShort(cal.best.label),
      title: 'Best day of the window',
      note: `${cal.max} tasks completed on ${dayName(cal.best.label)}.`,
    });
  }
  if (a.bestFocusDay.focus > 0) {
    milestones.push({
      date: dayShort(a.bestFocusDay.label),
      title: 'Focus peak of the period',
      note: `${dur(a.bestFocusDay.focus)} of deep work — the most of any day in range.`,
    });
  }

  const graph = h(
    'div',
    {},
    deltas
      ? h(
          'div',
          {},
          h('p', { class: 'pg-eyebrow', style: { marginBottom: '12px' } }, `Change vs ${x.prevWord}`),
          h(
            'div',
            { class: 'pg-delta-list' },
            ...deltaRows.map((d) => {
              const w = (Math.abs(d.v) / maxDelta) * 48;
              return h(
                'div',
                { class: 'pg-delta' },
                h('span', { class: 'd-name' }, d.name),
                h('span', { class: 'd-bar' }, h('i', { class: d.v < 0 ? 'neg' : '', style: { width: `${w.toFixed(1)}%` } })),
                h('span', { class: `d-val ${d.v > 0 ? 'pos' : d.v < 0 ? 'neg' : ''}`.trim() }, d.txt)
              );
            })
          )
        )
      : na(`No ${x.prevWord} to compare`, 'Change bars appear once a previous window with activity exists.'),
    milestones.length
      ? h(
          'div',
          {},
          h('p', { class: 'pg-eyebrow', style: { margin: '20px 0 10px' } }, 'Milestones in this window'),
          h(
            'div',
            { class: 'pg-ms' },
            ...milestones.map((m) =>
              h(
                'div',
                { class: 'pg-ms-item' },
                h('span', { class: 'ms-date' }, m.date),
                h('span', { class: 'ms-body' }, h('b', {}, m.title), h('span', {}, m.note))
              )
            )
          )
        )
      : null
  );

  // Relative movement: totals rates for equal windows, per-day rates otherwise.
  const doneRate = x.sameDays ? deltas?.done?.pct : x.avgDoneDelta?.pct;
  const focusRate = x.sameDays ? deltas?.focus?.pct : x.avgFocusDelta?.pct;
  const tasksVsFocus =
    doneRate != null && focusRate != null
      ? doneRate > focusRate
        ? 'Tasks grew faster than focus — output rose more than the time invested.'
        : focusRate > doneRate
          ? 'Focus grew faster than completions — more time invested than output returned this period.'
          : 'Tasks and focus moved in step.'
      : '';

  const prose = [
    proseP(
      deltas
        ? `Across ${a.range.label}: **${fmtSigned(deltas.done.abs)} tasks**${
            x.sameDays ? ` (${signedPct(deltas.done.pct)})` : ''
          }, **${fmtSignedDur(
            deltas.focus.abs
          )} of focus**${x.sameDays ? ` (${signedPct(deltas.focus.pct)})` : ''}, completion ${ppText(
            deltas.completion.abs
          )} to ${pctText(a.totals.completion)}. ${x.sameDays ? '' : `${x.winNote} `}${tasksVsFocus}`
        : `This is a single window of history (${a.range.label}); there is no previous period yet, so no change is claimed. The milestones below still describe what happened inside the window.`
    ),
    proseP(
      cal.run >= 2
        ? `**Consistency held**: a ${cal.run}-day active run ran through this window${cal.gap >= 2 ? `, alongside a ${cal.gap}-day gap` : ' with no long gaps'}.`
        : 'Activity in this window was scattered rather than run-shaped.',
      a.bestTaskDay.done > 0
        ? ` The strongest day was **${dayShort(a.bestTaskDay.label)}** with ${a.bestTaskDay.done} tasks completed.`
        : ''
    ),
  ];

  const notes = [
    x.sameDays
      ? deltas && deltas.done.pct != null && deltas.focus.pct != null
        ? noteNode(`Tasks ${signedPct(deltas.done.pct)} while focus ${signedPct(deltas.focus.pct)} — compare the two to judge efficiency.`, deltas.done.pct >= deltas.focus.pct ? 'ok' : '')
        : noteNode('No previous period — efficiency change cannot be calculated.')
      : x.avgDoneDelta && x.avgFocusDelta && x.avgDoneDelta.pct != null && x.avgFocusDelta.pct != null
        ? noteNode(
            `Per day: tasks ${signedPct(x.avgDoneDelta.pct)} while focus ${signedPct(x.avgFocusDelta.pct)} — the like-for-like efficiency read.`,
            x.avgDoneDelta.pct >= x.avgFocusDelta.pct ? 'ok' : ''
          )
        : noteNode('No previous baseline — efficiency change cannot be calculated.'),
    cal.run >= 2 ? noteNode(`Active run of ${cal.run} days held through the window.`, 'ok') : noteNode('No multi-day run established yet.'),
    a.totals.due - a.totals.done > 0
      ? noteNode(`${a.totals.due - a.totals.done} tasks remain due — clear high priority first.`, 'warn')
      : noteNode('No outstanding tasks due in this period.', 'ok'),
  ];

  return sectionEl({
    letter: 'L',
    title: 'Insights and milestones',
    sub: 'What changed, and the moments that defined the period',
    legend: [sw('Improvement', 'var(--success)'), sw('Decline', 'var(--rose)')],
    graph,
    kpis: [
      kpi('Best single day', a.bestTaskDay.done > 0 ? `${a.bestTaskDay.done} tasks` : '—', a.bestTaskDay.done > 0 ? dayShort(a.bestTaskDay.label) : 'no completions', 'ok'),
      kpi('Longest run', `${cal.run} day${cal.run === 1 ? '' : 's'}`, cal.runStart ? `from ${dayShort(cal.runStart)}` : '—', cal.run >= 2 ? 'ok' : ''),
      kpi('Focus leader', a.bestFocusDay.focus > 0 ? dur(a.bestFocusDay.focus) : '—', a.bestFocusDay.focus > 0 ? dayShort(a.bestFocusDay.label) : 'no focus'),
      kpi('Open items', String(Math.max(0, a.totals.due - a.totals.done)), a.totals.due ? `of ${a.totals.due} due` : 'nothing due', a.totals.due - a.totals.done > 0 ? 'pink' : 'ok'),
    ],
    prose,
    notes,
  });
}

/** addDays helper for calendar ranges (labels are 'YYYY-MM-DD'). */
function addDays(label, days) {
  const [y, m, d] = label.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

/* ============================================================
   View
   ============================================================ */

export async function progressView() {
  const root = h('div', { class: 'page page-wide page-progress' });
  const state = { rangeKey: 'week', offset: 0, data: null, a: null, pdfBusy: false };

  root.replaceChildren(loadingState('Crunching your numbers…'));

  async function loadData() {
    const [tasks, sessions, goals, blocks] = await Promise.all([
      listTasks(), listSessions(), listGoals(), listBlocks(),
    ]);
    state.data = { tasks, sessions, goals, blocks };
  }

  /**
   * Download a PDF report of the period currently on screen. Fully local:
   * jsPDF is imported on demand (code-split), the document is built in
   * memory and handed to the browser's own download — no network, no
   * third-party service ever sees this data.
   */
  async function downloadPdf(event) {
    if (state.pdfBusy || !state.a) return;
    state.pdfBusy = true;
    // Capture before the first await: currentTarget is nulled afterwards.
    const btn = event && event.currentTarget ? event.currentTarget : null;
    if (btn) {
      btn.disabled = true;
      btn.replaceChildren(icon('download'), 'Preparing\u2026');
    }
    try {
      const logoDataUrl = await loadLogoDataUrl();
      const { bytes, pages } = await renderProgressPdf(state.a, { logoDataUrl });
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = pdfFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Defer: revoking synchronously can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(`PDF report downloaded \u2014 ${pages} page${pages === 1 ? '' : 's'}`, { type: 'success' });
    } catch (err) {
      console.error('pdf report failed', err);
      toast('PDF report could not be generated', { type: 'error' });
    } finally {
      state.pdfBusy = false;
      if (btn && btn.isConnected) {
        btn.disabled = false;
        btn.replaceChildren(icon('download'), 'PDF report');
      }
    }
  }

  function rebuild(focusSelector) {
    hideTip();
    const { data } = state;
    const today = todayLabel();

    // Earliest stored day feeds resolveRange('all'); derive from raw records
    // so the all-time window starts at real history, not an arbitrary floor.
    let dataStart = null;
    const noteStart = (label) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(label) && (!dataStart || label < dataStart)) dataStart = label;
    };
    for (const rec of [...data.tasks, ...data.goals, ...data.blocks]) noteStart(String(rec.createdAt || '').slice(0, 10));
    for (const s of data.sessions) noteStart(String(s.startedAt || '').slice(0, 10));

    const range = resolveRange(state.rangeKey, state.offset, today, dataStart);
    const built = buildAnalytics(data, range, { today });

    /*
     * Honest-comparison normalisation (the engine's raw fields are kept
     * intact; these three corrections are computed here):
     *  1. A bounded range always has a previous window, so the engine returns
     *     a zeroed totals object for it. An empty window is shown as "no
     *     comparison", never as 0 → 0 fake deltas.
     *  2. Engine prev.activeDays is always 0 (derived from the current
     *     period's maps) — recompute it from raw records.
     *  3. Engine calendar runStart/gapStart remember the most recent run,
     *     not the longest — re-pair them with their true lengths.
     */
    const prevHasData =
      !!built.prev && built.prev.due + built.prev.focus + built.prev.sessions + built.prev.planned > 0;
    const prev =
      prevHasData
        ? {
            ...built.prev,
            activeDays: range.prevStart
              ? activeDaysIn(data.tasks, data.sessions, range.prevStart, range.prevEnd)
              : 0,
          }
        : null;
    const deltas =
      prev && built.deltas
        ? {
            ...built.deltas,
            // null rates must never surface as a numeric pp change
            // (engine: null − null coerces to 0).
            completion: {
              ...built.deltas.completion,
              abs:
                built.totals.completion != null && prev.completion != null
                  ? built.totals.completion - prev.completion
                  : null,
            },
            activeDays: { abs: built.totals.activeDays - prev.activeDays, pct: null },
          }
        : null;
    const run = longestRun(built.calendar.days);
    const gap = longestGap(built.calendar.days);
    const calendar = { ...built.calendar, run: run.len, runStart: run.start, gap: gap.len, gapStart: gap.start };
    const a = { ...built, prev, deltas, calendar };
    // The PDF report renders from this exact normalised object, so the PDF
    // and the page can never disagree about a single figure.
    state.a = a;

    /* shared derived facts for section prose */
    const bucketWord = a.granularity === 'day' ? 'day' : a.granularity === 'week' ? 'week' : 'month';
    const labels =
      a.granularity === 'week'
        ? a.series.map((b) => dayShort(b.start))
        : a.series.map((b) => b.label);
    const prevWord =
      range.key === 'week' ? 'previous week' : range.key === 'month' ? 'previous month' : 'previous period';
    const prevLabel =
      range.key === 'week' ? 'Previous week' : range.key === 'month' ? 'Previous month' : 'Previous period';
    const daysIn = dayList(range.start, range.end).length;
    const daysPrev = range.prevStart ? dayList(range.prevStart, range.prevEnd).length : 0;
    const prevAligned = prev != null && a.prevSeries.length === a.series.length;

    // True per-calendar-day averages (engine totals.avg* are per bucket).
    const curAvgDone = dayAvg(a.totals.done, daysIn);
    const prevAvgDone = a.prev && daysPrev ? dayAvg(a.prev.done, daysPrev) : null;
    const curAvgFocus = dayAvgMin(a.totals.focus, daysIn);
    const prevAvgFocus = a.prev && daysPrev ? dayAvgMin(a.prev.focus, daysPrev) : null;
    const avgDoneDelta =
      prevAvgDone != null
        ? { abs: Math.round((curAvgDone - prevAvgDone) * 10) / 10, pct: pctChange(curAvgDone, prevAvgDone) }
        : null;
    const avgFocusDelta =
      prevAvgFocus != null
        ? { abs: curAvgFocus - prevAvgFocus, pct: pctChange(curAvgFocus, prevAvgFocus) }
        : null;

    const sameDays = daysPrev > 0 && daysIn === daysPrev;
    const winNote = `The ${prevWord} spans ${daysPrev} days while this window spans ${daysIn}, so the per-day figures are the fairer comparison.`;

    const x = {
      bucketWord, labels, prevWord, prevLabel, daysIn, daysPrev, prevAligned,
      sameDays, winNote,
      curAvgDone, prevAvgDone, curAvgFocus, prevAvgFocus, avgDoneDelta, avgFocusDelta,
    };

    root.replaceChildren();
    root.appendChild(
      pageHead({
        title: 'Progress',
        sub: a.range.allTime
          ? 'Everything you have recorded, from your first entry to today.'
          : 'A clear look at how this period is going — computed from your own data.',
        actions: h(
          'div',
          { class: 'pg-head-actions' },
          rangeControls(state, (next) => {
            state.rangeKey = next.rangeKey;
            state.offset = next.offset;
            rebuild(next.focus);
          }),
          rangePill(a),
          // Only offered when the period has something to report.
          a.hasAnyData
            ? h(
                'button',
                {
                  class: 'btn btn-secondary',
                  onClick: downloadPdf,
                  ...(state.pdfBusy ? { disabled: true } : {}),
                },
                icon('download'),
                state.pdfBusy ? 'Preparing\u2026' : 'PDF report'
              )
            : null
        ),
      })
    );

    if (!a.hasAnyData) {
      root.appendChild(
        emptyState({
          iconName: 'progress',
          title: 'Nothing to show yet',
          hint: 'Add tasks, finish focus sessions, or set goals — your progress report appears here once real activity exists.',
        })
      );
      return;
    }

    /* ---- summary metrics ---- */
    const metrics = h(
      'section',
      { class: 'pg-metrics', 'aria-label': 'Summary metrics for the selected period' },
      metricCard({
        label: 'Tasks completed', iconName: 'tasks', value: String(a.totals.done),
        chip: deltaChip(a.deltas?.done, (d) => fmtSigned(d.abs)),
        prevText: a.prev ? `previous ${a.prev.done}` : 'no previous period',
      }),
      metricCard({
        label: 'Completion rate', iconName: 'check', ok: true,
        value: pctText(a.totals.completion),
        chip: deltaChip(a.deltas?.completion.abs != null ? a.deltas.completion : null, (d) => ppText(d.abs)),
        prevText: a.prev ? `previous ${pctText(a.prev.completion)}` : `${a.totals.done} of ${a.totals.due} due`,
      }),
      metricCard({
        label: 'Focus time', iconName: 'focus', value: dur(a.totals.focus),
        chip: deltaChip(a.deltas?.focus, (d) => fmtSignedDur(d.abs)),
        prevText: a.prev ? `previous ${dur(a.prev.focus)}` : `${a.totals.sessions} sessions`,
      }),
      metricCard({
        label: 'Avg focus / day', iconName: 'spark', value: dur(curAvgFocus),
        chip: deltaChip(avgFocusDelta, (d) => fmtSignedDur(d.abs)),
        prevText: prevAvgFocus != null ? `was ${dur(prevAvgFocus)}` : 'per calendar day',
      }),
      metricCard({
        label: 'Active days', iconName: 'plan', value: `${a.totals.activeDays}/${daysIn}`,
        chip: deltaChip(a.deltas?.activeDays, (d) => fmtSigned(d.abs)),
        prevText: a.prev ? `previous ${a.prev.activeDays}/${daysPrev}` : 'with work logged',
      }),
      metricCard({
        label: 'Avg session', iconName: 'list',
        value: a.totals.avgSession ? dur(a.totals.avgSession) : '—',
        chip: deltaChip(
          a.prev && a.prev.avgSession && a.totals.avgSession
            ? { abs: a.totals.avgSession - a.prev.avgSession }
            : null,
          (d) => fmtSignedDur(d.abs)
        ),
        prevText:
          a.prev && a.prev.avgSession
            ? `was ${dur(a.prev.avgSession)}`
            : a.totals.sessions
              ? `${a.totals.sessions} sessions`
              : 'no sessions yet',
      })
    );

    root.appendChild(metrics);

    /* ---- sections A–L ---- */
    root.appendChild(
      h(
        'div',
        { class: 'pg-sections' },
        sectionA(a, x),
        sectionB(a, x),
        sectionC(a),
        sectionD(a, x),
        sectionE(a, x),
        sectionF(a, x),
        sectionG(a, x),
        sectionH(a),
        sectionI(a, x),
        sectionJ(a, x),
        sectionK(a, x),
        sectionL(a, x)
      )
    );

    /* ---- methodology footer ---- */
    root.appendChild(
      h(
        'footer',
        { class: 'pg-foot' },
        h('span', { class: 'f-ico', 'aria-hidden': 'true' }, icon('info')),
        h(
          'p',
          {},
          strongNodes(
            '**Computed from your data.** Every figure, chart and sentence above is derived from the tasks, focus sessions, goals and plan blocks stored on this device — nothing is sampled, estimated or padded. ' +
              'Comparisons use the immediately preceding window; when that window is empty or a different length, the analysis says so instead of implying a change. ' +
              'Goal progress reflects only the value you set, and focus-by-priority is matched through linked time blocks — where either is missing, the section reports that honestly.'
          )
        )
      )
    );

    /* restore keyboard focus to the control that triggered the re-render */
    if (focusSelector) {
      const target = root.querySelector(focusSelector);
      if (target) target.focus({ preventScroll: true });
    }
  }

  try {
    await loadData();
    rebuild();
  } catch (err) {
    console.error('Progress load failed', err);
    root.replaceChildren(
      errorState('Your progress data could not be loaded. It is still safe in local storage.', async () => {
        root.replaceChildren(loadingState('Crunching your numbers…'));
        try {
          await loadData();
          rebuild();
        } catch (err2) {
          console.error('Progress retry failed', err2);
          root.replaceChildren(
            errorState('Loading failed again. Check the app is not low on storage, then retry.', async () => {
              root.replaceChildren(loadingState('Crunching your numbers…'));
              try {
                await loadData();
                rebuild();
              } catch (err3) {
                console.error('Progress retry failed', err3);
                root.replaceChildren(errorState('Loading still fails — your data has not been modified.', () => location.reload()));
              }
            })
          );
        }
      })
    );
  }

  // Router contract: views resolve to { element, dispose }.
  return { element: root, dispose: () => hideTip() };
}
