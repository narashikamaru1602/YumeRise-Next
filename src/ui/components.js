/**
 * Shared presentational components used across screens.
 * All take plain data and return real DOM nodes built with h().
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { formatDuration, formatDateShort, formatTime } from '../core/utils.js';

/* ---------------- Greeting ---------------- */

export function greeting({ name, dateLabel }) {
  const hour = new Date().getHours();
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return h(
    'section',
    { class: 'greeting', 'aria-labelledby': 'greeting-title' },
    h('p', { class: 'date' }, dateLabel),
    h('h1', { id: 'greeting-title' }, name ? `${part}, ${name}` : part),
    h('p', { class: 'subtitle' }, 'Small steps. Meaningful progress.'),
    // Decorative light-mode header illustration (spec §2: gradient banner
    // with mountains). Hidden in dark by CSS; aria-hidden + pointer-events
    // none so it never affects interaction or the a11y tree.
    h('div', {
      class: 'greeting-mountains',
      'aria-hidden': 'true',
      html:
        '<svg viewBox="0 0 320 96" fill="none" focusable="false">' +
        '<circle cx="258" cy="26" r="14" fill="#FB7185" fill-opacity="0.55"/>' +
        '<path d="M0 96 L64 44 L104 74 L156 30 L214 78 L268 52 L320 84 L320 96 Z" ' +
        'fill="#60A5FA" fill-opacity="0.35"/>' +
        '<path d="M0 96 L48 66 L96 88 L150 58 L206 90 L262 72 L320 92 L320 96 Z" ' +
        'fill="#7C5CFC" fill-opacity="0.28"/>' +
        '</svg>',
    })
  );
}

/* ---------------- Stat card ---------------- */

export function statCard({ label, value, small, meta, progress, tone }) {
  return h(
    'article',
    { class: 'stat-card' },
    // .stat-body (min-width:0, flex:1) keeps the text block inside the card.
    // Without this wrapper the <p>s are bare flex items and their min-content
    // width pushes them past the card on narrow (<=320px) screens.
    h(
      'div',
      { class: 'stat-body' },
      h('p', { class: 'stat-label' }, label),
      h('p', { class: 'stat-value' }, value, small ? h('small', {}, ` ${small}`) : null),
      meta ? h('p', { class: 'stat-meta' }, meta) : null,
      typeof progress === 'number'
        ? h(
            'div',
            {
              class: `progress ${tone || ''}`,
              role: 'progressbar',
              'aria-valuenow': String(Math.round(progress)),
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-label': label,
            },
            h('span', { style: { width: `${Math.min(100, Math.max(0, progress))}%` } })
          )
        : null
    )
  );
}

/* ---------------- Task item ---------------- */

const PRIORITY_TONE = { High: 'rose', Medium: 'amber', Low: '' };

export function taskItem(task, { onToggle, onOpen, showDate = true } = {}) {
  const done = task.status === 'done';
  const checklistDone = task.checklist.filter((c) => c.done).length;

  const check = h(
    'button',
    {
      class: 'task-check',
      role: 'checkbox',
      'aria-checked': String(done),
      'aria-label': `Mark “${task.title}” ${done ? 'incomplete' : 'complete'}`,
      onClick: (event) => {
        event.stopPropagation();
        onToggle?.(!done);
      },
    },
    h('span', { class: 'box' }, icon('check'))
  );

  const meta = [];
  if (task.startTime) {
    meta.push(
      h('span', {}, `${formatTime(`2000-01-01T${task.startTime}:00`)}${task.endTime ? `–${formatTime(`2000-01-01T${task.endTime}:00`)}` : ''}`)
    );
  } else if (showDate) {
    meta.push(h('span', {}, formatDateShort(task.date)));
  }
  if (task.priority && task.priority !== 'Medium') {
    meta.push(h('span', { class: `chip ${PRIORITY_TONE[task.priority] || ''}` }, task.priority));
  }
  if (task.checklist.length) {
    meta.push(h('span', { class: 'chip' }, `${checklistDone}/${task.checklist.length}`));
  }

  return h(
    'li',
    { class: `task-item ${done ? 'done' : ''}` },
    check,
    h(
      'div',
      { class: 'task-body' },
      onOpen
        ? h('button', { class: 'task-title as-button', onClick: onOpen }, task.title)
        : h('p', { class: 'task-title' }, task.title),
      meta.length ? h('div', { class: 'task-meta' }, meta) : null
    ),
    onOpen
      ? h(
          'button',
          { class: 'icon-btn bare', 'aria-label': `Edit “${task.title}”`, onClick: onOpen },
          icon('chevronRight')
        )
      : null
  );
}

/* ---------------- Goal item ---------------- */

const GOAL_TONES = ['', 'emerald', 'blue', 'amber'];
const GOAL_ICON = { active: 'target', long: 'flag' };

export function goalItem(goal, { onProgress, toneIndex = 0 } = {}) {
  const progress = Math.round(goal.progress);
  return h(
    'div',
    { class: 'goal-item' },
    h('div', { class: `goal-icon ${GOAL_TONES[toneIndex % GOAL_TONES.length]}` }, icon(GOAL_ICON[goal.kind] || 'target')),
    h(
      'div',
      { class: 'goal-body' },
      h('p', { class: 'goal-title' }, goal.title),
      h(
        'p',
        { class: 'goal-sub' },
        goal.target
          ? `${goal.current} of ${goal.target}${goal.unit ? ` ${goal.unit}` : ''}`
          : goal.note || (goal.kind === 'long' ? 'Long-term goal' : 'Active goal')
      ),
      h(
        'div',
        { class: 'goal-progress' },
        h(
          'div',
          {
            class: 'progress',
            role: 'progressbar',
            'aria-valuenow': String(progress),
            'aria-valuemin': '0',
            'aria-valuemax': '100',
            'aria-label': `${goal.title} progress`,
          },
          h('span', { style: { width: `${progress}%` } })
        ),
        h('span', { class: 'pct' }, `${progress}%`),
        onProgress
          ? h('button', { class: 'icon-btn bare', 'aria-label': `Update progress for “${goal.title}”`, onClick: onProgress }, icon('edit'))
          : null
      )
    )
  );
}

/* ---------------- Card wrapper ---------------- */

export function card({ title, actions, body, className = '' }) {
  return h(
    'section',
    { class: `card ${className}`.trim() },
    title
      ? h(
          'div',
          { class: 'card-header' },
          h('h2', {}, title),
          actions ? h('div', { class: 'card-actions' }, actions) : null
        )
      : null,
    body
  );
}

/* ---------------- Page header ---------------- */

export function pageHead({ title, sub, actions }) {
  return h(
    'div',
    { class: 'page-head' },
    h('div', {}, h('h1', { class: 'page-title' }, title), sub ? h('p', { class: 'page-sub' }, sub) : null),
    actions ? h('div', { class: 'card-actions' }, actions) : null
  );
}

/* ---------------- Focus timer panel ---------------- */

export function focusPanel(timerState, { onStart, onPause, onReset, compact = false } = {}) {
  const running = timerState.running;
  return h(
    'section',
    { class: 'focus-card', 'aria-labelledby': 'focus-heading' },
    h('h2', { id: 'focus-heading', class: 'sr-only' }, 'Focus timer'),
    h('p', { class: 'tagline' }, running ? 'Stay with it. One thing at a time.' : 'Start a focused work session'),
    h(
      'div',
      { class: 'focus-timer', style: { '--pct': String(Math.round(timerState.progress)) } },
      h(
        'div',
        { class: 'inner' },
        h('p', { class: 'label' }, timerState.finished ? 'Done' : running ? 'Focusing' : 'Ready'),
        h('p', { class: 'value' }, timerState.display)
      )
    ),
    h(
      'div',
      { class: 'focus-actions' },
      running
        ? h('button', { class: 'btn btn-secondary', onClick: onPause }, icon('pause'), 'Pause')
        : h(
            'button',
            { class: 'btn btn-primary', onClick: onStart, disabled: timerState.finished },
            icon('play'),
            timerState.finished ? 'Session complete' : timerState.remainingSec < timerState.durationMin * 60 ? 'Resume' : 'Start focus'
          ),
      compact ? null : h('button', { class: 'btn btn-ghost', onClick: onReset }, icon('reset'), 'Reset')
    )
  );
}

/* ---------------- Session row ---------------- */

export function sessionRow(session) {
  const date = new Date(session.startedAt);
  // A malformed timestamp degrades to an honest placeholder instead of
  // rendering browser text like "Invalid Date".
  const when = Number.isNaN(date.getTime())
    ? 'Time not recorded'
    : date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) +
      ' · ' +
      date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  // `div`, not `li`: the caller places this row inside its own list item.
  return h(
    'div',
    { class: 'session-item' },
    h('span', { class: 'session-icon' }, icon('focus')),
    h(
      'div',
      { class: 'session-main' },
      h('p', { class: 'session-title' }, session.note || 'Focus session'),
      h('p', { class: 'session-sub' }, when)
    ),
    h('span', { class: 'session-dur' }, formatDuration(session.minutes))
  );
}
