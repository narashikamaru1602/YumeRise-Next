/**
 * Shared UI utilities: toasts, dialogs, and the empty/loading/error state
 * blocks used by every screen.
 */

import { h, mount } from '../core/dom.js';
import { icon } from '../core/icons.js';

/* ---------------- Toasts ---------------- */

let toastRegion = null;

function region() {
  if (!toastRegion) toastRegion = document.getElementById('toast-region');
  return toastRegion;
}

export function toast(message, { type = 'info', timeout = 3200 } = {}) {
  const el = region();
  if (!el) return;
  const node = h(
    'div',
    { class: `toast ${type}` },
    h('span', { class: 'toast-dot' }),
    h('span', {}, message)
  );
  el.appendChild(node);
  setTimeout(() => {
    node.style.opacity = '0';
    node.style.transition = 'opacity 200ms';
    setTimeout(() => node.remove(), 220);
  }, timeout);
}

/* ---------------- Dialog ---------------- */

/* Closers for dialogs currently open. A route change closes them so a stale
   modal can't sit over — and later write into — a different page's data. */
const openClosers = new Set();

export function closeOpenDialogs() {
  for (const close of [...openClosers]) {
    try {
      close();
    } catch (err) {
      console.error('could not close dialog', err);
    }
  }
}

/**
 * Open an accessible modal dialog. Content is built by the caller with h(),
 * so user data is never interpolated into HTML.
 * Returns { close } — the backdrop closes on Escape, backdrop click, or close().
 */
export function openDialog({ title, content, actions, onClose }) {
  const root = document.getElementById('dialog-root');
  const appRoot = document.getElementById('app');
  const previouslyFocused = document.activeElement;
  let closed = false;

  const dialogEl = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h(
      'div',
      { class: 'dialog-header' },
      h('h2', {}, title),
      h('button', { class: 'icon-btn bare', 'aria-label': 'Close dialog', onClick: () => close() }, icon('close'))
    ),
    content
  );

  const backdrop = h('div', { class: 'dialog-backdrop' }, dialogEl);

  function close(result) {
    if (closed) return;
    closed = true;
    openClosers.delete(close);
    backdrop.remove();
    document.removeEventListener('keydown', onKeydown);
    appRoot?.removeAttribute('inert');
    if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
      previouslyFocused.focus({ preventScroll: true });
    }
    if (typeof onClose === 'function') onClose(result);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      trapFocus(event, dialogEl);
    }
  }

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });
  document.addEventListener('keydown', onKeydown);

  if (actions) {
    dialogEl.appendChild(actions);
  }

  root.appendChild(backdrop);
  // The rest of the app is inert while the modal is open: keyboard and screen
  // reader users can't reach controls behind it (backdrop click still closes).
  appRoot?.setAttribute('inert', '');
  openClosers.add(close);
  const focusable = dialogEl.querySelector('input, select, textarea, button:not([aria-label="Close dialog"])');
  (focusable || dialogEl.querySelector('.icon-btn'))?.focus({ preventScroll: true });

  return { close, element: dialogEl };
}

function trapFocus(event, containerEl) {
  const nodes = [...containerEl.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ---------------- State blocks ---------------- */

export function emptyState({ iconName = 'spark', title, hint, actionLabel, onAction }) {
  return h(
    'div',
    { class: 'state-block' },
    h('div', { class: 'state-icon' }, icon(iconName)),
    h('h3', {}, title),
    hint ? h('p', {}, hint) : null,
    actionLabel && onAction
      ? h('button', { class: 'btn btn-soft', onClick: onAction }, actionLabel)
      : null
  );
}

export function loadingState(label = 'Loading…') {
  const block = h('div', { class: 'state-block', role: 'status', 'aria-live': 'polite' });
  for (let i = 0; i < 3; i += 1) {
    block.appendChild(
      h('div', { class: 'skeleton', style: { width: '100%', maxWidth: '420px', height: i === 0 ? '64px' : '48px' } })
    );
  }
  block.appendChild(h('p', {}, label));
  return block;
}

export function errorState(message, onRetry) {
  return h(
    'div',
    { class: 'state-block' },
    h('div', { class: 'state-icon', style: { background: 'var(--error-soft)', color: 'var(--error)' } }, icon('warning')),
    h('h3', {}, 'Could not load'),
    h('p', {}, message || 'An unexpected error occurred. Your saved data is safe.'),
    onRetry ? h('button', { class: 'btn btn-secondary', onClick: onRetry }, 'Try again') : null
  );
}

export function banner(text, { iconName = 'info' } = {}) {
  return h('div', { class: 'banner', role: 'note' }, icon(iconName), h('span', {}, text));
}

/* ---------------- Form helpers ---------------- */

export function field(label, inputEl, { hint, id } = {}) {
  const inputId = id || `f-${Math.random().toString(36).slice(2, 8)}`;
  inputEl.id = inputId;
  return h(
    'div',
    { class: 'field' },
    h('label', { for: inputId }, label),
    inputEl,
    hint ? h('span', { class: 'hint' }, hint) : null
  );
}

export function textInput(props = {}) {
  return h('input', { class: 'input', type: 'text', ...props });
}

export function selectInput(options, props = {}) {
  const select = h('select', { class: 'select', ...props });
  for (const opt of options) {
    const o = h('option', { value: opt.value }, opt.label);
    if (opt.selected) o.selected = true;
    select.appendChild(o);
  }
  return select;
}

export function segmented(options, { value, onChange, label }) {
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });

  const select = (btn) => {
    const index = [...group.children].indexOf(btn);
    if (index < 0) return;
    for (const child of group.children) child.setAttribute('aria-checked', 'false');
    btn.setAttribute('aria-checked', 'true');
    onChange(options[index].value);
    btn.focus();
  };

  for (const opt of options) {
    const btn = h(
      'button',
      {
        type: 'button',
        role: 'radio',
        'aria-checked': String(opt.value === value),
        onClick: () => select(btn),
      },
      opt.label
    );
    group.appendChild(btn);
  }

  // Radio groups are arrow-key navigable per the APG; previously only Tab
  // worked, so keyboard users had to tab through every segment.
  group.addEventListener('keydown', (event) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
    const buttons = [...group.children];
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    event.preventDefault();
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
    const next = (current + delta + buttons.length) % buttons.length;
    select(buttons[next]);
  });

  return group;
}

export { mount };
