/**
 * YumeRise Next — application entry point.
 *
 * Builds the responsive shell (sidebar on desktop, bottom nav on mobile),
 * wires the hash router, theme, and native bridge. Everything renders from
 * real local data; there is no hardcoded sample content.
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/components.css';
import './styles/views.css';
import './styles/progress.css';

import { h, must } from './core/dom.js';
import { icon, brandLogo } from './core/icons.js';
import { initTheme, toggle as toggleTheme, getApplied, onThemeChange } from './core/theme.js';
import { startRouter, route, navigate, registerNavListener } from './core/router.js';
import { initNative } from './native/bridge.js';

import { homeView } from './views/home.js';
import { tasksView } from './views/tasks.js';
import { focusView } from './views/focus.js';
import { goalsView } from './views/goals.js';
import { planView } from './views/plan.js';
import { progressView } from './views/progress.js';
import { settingsView } from './views/settings.js';

/* ---------------- Navigation model ---------------- */

const PRIMARY = [
  { key: 'home', label: 'Home', shortLabel: 'Home', iconName: 'home' },
  { key: 'tasks', label: 'My Tasks', shortLabel: 'Tasks', iconName: 'tasks' },
  { key: 'plan', label: 'Plan', shortLabel: 'Plan', iconName: 'plan' },
  { key: 'focus', label: 'Focus', shortLabel: 'Focus', iconName: 'focus' },
  { key: 'goals', label: 'Goals', shortLabel: 'Goals', iconName: 'goals' },
  { key: 'progress', label: 'Progress', shortLabel: 'Stats', iconName: 'progress' },
];

// Bottom nav keeps the 5 most-used destinations; Progress lives in More/sidebar.
const BOTTOM = [
  PRIMARY[0], PRIMARY[1], PRIMARY[2], PRIMARY[3], PRIMARY[4],
];

/* ---------------- Theme button ---------------- */

function themeButton({ bare = false } = {}) {
  const btn = h(
    'button',
    {
      class: bare ? 'icon-btn bare' : 'icon-btn',
      'aria-label': `Switch to ${getApplied() === 'dark' ? 'light' : 'dark'} theme`,
      onClick: () => {
        toggleTheme();
        syncThemeButtons();
      },
    }
  );
  btn.classList.add('theme-toggle');
  btn.appendChild(icon(getApplied() === 'dark' ? 'sun' : 'moon'));
  return btn;
}

const themeButtons = new Set();
function syncThemeButtons() {
  for (const btn of themeButtons) {
    const next = getApplied() === 'dark' ? 'sun' : 'moon';
    btn.setAttribute('aria-label', `Switch to ${getApplied() === 'dark' ? 'light' : 'dark'} theme`);
    btn.replaceChildren(icon(next));
  }
}

/* ---------------- Shell ---------------- */

function buildShell() {
  const sidebarNav = h('nav', { class: 'sidebar-nav', 'aria-label': 'Primary' });
  const bottomNav = h('nav', { class: 'bottom-nav', 'aria-label': 'Primary' });
  const viewMount = h('main', { class: 'view-mount', id: 'main-content', tabindex: '-1' });

  const navButtons = new Map();

  for (const item of PRIMARY) {
    const btn = h(
      'button',
      {
        class: 'nav-item',
        type: 'button',
        onClick: () => navigate(item.key),
      },
      h('span', { class: 'nav-icon' }, icon(item.iconName)),
      h('span', {}, item.label)
    );
    btn.dataset.navKey = item.key;
    sidebarNav.appendChild(btn);
    navButtons.set(item.key, btn);
  }

  for (const item of BOTTOM) {
    const btn = h(
      'button',
      {
        class: 'bottom-nav-item',
        type: 'button',
        onClick: () => navigate(item.key),
      },
      h('span', { class: 'nav-icon' }, icon(item.iconName)),
      h('span', { class: 'nav-label' }, item.shortLabel)
    );
    btn.dataset.navKey = `bottom-${item.key}`;
    bottomNav.appendChild(btn);
    navButtons.set(`bottom-${item.key}`, btn);
  }

  const sidebarFooter = h(
    'div',
    { class: 'sidebar-footer' },
    (() => {
      const settingsBtn = h(
        'button',
        { class: 'nav-item', type: 'button', onClick: () => navigate('settings') },
        h('span', { class: 'nav-icon' }, icon('settings')),
        h('span', {}, 'Settings')
      );
      settingsBtn.dataset.navKey = 'settings';
      navButtons.set('settings', settingsBtn);
      return settingsBtn;
    })()
  );

  const topbarTheme = themeButton();
  themeButtons.add(topbarTheme);

  const topbar = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'topbar-brand' },
      h('span', { class: 'logo-mark', 'aria-hidden': 'true', html: brandLogo('top') }),
      h('span', {}, 'YumeRise')
    ),
    h(
      'div',
      { class: 'topbar-actions' },
      topbarTheme,
      (() => {
        const settingsBtn = h(
          'button',
          { class: 'icon-btn', 'aria-label': 'Settings', onClick: () => navigate('settings') },
          icon('settings')
        );
        return settingsBtn;
      })()
    )
  );

  const sidebar = h(
    'aside',
    { class: 'sidebar', 'aria-label': 'Sidebar' },
    h(
      'div',
      { class: 'sidebar-brand' },
      h('span', { class: 'logo-mark', 'aria-hidden': 'true', html: brandLogo('side') }),
      h('span', {}, 'YumeRise Next')
    ),
    sidebarNav,
    sidebarFooter
  );

  const main = h('div', { class: 'main' }, topbar, viewMount);
  const app = h('div', { class: 'app' }, sidebar, main, bottomNav);

  registerNavListener((active) => {
    for (const [key, btn] of navButtons) {
      const isActive = key === active || key === `bottom-${active}`;
      btn.classList.toggle('active', isActive);
      if (isActive) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  });

  return { app, viewMount };
}

/* ---------------- Boot ---------------- */

async function boot() {
  initTheme();
  // Keep the topbar toggle's icon/label correct when the theme changes
  // anywhere else (Settings mode/accent controls, OS switch in System mode).
  onThemeChange(() => syncThemeButtons());
  initNative();

  route('home', homeView);
  route('tasks', tasksView);
  route('plan', planView);
  route('focus', focusView);
  route('goals', goalsView);
  route('progress', progressView);
  route('settings', settingsView);

  const { app, viewMount } = buildShell();
  const root = must('#app');
  root.replaceChildren(app);
  root.setAttribute('aria-busy', 'false');

  startRouter(viewMount);
}

boot().catch((err) => {
  console.error('YumeRise failed to start', err);
  const root = document.getElementById('app');
  if (root) {
    root.innerHTML = '';
    // Never leave aria-busy="true": AT would report a permanent loading state.
    root.setAttribute('aria-busy', 'false');
    const msg = document.createElement('div');
    msg.className = 'state-block';
    const h3 = document.createElement('h3');
    h3.textContent = 'Could not start';
    const p = document.createElement('p');
    msg.append(h3, p);
    p.textContent = 'YumeRise Next hit an unexpected error while starting.';
    root.appendChild(msg);
  }
});
