/**
 * Theme management: Light / Dark / System + dark accent palettes.
 *
 * - mode:   'light' | 'dark' | 'system'  (persisted, 'yrn.theme')
 * - accent: 'rose' | 'graphite'          (persisted, 'yrn.accent')
 *
 * The applied theme lives on <html data-theme> and the dark accent on
 * <html data-accent>, which every token consumer reads — the structural
 * fix for the legacy class-scope bug where the auth shell never received
 * the light theme.
 *
 * The accent preference is preserved across mode switches (spec §8): it
 * only *visibly* applies while dark (CSS scopes accent tokens under
 * [data-theme='dark']), but the stored choice is never discarded.
 * System mode follows the OS preference via matchMedia.
 */

const MODE_KEY = 'yrn.theme';    // 'light' | 'dark' | 'system'
const ACCENT_KEY = 'yrn.accent'; // 'rose' | 'graphite'

const MODES = ['light', 'dark', 'system'];
const ACCENTS = ['rose', 'graphite'];

const listeners = new Set();

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function read(key, allowed, fallback) {
  try {
    const v = localStorage.getItem(key);
    return allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

export function getMode() {
  return read(MODE_KEY, MODES, 'system');
}

/** Dark accent palette: 'rose' (default) or 'graphite'. */
export function getAccent() {
  return read(ACCENT_KEY, ACCENTS, 'rose');
}

export function getApplied() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function apply() {
  const mode = getMode();
  const applied = mode === 'system' ? systemTheme() : mode;
  const accent = getAccent();
  const root = document.documentElement;
  root.dataset.theme = applied;
  root.dataset.accent = accent;
  for (const fn of listeners) {
    try { fn(applied, mode, accent); } catch (err) { console.error('theme listener failed', err); }
  }
}

export function setMode(mode) {
  if (!MODES.includes(mode)) return;
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* storage may be unavailable */ }
  apply();
}

export function setAccent(accent) {
  if (!ACCENTS.includes(accent)) return;
  try { localStorage.setItem(ACCENT_KEY, accent); } catch { /* storage may be unavailable */ }
  apply();
}

export function toggle() {
  setMode(getApplied() === 'dark' ? 'light' : 'dark');
}

/** fn(appliedTheme, mode, accent) — called on any theme/accent change. */
export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getMode() === 'system') apply();
  });
  apply();
}
