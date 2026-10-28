/**
 * Plan screen — a day timeline of time blocks with day navigation.
 * Blocks are real stored records; the view always reads from IndexedDB.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHead, card } from '../ui/components.js';
import { emptyState, loadingState, errorState, toast, openDialog, field, textInput } from '../ui/kit.js';
import { listBlocks, addBlock, deleteBlock } from '../data/repositories.js';
import { todayLabel, addDaysLabel, formatDateLong, formatTime } from '../core/utils.js';
import { openDailyPlanner } from '../features/schedule/planner.js';

export async function planView() {
  const root = h('div', { class: 'page' });
  let date = todayLabel();

  async function render() {
    root.replaceChildren(loadingState('Loading your plan…'));

    let blocks;
    try {
      blocks = await listBlocks();
    } catch (err) {
      console.error('blocks load failed', err);
      root.replaceChildren(errorState('Your plan could not be read.', render));
      return;
    }

    const dayBlocks = blocks.filter((b) => b.date === date);

    root.replaceChildren();
    root.appendChild(
      pageHead({
        title: 'Plan',
        sub: dayBlocks.length ? `${dayBlocks.length} block${dayBlocks.length === 1 ? '' : 's'} planned` : 'Nothing planned yet',
      })
    );

    const isToday = date === todayLabel();
    root.appendChild(
      h(
        'div',
        { class: 'plan-daybar' },
        h(
          'button',
          { class: 'icon-btn', 'aria-label': 'Previous day', onClick: () => { date = addDaysLabel(date, -1); renderRefocus('Previous day'); } },
          icon('chevronLeft')
        ),
        h(
          'div',
          { style: { textAlign: 'center' } },
          h('p', { class: 'plan-date' }, isToday ? 'Today' : formatDateLong(date)),
          // Full date subtitle only under "Today" — otherwise it repeated the
          // identical string that the line above already shows.
          h('p', { style: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' } }, isToday ? formatDateLong(date) : null)
        ),
        h(
          'button',
          { class: 'icon-btn', 'aria-label': 'Next day', onClick: () => { date = addDaysLabel(date, 1); renderRefocus('Next day'); } },
          icon('chevronRight')
        )
      )
    );

    if (!isToday) {
      root.appendChild(
        h(
          'div',
          { style: { textAlign: 'center', marginBottom: 'var(--space-4)' } },
          h('button', { class: 'btn btn-soft', 'aria-label': 'Back to today', onClick: () => { date = todayLabel(); renderRefocus('Back to today'); } }, 'Back to today')
        )
      );
    }

    if (!dayBlocks.length) {
      root.appendChild(
        emptyState({
          iconName: 'plan',
          title: 'No blocks for this day',
          hint: 'Time blocks give your day shape. Add one to start planning.',
          actionLabel: 'Add a block',
          onAction: () => openBlockDialog(),
        })
      );
    } else {
      const timeline = h('div', { class: 'timeline' });
      for (const block of dayBlocks) {
        const start = block.startTime ? formatTime(`2000-01-01T${block.startTime}:00`) : '';
        timeline.appendChild(
          h(
            'div',
            { class: 'timeline-block' },
            h(
              'div',
              { class: 'block-card' },
              h('span', { class: 'block-time' }, start || '—'),
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h('p', { class: 'block-title' }, block.title),
                block.endTime
                  ? h('p', { class: 'block-sub' }, `until ${formatTime(`2000-01-01T${block.endTime}:00`)}`)
                  : null
              ),
              h(
                'button',
                {
                  class: 'icon-btn bare',
                  'aria-label': `Remove “${block.title}”`,
                  onClick: async () => {
                    try {
                      await deleteBlock(block.id);
                      toast('Block removed', { type: 'success' });
                      await render();
                      focusHeading(); // the remove button was just replaced
                    } catch (err) {
                      console.error(err);
                      toast('Could not remove the block', { type: 'error' });
                    }
                  },
                },
                icon('trash')
              )
            )
          )
        );
      }
      root.appendChild(card({ body: timeline }));
    }

    root.appendChild(
      h(
        'div',
        {
          style: {
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--space-2)',
            justifyContent: 'center',
            marginTop: 'var(--space-4)',
          },
        },
        h(
          'button',
          {
            class: 'btn btn-secondary',
            type: 'button',
            'aria-label': 'Open daily planner',
            onClick: () =>
              openDailyPlanner({
                date,
                onSaved: async () => {
                  await render();
                  focusHeading();
                },
              }),
          },
          icon('spark'),
          'Daily planner'
        ),
        h('button', { class: 'btn btn-primary', type: 'button', onClick: () => openBlockDialog() }, icon('plus'), 'Add block')
      )
    );
  }

  /* After a dialog closes and the page re-renders, the opener element is gone
     and focus silently falls to <body>. Move it to the page heading instead. */
  function focusHeading() {
    const heading = root.querySelector('h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  /* Re-render and return focus to a fixed-label control: the render replaces
     the node that had focus, which would otherwise drop keyboard focus to
     <body> on every day-step. */
  async function renderRefocus(label) {
    await render();
    const btn = root.querySelector(`[aria-label="${label}"]`);
    if (btn) btn.focus();
  }

  function openBlockDialog() {
    const title = textInput({ placeholder: 'What is this block for?', required: true, maxlength: '160' });
    const start = h('input', { class: 'input', type: 'time', value: '09:00' });
    const end = h('input', { class: 'input', type: 'time' });

    const content = h(
      'div',
      {},
      field('Title', title),
      h(
        'div',
        { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' } },
        field('Start', start),
        field('End (optional)', end)
      ),
      h('p', { class: 'hint', style: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' } }, `Adding to ${date === todayLabel() ? 'today' : formatDateLong(date)}`)
    );

    // Declared before the dialog so the handler can disable it while saving.
    const saveBlock = h(
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
          // Disable while saving: a double-tap used to add the block twice.
          saveBlock.disabled = true;
          try {
            await addBlock({ title: trimmed, date, startTime: start.value || '09:00', endTime: end.value });
            toast('Block added', { type: 'success' });
            dialog.close();
            await render();
            focusHeading();
          } catch (err) {
            console.error(err);
            toast('Could not add the block', { type: 'error' });
            saveBlock.disabled = false;
          }
        },
      },
      'Add block'
    );

    const dialog = openDialog({
      title: 'New time block',
      content,
      actions: h(
        'div',
        { class: 'dialog-actions' },
        h('button', { class: 'btn btn-secondary', onClick: () => dialog.close() }, 'Cancel'),
        saveBlock
      ),
    });
  }

  await render();
  return { element: root, dispose: () => {} };
}
