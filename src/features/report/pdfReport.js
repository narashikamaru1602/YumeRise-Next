/**
 * Progress → printable PDF report (ChatGPT data exchange, part C).
 *
 * Design goals:
 *  - Premium editorial layout: cover, metric cards, section hierarchy,
 *    vector charts, headers/footers/page numbers, deliberate whitespace.
 *  - The SAME analytics object the Progress screen displays is passed in,
 *    so every figure in the PDF is exactly what the page showed — this
 *    module never recomputes statistics and never invents insight.
 *  - Sections appear only when the period has data for them.
 *  - Generated fully in the browser (jsPDF, dynamically imported so it is
 *    code-split out of the initial bundle). Nothing is uploaded anywhere.
 *  - Text stays real vector text: selectable, searchable, ChatGPT-readable.
 */

import { longestRun, longestGap, dayShort, dayList, rangeLabel } from '../../data/analytics.js';
import { formatDuration } from '../../core/utils.js';

/* ---------------- palette (light-theme tokens, print-tuned) ----------------
   Chosen for contrast on white paper and to remain distinguishable in
   grayscale (every colored element also carries a text value or label). */
const C = {
  ink: [30, 41, 59],        // --text        #1e293b
  body: [51, 65, 85],       // slate-700     readable body on white
  muted: [71, 85, 105],     // slate-600     labels / secondary (7:1+)
  faint: [148, 163, 184],   // --text-muted  chart hints only
  hair: [226, 231, 240],    // --border      rules
  track: [240, 243, 248],   // bar tracks / card fills
  card: [248, 249, 252],
  accent: [124, 92, 252],   // --accent      #7c5cfc
  accentDeep: [109, 79, 240],
  accentSoft: [237, 233, 254],
  emerald: [16, 185, 129],  // --success     "completed" series
  blue: [96, 165, 250],     // secondary series
  tan: [214, 163, 115],     // --tan-deep    planning accent
};

const PAGE = { w: 210, h: 297, ml: 18, mr: 18, mb: 18, top: 24 };
const CW = PAGE.w - PAGE.ml - PAGE.mr; // 174 mm content width

/** Font size (pt) → height in mm (coordinates are mm). */
const PT = (pt) => (pt * 25.4) / 72;
const lh = (pt) => PT(pt) * 1.45; // line box

/* ---------------- text safety ----------------
   Imported/task text is untrusted. It is only ever drawn as text (never as
   HTML), and this maps typographic glyphs the built-in fonts lack to
   printable equivalents so nothing renders as a box or a '?' run. */
export function pdfText(value) {
  return String(value ?? '')
    .replace(/[\u2018\u2019\u201A\u2032\u2035]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u25CF\u25CB\u25AA]/g, '-')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2190-\u21FF\u2700-\u27BF\u2600-\u26FF]/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

const pctText = (v) => (v == null ? '\u2014' : `${Math.round(v)}%`);

function clip(doc, text, width) {
  const s = pdfText(text);
  if (doc.getTextWidth(s) <= width) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${s.slice(0, mid)}...`) <= width) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo)}...`;
}

/* ---------------- browser-only logo rasterisation ----------------
   The shipped icon is an SVG (no raster asset exists); rasterise it through
   a canvas so the cover uses the real YumeRise brand mark. Returns null
   anywhere canvas/fetch is unavailable (e.g. Node tests) — the cover then
   falls back to the wordmark alone. */
export async function loadLogoDataUrl() {
  try {
    const href = (document.querySelector('link[rel="icon"]') || {}).href || './icon.svg';
    const res = await fetch(href);
    if (!res.ok) return null;
    const svg = await res.text();
    // The icon has a viewBox but no intrinsic size; give the raster one.
    const sized = /<svg[^>]*\swidth=/.test(svg)
      ? svg
      : svg.replace('<svg ', '<svg width="256" height="256" ');
    const img = new Image();
    const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sized)}`;
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = src;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 256, 256);
    return canvas.toDataURL('image/png');
  } catch (err) {
    return null;
  }
}

export function pdfFileName(now = new Date()) {
  const d = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return `yumerise-progress-${d}.pdf`;
}

/* =======================================================================
   Report model — every fact below is read from the analytics object the
   Progress screen rendered; nothing is estimated.
   ===================================================================== */
function buildModel(a) {
  const t = a.totals;
  const daysIn = dayList(a.range.start, a.range.end).length;
  const bucketWord = a.granularity === 'week' ? 'week' : a.granularity === 'month' ? 'month' : 'day';
  const labels = a.granularity === 'week'
    ? a.series.map((b) => dayShort(b.start))
    : a.series.map((b) => b.label);

  const prev = a.prev && (a.prev.due + a.prev.focus + a.prev.sessions + a.prev.planned) > 0 ? a.prev : null;
  const run = longestRun(a.calendar.days);
  const gap = longestGap(a.calendar.days);
  const goals = a.goals || { total: 0, active: 0, done: 0, avgProgress: 0, rows: [] };

  const periodLabel = a.range.label || rangeLabel(a.range.start, a.range.end);
  const prevWord = a.range.key === 'week' ? 'the previous week' : a.range.key === 'month' ? 'the previous month' : 'the previous period';

  const flags = {
    tasks: t.due > 0 || t.done > 0,
    focus: t.sessions > 0,
    goals: goals.total > 0,
    planning: t.planned > 0,
    trends: a.series.length > 1 && (t.done > 0 || t.focus > 0),
    prev: prev != null,
  };

  /* headline metric cards (cover + executive summary share these) */
  const metrics = [
    { label: 'Tasks completed', value: String(t.done), sub: t.due > 0 ? `of ${t.due} due this period` : 'no dated tasks in period' },
    { label: 'Completion rate', value: pctText(t.completion), sub: t.due > 0 ? `${t.done} of ${t.due} due` : 'no tasks due in period' },
    { label: 'Focus time', value: formatDuration(t.focus), sub: flags.focus ? `${t.sessions} session${t.sessions === 1 ? '' : 's'}` : 'no sessions recorded' },
    { label: 'Avg focus / day', value: formatDuration(t.avgFocus ?? Math.round(t.focus / Math.max(1, daysIn))), sub: 'per calendar day' },
    { label: 'Active days', value: `${t.activeDays}/${daysIn}`, sub: flags.prev ? `previous ${prev.activeDays}/${daysIn}` : 'days with work logged' },
    { label: 'Avg session', value: t.avgSession ? formatDuration(t.avgSession) : '\u2014', sub: t.avgSession ? 'per recorded session' : 'no sessions in period' },
  ];

  /* factual observations — only stated when the numbers support them */
  const obs = [];
  if (flags.tasks) {
    let s = `${t.done} of ${t.due} tasks completed (${pctText(t.completion)})`;
    if (flags.prev && prev.completion != null && t.completion != null) s += `; ${pctText(prev.completion)} ${prevWord}`;
    obs.push(`${s}.`);
  }
  if (flags.focus) {
    let s = `${formatDuration(t.focus)} focused across ${t.sessions} session${t.sessions === 1 ? '' : 's'}, averaging ${formatDuration(t.avgSession)}`;
    if (flags.prev) s += ` (previous period: ${formatDuration(prev.focus)})`;
    obs.push(`${s}.`);
  }
  if (t.activeDays > 0) {
    obs.push(`Active on ${t.activeDays} of ${daysIn} days; best run ${run.len} day${run.len === 1 ? '' : 's'}${run.start ? ` from ${dayShort(run.start)}` : ''}.`);
  }
  if (goals.active > 0) {
    const near = (goals.nearTarget || []).length;
    obs.push(`${goals.active} active goal${goals.active === 1 ? '' : 's'}, averaging ${goals.avgProgress}% progress${near ? `; ${near} at or above 75%` : ''}.`);
  }
  if (flags.planning) {
    obs.push(`Planned ${formatDuration(t.planned)} against ${formatDuration(t.focus)} actually focused.`);
  }
  if (!obs.length) obs.push('No activity was recorded in this period.');
  obs.push('All figures are computed from the records on this device by the same engine as the Progress screen.');

  return {
    a, t, daysIn, bucketWord, labels, prev, run, gap, goals,
    periodLabel, prevWord, flags, metrics, observations: obs,
    generatedLabel: new Date().toLocaleString(),
    hasAny: a.hasAnyData !== false,
  };
}

/* =======================================================================
   Sheet — a small layout engine with page-break safety
   ===================================================================== */
class Sheet {
  constructor(doc) {
    this.doc = doc;
    this.y = PAGE.top;
  }

  get pageW() { return this.doc.internal.pageSize.getWidth(); }
  get pageH() { return this.doc.internal.pageSize.getHeight(); }

  newPage() {
    this.doc.addPage();
    this.y = PAGE.top;
  }

  /** Begin a new page when `h` more millimetres do not fit. */
  need(h) {
    if (this.y + h > this.pageH - PAGE.mb) this.newPage();
  }

  text(str, { x = PAGE.ml, y = this.y, size = 9.5, style = 'normal', color = C.body, align = 'left', charSpace = 0, max } = {}) {
    const d = this.doc;
    d.setFont('helvetica', style);
    d.setFontSize(size);
    d.setTextColor(...color);
    const s = max ? clip(d, str, max) : pdfText(str);
    d.text(s, x, y, { align, charSpace });
    return d.getTextWidth(s);
  }

  rule(y = this.y, { color = C.hair, width = 0.3, from = PAGE.ml, to = this.pageW - PAGE.mr } = {}) {
    const d = this.doc;
    d.setDrawColor(...color);
    d.setLineWidth(width);
    d.line(from, y, to, y);
  }

  /** Wrapped paragraph; breaks across pages per line, never mid-line. */
  paragraph(str, { size = 9.5, color = C.body, x = PAGE.ml, width = CW, gap = 0, bullet = false } = {}) {
    const d = this.doc;
    d.setFont('helvetica', 'normal');
    d.setFontSize(size);
    const lines = d.splitTextToSize(pdfText(str), width);
    const step = lh(size);
    if (bullet) this.y += 1.4;
    for (const line of lines) {
      this.need(step);
      this.doc.setFont('helvetica', 'normal');
      this.doc.setFontSize(size);
      this.doc.setTextColor(...color);
      this.doc.text(line, x, this.y + PT(size) * 0.8);
      this.y += step;
    }
    this.y += gap;
  }

  /** Section heading: accent number + title + rule; kept with next block. */
  section(number, title, keep = 16) {
    this.need(lh(13.5) + keep);
    const d = this.doc;
    d.setFont('helvetica', 'bold');
    d.setFontSize(13.5);
    d.setTextColor(...C.accent);
    const num = `${number} `;
    d.text(num, PAGE.ml, this.y + PT(13.5) * 0.8);
    const numW = d.getTextWidth(num) + 1.5;
    d.setTextColor(...C.ink);
    d.text(pdfText(title), PAGE.ml + numW, this.y + PT(13.5) * 0.8);
    this.y += lh(13.5);
    this.rule(this.y, { color: C.hair, width: 0.35 });
    this.y += 4;
  }

  /** 3-column metric card row (items.length up to 3 per row). */
  metricGrid(items, cols = 3) {
    const gap = 4;
    const w = (CW - gap * (cols - 1)) / cols;
    const h = 21;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      this.need(h + gap);
      row.forEach((item, j) => {
        const x = PAGE.ml + j * (w + gap);
        const d = this.doc;
        d.setFillColor(...C.card);
        d.roundedRect(x, this.y, w, h, 2.4, 2.4, 'F');
        this.text(item.label.toUpperCase(), { x: x + 4, y: this.y + 7, size: 7, style: 'bold', color: C.muted, charSpace: 0.25, max: w - 8 });
        this.text(item.value, { x: x + 4, y: this.y + 15.4, size: 15, style: 'bold', color: C.ink, max: w - 8 });
        this.text(item.sub, { x: x + 4, y: this.y + 19.6, size: 7, color: C.muted, max: w - 8 });
      });
      this.y += h + gap;
    }
  }

  /** Horizontal progress bar (completion, goals). frac 0..1 */
  hBar(x, y, w, h, frac, { fill = C.accent, track = C.track } = {}) {
    const d = this.doc;
    const r = h / 2;
    d.setFillColor(...track);
    d.roundedRect(x, y, w, h, r, r, 'F');
    const fw = Math.max(0, Math.min(1, frac)) * w;
    if (fw > 0.01) {
      d.setFillColor(...fill);
      d.roundedRect(x, y, fw, h, Math.min(r, fw / 2), Math.min(r, fw / 2), 'F');
    }
  }

  /**
   * Vertical bar chart. series: [{ name, color, values }]; labels on x.
   * Every series is labeled in the legend, and bar values are printed when
   * there is room (n <= 7), so the chart never depends on color alone.
   */
  vBars({ labels, series, height = 52, showAvgOfFirst = false, valueSuffix = '' }) {
    const n = labels.length;
    if (!n || series.every((s) => s.values.every((v) => !v))) return;
    const d = this.doc;
    const legendH = series.length > 1 ? 6 : 0;
    this.need(height + legendH + 10);

    // legend
    if (series.length > 1) {
      let lx = PAGE.ml;
      for (const s of series) {
        d.setFillColor(...s.color);
        d.roundedRect(lx, this.y + 1.4, 2.6, 2.6, 0.6, 0.6, 'F');
        d.setFont('helvetica', 'normal');
        d.setFontSize(7.5);
        d.setTextColor(...C.muted);
        d.text(pdfText(s.name), lx + 4, this.y + 3.9);
        lx += 4 + d.getTextWidth(pdfText(s.name)) + 8;
      }
      this.y += legendH;
    }

    const plotTop = this.y + PT(7.5);      // room for the max label
    const baseline = this.y + height;
    const plotH = baseline - plotTop;
    const axisW = 9;
    const x0 = PAGE.ml + axisW;
    const plotW = CW - axisW;
    const groupW = plotW / n;
    const multi = series.length > 1;
    const barW = multi ? groupW * 0.32 : Math.min(9, groupW * 0.62);
    const max = Math.max(1, ...series.flatMap((s) => s.values));

    const topY = (v) => baseline - (v / max) * plotH;

    // scale labels: max at top, 0 at baseline
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...C.faint);
    d.text(`${Math.round(max)}${valueSuffix}`, PAGE.ml, plotTop + 1.5);
    d.text('0', PAGE.ml, baseline + 1.5);

    // bars
    for (let i = 0; i < n; i += 1) {
      const center = x0 + groupW * (i + 0.5);
      series.forEach((s, si) => {
        const v = Number(s.values[i]) || 0;
        if (v <= 0) return;
        const bx = multi
          ? center - barW - 1 + si * (barW + 2)
          : center - barW / 2;
        const by = topY(v);
        d.setFillColor(...s.color);
        d.rect(bx, by, barW, baseline - by, 'F');
      });
      // per-bar values when the spacing can carry them
      if (!multi && n <= 7 && (Number(series[0].values[i]) || 0) > 0) {
        d.setFont('helvetica', 'bold');
        d.setFontSize(7);
        d.setTextColor(...C.muted);
        const v = `${series[0].values[i]}${valueSuffix}`;
        d.text(v, center, topY(series[0].values[i]) - 1.5, { align: 'center' });
      }
      // x labels (sampled so they never collide)
      const every = Math.ceil(n / 10);
      if (i % every === 0) {
        d.setFont('helvetica', 'normal');
        d.setFontSize(7);
        d.setTextColor(...C.muted);
        d.text(pdfText(labels[i]), center, baseline + 4, { align: 'center' });
      }
    }

    // average line over the first series (focus totals), with its own label
    if (showAvgOfFirst) {
      const vals = series[0].values;
      const avg = vals.reduce((s, v) => s + (Number(v) || 0), 0) / Math.max(1, vals.length);
      if (avg > 0 && avg < max) {
        const ay = topY(avg);
        d.setDrawColor(...C.accentDeep);
        d.setLineWidth(0.35);
        d.line(x0, ay, x0 + plotW, ay);
        d.setFont('helvetica', 'bold');
        d.setFontSize(6.5);
        d.setTextColor(...C.accentDeep);
        const tag = `avg ${Math.round(avg)}${valueSuffix}`;
        d.text(tag, x0 + plotW, ay - 1.2, { align: 'right' });
      }
    }

    // baseline
    this.rule(baseline, { color: C.hair, width: 0.4, from: x0 - 2, to: x0 + plotW });
    this.y = baseline + 8;
  }
}

/* =======================================================================
   Report sections
   ===================================================================== */
function drawCover(doc, m) {
  const d = doc;
  let y = 17;

  // brand row: real logo when available, wordmark always
  if (m.logoDataUrl) {
    try {
      d.addImage(m.logoDataUrl, 'PNG', PAGE.ml, y, 13, 13);
      d.setFont('helvetica', 'bold');
      d.setFontSize(13);
      d.setTextColor(...C.ink);
      d.text('YumeRise', PAGE.ml + 17, y + 9.2);
    } catch (err) {
      m.logoDataUrl = null;
      drawCoverWordmark(d, y);
    }
  } else {
    drawCoverWordmark(d, y);
  }
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(...C.muted);
  const brandRight = 'Next  \u00b7  local-first productivity';
  d.text(brandRight, PAGE.w - PAGE.mr, y + 9.2, { align: 'right' });

  // accent rule + hairline (editorial masthead)
  y += 22;
  d.setDrawColor(...C.accent);
  d.setLineWidth(1.1);
  d.line(PAGE.ml, y, PAGE.ml + 46, y);
  d.setDrawColor(...C.hair);
  d.setLineWidth(0.5);
  d.line(PAGE.ml + 46, y, PAGE.w - PAGE.mr, y);

  // title block
  y += 44;
  d.setFont('helvetica', 'bold');
  d.setFontSize(9);
  d.setTextColor(...C.accent);
  d.text('PROGRESS REPORT', PAGE.ml, y, { charSpace: 0.9 });
  y += 15;
  d.setFont('helvetica', 'bold');
  d.setFontSize(30);
  d.setTextColor(...C.ink);
  d.text('Your progress,', PAGE.ml, y);
  y += 13;
  d.text('in full detail', PAGE.ml, y);
  y += 14;
  d.setFont('helvetica', 'normal');
  d.setFontSize(14);
  d.setTextColor(...C.body);
  d.text(pdfText(m.periodLabel), PAGE.ml, y);
  y += 8;
  d.setFont('helvetica', 'normal');
  d.setFontSize(9);
  d.setTextColor(...C.muted);
  d.text(pdfText(`Generated ${m.generatedLabel}`), PAGE.ml, y);

  // key figures strip
  y += 16;
  const items = [m.metrics[0], m.metrics[1], m.metrics[2], m.metrics[4]];
  const gap = 4;
  const w = (CW - gap * 3) / 4;
  const h = 24;
  items.forEach((item, i) => {
    const x = PAGE.ml + i * (w + gap);
    d.setFillColor(...C.card);
    d.roundedRect(x, y, w, h, 2.4, 2.4, 'F');
    d.setFillColor(...C.accent);
    d.rect(x, y, 1.6, h, 'F');
    d.setFont('helvetica', 'bold');
    d.setFontSize(7);
    d.setTextColor(...C.muted);
    d.text(clip(d, item.label.toUpperCase(), w - 10), x + 5, y + 7.5, { charSpace: 0.2 });
    d.setFont('helvetica', 'bold');
    d.setFontSize(17);
    d.setTextColor(...C.ink);
    d.text(pdfText(item.value), x + 5, y + 16.5);
    d.setFont('helvetica', 'normal');
    d.setFontSize(7);
    d.setTextColor(...C.muted);
    d.text(clip(d, item.sub, w - 8), x + 5, y + 21.5);
  });
  y += h + 14;

  // summary paragraph
  d.setFont('helvetica', 'bold');
  d.setFontSize(8);
  d.setTextColor(...C.muted);
  d.text('AT A GLANCE', PAGE.ml, y, { charSpace: 0.6 });
  y += 6;
  const summary = m.observations.slice(0, 3).join(' ');
  d.setFont('helvetica', 'normal');
  d.setFontSize(10.5);
  const lines = d.splitTextToSize(pdfText(summary), CW - 6);
  d.setTextColor(...C.body);
  for (const line of lines) {
    d.text(line, PAGE.ml + 6, y + 4.4);
    y += 10.5 * (25.4 / 72) * 1.5;
    if (y > PAGE.h - 60) break; // cover never overflows; detail follows inside
  }

  // honesty footer block
  y = PAGE.h - 46;
  d.setDrawColor(...C.hair);
  d.setLineWidth(0.4);
  d.line(PAGE.ml, y, PAGE.w - PAGE.mr, y);
  y += 6;
  d.setFont('helvetica', 'normal');
  d.setFontSize(8.5);
  d.setTextColor(...C.muted);
  d.text('Generated locally in your browser from the records stored on this device.', PAGE.ml, y + 3);
  y += 5.2;
  d.text('Nothing was uploaded; every figure matches the YumeRise Progress screen for this period.', PAGE.ml, y + 3);
}

function drawCoverWordmark(d, y) {
  d.setFont('helvetica', 'bold');
  d.setFontSize(16);
  d.setTextColor(...C.ink);
  d.text('YumeRise', PAGE.ml, y + 10);
}

function drawExecutive(sheet, m, no) {
  sheet.section(no, 'Executive summary');
  sheet.metricGrid(m.metrics, 3);
  sheet.y += 2;
  for (const line of m.observations) {
    sheet.paragraph(`\u2013  ${line}`, { size: 9.5, color: C.body, x: PAGE.ml + 1, width: CW - 4, gap: 1.5 });
  }
  sheet.y += 4;
}

function drawProductivity(sheet, m, no) {
  const { t, prev, flags, prevWord } = m;
  sheet.section(no, 'Productivity overview');

  // headline completion bar
  sheet.paragraph('Completion of tasks due in this period', { size: 8.5, color: C.muted });
  sheet.need(16);
  const barW = CW - 46;
  sheet.text(`${pctText(t.completion)} complete`, { x: PAGE.ml, y: sheet.y + 5.4, size: 11, style: 'bold', color: C.ink });
  sheet.text(`${t.done} of ${t.due} due`, { x: PAGE.ml + barW + 46, y: sheet.y + 5.4, size: 9.5, align: 'right', color: C.muted });
  sheet.hBar(PAGE.ml, sheet.y + 8.5, barW + 46, 5, t.due > 0 ? t.done / t.due : 0, { fill: C.accent });
  sheet.y += 20;

  // comparison note (only when a previous window truly has data)
  if (flags.prev && t.completion != null && prev.completion != null) {
    const diff = Math.round((t.completion - prev.completion) * 10) / 10;
    const sentence = diff === 0
      ? `Completion was ${pctText(t.completion)} \u2014 level with ${prevWord}.`
      : `Completion was ${pctText(t.completion)} versus ${pctText(prev.completion)} ${prevWord} \u2014 ${
          diff > 0 ? 'up' : 'down'
        } ${Math.abs(diff)} percentage points.`;
    sheet.paragraph(sentence, { size: 9.5 });
  } else {
    sheet.paragraph(`No comparison: ${prevWord} contains no recorded activity.`, { size: 9.5, color: C.muted });
  }

  // per-priority breakdown
  const rows = (m.a.priority || []).filter((p) => p.due > 0);
  if (rows.length) {
    sheet.y += 3;
    sheet.text('Due per priority', { y: sheet.y + 3.4, size: 8.5, style: 'bold', color: C.muted });
    sheet.y += 7;
    const nameW = 24;
    const x0 = PAGE.ml + nameW;
    const rowW = CW - nameW - 34;
    const colors = { Low: C.emerald, Medium: C.blue, High: C.accent };
    for (const p of rows) {
      sheet.need(8.6);
      sheet.text(p.name, { x: PAGE.ml, y: sheet.y + 3.6, size: 9, color: C.ink });
      sheet.hBar(x0, sheet.y + 1.4, rowW, 3.4, p.due ? p.done / p.due : 0, { fill: colors[p.name] || C.accent });
      sheet.text(`${p.done}/${p.due}`, { x: PAGE.ml + CW, y: sheet.y + 3.6, size: 8.5, align: 'right', color: C.muted });
      sheet.y += 7.6;
    }
    sheet.y += 2;
  }

  const outstanding = t.due - t.done;
  sheet.paragraph(
    outstanding > 0
      ? `${outstanding} task${outstanding === 1 ? '' : 's'} from this period remain${outstanding === 1 ? 's' : ''} open; ${t.done} were completed.`
      : `All ${t.due} due task${t.due === 1 ? '' : 's'} were completed in this period.`,
    { size: 9.5, gap: 4 }
  );
}

function drawFocus(sheet, m, no) {
  const { t, prev, flags, prevWord, labels } = m;
  sheet.section(no, 'Focus analysis', { keep: 74 });

  // KPI cards
  sheet.metricGrid([
    { label: 'Sessions', value: String(t.sessions), sub: 'recorded this period' },
    { label: 'Focus time', value: formatDuration(t.focus), sub: flags.prev ? `previous ${formatDuration(prev.focus)}` : 'total focused' },
    { label: 'Avg session', value: t.avgSession ? formatDuration(t.avgSession) : '\u2014', sub: 'per recorded session' },
  ]);
  sheet.y += 1;

  // per-bucket focus chart (with previous window as a second series when aligned)
  const series = [{ name: 'Focus minutes', color: C.accent, values: m.a.series.map((b) => b.focus) }];
  const aligned = flags.prev && m.a.prevSeries.length === m.a.series.length;
  if (aligned) series.push({ name: 'Previous window', color: C.faint, values: m.a.prevSeries.map((b) => b.focus) });
  sheet.vBars({ labels, series, height: 50, showAvgOfFirst: true, valueSuffix: 'm' });

  // narrative
  const best = m.a.bestFocusDay;
  const facts = [
    `${formatDuration(t.focus)} recorded in ${t.sessions} session${t.sessions === 1 ? '' : 's'} across ${m.daysIn} day${m.daysIn === 1 ? '' : 's'} (${formatDuration(Math.round(t.focus / m.daysIn))} per calendar day).`,
  ];
  if (best && best.focus > 0) facts.push(`Fullest day: ${dayShort(best.label)} with ${formatDuration(best.focus)} focused.`);
  if (flags.prev) facts.push(`The previous window held ${formatDuration(prev.focus)} \u2014 ${t.focus >= prev.focus ? 'an increase' : 'a decrease'} of ${formatDuration(Math.abs(t.focus - prev.focus))}.`);
  for (const f of facts) sheet.paragraph(`\u2013  ${f}`, { size: 9.5, x: PAGE.ml + 1, width: CW - 4, gap: 1.2 });
  sheet.y += 3;
}

function drawGoalsPlanning(sheet, m, no) {
  const { goals, t } = m;
  sheet.section(no, 'Goals and planning', { keep: goals.rows.length ? 24 : 16 });

  if (goals.total > 0 && !goals.active) {
    sheet.paragraph(`All ${goals.done} of your goals are marked complete. Goals store only current progress, so no goal trend is shown.`, { size: 9.5, gap: 4 });
  } else if (goals.rows.length) {
    sheet.paragraph(`${goals.active} active goal${goals.active === 1 ? '' : 's'}, averaging ${goals.avgProgress}% progress. Goals keep current state only \u2014 there is no goal history to chart.`, { size: 9, color: C.muted });
    const shown = goals.rows.slice(0, 8);
    for (const g of shown) {
      sheet.need(12.5);
      const titleW = CW - 34;
      sheet.text(g.title, { y: sheet.y + 3.8, size: 9.5, color: C.ink, style: 'bold', max: titleW });
      sheet.text(`${Math.round(g.progress)}%`, { x: PAGE.ml + CW, y: sheet.y + 3.8, size: 9.5, align: 'right', style: 'bold', color: C.accentDeep });
      sheet.y += 6;
      sheet.hBar(PAGE.ml, sheet.y, CW, 3, g.progress / 100, { fill: C.accent, track: C.track });
      sheet.y += 5;
      const sub = g.target > 0
        ? `${g.current} / ${g.target} ${pdfText(g.unit || '')}`.trim()
        : `${g.kind === 'long' ? 'Long-term goal' : 'Active goal'}`;
      sheet.text(sub, { y: sheet.y + 2.8, size: 7.5, color: C.muted, max: CW });
      sheet.y += 5.5;
    }
    if (goals.rows.length > shown.length) {
      sheet.paragraph(`+ ${goals.rows.length - shown.length} more active goal${goals.rows.length - shown.length === 1 ? '' : 's'} shown on the Progress screen.`, { size: 8, color: C.muted, gap: 3 });
    }
  }

  if (t.planned > 0) {
    const diff = t.planned - t.focus;
    sheet.paragraph(
      `Planned time: ${formatDuration(t.planned)} against ${formatDuration(t.focus)} focused \u2014 ${
        diff > 0 ? `${formatDuration(diff)} of planned time was not focused` : diff < 0 ? `${formatDuration(-diff)} more than planned` : 'planned and focused matched exactly'
      }.`,
      { size: 9.5, gap: 4 }
    );
  }
}

function drawTrends(sheet, m, no) {
  const { t, prev, flags, prevWord, labels, run, gap } = m;
  sheet.section(no, 'Historical trends', { keep: 74 });

  sheet.vBars({
    labels,
    series: [{ name: 'Tasks completed', color: C.emerald, values: m.a.series.map((b) => b.done) }],
    height: 46,
    showAvgOfFirst: true,
  });

  // consistency strip
  const cells = [
    { label: 'Active days', value: `${t.activeDays}/${m.daysIn}` },
    { label: 'Best run', value: `${run.len} day${run.len === 1 ? '' : 's'}` },
    { label: 'Longest quiet stretch', value: `${gap.len} day${gap.len === 1 ? '' : 's'}` },
  ];
  const w = CW / 3;
  sheet.need(20);
  cells.forEach((c, i) => {
    const x = PAGE.ml + i * w;
    sheet.text(c.label.toUpperCase(), { x, y: sheet.y + 3.4, size: 6.8, style: 'bold', color: C.muted, charSpace: 0.25, max: w - 6 });
    sheet.text(c.value, { x, y: sheet.y + 10.2, size: 12, style: 'bold', color: C.ink, max: w - 6 });
  });
  sheet.y += 17;
  sheet.rule(sheet.y - 2, { color: C.hair });
  sheet.y += 2;

  const notes = [];
  if (m.a.bestTaskDay && m.a.bestTaskDay.done > 0) notes.push(`Most tasks completed on ${dayShort(m.a.bestTaskDay.label)} (${m.a.bestTaskDay.done}).`);
  if (run.start) notes.push(`Best run began ${dayShort(run.start)}.`);
  if (gap.len > 0 && gap.start) {
    const gapEnd = (dayList(gap.start, m.a.calendar.end) || [])[gap.len - 1] || gap.start;
    notes.push(`Longest quiet stretch: ${dayShort(gap.start)} \u2192 ${dayShort(gapEnd)}.`);
  }
  if (flags.prev) notes.push(`Previous window: ${prev.done} completed, ${formatDuration(prev.focus)} focused \u2014 this window ${t.done} completed, ${formatDuration(t.focus)} focused.`);
  for (const n of notes) sheet.paragraph(`\u2013  ${n}`, { size: 9, x: PAGE.ml + 1, width: CW - 4, gap: 1 });
  sheet.y += 3;
}

function drawMethodology(sheet, m, no) {
  const { flags, prevWord } = m;
  sheet.section(no, 'Methodology and data notes');

  const lines = [
    `Reporting period: ${m.periodLabel} \u2014 ${m.daysIn} calendar day${m.daysIn === 1 ? '' : 's'}, grouped by ${m.bucketWord}${m.a.series.length ? ` (${m.a.series.length} buckets)` : ''}. Generated ${m.generatedLabel}.`,
    'Source: the tasks, focus sessions, goals and plan blocks stored in this browser (IndexedDB) by YumeRise Next, analysed by the same engine that renders the Progress screen. The PDF was produced locally; no data was sent to any service.',
    'Definitions \u2014 due: tasks dated inside the period; completion: completed \u00f7 due; focus time: the sum of each recorded session\u2019s actual minutes, counted on the local day of its start; active day: at least one task completed or one focus minute; planned: minutes in plan blocks and scheduled tasks, counted once; averages are per calendar day.',
    flags.prev
      ? `Comparison: figures are compared against ${prevWord}, which contains recorded activity.`
      : 'Comparison: the previous window contains no activity, so no period-over-period change is shown.',
    'Limitations \u2014 goals store current progress only (no history), so goal trends are not shown; focus time counts recorded sessions only, so untracked focus is invisible; sessions under one whole minute are not recorded; this report reflects data as of the generation date above.',
    'This PDF contains selectable text, so it can be pasted or uploaded into tools like ChatGPT for further analysis.',
  ];
  for (const line of lines) sheet.paragraph(`\u2013  ${line}`, { size: 8.5, color: C.muted, x: PAGE.ml + 1, width: CW - 4, gap: 2.2 });
}

/* =======================================================================
   Render + header/footer pass
   ===================================================================== */
function stampChrome(doc, m) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    if (i > 1) {
      // running header
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...C.faint);
      doc.text('YumeRise  \u00b7  Progress Report', PAGE.ml, 13);
      doc.text(pdfText(m.periodLabel), PAGE.w - PAGE.mr, 13, { align: 'right' });
      doc.setDrawColor(...C.hair);
      doc.setLineWidth(0.3);
      doc.line(PAGE.ml, 15.5, PAGE.w - PAGE.mr, 15.5);
    }
    // footer + page number on every page (cover included)
    const fy = PAGE.h - 13.5;
    doc.setDrawColor(...C.hair);
    doc.setLineWidth(0.3);
    doc.line(PAGE.ml, fy, PAGE.w - PAGE.mr, fy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...C.faint);
    doc.text('YumeRise Next \u00b7 generated locally on this device', PAGE.ml, fy + 4.5);
    doc.text(`Page ${i} of ${total}`, PAGE.w - PAGE.mr, fy + 4.5, { align: 'right' });
  }
}

/**
 * Render the report.
 * @param {object} a - the analytics object the Progress screen displayed
 *   (the view passes its own normalised build result so figures match exactly).
 * @param {{ logoDataUrl?: string|null }} [options]
 * @returns {Promise<{ bytes: Uint8Array, pages: number }>}
 */
export async function renderProgressPdf(a, { logoDataUrl = null } = {}) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false, putOnlyUsedFonts: true });
  const m = buildModel(a);
  m.logoDataUrl = logoDataUrl || null;

  drawCover(doc, m);

  const sheet = new Sheet(doc);
  sheet.newPage();

  // Sequential section numbers — only included sections get a number, so a
  // sparse report reads 1, 2, 3… with no gaps.
  let sectionNo = 0;
  const next = () => String((sectionNo += 1));

  if (m.hasAny) {
    drawExecutive(sheet, m, next());
    if (m.flags.tasks) drawProductivity(sheet, m, next());
    if (m.flags.focus) drawFocus(sheet, m, next());
    if (m.flags.goals || m.flags.planning) drawGoalsPlanning(sheet, m, next());
    if (m.flags.trends) drawTrends(sheet, m, next());
  } else {
    sheet.section(next(), 'No activity in this period');
    sheet.paragraph('This period contains no records, so there is nothing to report. Choose a wider range on the Progress screen, or add tasks, sessions or goals first.', { size: 10 });
  }

  drawMethodology(sheet, m, next());
  stampChrome(doc, m);

  const bytes = new Uint8Array(doc.output('arraybuffer'));
  return { bytes, pages: doc.getNumberOfPages() };
}
