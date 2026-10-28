/**
 * Tasks screen — full list with filters, create/edit dialog (title, date,
 * times, priority, description, checklist), completion toggle and delete.
 * All mutations persist to IndexedDB; the list always reflects stored data.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { taskItem, pageHead, card } from '../ui/components.js';
import { emptyState, loadingState, errorState, toast, openDialog, field, textInput, selectInput } from '../ui/kit.js';
import {
  listTasks, addTask, saveTask, toggleTask, deleteTask, PRIORITIES,
} from '../data/repositories.js';
import { todayLabel, addDaysLabel, uid } from '../core/utils.js';

const FILTERS = [
  { key: 'today', label: 'Today' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'all', label: 'All' },
  { key: 'done', label: 'Done' },
];

export async function tasksView() {
  const root = h('div', { class: 'page' });
  let filter = 'today';
  let tasks = [];

  function filtered() {
    const today = todayLabel();
    switch (filter) {
      case 'today': return tasks.filter((t) => t.date === today);
      case 'upcoming': return tasks.filter((t) => t.date > today && t.status !== 'done');
      case 'done': return tasks.filter((t) => t.status === 'done');
      default: return tasks;
    }
  }

  async function render() {
    root.replaceChildren(loadingState('Loading tasks…'));
    try {
      tasks = await listTasks();
    } catch (err) {
      console.error('tasks load failed', err);
      root.replaceChildren(errorState('Tasks could not be read from local storage.', render));
      return;
    }

    root.replaceChildren();

    root.appendChild(
      pageHead({
        title: 'Tasks',
        sub: `${tasks.filter((t) => t.status !== 'done').length} open · ${tasks.filter((t) => t.status === 'done').length} done`,
        actions: [
          h('button', { class: 'btn btn-primary', onClick: () => openTaskDialog() }, icon('plus'), 'New task'),
        ],
      })
    );

    const bar = h('div', { class: 'filter-bar', role: 'group', 'aria-label': 'Filter tasks' });
    for (const f of FILTERS) {
      bar.appendChild(
        h(
          'button',
          {
            class: 'filter-chip',
            'aria-pressed': String(filter === f.key),
            onClick: () => {
              filter = f.key;
              render();
            },
          },
          f.label
        )
      );
    }
    root.appendChild(bar);

    const list = filtered();
    const body = h('div', {});

    if (!list.length) {
      body.appendChild(
        emptyState({
          iconName: 'tasks',
          title: filter === 'done' ? 'Nothing completed yet' : 'No tasks here',
          hint:
            filter === 'today'
              ? 'Add your first task for today. Small and specific works best.'
              : 'Tasks you add will appear here.',
          actionLabel: filter === 'done' ? null : 'Add a task',
          onAction: () => openTaskDialog(),
        })
      );
    } else {
      const ul = h('ul', { class: 'task-list', role: 'list' });
      for (const task of list) {
        ul.appendChild(
          taskItem(task, {
            onToggle: async (done) => {
              try {
                await toggleTask(task.id, done);
                toast(done ? 'Task completed' : 'Task reopened', { type: 'success' });
                render();
              } catch (err) {
                console.error(err);
                toast('Could not update the task', { type: 'error' });
              }
            },
            onOpen: () => openTaskDialog(task),
          })
        );
      }
      body.appendChild(card({ body: ul }));
    }

    root.appendChild(body);
  }

  /* After a dialog closes and the page re-renders, the opener element is gone
     and focus silently falls to <body>. Move it to the page heading instead. */
  function focusHeading() {
    const heading = root.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  /* ---------------- Create / edit dialog ---------------- */

  function openTaskDialog(task = null) {
    const isEdit = Boolean(task);
    const title = textInput({ value: task?.title || '', placeholder: 'What needs your attention?', required: true, maxlength: '200' });
    const date = h('input', { class: 'input', type: 'date', value: task?.date || todayLabel() });
    const start = h('input', { class: 'input', type: 'time', value: task?.startTime || '' });
    const end = h('input', { class: 'input', type: 'time', value: task?.endTime || '' });
    const priority = selectInput(
      PRIORITIES.map((p) => ({ value: p, label: p, selected: (task?.priority || 'Medium') === p }))
    );
    const description = h('textarea', { class: 'textarea', placeholder: 'Optional context', maxlength: '1000' });
    description.value = task?.description || '';

    const checklistRows = h('div', { class: 'checklist-rows' });

    function addChecklistRow(item = { id: null, text: '', done: false }) {
      const input = textInput({ value: item.text, placeholder: 'Checklist item', maxlength: '160' });
      input.value = item.text;
      const row = h(
        'div',
        { class: 'checklist-row' },
        input,
        h(
          'button',
          {
            class: 'icon-btn bare',
            'aria-label': 'Remove checklist item',
            onClick: () => row.remove(),
          },
          icon('trash')
        )
      );
      row._input = input;
      // Keep the stored record this row came from, so saving the dialog can
      // preserve its id and done state (previously both were silently lost).
      row._item = item;
      checklistRows.appendChild(row);
    }
    for (const item of task?.checklist || []) addChecklistRow(item);

    const content = h(
      'div',
      {},
      field('Title', title),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' } },
        field('Date', date),
        field('Priority', priority)
      ),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' } },
        field('Start time (optional)', start, { hint: 'Leave blank for any time' }),
        field('End time (optional)', end)
      ),
      field('Description', description),
      h(
        'div',
        { class: 'switch-row', style: { justifyContent: 'space-between' } },
        h('span', { class: 'switch-title', style: { fontSize: 'var(--text-sm)' } }, 'Checklist'),
        h('button', { class: 'btn btn-soft', onClick: () => addChecklistRow() }, icon('plus'), 'Add item')
      ),
      checklistRows
    );

    const cancel = h('button', { class: 'btn btn-secondary', onClick: () => dialog.close() }, 'Cancel');
    const save = h(
      'button',
      { class: 'btn btn-primary', onClick: onSubmit },
      isEdit ? 'Save changes' : 'Add task'
    );

    const dialog = openDialog({
      title: isEdit ? 'Edit task' : 'New task',
      content,
      actions: h('div', { class: 'dialog-actions' }, cancel, save),
    });

    async function onSubmit() {
      const trimmed = title.value.trim();
      if (!trimmed) {
        title.focus();
        toast('A title is required', { type: 'error' });
        return;
      }
      const items = [...checklistRows.querySelectorAll('.checklist-row')]
        .map((row) => {
          const original = row._item;
          return {
            // Rows that came from the stored task keep their id and done state;
            // rows added in this dialog get a fresh id and start unchecked.
            id: original?.id ?? uid(),
            text: row.querySelector('input').value.trim(),
            done: original ? original.done === true : false,
          };
        })
        .filter((item) => item.text);

      save.disabled = true;
      try {
        const payload = {
          title: trimmed,
          date: date.value || todayLabel(),
          startTime: start.value,
          endTime: end.value,
          priority: priority.value,
          description: description.value,
          checklist: items,
        };
        if (isEdit) {
          await saveTask({ ...task, ...payload });
          toast('Task saved', { type: 'success' });
        } else {
          await addTask(payload);
          toast('Task added', { type: 'success' });
        }
        dialog.close();
        await render();
        focusHeading();
      } catch (err) {
        console.error(err);
        toast('Could not save the task', { type: 'error' });
        save.disabled = false;
      }
    }
  }

  await render();
  return { element: root, dispose: () => {} };
}
