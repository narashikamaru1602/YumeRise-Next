/**
 * Focus screen — timer with presets, live ring, session log from real data,
 * and a weekly summary. The timer itself is a module singleton, so starting
 * a session here and navigating away keeps it running.
 */

import { h } from '../core/dom.js';
import { pageHead, card, focusPanel, sessionRow } from '../ui/components.js';
import { emptyState, loadingState, errorState, toast } from '../ui/kit.js';
import { barChart } from '../ui/charts.js';
import { listSessions, deleteSession } from '../data/repositories.js';
import * as timer from '../features/focus/timer.js';
import { todayLabel, formatDuration, startOfWeek, dayIndex, weekLabels } from '../core/utils.js';

export async function focusView() {
  const root = h('div', { class: 'page' });
  let disposeTimer = null;
  let disposed = false;

  async function render() {
    root.replaceChildren(loadingState('Loading focus data…'));

    let sessions;
    let today;
    let weekStart;
    let weekSessions;
    let weekMinutes;
    let todayMinutes;
    let weekData;
    try {
      sessions = await listSessions();

      /* A malformed stored record must degrade gracefully (kept in the log,
         left out of date buckets) instead of crashing the whole view. */
      const dayOf = (s) =>
        typeof s.startedAt === 'string' && s.startedAt.length >= 10
          ? s.startedAt.slice(0, 10)
          : null;
      const minOf = (s) => (Number.isFinite(Number(s.minutes)) ? Math.max(0, Number(s.minutes)) : 0);

      today = todayLabel();
      weekStart = startOfWeek(today);
      weekSessions = sessions.filter((s) => {
        const d = dayOf(s);
        return d !== null && d >= weekStart;
      });
      weekMinutes = weekSessions.reduce((sum, s) => sum + minOf(s), 0);
      todayMinutes = sessions
        .filter((s) => dayOf(s) === today)
        .reduce((sum, s) => sum + minOf(s), 0);

      weekData = weekLabels().map((label, index) => ({
        label,
        value: sessions
          .filter((s) => {
            const d = dayOf(s);
            return d !== null && d >= weekStart && dayIndex(d) === index;
          })
          .reduce((sum, s) => sum + minOf(s), 0),
      }));
    } catch (err) {
      console.error('sessions load failed', err);
      root.replaceChildren(errorState('Focus sessions could not be read.', render));
      return;
    }

    root.replaceChildren();

    root.appendChild(
      pageHead({
        title: 'Focus',
        sub: `${formatDuration(todayMinutes)} today · ${formatDuration(weekMinutes)} this week`,
      })
    );

    const grid = h('div', { class: 'focus-view-grid' });

    /* ---- Timer column ---- */
    const left = h('div', {});

    const snap = timer.snapshot();
    const inProgress = snap.inProgress;
    const isPreset = timer.PRESETS.includes(snap.durationMin);

    // One exit for every duration change: the timer refuses mid-session
    // changes itself, but the controls are also disabled while a session is
    // in progress so elapsed time can never be discarded by a stray tap.
    const applyDuration = (value) => {
      if (!timer.setDuration(value)) {
        toast('Finish or reset the session before changing its length.', { type: 'info' });
      }
      render();
    };

    const customInput = h('input', {
      class: 'preset-custom',
      type: 'number',
      min: String(timer.MIN_DURATION_MIN),
      max: String(timer.MAX_DURATION_MIN),
      step: '1',
      inputMode: 'numeric',
      placeholder: 'Custom',
      'aria-label': `Custom session length in minutes (${timer.MIN_DURATION_MIN} to ${timer.MAX_DURATION_MIN})`,
      // Show the custom length only when it is not one of the presets;
      // otherwise the placeholder keeps the row uncluttered.
      ...(isPreset ? {} : { value: String(snap.durationMin) }),
      ...(inProgress
        ? { disabled: true, title: 'Finish or reset the session to change its length' }
        : {}),
      onChange: (event) => {
        const raw = String(event.target.value).trim();
        if (raw === '') { render(); return; } // emptied: keep the current length
        const minutes = Number(raw);
        if (!Number.isInteger(minutes) || minutes < timer.MIN_DURATION_MIN || minutes > timer.MAX_DURATION_MIN) {
          // Reject loudly rather than guess: no silent clamping of typed input.
          toast(`Choose a session length between ${timer.MIN_DURATION_MIN} and ${timer.MAX_DURATION_MIN} minutes.`, { type: 'error' });
          render();
          return;
        }
        applyDuration(minutes);
      },
    });

    left.appendChild(
      h(
        'div',
        { class: 'preset-row', role: 'group', 'aria-label': 'Session length' },
        ...timer.PRESETS.map((min) =>
          h(
            'button',
            {
              class: 'preset',
              'aria-pressed': String(snap.durationMin === min),
              ...(inProgress ? { disabled: true, title: 'Finish or reset the session to change its length' } : {}),
              onClick: () => applyDuration(min),
            },
            `${min} min`
          )
        ),
        customInput
      )
    );

    if (inProgress) {
      left.appendChild(
        h('p', { class: 'preset-note' }, 'Finish or reset the session to change its length.')
      );
    }

    left.appendChild(
      focusPanel(timer.snapshot(), {
        onStart: () => timer.start(),
        onPause: () => timer.pause(),
        onReset: () => { timer.reset(); render(); },
      })
    );

    left.appendChild(
      h(
        'div',
        { class: 'card', style: { textAlign: 'center' } },
        h(
          'p',
          { style: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' } },
          'Sessions are saved on this device as they finish. Ending early records the whole minutes you actually focused.'
        ),
        h(
          'div',
          { style: { marginTop: 'var(--space-3)' } },
          h(
            'button',
            {
              class: 'btn btn-ghost',
              onClick: async () => {
                try {
                  const minutes = await timer.endEarly();
                  toast(minutes ? `Recorded ${formatDuration(minutes)}` : 'Session too short to record', {
                    type: minutes ? 'success' : 'info',
                  });
                } catch (err) {
                  // The write failed — say so; never claim a record that was
                  // not saved.
                  console.error(err);
                  toast('Could not save the session', { type: 'error' });
                }
                render();
              },
            },
            'End session early'
          )
        )
      )
    );

    grid.appendChild(left);

    /* ---- Log column ---- */
    const right = h('div', {});

    right.appendChild(
      card({
        title: 'This week',
        body: barChart(weekData, {
          ariaLabel: `Focus minutes by day. Total ${Math.round(weekMinutes)} minutes this week.`,
          valueFormatter: (v) => `${v}m`,
        }),
      })
    );

    const logList = h('ul', { class: 'row-list', role: 'list' });
    if (!sessions.length) {
      logList.appendChild(
        h('li', {}, emptyState({
          iconName: 'focus',
          title: 'No sessions yet',
          hint: 'Finish a focus session and it will be recorded here.',
        }))
      );
    } else {
      for (const session of sessions.slice(0, 12)) {
        const row = h(
          'li',
          {},
          sessionRow(session),
          h(
            'div',
            { style: { textAlign: 'right', marginTop: '-28px' } },
            h(
              'button',
              {
                class: 'icon-btn bare',
                'aria-label': `Delete ${formatDuration(session.minutes)} session`,
                onClick: async () => {
                  try {
                    await deleteSession(session.id);
                    toast('Session removed', { type: 'success' });
                    render();
                  } catch (err) {
                    console.error(err);
                    toast('Could not remove the session', { type: 'error' });
                  }
                },
              },
              (function () {
                const span = document.createElement('span');
                span.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/></svg>';
                span.setAttribute('aria-hidden', 'true');
                return span.firstElementChild;
              })()
            )
          )
        );
        logList.appendChild(row);
      }
    }

    right.appendChild(card({ title: 'Session log', body: logList }));
    grid.appendChild(right);
    root.appendChild(grid);

    if (disposed) return;
    if (disposeTimer) disposeTimer();
    let seenRecorded = timer.snapshot().recordedSeq;
    disposeTimer = timer.subscribe((state) => {
      if (disposed) return;
      const ring = root.querySelector('.focus-timer');
      if (!ring) return;
      ring.style.setProperty('--pct', String(Math.round(state.progress)));
      const value = ring.querySelector('.value');
      if (value) value.textContent = state.display;
      const label = ring.querySelector('.label');
      if (label) label.textContent = state.finished ? 'Done' : state.running ? 'Focusing' : 'Ready';

      const primary = root.querySelector('.focus-actions .btn-primary, .focus-actions .btn-secondary');
      if (!primary) return;
      const text = primary.textContent.trim();
      const showsPause = text === 'Pause';
      const showsComplete = text === 'Session complete';
      const shapeChanged =
        (state.running && !showsPause) ||
        (!state.running && showsPause) ||
        (state.finished && !showsComplete) ||
        (!state.finished && showsComplete);
      // Re-render when the controls no longer match the timer, or when a
      // session has just been persisted (so the log and stats include it).
      const dataChanged = state.recordedSeq !== seenRecorded;
      if (dataChanged) seenRecorded = state.recordedSeq;
      if (shapeChanged || dataChanged) render();
    });
  }

  await render();
  return {
    element: root,
    dispose: () => {
      disposed = true;
      if (disposeTimer) disposeTimer();
    },
  };
}
