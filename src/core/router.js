/**
 * Hash router with URL-addressable state (the legacy client had `let view`
 * with no URL state at all). Views register by name; navigation updates the
 * hash so back/forward and deep links work on web and in the WebView.
 */

import { closeOpenDialogs } from '../ui/kit.js';

const routes = new Map();
let container = null;
let currentDispose = null;
let currentName = null;
/* Monotonic render counter: a slow view factory that finishes after a newer
   navigation must not overwrite the newer view. */
let renderSeq = 0;
const navListeners = new Set();

export function route(name, factory) {
  routes.set(name, factory);
}

export function registerNavListener(fn) {
  navListeners.add(fn);
  return () => navListeners.delete(fn);
}

export function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  return routes.has(hash) ? hash : 'home';
}

export function navigate(name, { replace = false } = {}) {
  const target = `#/${name}`;
  if (location.hash === target) {
    render();
    return;
  }
  if (replace) {
    history.replaceState(null, '', target);
    render();
  } else {
    location.hash = target;
  }
}

async function render() {
  const seq = ++renderSeq;
  const name = currentRoute();
  if (!container) return;

  // A dialog opened on the PREVIOUS page must not survive navigation: it
  // would sit over the new view and could later write stale data. Same-route
  // re-renders (refresh() after an import) keep their dialog open — the
  // import flow shows its completion step in-place.
  if (currentName !== null && currentName !== name) {
    try { closeOpenDialogs(); } catch (err) { console.error('stale dialog close failed', err); }
  }

  if (typeof currentDispose === 'function') {
    try { currentDispose(); } catch (err) { console.error('view dispose failed', err); }
  }
  currentDispose = null;

  const factory = routes.get(name) || routes.get('home');
  container.replaceChildren();

  const loading = document.createElement('div');
  loading.className = 'state-block';
  loading.innerHTML = '<div class="skeleton" style="width:100%;max-width:420px;height:120px"></div>';
  container.appendChild(loading);

  try {
    const view = await factory();
    if (seq !== renderSeq) {
      // Superseded while loading — the newer render owns the page now.
      try { if (view && typeof view.dispose === 'function') view.dispose(); } catch { /* already superseded */ }
      return;
    }
    container.replaceChildren();
    const node = view.element;
    container.appendChild(node);
    currentDispose = view.dispose;
    currentName = name;
    for (const fn of navListeners) fn(name);
    // Move focus to the view heading for keyboard/screen-reader users.
    const heading = node.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  } catch (err) {
    if (seq !== renderSeq) return; // a newer render superseded this failure
    console.error('route render failed', err);
    container.replaceChildren();
    const error = document.createElement('div');
    error.className = 'state-block';
    error.innerHTML =
      '<div class="state-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4 3 20h18z"/><path d="M12 10v4.5"/></svg></div>';
    const h3 = document.createElement('h3');
    h3.textContent = 'Something went wrong';
    const p = document.createElement('p');
    p.textContent = 'This screen could not be loaded. Your saved data is unaffected.';
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Try again';
    btn.addEventListener('click', render);
    error.append(h3, p, btn);
    container.appendChild(error);
  }
}

export function startRouter(mountEl) {
  container = mountEl;
  window.addEventListener('hashchange', render);
  if (!location.hash) history.replaceState(null, '', '#/home');
  render();
}

export function refresh() {
  render();
}

export { currentName };
