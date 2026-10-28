/**
 * Daily Planner dialog — generate, review, edit, save, or download a day schedule.
 */

import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog, toast, field, textInput, selectInput } from '../../ui/kit.js';
import { todayLabel, formatDateLong } from '../../core/utils.js';
import { refresh } from '../../core/router.js';
import { defaultOptionsForDate } from '../../data/schedule/defaults.js';
import { generateDailySchedule, materializeFromItems } from '../../data/schedule/generate.js';
import { validateSchedule } from '../../data/schedule/validate.js';
import { saveSchedule } from '../../data/schedule/save.js';
import { scheduleToJsonText, scheduleJsonFilename } from '../../data/schedule/exportJson.js';

function downloadText(text, filename) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * @param {{ date?: string, onSaved?: () => void }} [opts]
 */
export function openDailyPlanner({ date: initialDate, onSaved } = {}) {
  const state = {
    options: defaultOptionsForDate(initialDate || todayLabel()),
    items: [],
    notes: [],
    generated: false,
    busy: false,
    error: null,
  };

  let dialog = null;
  let bodyEl = null;

  function currentSchedule() {
    const { tasks, blocks } = materializeFromItems(state.options.date, state.items);
    return { date: state.options.date, tasks, blocks };
  }

  function generate({ replace = true } = {}) {
    if (state.items.length && !replace) return;
    if (state.items.length && replace) {
      const ok = window.confirm(
        'Replace the current proposal with a newly generated schedule? Your edits on this screen will be lost.'
      );
      if (!ok) return;
    }
    const result = generateDailySchedule(state.options);
    state.items = result.items;
    state.notes = result.notes || [];
    state.generated = true;
    state.error = null;
    renderBody();
  }

  function updateItem(index, patch) {
    const next = { ...state.items[index], ...patch };
    state.items = state.items.slice();
    state.items[index] = next;
  }

  function removeItem(index) {
    state.items = state.items.filter((_, i) => i !== index);
    renderBody();
  }

  function addBlankItem() {
    state.items = state.items.concat([
      {
        key: `custom-${Date.now()}`,
        title: 'New activity',
        description: '',
        startTime: '12:00',
        endTime: '12:30',
        priority: 'Medium',
      },
    ]);
    state.generated = true;
    renderBody();
  }

  async function doSave() {
    if (state.busy) return;
    const schedule = currentSchedule();
    const check = validateSchedule(schedule);
    if (!check.ok) {
      state.error = check.errors.join(' ');
      renderBody();
      toast(check.errors[0] || 'Schedule is invalid', { type: 'error' });
      return;
    }
    state.busy = true;
    state.error = null;
    renderBody();
    const result = await saveSchedule(schedule);
    state.busy = false;
    if (!result.ok) {
      state.error = (result.errors || []).join(' ');
      renderBody();
      toast(result.errors?.[0] || 'Save failed', { type: 'error' });
      return;
    }
    toast(
      `Saved ${result.addedTasks} task${result.addedTasks === 1 ? '' : 's'} and ${result.addedBlocks} block${result.addedBlocks === 1 ? '' : 's'}`,
      { type: 'success' }
    );
    dialog?.close();
    if (typeof onSaved === 'function') onSaved();
    else refresh();
  }

  function doDownload() {
    const schedule = currentSchedule();
    const check = validateSchedule(schedule);
    if (!check.ok) {
      state.error = check.errors.join(' ');
      renderBody();
      toast(check.errors[0] || 'Schedule is invalid', { type: 'error' });
      return;
    }
    downloadText(scheduleToJsonText(schedule), scheduleJsonFilename(schedule.date));
    toast('Schedule JSON downloaded', { type: 'success' });
  }

  function renderBody() {
    if (!bodyEl) return;
    bodyEl.replaceChildren();

    /* Options */
    const optCard = h('div', { class: 'card', style: { marginBottom: 'var(--space-4)' } });
    optCard.appendChild(h('p', { class: 'card-title' }, 'Day settings'));
    optCard.appendChild(
      h('p', { style: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginBottom: 'var(--space-3)' } }, formatDateLong(state.options.date))
    );

    const dateInput = textInput({
      type: 'date',
      value: state.options.date,
      onChange: (e) => {
        const v = e.target.value;
        if (!v) return;
        const keepToggles = { ...state.options };
        state.options = { ...defaultOptionsForDate(v), hasSchool: keepToggles.hasSchool, hasCoaching: keepToggles.hasCoaching, includeStrength: keepToggles.includeStrength, includeVolleyball: keepToggles.includeVolleyball, includePython: keepToggles.includePython, includeJapanese: keepToggles.includeJapanese, includeMinecraft: keepToggles.includeMinecraft, includeYumerise: keepToggles.includeYumerise, sleepTarget: keepToggles.sleepTarget };
        state.options.date = v;
        renderBody();
      },
    });
    optCard.appendChild(field('Date', dateInput));

    const toggles = [
      ['hasSchool', 'School day (~7:00–15:00)'],
      ['hasCoaching', 'Coaching (~17:00–20:00)'],
      ['includeStrength', 'Strength training (20m)'],
      ['includeVolleyball', 'Volleyball (20m)'],
      ['includePython', 'Python practice (20m)'],
      ['includeJapanese', 'Japanese practice (20m)'],
      ['includeYumerise', 'YumeRise plan tomorrow (30m)'],
      ['includeMinecraft', 'Minecraft reward (up to 60m)'],
    ];
    const toggleList = h('div', { class: 'stack', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } });
    for (const [key, label] of toggles) {
      const id = `planner-${key}`;
      const input = h('input', {
        type: 'checkbox',
        id,
        checked: Boolean(state.options[key]),
        onChange: (e) => {
          state.options[key] = e.target.checked;
        },
      });
      toggleList.appendChild(
        h('label', { class: 'check-row', style: { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)' } }, input, label)
      );
    }
    optCard.appendChild(toggleList);

    const sleepInput = textInput({
      type: 'time',
      value: state.options.sleepTarget,
      onChange: (e) => {
        state.options.sleepTarget = e.target.value || '23:00';
      },
    });
    optCard.appendChild(field('Sleep target', sleepInput));

    const genRow = h(
      'div',
      { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-4)', flexWrap: 'wrap' } },
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          onClick: () => generate({ replace: true }),
        },
        icon('spark'),
        state.items.length ? 'Regenerate' : 'Generate schedule'
      ),
      h(
        'button',
        { class: 'btn btn-soft', type: 'button', onClick: addBlankItem },
        icon('plus'),
        'Add item'
      )
    );
    optCard.appendChild(genRow);
    bodyEl.appendChild(optCard);

    if (state.notes.length) {
      bodyEl.appendChild(
        h(
          'div',
          { class: 'card', style: { marginBottom: 'var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)' } },
          ...state.notes.map((n) => h('p', {}, n))
        )
      );
    }

    if (state.error) {
      bodyEl.appendChild(
        h('div', { class: 'card', style: { marginBottom: 'var(--space-4)', color: 'var(--danger, #c44)' } }, h('p', {}, state.error))
      );
    }

    if (!state.items.length) {
      bodyEl.appendChild(
        h(
          'div',
          { class: 'empty-state', style: { textAlign: 'center', padding: 'var(--space-6)' } },
          h('p', {}, 'Generate a schedule for this day, then review and edit before saving.')
        )
      );
      return;
    }

    const list = h('div', { class: 'stack', style: { gap: 'var(--space-3)' } });
    state.items.forEach((item, index) => {
      const card = h('div', { class: 'card block-card', style: { display: 'grid', gap: 'var(--space-2)' } });
      const titleIn = textInput({
        value: item.title,
        onChange: (e) => updateItem(index, { title: e.target.value }),
      });
      const descIn = textInput({
        value: item.description || '',
        onChange: (e) => updateItem(index, { description: e.target.value }),
      });
      const startIn = textInput({
        type: 'time',
        value: item.startTime,
        onChange: (e) => updateItem(index, { startTime: e.target.value }),
      });
      const endIn = textInput({
        type: 'time',
        value: item.endTime,
        onChange: (e) => updateItem(index, { endTime: e.target.value }),
      });
      const pri = item.priority || 'Medium';
      const priIn = selectInput(
        [
          { value: 'Low', label: 'Low', selected: pri === 'Low' },
          { value: 'Medium', label: 'Medium', selected: pri === 'Medium' },
          { value: 'High', label: 'High', selected: pri === 'High' },
        ],
        {
          onChange: (e) => updateItem(index, { priority: e.target.value }),
        }
      );
      card.appendChild(field('Title', titleIn));
      card.appendChild(field('Description', descIn));
      card.appendChild(
        h(
          'div',
          { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' } },
          field('Start', startIn),
          field('End', endIn)
        )
      );
      card.appendChild(field('Priority', priIn));
      card.appendChild(
        h(
          'button',
          {
            class: 'btn btn-soft',
            type: 'button',
            style: { justifySelf: 'start' },
            onClick: () => removeItem(index),
          },
          icon('trash'),
          'Remove'
        )
      );
      list.appendChild(card);
    });
    bodyEl.appendChild(list);

    const actions = h(
      'div',
      {
        class: 'row',
        style: { gap: 'var(--space-2)', marginTop: 'var(--space-5)', flexWrap: 'wrap', position: 'sticky', bottom: 0, paddingTop: 'var(--space-3)', background: 'var(--surface, var(--bg))' },
      },
      h(
        'button',
        {
          class: 'btn btn-primary',
          type: 'button',
          disabled: state.busy,
          onClick: doSave,
        },
        icon('check'),
        state.busy ? 'Saving…' : 'Save to YumeRise'
      ),
      h(
        'button',
        { class: 'btn btn-secondary', type: 'button', onClick: doDownload },
        icon('download'),
        'Download JSON'
      )
    );
    bodyEl.appendChild(actions);
  }

  bodyEl = h('div', { class: 'dialog-body', style: { maxHeight: '70vh', overflow: 'auto' } });
  renderBody();

  dialog = openDialog({
    title: 'Daily planner',
    content: bodyEl,
  });
}
