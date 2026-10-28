/**
 * Dependency-free SVG charts (per the confirmed charts decision).
 * All charts:
 *  - render from real data passed by the caller
 *  - expose a text/table alternative via role="img" + aria-label, or an
 *    adjacent visible summary
 *  - never rely on colour alone (values are labelled)
 *  - use CSS custom properties so both themes are correct automatically
 */

import { h } from '../core/dom.js';

/* ============================================================
   Shared chart tooltip (one singleton for every chart).
   Lines are joined with § in data-tip; markup-free strings only.
   Hover shows it at the pointer; keyboard focus shows it anchored
   to the mark, so tooltips are reachable without a mouse.
   ============================================================ */

let tipEl = null;

function tip() {
  if (!tipEl || !tipEl.isConnected) {
    tipEl = h('div', { class: 'pg-tip', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function tipLines(attr) {
  return String(attr || '').split('§').filter((line) => line !== '');
}

function renderTip(lines) {
  const el = tip();
  el.replaceChildren();
  lines.forEach((line, i) => {
    el.appendChild(h(i === 0 ? 'b' : 'span', {}, line));
  });
}

export function showTipAt(x, y, lines) {
  renderTip(lines);
  const el = tip();
  el.dataset.show = '1';
  const rect = el.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 10;
  const maxY = window.innerHeight - rect.height - 10;
  el.style.left = `${Math.max(10, Math.min(maxX, x + 14))}px`;
  el.style.top = `${Math.max(10, Math.min(maxY, y + 16))}px`;
}

export function hideTip() {
  if (tipEl) tipEl.dataset.show = '0';
}

/** Marks get hover + (when few enough to stay keyboard-sane) focus support. */
function markInteractive(el, lines, { focusable }) {
  el.classList.add('mark');
  if (focusable) el.setAttribute('tabindex', '0');
  el.addEventListener('pointerenter', (event) => showTipAt(event.clientX, event.clientY, lines));
  el.addEventListener('pointermove', (event) => showTipAt(event.clientX, event.clientY, lines));
  el.addEventListener('pointerleave', hideTip);
  if (focusable) {
    el.addEventListener('focus', () => {
      const r = el.getBoundingClientRect();
      showTipAt(r.left + r.width / 2, r.top, lines);
    });
    el.addEventListener('blur', hideTip);
  }
}

/* ---------------- geometry helpers (shared by the primitives) ---------------- */

export const CHART = Object.freeze({ VW: 760, VH: 300, PL: 46, PR: 16, PT: 16, PB: 32 });

/** Neat axis scale: step from {1, 2, 2.5, 5, 10} × 10^k covering maxVal. */
export function niceScale(maxVal, ticks = 4) {
  if (!(maxVal > 0)) return { step: 1, max: ticks };
  const raw = maxVal / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  return { step, max: step * ticks };
}

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function baseSvg(ariaLabel) {
  const { VW, VH } = CHART;
  const svg = svgEl('svg', { viewBox: `0 0 ${VW} ${VH}`, class: 'cchart', role: 'img' });
  svg.setAttribute('aria-label', ariaLabel || '');
  return svg;
}

/** Y grid lines + tick labels for the left axis. */
function gridLeft(svg, scale, fmt) {
  const { VW, VH, PL, PR, PT, PB } = CHART;
  const plotH = VH - PT - PB;
  const g = svgEl('g', { class: 'cgrid' });
  const labels = svgEl('g', { class: 'caxis' });
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) {
    const y = PT + plotH - (v / scale.max) * plotH;
    g.appendChild(svgEl('line', { x1: PL, y1: y.toFixed(1), x2: VW - PR, y2: y.toFixed(1) }));
    const t = svgEl('text', { x: PL - 9, y: (y + 3.5).toFixed(1), 'text-anchor': 'end', class: 'caxis-y' });
    t.textContent = fmt ? fmt(v) : String(v);
    labels.appendChild(t);
  }
  svg.appendChild(g);
  svg.appendChild(labels);
}

function xLabels(svg, labels) {
  const { VW, VH, PL, PR } = CHART;
  const plotW = VW - PL - PR;
  const gw = plotW / labels.length;
  const g = svgEl('g', { class: 'caxis' });
  labels.forEach((l, i) => {
    const t = svgEl('text', {
      x: (PL + gw * (i + 0.5)).toFixed(1), y: VH - 9, 'text-anchor': 'middle',
    });
    t.textContent = l;
    g.appendChild(t);
  });
  svg.appendChild(g);
}

/**
 * Bar chart for weekly focus minutes / completion counts.
 * data: [{ label, value, highlight? }]
 */
export function barChart(data, { ariaLabel, height = 132, valueFormatter = (v) => String(v) } = {}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const wrap = h('div', { class: 'chart-wrap' });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${data.length * 40} ${height}`);
  svg.setAttribute('role', 'img');
  const summary = data.map((d) => `${d.label} ${valueFormatter(d.value)}`).join(', ');
  svg.setAttribute('aria-label', ariaLabel || `Bar chart. ${summary}`);

  const chartHeight = height - 26;
  data.forEach((d, i) => {
    const x = i * 40 + 8;
    const barH = Math.max(d.value > 0 ? 4 : 0, (d.value / max) * (chartHeight - 8));
    const y = chartHeight - barH;

    const track = document.createElementNS(svgNS, 'rect');
    track.setAttribute('x', String(x));
    track.setAttribute('y', '0');
    track.setAttribute('width', '24');
    track.setAttribute('height', String(chartHeight));
    track.setAttribute('rx', '6');
    track.setAttribute('fill', 'var(--chart-track)');
    track.setAttribute('opacity', '0.5');
    svg.appendChild(track);

    if (barH > 0) {
      const bar = document.createElementNS(svgNS, 'rect');
      bar.setAttribute('x', String(x));
      bar.setAttribute('y', String(y));
      bar.setAttribute('width', '24');
      bar.setAttribute('height', String(barH));
      bar.setAttribute('rx', '6');
      bar.setAttribute('fill', d.highlight ? 'var(--chart-2)' : 'var(--chart-1)');
      svg.appendChild(bar);
    }

    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(x + 12));
    label.setAttribute('y', String(height - 8));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '10');
    label.setAttribute('fill', 'var(--text-muted)');
    label.textContent = d.label;
    svg.appendChild(label);
  });

  wrap.appendChild(svg);
  return wrap;
}

/**
 * Simple donut for a single percentage (e.g. completion rate).
 */
export function donut({ percent, valueText, label, size = 116 }) {
  const p = Math.min(100, Math.max(0, Number(percent) || 0));
  const radius = 44;
  const circumference = 2 * Math.PI * radius;
  const dash = (p / 100) * circumference;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label}: ${Math.round(p)}%`);

  const track = document.createElementNS(svgNS, 'circle');
  track.setAttribute('cx', String(size / 2));
  track.setAttribute('cy', String(size / 2));
  track.setAttribute('r', String(radius));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--chart-track)');
  track.setAttribute('stroke-width', '10');
  svg.appendChild(track);

  const arc = document.createElementNS(svgNS, 'circle');
  arc.setAttribute('cx', String(size / 2));
  arc.setAttribute('cy', String(size / 2));
  arc.setAttribute('r', String(radius));
  arc.setAttribute('fill', 'none');
  arc.setAttribute('stroke', 'var(--chart-1)');
  arc.setAttribute('stroke-width', '10');
  arc.setAttribute('stroke-linecap', 'round');
  arc.setAttribute('stroke-dasharray', `${dash} ${circumference - dash}`);
  arc.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  svg.appendChild(arc);

  return h(
    'div',
    { class: 'donut-wrap' },
    svg,
    h(
      'div',
      {},
      h('div', { class: 'donut-center-value' }, valueText ?? `${Math.round(p)}%`),
      h('div', { class: 'donut-center-label' }, label)
    )
  );
}

/**
 * Trend line over a week of values, with a hidden data table alternative.
 * data: [{ label, value }]
 */
export function lineChart(data, { ariaLabel, valueFormatter = (v) => String(v) } = {}) {
  const width = 320;
  const height = 120;
  const pad = 10;
  const max = Math.max(1, ...data.map((d) => d.value));
  const step = data.length > 1 ? (width - pad * 2) / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = pad + i * step;
    const y = height - pad - (d.value / max) * (height - pad * 2 - 12);
    return { ...d, x, y };
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  const summary = data.map((d) => `${d.label} ${valueFormatter(d.value)}`).join(', ');
  svg.setAttribute('aria-label', ariaLabel || `Line chart. ${summary}`);

  const area = document.createElementNS(svgNS, 'path');
  const line = document.createElementNS(svgNS, 'path');
  const dLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const dArea = `${dLine} L${points[points.length - 1].x.toFixed(1)} ${height - pad} L${points[0].x.toFixed(1)} ${height - pad} Z`;

  line.setAttribute('d', dLine);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--chart-2)');
  line.setAttribute('stroke-width', '2.5');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');

  area.setAttribute('d', dArea);
  area.setAttribute('fill', 'var(--chart-2)');
  area.setAttribute('opacity', '0.12');

  svg.appendChild(area);
  svg.appendChild(line);

  for (const p of points) {
    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', p.x.toFixed(1));
    dot.setAttribute('cy', p.y.toFixed(1));
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', 'var(--chart-2)');
    svg.appendChild(dot);
  }

  const labels = h(
    'div',
    { class: 'legend' },
    ...data.map((d) =>
      h('span', { class: 'legend-item' }, `${d.label}: ${valueFormatter(d.value)}`)
    )
  );

  return h('div', { class: 'chart-wrap' }, svg, labels);
}

/* ============================================================
   Premium primitives for the Progress page.
   Geometry follows the approved reference (VW 760 / VH 300,
   PL 46 / PR 16 / PT 16 / PB 32); colours are CSS variables so
   every theme and dark accent is correct without branching.
   ============================================================ */

/** Tooltip/keyboard budget: beyond this many marks, rely on aria summary. */
function focusableFor(count) {
  return count <= 48;
}

/**
 * Grouped vertical bars with grid, x labels and optional average line.
 * { labels, series:[{name, color, values}], avg, avgLabel, yFmt, max, aria, tip(s,i,v) }
 */
export function groupedBars(o) {
  const { VW, VH, PL, PR, PT, PB } = CHART;
  const plotW = VW - PL - PR;
  const plotH = VH - PT - PB;
  const peak = Math.max(...o.series.flatMap((s) => s.values), 0);
  const scale = niceScale(o.max || peak * 1.12);
  const svg = baseSvg(o.aria);
  gridLeft(svg, scale, o.yFmt);

  const gw = plotW / o.labels.length;
  const bw = Math.min(o.barW || 24, (gw * 0.7) / o.series.length);
  const totalMarks = o.series.reduce((n, s) => n + s.values.length, 0);
  const focusable = focusableFor(totalMarks);

  o.series.forEach((s, si) => {
    const off = (o.series.length * bw + (o.series.length - 1) * 4) / 2;
    s.values.forEach((v, i) => {
      const bh = (v / scale.max) * plotH;
      const x = PL + gw * i + gw / 2 - off + si * (bw + 4);
      const y = PT + plotH - bh;
      const rect = svgEl('rect', {
        x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1),
        height: Math.max(bh, v > 0 ? 2 : 1).toFixed(1), rx: 6, fill: s.color,
        class: v > 0 ? '' : 'cz',
      });
      markInteractive(rect, o.tip ? o.tip(s, i, v) : [o.labels[i], `${s.name}: ${v}`], { focusable });
      svg.appendChild(rect);
    });
  });

  if (o.avg != null) {
    const y = PT + plotH - (o.avg / scale.max) * plotH;
    svg.appendChild(svgEl('line', { class: 'cavg', x1: PL, y1: y.toFixed(1), x2: VW - PR, y2: y.toFixed(1) }));
    const tag = svgEl('text', { class: 'cavg-tag', x: VW - PR, y: (y - 7).toFixed(1), 'text-anchor': 'end' });
    tag.textContent = o.avgLabel || '';
    svg.appendChild(tag);
  }

  xLabels(svg, o.labels);
  return svg;
}

/**
 * Line chart with soft area fill and optional dashed previous-period series.
 * { labels, series:[{name, color, values, fill, dash, points, width}], yFmt, aria, tip(s,i,v) }
 */
export function areaLine(o) {
  const { VW, VH, PL, PR, PT, PB } = CHART;
  const plotW = VW - PL - PR;
  const plotH = VH - PT - PB;
  const peak = Math.max(...o.series.flatMap((s) => s.values), 0);
  const scale = niceScale(o.max || peak * 1.15);
  const svg = baseSvg(o.aria);
  gridLeft(svg, scale, o.yFmt);

  const gw = plotW / o.labels.length;
  const px = (i) => PL + gw * (i + 0.5);
  const py = (v) => PT + plotH - (v / scale.max) * plotH;
  const path = (vals) => vals.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ');

  for (const s of o.series) {
    if (s.fill) {
      const d = `${path(s.values)} L${px(s.values.length - 1).toFixed(1)},${PT + plotH} L${px(0).toFixed(1)},${PT + plotH} Z`;
      svg.appendChild(svgEl('path', { d, fill: s.color, opacity: s.fillOpacity || 0.12 }));
    }
    svg.appendChild(svgEl('path', {
      d: path(s.values), fill: 'none', stroke: s.color,
      'stroke-width': s.width || 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      ...(s.dash ? { 'stroke-dasharray': '6 5' } : {}),
    }));
  }

  const totalMarks = o.series.filter((s) => s.points !== false).reduce((n, s) => n + s.values.length, 0);
  const focusable = focusableFor(totalMarks);
  for (const s of o.series) {
    if (s.points === false) continue;
    s.values.forEach((v, i) => {
      const dot = svgEl('circle', {
        cx: px(i).toFixed(1), cy: py(v).toFixed(1), r: 5,
        fill: 'var(--surface)', stroke: s.color, 'stroke-width': 2.6,
      });
      markInteractive(dot, o.tip ? o.tip(s, i, v) : [o.labels[i], `${s.name}: ${v}`], { focusable });
      svg.appendChild(dot);
    });
  }

  xLabels(svg, o.labels);
  return svg;
}

/**
 * Bars on the left axis + a line on a right-hand axis (monthly trends).
 * { labels, bars:{values, color}, line:{values, color}, yFmtA, yFmtB, aria, tipBar(i,v), tipLine(i,v) }
 */
export function dualAxis(o) {
  const { VW, VH, PL, PR, PT, PB } = CHART;
  const plotW = VW - PL - PR;
  const plotH = VH - PT - PB;
  const bScale = niceScale(Math.max(...o.bars.values, 0) * 1.15);
  const lScale = niceScale(Math.max(...o.line.values, 0) * 1.15);
  const svg = baseSvg(o.aria);
  gridLeft(svg, bScale, o.yFmtA);

  const gw = plotW / o.labels.length;
  const bw = Math.min(30, gw * 0.46);
  const focusable = focusableFor(o.labels.length * 2);
  o.bars.values.forEach((v, i) => {
    const bh = (v / bScale.max) * plotH;
    const x = PL + gw * (i + 0.5) - bw / 2;
    const y = PT + plotH - bh;
    const rect = svgEl('rect', {
      x: x.toFixed(1), y: y.toFixed(1), width: bw.toFixed(1),
      height: Math.max(bh, v > 0 ? 2 : 1).toFixed(1), rx: 7, fill: o.bars.color,
    });
    markInteractive(rect, o.tipBar ? o.tipBar(i, v) : [o.labels[i], `${v}`], { focusable });
    svg.appendChild(rect);
  });

  const px = (i) => PL + gw * (i + 0.5);
  const py = (v) => PT + plotH - (v / lScale.max) * plotH;
  svg.appendChild(svgEl('path', {
    d: o.line.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' '),
    fill: 'none', stroke: o.line.color, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
  }));
  o.line.values.forEach((v, i) => {
    const dot = svgEl('circle', {
      cx: px(i).toFixed(1), cy: py(v).toFixed(1), r: 5,
      fill: 'var(--surface)', stroke: o.line.color, 'stroke-width': 2.6,
    });
    markInteractive(dot, o.tipLine ? o.tipLine(i, v) : [o.labels[i], `${v}`], { focusable });
    svg.appendChild(dot);
  });

  // Right-hand tick labels, coloured by the line series.
  const rightLabels = svgEl('g', { class: 'caxis' });
  for (let v = 0; v <= lScale.max + 1e-9; v += lScale.step) {
    const y = PT + plotH - (v / lScale.max) * plotH;
    const t = svgEl('text', {
      x: VW - PR + 8, y: (y + 3.5).toFixed(1), 'text-anchor': 'start',
      fill: o.line.color, class: 'caxis-y',
    });
    t.textContent = o.yFmtB ? o.yFmtB(v) : String(v);
    rightLabels.appendChild(t);
  }
  svg.appendChild(rightLabels);

  xLabels(svg, o.labels);
  return svg;
}

/**
 * Horizontal bars: left labels, right values, tooltip per row.
 * { rows:[{label, value, color, right}], aria, tip(row) }
 */
export function hBars(o) {
  const { VW, VH, PT, PB } = CHART;
  const svg = baseSvg(o.aria);
  const maxV = Math.max(...o.rows.map((r) => r.value), 1);
  const x0 = 168;
  const x1 = VW - 108;
  const rowH = (VH - PT - PB) / o.rows.length;
  const focusable = focusableFor(o.rows.length);

  o.rows.forEach((row, i) => {
    const y = PT + rowH * i + rowH / 2;
    const w = (row.value / maxV) * (x1 - x0);

    const label = svgEl('text', { x: x0 - 14, y: y + 4, 'text-anchor': 'end', class: 'cbar-label' });
    label.textContent = row.label;
    svg.appendChild(label);

    svg.appendChild(svgEl('rect', { x: x0, y: y - 13, width: x1 - x0, height: 26, rx: 9, class: 'ctrack' }));

    const bar = svgEl('rect', {
      x: x0, y: y - 13, width: Math.max(w, row.value > 0 ? 4 : 0).toFixed(1),
      height: 26, rx: 9, fill: row.color,
    });
    markInteractive(bar, o.tip ? o.tip(row) : [row.label, row.right || String(row.value)], { focusable });
    svg.appendChild(bar);

    const val = svgEl('text', { x: x1 + 12, y: y + 4, class: 'cval' });
    val.textContent = row.right ?? String(row.value);
    svg.appendChild(val);
  });
  return svg;
}

/**
 * Multi-segment donut with inline legend rows (task breakdown).
 * { parts:[{label, value, color, note, right, barFrac}], center, centerSub, aria, tip(part) }
 */
export function donutLegend(o) {
  const { VW, VH, PR } = CHART;
  const svg = baseSvg(o.aria);
  const total = o.parts.reduce((n, p) => n + p.value, 0);
  const r = 88;
  const cx = 132;
  const cy = 148;
  const C = 2 * Math.PI * r;
  const focusable = focusableFor(o.parts.length);

  svg.appendChild(svgEl('circle', { cx, cy, r, fill: 'none', class: 'ctrack', 'stroke-width': 34 }));
  let acc = 0;
  for (const p of o.parts) {
    if (!total || p.value <= 0) continue; // nothing to arc — leave the empty track
    const frac = p.value / total;
    const len = frac * C;
    const seg = svgEl('circle', {
      cx, cy, r, fill: 'none', stroke: p.color, 'stroke-width': 34,
      'stroke-dasharray': `${Math.max(len - 3, 0).toFixed(2)} ${(C - Math.max(len - 3, 0) + 3).toFixed(2)}`,
      'stroke-dashoffset': `${(-acc).toFixed(2)}`,
      transform: `rotate(-90 ${cx} ${cy})`,
    });
    markInteractive(seg, o.tip ? o.tip(p) : [p.label, p.note || String(p.value)], { focusable });
    svg.appendChild(seg);
    acc += len;
  }

  const center = svgEl('text', { x: cx, y: cy - 2, 'text-anchor': 'middle', class: 'cdonut-value' });
  center.textContent = String(o.center ?? total);
  svg.appendChild(center);
  const sub = svgEl('text', { x: cx, y: cy + 20, 'text-anchor': 'middle', class: 'caxis' });
  sub.textContent = o.centerSub || '';
  svg.appendChild(sub);

  o.parts.forEach((p, i) => {
    const y = 66 + i * 62;
    svg.appendChild(svgEl('rect', { x: 300, y: y - 13, width: 13, height: 13, rx: 4, fill: p.color }));
    const label = svgEl('text', { x: 322, y: y - 2, class: 'cval' });
    label.textContent = p.label;
    svg.appendChild(label);
    const note = svgEl('text', { x: 322, y: y + 17, class: 'caxis' });
    note.textContent = p.note || '';
    svg.appendChild(note);
    const right = svgEl('text', { x: VW - PR, y: y - 2, 'text-anchor': 'end', class: 'cval cval-lg' });
    right.textContent = p.right || '';
    svg.appendChild(right);
    svg.appendChild(svgEl('rect', { x: 322, y: y + 25, width: VW - PR - 322, height: 8, rx: 6, class: 'ctrack' }));
    if (p.barFrac > 0) {
      svg.appendChild(svgEl('rect', {
        x: 322, y: y + 25, width: ((VW - PR - 322) * Math.min(1, p.barFrac)).toFixed(1),
        height: 8, rx: 6, fill: p.color,
      }));
    }
  });
  return svg;
}

/**
 * Hour-of-day heatmap: 7 weekday rows × 24 hour cells.
 * { matrix: 7×24 minutes, dayLabels:[Mon..Sun], aria, tip(dayIdx, hour, minutes) }
 */
export function hourHeat(o) {
  const cw = 26;
  const ch = 30;
  const gap = 2;
  const x0 = 58;
  const y0 = 26;
  const svg = baseSvg(o.aria);
  const maxV = Math.max(...o.matrix.flat(), 1);
  const focusable = focusableFor(7 * 24); // 168 cells > budget → aria summary only

  o.dayLabels.forEach((d, i) => {
    const t = svgEl('text', { x: x0 - 12, y: y0 + i * ch + ch / 2 + 4, 'text-anchor': 'end', class: 'caxis' });
    t.textContent = d;
    svg.appendChild(t);
  });

  o.matrix.forEach((row, i) => {
    row.forEach((v, hour) => {
      const alpha = v === 0 ? 0.05 : 0.14 + 0.86 * (v / maxV);
      const rect = svgEl('rect', {
        x: x0 + hour * (cw + gap), y: y0 + i * ch, width: cw, height: ch - 3, rx: 6,
        fill: 'var(--accent)', 'fill-opacity': alpha.toFixed(2),
        stroke: 'var(--surface)', 'stroke-width': 1,
      });
      markInteractive(
        rect,
        o.tip ? o.tip(i, hour, v) : [o.dayLabels[i], `${String(hour).padStart(2, '0')}:00`, `${v} min`],
        { focusable }
      );
      svg.appendChild(rect);
    });
  });

  const axisY = y0 + 7 * ch + 6;
  for (let hour = 0; hour < 24; hour += 3) {
    const t = svgEl('text', {
      x: x0 + hour * (cw + gap) + cw / 2, y: axisY, 'text-anchor': 'middle', class: 'caxis',
    });
    t.textContent = `${String(hour).padStart(2, '0')}:00`;
    svg.appendChild(t);
  }

  // Density legend on the right.
  const lx = x0 + 24 * (cw + gap) + 6;
  const dense = svgEl('text', { x: lx, y: y0 + 12, 'text-anchor': 'start', class: 'caxis' });
  dense.textContent = 'Densest';
  svg.appendChild(dense);
  [1, 0.7, 0.4, 0.14, 0.05].forEach((alpha, i) => {
    svg.appendChild(svgEl('rect', {
      x: lx, y: y0 + 22 + i * 22, width: 26, height: 16, rx: 5,
      fill: 'var(--accent)', 'fill-opacity': String(alpha),
    }));
  });
  const quiet = svgEl('text', { x: lx, y: y0 + 22 + 5 * 22, 'text-anchor': 'start', class: 'caxis' });
  quiet.textContent = 'Quiet';
  svg.appendChild(quiet);
  return svg;
}
