/**
 * Home screen — greeting, neutral stat row, today's tasks, active goals,
 * focus panel and the weekly focus chart. All values come from real stored
 * data (IndexedDB); when there is no data yet, honest empty states show.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { navigate, refresh } from '../core/router.js';
import { greeting, statCard, taskItem, goalItem, card, focusPanel } from '../ui/components.js';
import { emptyState, loadingState, errorState, toast } from '../ui/kit.js';
import { barChart } from '../ui/charts.js';
import { listTasks, toggleTask } from '../data/repositories.js';
import { listGoals } from '../data/repositories.js';
import { listSessions } from '../data/repositories.js';
import * as timer from '../features/focus/timer.js';
import { todayLabel, formatDateLong, formatDuration, startOfWeek, dayIndex, weekLabels } from '../core/utils.js';

export async function homeView() {
  const root = h('div', { class: 'page' });
  root.appendChild(loadingState('Loading your day…'));

  let disposeTimer = null;
  let disposed = false;

  async function render() {
    try {
      const [tasks, goals, sessions] = await Promise.all([listTasks(), listGoals(), listSessions()]);
      const today = todayLabel();
      const todayTasks = tasks.filter((t) => t.date === today);
      const doneToday = todayTasks.filter((t) => t.status === 'done').length;
      const activeGoals = goals.filter((g) => !g.done && g.kind === 'active').slice(0, 3);

      const weekStart = startOfWeek(today);
      const weekMinutes = sessions
        .filter((s) => {
          const label = s.startedAt.slice(0, 10);
          return label >= weekStart && label <= today;
        })
        .reduce((sum, s) => sum + s.minutes, 0);

      const todayMinutes = sessions
        .filter((s) => s.startedAt.slice(0, 10) === today)
        .reduce((sum, s) => sum + s.minutes, 0);

      const weekData = weekLabels().map((label, index) => ({
        label,
        value: sessions
          .filter((s) => {
            const d = s.startedAt.slice(0, 10);
            return d >= weekStart && dayIndex(d) === index;
          })
          .reduce((sum, s) => sum + s.minutes, 0),
      }));

      const completion = todayTasks.length ? (doneToday / todayTasks.length) * 100 : 0;

      root.replaceChildren();

      root.appendChild(
        greeting({ name: '', dateLabel: formatDateLong(today) })
      );

      root.appendChild(
        h(
          'div',
          { class: 'stat-row', 'aria-label': 'Today overview' },
          statCard({
            label: 'Tasks done',
            value: String(doneToday),
            small: `/ ${todayTasks.length}`,
            meta: todayTasks.length ? `${Math.round(completion)}% completion` : 'Nothing scheduled yet',
            progress: completion,
            tone: 'emerald',
          }),
          statCard({
            label: 'Focus today',
            value: formatDuration(todayMinutes),
            meta: todayMinutes ? 'focused so far' : 'No focus yet',
          }),
          statCard({
            label: 'This week',
            value: formatDuration(weekMinutes),
            meta: 'focused so far',
          }),
          statCard({
            label: 'Sessions',
            value: String(sessions.filter((s) => s.startedAt.slice(0, 10) >= weekStart).length),
            meta: 'this week',
          })
        )
      );

      const contentGrid = h('div', { class: 'content-grid' });

      /* ---- Left column: tasks + goals ---- */
      const left = h('div', {});

      const todayList = h('ul', { class: 'task-list', role: 'list' });
      if (!todayTasks.length) {
        todayList.appendChild(
          h('li', {}, emptyState({
            iconName: 'tasks',
            title: 'No tasks today',
            hint: 'Add one task for today, or plan the week ahead.',
            actionLabel: 'Add a task',
            onAction: () => navigate('tasks'),
          }))
        );
      } else {
        for (const task of todayTasks.slice(0, 5)) {
          todayList.appendChild(
            taskItem(task, {
              showDate: false,
              onToggle: async (done) => {
                try {
                  await toggleTask(task.id, done);
                  toast(done ? 'Task completed' : 'Task reopened', { type: 'success' });
                  refresh();
                } catch (err) {
                  console.error(err);
                  toast('Could not update the task', { type: 'error' });
                }
              },
              onOpen: () => navigate('tasks'),
            })
          );
        }
      }

      left.appendChild(
        card({
          title: "Today's tasks",
          actions: [
            h('button', { class: 'text-link', onClick: () => navigate('tasks') }, 'View all'),
            h('button', { class: 'icon-btn bare', 'aria-label': 'Add task', onClick: () => navigate('tasks') }, icon('plus')),
          ],
          body: todayList,
        })
      );

      const goalList = h('div', { class: 'goal-list' });
      if (!activeGoals.length) {
        goalList.appendChild(
          emptyState({
            iconName: 'goals',
            title: 'No active goals',
            hint: 'Goals give your days direction. Add one when you are ready.',
            actionLabel: 'Add a goal',
            onAction: () => navigate('goals'),
          })
        );
      } else {
        activeGoals.forEach((goal, index) => {
          goalList.appendChild(goalItem(goal, { toneIndex: index }));
        });
      }

      left.appendChild(card({ title: 'Active goals', body: goalList }));
      contentGrid.appendChild(left);

      /* ---- Right column: focus + week chart ---- */
      const right = h('div', {});

      right.appendChild(
        focusPanel(timer.snapshot(), {
          onStart: () => { timer.start(); },
          onPause: () => { timer.pause(); },
          // Re-render: the subscriber only reacts to running/finished changes,
          // so without this the primary button kept saying "Resume" after a
          // reset (focus view already re-rendered here).
          onReset: () => { timer.reset(); render(); },
        })
      );

      right.appendChild(
        card({
          title: 'Focus this week',
          actions: [h('span', { class: 'chart-meta' }, formatDuration(weekMinutes))],
          body: h(
            'div',
            {},
            barChart(weekData, {
              ariaLabel: `Focus minutes by day this week. Total ${Math.round(weekMinutes)} minutes.`,
              valueFormatter: (v) => `${v}m`,
            }),
            h('div', { class: 'legend' },
              h('span', { class: 'legend-item' },
                h('span', { class: 'legend-swatch', style: { background: 'var(--chart-1)' } }),
                'Focus minutes per day'))
          ),
        })
      );

      contentGrid.appendChild(right);
      root.appendChild(contentGrid);

      /* ---- Timer live updates ---- */
      if (disposed) return;
      if (disposeTimer) disposeTimer();
      disposeTimer = timer.subscribe((state) => {
        if (disposed) return;
        const ring = root.querySelector('.focus-timer');
        if (!ring) return;
        ring.style.setProperty('--pct', String(Math.round(state.progress)));
        const value = ring.querySelector('.value');
        if (value) value.textContent = state.display;
        const label = ring.querySelector('.label');
        if (label) label.textContent = state.finished ? 'Done' : state.running ? 'Focusing' : 'Ready';

        // Keep the buttons truthful. The panel is built once per render, so
        // without this the Start/Pause/End buttons stopped matching the timer
        // after the first state change (the primary button went inert).
        // Re-rendering also refreshes the focus stats once a session completes.
        const primary = root.querySelector('.focus-actions .btn-primary')
          || root.querySelector('.focus-actions .btn-secondary');
        const text = primary ? primary.textContent.trim() : '';
        const showsPause = text === 'Pause';
        const showsComplete = text === 'Session complete';
        if (
          (state.running && !showsPause) ||
          (!state.running && showsPause) ||
          (state.finished && !showsComplete) ||
          (!state.finished && showsComplete)
        ) {
          render();
        }
      });
    } catch (err) {
      console.error('home render failed', err);
      root.replaceChildren(errorState('Your saved data could not be read.', render));
    }
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
