/**
 * Tiny DOM helper. Builds real elements without string interpolation of user
 * data, so text always renders as text (no innerHTML XSS paths like the
 * legacy client had at main.js:170/462/779/422).
 *
 * h('button', { class: 'btn', onClick: fn, 'aria-label': 'Add' }, 'Add task')
 * Children may be nodes, strings, numbers, arrays, or null/false (skipped).
 */

export function h(tag, props, ...children) {
  const el = document.createElement(tag);

  if (props && typeof props === 'object' && !(props instanceof Node)) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') {
        el.className = value;
      } else if (key === 'dataset') {
        Object.assign(el.dataset, value);
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'html') {
        // Only ever used with our own static icon strings, never user data.
        // The typeof check is belt-and-braces: a non-string (e.g. an object
        // with a hostile toString) is never parsed as markup.
        if (typeof value === 'string') el.innerHTML = value;
      } else if (value === true) {
        el.setAttribute(key, '');
      } else {
        el.setAttribute(key, String(value));
      }
    }
  } else if (props != null) {
    children.unshift(props);
  }

  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const child of children) {
    if (child == null || child === false || child === true) continue;
    if (Array.isArray(child)) {
      appendChildren(el, child);
    } else if (child instanceof Node) {
      el.appendChild(child);
    } else {
      el.appendChild(document.createTextNode(String(child)));
    }
  }
}

/** Replace an element's children safely. */
export function mount(container, ...children) {
  container.replaceChildren();
  appendChildren(container, children);
  return container;
}

/** Query with a clear failure instead of a silent null. */
export function must(selector, root = document) {
  const el = root.querySelector(selector);
  if (!el) throw new Error(`Required element not found: ${selector}`);
  return el;
}
