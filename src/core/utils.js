/**
 * Small shared utilities: ids, dates, time math, formatting.
 * Date labels use the local calendar day (YYYY-MM-DD), matching the legacy
 * model.js convention where a stored date label IS the user's local day.
 */

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function todayLabel(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysLabel(label, days) {
  const [y, m, d] = label.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return todayLabel(date);
}

export function labelToDate(label) {
  const [y, m, d] = label.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateLong(label) {
  return labelToDate(label).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

export function formatDateShort(label) {
  return labelToDate(label).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function formatTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** 'HH:MM' <-> minutes, matching legacy model.js behaviour. */
export function timeToMinutes(time) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  // Both parts must be real clock values: '12:99' used to pass because only
  // the total was checked against 1440.
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

export function minutesToTime(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  const m = ((Number(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Human duration: 90 -> '1h 30m', 45 -> '45m'. */
export function formatDuration(minutes) {
  const value = Number(minutes);
  // Guard non-finite input so nothing ever renders as 'Infinityh'/'NaNm'.
  const total = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

/** mm:ss for the timer display. */
export function formatClock(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Weekday labels Monday-first for charts. */
export function weekLabels() {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
}

/** Monday-first index (0..6) for a YYYY-MM-DD label. */
export function dayIndex(label) {
  const day = labelToDate(label).getDay(); // 0=Sun
  return (day + 6) % 7;
}

/** Start-of-week label (Monday) for a given label. */
export function startOfWeek(label) {
  return addDaysLabel(label, -dayIndex(label));
}
