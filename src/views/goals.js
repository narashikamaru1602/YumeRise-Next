/**
 * Goals screen — active and long-term goals with progress editing.
 * Progress is user-adjusted (0-100% or a numeric target), never fabricated.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { goalItem, pageHead, card } from '../ui/components.js';
import { emptyState, loadingState, errorState, toast, openDialog, field, textInput, segmented } from '../ui/kit.js';
import { listGoals, addGoal, updateGoal, deleteGoal } from '../data/repositories.js';

export async function goalsView() {
  const root = h('div', { class: 'page' });
  let goals = [];

  async function render() {
    root.replaceChildren(loadingState('Loading goals…'));
    try {
      goals = await listGoals();
    } catch (err) {
      console.error('goals load failed', err);
      root.replaceChildren(errorState('Goals could not be read from local storage.', render));
      return;
    }

    root.replaceChildren();
    const active = goals.filter((g) => g.kind === 'active' && !g.done);
    const longTerm = goals.filter((g) => g.kind === 'long' && !g.done);

    root.appendChild(
      pageHead({
        title: 'Goals',
        sub: `${active.length} active · ${longTerm.length} long-term`,
        actions: [h('button', { class: 'btn btn-primary', onClick: () => openGoalDialog() }, icon('plus'), 'New goal')],
      })
    );

    if (!goals.length) {
      root.appendChild(
        emptyState({
          iconName: 'goals',
          title: 'No goals yet',
          hint: 'A goal is something you are moving toward. Add one when it feels right.',
          actionLabel: 'Add a goal',
          onAction: () => openGoalDialog(),
        })
      );
      return;
    }

    if (active.length) {
      const list = h('div', { class: 'goal-list' });
      active.forEach((goal, index) => {
        list.appendChild(goalItem(goal, { toneIndex: index, onProgress: () => openProgressDialog(goal) }));
      });
      root.appendChild(card({ title: 'Active goals', body: list, actions: [h('button', { class: 'icon-btn bare', 'aria-label': 'Add goal', onClick: () => openGoalDialog() }, icon('plus'))] }));
    }

    if (longTerm.length) {
      const list = h('div', { class: 'goal-list' });
      longTerm.forEach((goal, index) => {
        list.appendChild(goalItem(goal, { toneIndex: index + 1, onProgress: () => openProgressDialog(goal) }));
      });
      root.appendChild(card({ title: 'Long-term goals', body: list }));
    }

    // Completed goals, if any
    const done = goals.filter((g) => g.done);
    if (done.length) {
      const list = h('div', { class: 'goal-list' });
      done.forEach((goal, index) => list.appendChild(goalItem(goal, { toneIndex: index + 2 })));
      root.appendChild(card({ title: 'Completed', body: list }));
    }
  }

  function openGoalDialog(goal = null) {
    const isEdit = Boolean(goal);
    const title = textInput({ value: goal?.title || '', placeholder: 'What are you working toward?', required: true, maxlength: '200' });
    const kind = segmented(
      [
        { value: 'active', label: 'Active' },
        { value: 'long', label: 'Long-term' },
      ],
      { value: goal?.kind || 'active', onChange: () => {}, label: 'Goal type' }
    );
    const note = textInput({ value: goal?.note || '', placeholder: 'Optional note', maxlength: '300' });

    const content = h('div', {}, field('Title', title), h('div', { class: 'field' }, h('label', {}, 'Type'), kind), field('Note', note));

    // Named so the async handlers can disable it (double-tap guard).
    const save = h(
      'button',
      {
        class: 'btn btn-primary',
        onClick: async () => {
          const trimmed = title.value.trim();
          if (!trimmed) {
            title.focus();
            toast('A title is required', { type: 'error' });
            return;
          }
          const kindValue = kind.querySelector('[aria-checked="true"]')?.textContent?.trim() === 'Long-term' ? 'long' : 'active';
          save.disabled = true;
          try {
            if (isEdit) {
              await updateGoal(goal.id, { title: trimmed, kind: kindValue, note: note.value.trim() });
              toast('Goal saved', { type: 'success' });
            } else {
              await addGoal({ title: trimmed, kind: kindValue, note: note.value.trim() });
              toast('Goal added', { type: 'success' });
            }
            dialog.close();
            await render();
            focusHeading();
          } catch (err) {
            console.error(err);
            toast('Could not save the goal', { type: 'error' });
            save.disabled = false;
          }
        },
      },
      isEdit ? 'Save changes' : 'Add goal'
    );

    const actions = h(
      'div',
      { class: 'dialog-actions' },
      isEdit
        ? h(
            'button',
            {
              class: 'btn btn-danger',
              onClick: async () => {
                if (!confirm('Delete this goal?')) return;
                try {
                  await deleteGoal(goal.id);
                  toast('Goal deleted', { type: 'success' });
                  dialog.close();
                  await render();
                  focusHeading();
                } catch (err) {
                  console.error(err);
                  toast('Could not delete the goal', { type: 'error' });
                }
              },
            },
            icon('trash'),
            'Delete'
          )
        : h('button', { class: 'btn btn-secondary', onClick: () => dialog.close() }, 'Cancel'),
      save
    );

    const dialog = openDialog({ title: isEdit ? 'Edit goal' : 'New goal', content, actions });
  }

  /* After a dialog closes and the page re-renders, the opener element is gone
     and focus silently falls to <body>. Move it to the page heading instead. */
  function focusHeading() {
    const heading = root.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  function openProgressDialog(goal) {
    const usesTarget = Boolean(goal.target);
    // Defensive: never hand a non-numeric progress to a range input.
    const initialProgress = Math.min(100, Math.max(0, Math.round(Number(goal.progress) || 0)));
    const current = h('input', { class: 'input', type: 'number', min: '0', max: usesTarget ? String(goal.target) : '100', value: String(Number(goal.current) || 0) });
    const sliderId = `goal-progress-${goal.id}`;
    const slider = h('input', {
      id: sliderId,
      class: 'input',
      type: 'range',
      min: '0',
      max: '100',
      step: '5',
      value: String(initialProgress),
      'aria-describedby': `${sliderId}-readout`,
      style: { padding: '12px 0' },
    });
    const readout = h('span', { id: `${sliderId}-readout`, class: 'chip accent' }, `${slider.value}%`);
    slider.addEventListener('input', () => {
      readout.textContent = `${slider.value}%`;
      // With a target, the slider is a real control: it drives "current".
      if (usesTarget && goal.target > 0) {
        current.value = String(Math.round((Number(slider.value) / 100) * goal.target));
      }
    });
    current.addEventListener('input', () => {
      if (!usesTarget || !(goal.target > 0)) return;
      const pct = Math.round(((Number(current.value) || 0) / goal.target) * 100);
      slider.value = String(Math.min(100, Math.max(0, pct)));
      readout.textContent = `${slider.value}%`;
    });

    const content = h(
      'div',
      {},
      usesTarget
        ? field(`Current of ${goal.target}${goal.unit ? ` ${goal.unit}` : ''}`, current)
        : null,
      h(
        'div',
        { class: 'field' },
        // Real label bound to the range input (label[for] on a wrapper div
        // never associated anything).
        h('label', { for: sliderId }, 'Progress'),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 'var(--space-3)' } }, slider, readout)
      )
    );

    const save = h(
      'button',
      {
        class: 'btn btn-primary',
        onClick: async () => {
          save.disabled = true;
          try {
            const patch = { progress: Number(slider.value) };
            if (usesTarget) {
              patch.current = Math.min(goal.target, Math.max(0, Number(current.value) || 0));
              patch.progress = goal.target ? Math.round((patch.current / goal.target) * 100) : patch.progress;
            }
            await updateGoal(goal.id, patch);
            toast('Progress updated', { type: 'success' });
            dialog.close();
            await render();
            focusHeading();
          } catch (err) {
            console.error(err);
            toast('Could not update progress', { type: 'error' });
            save.disabled = false;
          }
        },
      },
      'Save'
    );

    const actions = h(
      'div',
      { class: 'dialog-actions' },
      h('button', { class: 'btn btn-secondary', onClick: () => dialog.close() }, 'Cancel'),
      save
    );

    const dialog = openDialog({ title: `Update “${goal.title}”`, content, actions });
  }

  await render();
  return { element: root, dispose: () => {} };
}
