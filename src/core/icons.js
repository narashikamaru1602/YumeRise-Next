/**
 * Inline SVG icon set (stroke style, 24x24, currentColor).
 * Our own drawings — consistent visual language, no emoji, no external deps.
 * All icons are aria-hidden; accessible names live on the controls.
 */

const S = (paths, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ` +
  `stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${extra}>${paths}</svg>`;

export const icons = {
  home: S('<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5"/>'),
  tasks: S('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="m8 12 2.5 2.5L16 9"/>'),
  focus: S('<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5"/><path d="M9 2.5h6"/>'),
  goals: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  plan: S('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17"/><path d="M8 3v4M16 3v4"/>'),
  progress: S('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M21 20H3"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>'),
  more: S('<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  check: S('<path d="m5 12.5 4.5 4.5L19 7"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  play: S('<path d="M7 5.5v13l11-6.5z"/>'),
  pause: S('<path d="M9 5.5v13M15 5.5v13"/>'),
  reset: S('<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>'),
  trash: S('<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/>'),
  edit: S('<path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  chevronRight: S('<path d="m9 5 7 7-7 7"/>'),
  chevronLeft: S('<path d="m15 5-7 7 7 7"/>'),
  sun: S('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
  moon: S('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/>'),
  monitor: S('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 16.5v4"/>'),
  clock: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  calendar: S('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  book: S('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20"/>'),
  target: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  trend: S('<path d="m3 16 5-5 4 4 8-8"/><path d="M15 7h5v5"/>'),
  spark: S('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8"/>'),
  inbox: S('<path d="M4 13h4l2 3h4l2-3h4"/><path d="M5.5 5h13l1.5 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z"/>'),
  info: S('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/>'),
  warning: S('<path d="M12 4 3 20h18z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.5" r="1" fill="currentColor" stroke="none"/>'),
  download: S('<path d="M12 4v10"/><path d="m7.5 10.5 4.5 4 4.5-4"/><path d="M4.5 19.5h15"/>'),
  upload: S('<path d="M12 15V5"/><path d="m7.5 9 4.5-4 4.5 4"/><path d="M4.5 19.5h15"/>'),
  bell: S('<path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 14 6 10z"/><path d="M10 19a2 2 0 0 0 4 0"/>'),
  music: S('<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>'),
  flag: S('<path d="M5 21V4"/><path d="M5 5h11l-1.5 3.5L16 12H5"/>'),
  list: S('<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4.2" cy="6" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="4.2" cy="18" r="1.1" fill="currentColor" stroke="none"/>'),
};

/** Return an icon element. Falls back to a neutral dot if the name is unknown. */
export function icon(name) {
  const span = document.createElement('span');
  // `typeof` guard: prototype keys like 'constructor' resolve to functions on
  // a plain object, which would otherwise be stringified into the markup.
  span.innerHTML = typeof icons[name] === 'string' ? icons[name] : icons.spark;
  span.setAttribute('aria-hidden', 'true');
  span.style.display = 'contents';
  return span.firstElementChild || span;
}

/* ---------------- Brand mark ---------------- */

/**
 * The YumeRise badge: a dawn disc — gradient ring, rising sun, layered
 * lavender-blue hills and a lotus at the horizon. Full-colour artwork, so it
 * stays identical in every theme (like an app icon).
 *
 * `uid` namespaces every gradient/clip id so the badge can appear more than
 * once in the same document (sidebar + topbar) without id collisions.
 */
export function brandLogo(uid = 'a') {
  const id = (name) => `yl-${name}-${uid}`;
  return (
    '<svg viewBox="0 0 200 200" fill="none" aria-hidden="true" focusable="false">' +
    `<defs>` +
    `<linearGradient id="${id('ring')}" x1="0" y1="0" x2="1" y2="1">` +
    '<stop offset="0" stop-color="#FDBA74"/><stop offset="0.5" stop-color="#F9A8D4"/><stop offset="1" stop-color="#7C5CFC"/>' +
    `</linearGradient>` +
    `<radialGradient id="${id('bgd')}" cx="0.5" cy="0.35" r="0.7">` +
    '<stop offset="0" stop-color="#FFF7EC"/><stop offset="0.6" stop-color="#F3EEFF"/><stop offset="1" stop-color="#E4DCFB"/>' +
    `</radialGradient>` +
    `<linearGradient id="${id('sun')}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#FFE7B8"/><stop offset="1" stop-color="#FDBA74"/>' +
    `</linearGradient>` +
    `<linearGradient id="${id('ray')}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#FDBA74"/><stop offset="1" stop-color="#F9A8D4"/>' +
    `</linearGradient>` +
    `<linearGradient id="${id('h1')}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#C9B8FF"/><stop offset="1" stop-color="#B0A0F0"/>' +
    `</linearGradient>` +
    `<linearGradient id="${id('h2')}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#9DB4F5"/><stop offset="1" stop-color="#7C9CEB"/>' +
    `</linearGradient>` +
    `<linearGradient id="${id('h3')}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#6F97EA"/><stop offset="1" stop-color="#5B7FDC"/>' +
    `</linearGradient>` +
    `<clipPath id="${id('disc')}"><circle cx="100" cy="100" r="84"/></clipPath>` +
    `</defs>` +
    `<circle cx="100" cy="100" r="96" stroke="url(#${id('ring')})" stroke-width="3"/>` +
    `<circle cx="100" cy="100" r="90" stroke="url(#${id('ring')})" stroke-width="1" stroke-dasharray="2 4" opacity="0.7"/>` +
    `<circle cx="100" cy="100" r="84" fill="url(#${id('bgd')})"/>` +
    `<g stroke="url(#${id('ray')})" stroke-width="4" stroke-linecap="round">` +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-180 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-157.5 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-135 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-112.5 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-90 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-67.5 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-45 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(-22.5 100 92)"/>' +
    '<line x1="100" y1="42" x2="100" y2="28" transform="rotate(0 100 92)"/>' +
    `</g>` +
    `<circle cx="100" cy="92" r="32" fill="url(#${id('sun')})"/>` +
    '<circle cx="100" cy="92" r="24" fill="#FFF4DC" opacity="0.5"/>' +
    `<g clip-path="url(#${id('disc')})">` +
    '<path d="M10 126 Q50 106 92 124 T190 118 V200 H10Z" fill="url(#' + id('h1') + ')"/>' +
    '<path d="M10 142 Q64 122 118 140 T190 136 V200 H10Z" fill="url(#' + id('h2') + ')"/>' +
    '<path d="M10 160 Q90 146 190 158 V200 H10Z" fill="url(#' + id('h3') + ')"/>' +
    `</g>` +
    '<rect x="78" y="172" width="44" height="3" rx="1.5" fill="#FFFFFF" opacity="0.7"/>' +
    '<rect x="86" y="178" width="28" height="2.5" rx="1.25" fill="#FFFFFF" opacity="0.5"/>' +
    '<rect x="93" y="183" width="14" height="2" rx="1" fill="#FFFFFF" opacity="0.35"/>' +
    '<path d="M100 124 C104 118 104 112 100 106 C96 112 96 118 100 124Z" fill="#F9A8D4"/>' +
    '<path d="M98 124 C92 122 90 116 93 112 C96 115 97 119 98 124Z" fill="#F9A8D4" opacity="0.8"/>' +
    '<path d="M102 124 C108 122 110 116 107 112 C104 115 103 119 102 124Z" fill="#F9A8D4" opacity="0.8"/>' +
    `</svg>`
  );
}
