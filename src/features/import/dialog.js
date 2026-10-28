/**
 * Import dialog — the multi-step "Import data" workflow.
 *
 * Steps: select file → validate → preview → choose strategy → confirm →
 * result. Nothing is written until the user confirms, and the final write is
 * a single atomic transaction (see core/db.js atomicWrite), so cancelling or
 * failing at any point leaves existing data untouched.
 */

import { h } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { openDialog, toast } from '../../ui/kit.js';
import { refresh } from '../../core/router.js';
import { LIMITS } from '../../data/import/schema.js';
import { parseExportText } from '../../data/import/parse.js';
import { buildPlan, describePlan } from '../../data/import/plan.js';
import { commitPlan } from '../../data/import/apply.js';
import { makeAdapter, COLLECTIONS } from '../../data/import/storage.js';

const COLLECTION_LABELS = {
  tasks: 'Tasks',
  goals: 'Goals',
  sessions: 'Focus sessions',
  blocks: 'Plan blocks',
};

const nf = new Intl.NumberFormat();

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isJsonFile(file) {
  const name = (file.name || '').toLowerCase();
  const type = String(file.type || '');
  return name.endsWith('.json') || type.includes('json') || type === '';
}

export function openImportDialog({ onImported } = {}) {
  const state = {
    step: 'select',       // select | preview | confirm | running | done | error
    file: null,           // { name, size }
    payload: null,
    plan: null,
    strategy: 'merge',
    conflictPolicy: 'keepExisting',
    fileError: null,
    fileNotes: [],
    result: null,
    failure: null,
    existingCache: null,  // current storage contents, read once for the preview
  };

  let dialog = null;
  let fileInput = null;
  let dropZone = null;
  let lastFocusedLabel = null;

  const adapter = makeAdapter();

  function close() {
    if (dialog) dialog.close();
  }

  /* ---------------- file selection ---------------- */

  async function pickFile(file) {
    if (!file) return;
    state.fileError = null;
    state.fileNotes = [];
    state.payload = null;
    state.plan = null;

    if (!isJsonFile(file)) {
      state.file = null;
      state.fileError = 'YumeRise exports are .json files. Choose the file you downloaded from Export data.';
      render();
      return;
    }
    if (file.size > LIMITS.maxFileBytes) {
      state.file = null;
      state.fileError = `That file is ${formatBytes(file.size)}. Imports are limited to ${formatBytes(LIMITS.maxFileBytes)}.`;
      render();
      return;
    }

    state.file = { name: file.name, size: file.size };
    render();

    let text;
    try {
      text = await file.text();
    } catch {
      state.file = null;
      state.fileError = 'That file could not be read. Try choosing it again.';
      render();
      return;
    }

    const parsed = parseExportText(text);
    if (!parsed.ok) {
      state.payload = null;
      state.fileError = parsed.detail ? `${parsed.error} ${parsed.detail}` : parsed.error;
      render();
      return;
    }

    state.payload = parsed.payload;
    state.fileNotes = parsed.payload.notes || [];
    state.step = 'preview';
    render();
    // The preview classifies new/duplicate/conflicting records against
    // what is currently stored, so refresh that snapshot first.
    await loadExisting();
    render();
  }

  /* Preview needs current storage contents to classify new/duplicate/conflict. */
  async function loadExisting() {
    try {
      state.existingCache = await adapter.readAll();
    } catch (err) {
      console.error('could not read existing data for preview', err);
      state.existingCache = { tasks: [], goals: [], sessions: [], blocks: [] };
    }
    return state.existingCache;
  }

  function computePlan() {
    if (!state.payload) return null;
    const existing = state.existingCache || { tasks: [], goals: [], sessions: [], blocks: [] };
    return buildPlan(state.payload, existing, {
      strategy: state.strategy,
      conflictPolicy: state.conflictPolicy,
    });
  }

  /* ---------------- steps ---------------- */

  function resetToSelect() {
    state.step = 'select';
    state.file = null;
    state.payload = null;
    state.plan = null;
    state.fileError = null;
    state.fileNotes = [];
    state.result = null;
    state.failure = null;
    // Storage may have changed since this snapshot was taken (e.g. after an
    // import), so the next preview must re-read it.
    state.existingCache = null;
    render();
    if (fileInput) fileInput.value = '';
  }

  async function goConfirm() {
    state.plan = computePlan();
    state.step = 'confirm';
    render();
  }

  async function runImport() {
    if (state.step === 'running') return; // guard against double submit
    // Rebuild the plan against CURRENT storage: the preview's snapshot can be
    // stale (the dialog can sit open while data changes), and stale
    // classification could add an id that now exists locally, clobbering it.
    await loadExisting();
    state.plan = computePlan();
    if (!state.plan) return;

    state.step = 'running';
    render();

    try {
      const result = await commitPlan(state.plan, adapter);
      state.result = result;
      state.step = 'done';
      render();
      if (result.committed) {
        toast(`Import complete — ${result.counts.added} added, ${result.counts.updated} updated`, { type: 'success' });
        try { refresh(); } catch { /* view refresh is best-effort */ }
        if (typeof onImported === 'function') onImported(result);
      } else {
        toast('Nothing to import — everything was already saved', { type: 'info' });
      }
    } catch (err) {
      console.error('import failed', err);
      state.failure = (err && err.message) || 'Import could not be saved.';
      state.step = 'error';
      render();
    }
  }

  /* ---------------- render ---------------- */

  function render() {
    if (!dialog) return;
    const body = dialog.body;
    body.replaceChildren();
    if (state.step === 'select') body.appendChild(stepSelect());
    else if (state.step === 'preview') body.appendChild(stepPreview());
    else if (state.step === 'confirm') body.appendChild(stepConfirm());
    else if (state.step === 'running') body.appendChild(stepRunning());
    else if (state.step === 'done') body.appendChild(stepDone());
    else if (state.step === 'error') body.appendChild(stepError());

    const actions = dialog.actions;
    actions.replaceChildren();
    actions.appendChild(stepActions());
  }

  function stepSelect() {
    const input = h('input', {
      type: 'file',
      accept: '.json,application/json',
      class: 'sr-only',
      id: 'import-file-input',
      'aria-label': 'Choose a YumeRise export file',
      tabindex: '-1', // the drop zone is the keyboard control; skip the hidden input
      onChange: (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) pickFile(file);
      },
    });
    fileInput = input;

    dropZone = h(
      'div',
      {
        class: `import-drop${state.fileError ? ' has-error' : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-label': 'Choose a YumeRise export file, or drop it here',
        onClick: () => input.click(),
        onKeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.click();
          }
        },
        onDragover: (e) => {
          e.preventDefault();
          dropZone.classList.add('is-over');
        },
        onDragleave: () => dropZone.classList.remove('is-over'),
        onDrop: (e) => {
          e.preventDefault();
          dropZone.classList.remove('is-over');
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          if (file) pickFile(file);
        },
      },
      h('span', { class: 'import-drop-icon', 'aria-hidden': 'true' }, icon('upload')),
      h('p', { class: 'import-drop-title' }, 'Drop your export here, or click to choose'),
      h('p', { class: 'import-drop-hint' }, `.json · up to ${formatBytes(LIMITS.maxFileBytes)} · read on this device only`),
      input
    );

    const wrap = h('div', { class: 'import-step' });
    wrap.appendChild(h('p', { class: 'import-lede' },
      'Restore a YumeRise export. The file stays on this device — nothing is uploaded.'));
    wrap.appendChild(dropZone);

    if (state.file) {
      wrap.appendChild(
        h('div', { class: 'import-file', role: 'status' },
          h('span', { class: 'import-file-icon', 'aria-hidden': 'true' }, icon('inbox')),
          h('span', { class: 'import-file-name' }, state.file.name),
          h('span', { class: 'import-file-size' }, formatBytes(state.file.size)),
          h('button', { class: 'btn btn-ghost btn-sm', onClick: resetToSelect }, 'Choose another')
        )
      );
    }
    if (state.fileError) {
      wrap.appendChild(
        h('p', { class: 'import-error', role: 'alert' },
          icon('warning'), h('span', {}, state.fileError))
      );
    }
    return wrap;
  }

  function stepPreview() {
    const p = state.payload;
    const plan = computePlan();
    state.plan = plan;

    const wrap = h('div', { class: 'import-step' });
    wrap.appendChild(h('p', { class: 'import-lede' },
      'Review what this file contains before anything is saved.'));

    wrap.appendChild(
      h('div', { class: 'import-file' },
        h('span', { class: 'import-file-icon', 'aria-hidden': 'true' }, icon('inbox')),
        h('span', { class: 'import-file-name' }, state.file ? state.file.name : 'export.json'),
        h('span', { class: 'import-file-size' },
          state.file ? formatBytes(state.file.size) : ''),
        h('button', { class: 'btn btn-ghost btn-sm', onClick: resetToSelect }, 'Choose another')
      )
    );

    const meta = [];
    meta.push(['Exported', p.exportedAt ? new Date(p.exportedAt).toLocaleString() : 'unknown date']);
    meta.push(['Format', `v${p.version}`]);
    wrap.appendChild(
      h('dl', { class: 'import-meta' },
        meta.map(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]))
    );

    /* Counts per collection */
    const rows = COLLECTIONS.map((name) => {
      const count = p.counts[name] || 0;
      if (!count) return null;
      const change = plan.collections[name];
      const add = change.add.length;
      const dup = change.identical;
      const con = change.conflicts.length;
      return h('div', { class: 'import-row' },
        h('span', { class: 'import-row-name' }, COLLECTION_LABELS[name]),
        h('span', { class: 'import-row-count num' }, `${nf.format(count)} in file`),
        h('span', { class: 'import-row-detail num' },
          `${add} new · ${dup} already saved${con ? ` · ${con} conflicting` : ''}`)
      );
    }).filter(Boolean);

    if (rows.length) {
      wrap.appendChild(h('div', { class: 'import-summary' },
        h('p', { class: 'import-summary-title' }, 'In this file'),
        rows));
    } else {
      wrap.appendChild(h('div', { class: 'import-summary' },
        h('p', { class: 'import-summary-title' }, 'This export contains no records.')));
    }

    /* Skipped / invalid */
    if (p.invalid.length) {
      const shown = p.invalid.slice(0, 4);
      wrap.appendChild(
        h('div', { class: 'import-warning' },
          icon('warning'),
          h('span', {},
            `${p.invalid.length} record${p.invalid.length === 1 ? '' : 's'} could not be read and will be skipped.`,
            h('ul', { class: 'import-invalid-list' },
              shown.map((row) => h('li', {}, `${COLLECTION_LABELS[row.collection]}: ${row.reason}`)),
              p.invalid.length > shown.length ? h('li', {}, `…and ${p.invalid.length - shown.length} more`) : null))
        )
      );
    }

    for (const note of state.fileNotes) {
      wrap.appendChild(h('p', { class: 'import-note' }, icon('info'), h('span', {}, note)));
    }

    /* Strategy */
    wrap.appendChild(
      h('fieldset', { class: 'import-choice' },
        h('legend', {}, 'How should this file be imported?'),
        radioRow('import-strategy', 'merge', 'Merge with my data',
          'Adds new records and keeps everything you already have.', state.strategy === 'merge',
          () => { state.strategy = 'merge'; render(); }),
        radioRow('import-strategy', 'replace', 'Replace all data',
          `Overwrites your current tasks, goals, sessions and plans with this file. ${plan.totals.removed} existing record${plan.totals.removed === 1 ? '' : 's'} would be removed.`,
          state.strategy === 'replace',
          () => { state.strategy = 'replace'; render(); },
          { danger: true })
      )
    );

    if (state.strategy === 'replace') {
      wrap.appendChild(
        h('div', { class: 'import-warning import-warning-strong', role: 'note' },
          icon('warning'),
          h('span', {}, 'Replace cannot be undone. Export your current data first if you might need it.'))
      );
    }

    if (plan.totals.conflicts > 0 && state.strategy === 'merge') {
      wrap.appendChild(
        h('fieldset', { class: 'import-choice' },
          h('legend', {}, `Conflicting records (${plan.totals.conflicts})`),
          h('p', { class: 'import-choice-hint' },
            'These records already exist with the same ID but different contents.'),
          radioRow('import-conflict', 'keepExisting', 'Keep my version',
            'Your current records win; the imported copies are skipped.',
            state.conflictPolicy === 'keepExisting',
            () => { state.conflictPolicy = 'keepExisting'; render(); }),
          radioRow('import-conflict', 'useImported', 'Use the imported version',
            'Overwrites your current records with the ones from this file.',
            state.conflictPolicy === 'useImported',
            () => { state.conflictPolicy = 'useImported'; render(); })
        )
      );
    }

    return wrap;
  }

  function stepConfirm() {
    const plan = state.plan;
    const wrap = h('div', { class: 'import-step' });
    wrap.appendChild(h('p', { class: 'import-lede' }, 'Confirm what will change.'));

    const lines = [];
    const t = plan.totals;
    if (plan.strategy === 'replace') {
      lines.push(['Records from file', `${nf.format(t.kept ?? 0)}`]);
      lines.push(['Existing records removed', `${nf.format(t.removed)}`]);
    } else {
      lines.push(['New records', `${nf.format(t.add)}`]);
      lines.push(['Records updated', `${nf.format(t.update)}`]);
      lines.push(['Already saved (skipped)', `${nf.format(t.identical)}`]);
      if (t.conflictsKept) lines.push(['Conflicts kept as-is', `${nf.format(t.conflictsKept)}`]);
    }
    if (t.invalid) lines.push(['Unreadable records skipped', `${nf.format(t.invalid)}`]);

    wrap.appendChild(
      h('div', { class: 'import-summary import-confirm' },
        h('p', { class: 'import-summary-title' }, describePlan(plan)),
        h('dl', { class: 'import-meta' },
          lines.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, v)])))
    );

    for (const note of plan.notes) {
      wrap.appendChild(h('p', { class: 'import-note' }, icon('info'), h('span', {}, note)));
    }

    if (plan.strategy === 'replace') {
      wrap.appendChild(
        h('div', { class: 'import-warning import-warning-strong', role: 'note' },
          icon('warning'),
          h('span', {}, 'This replaces ALL of your data with the contents of this file. It cannot be undone.'))
      );
    }
    return wrap;
  }

  function stepRunning() {
    const wrap = h('div', { class: 'import-step import-running' });
    wrap.appendChild(h('div', { class: 'import-spinner', 'aria-hidden': 'true' }));
    wrap.appendChild(h('p', { role: 'status', 'aria-live': 'polite' }, 'Importing your data…'));
    return wrap;
  }

  function stepDone() {
    const r = state.result;
    const wrap = h('div', { class: 'import-step' });

    if (!r.committed) {
      wrap.appendChild(h('div', { class: 'import-result is-neutral' },
        icon('info'),
        h('div', {},
          h('h3', {}, 'Nothing to import'),
          h('p', {}, 'Every record in this file is already saved. Your data was not changed.'))));
      return wrap;
    }

    const rows = [];
    if (r.counts.added) rows.push(['Added', r.counts.added]);
    if (r.counts.updated) rows.push(['Updated', r.counts.updated]);
    rows.push(['Already saved (unchanged)', r.counts.identical]);
    if (r.counts.removed) rows.push(['Removed by replace', r.counts.removed]);
    if (r.counts.conflictsKept) rows.push(['Conflicts kept as your version', r.counts.conflictsKept]);
    if (r.counts.invalid) rows.push(['Unreadable records skipped', r.counts.invalid]);

    wrap.appendChild(h('div', { class: 'import-result is-success' },
      icon('check'),
      h('div', {},
        h('h3', {}, 'Import complete'),
        h('dl', { class: 'import-meta' },
          rows.map(([k, v]) => [h('dt', {}, k), h('dd', { class: 'num' }, nf.format(v))])))));

    for (const note of r.notes) {
      wrap.appendChild(h('p', { class: 'import-note' }, icon('info'), h('span', {}, note)));
    }
    wrap.appendChild(h('p', { class: 'import-footnote' },
      'Your data is saved on this device and will be there after a refresh.'));
    return wrap;
  }

  function stepError() {
    const wrap = h('div', { class: 'import-step' });
    wrap.appendChild(h('div', { class: 'import-result is-error' },
      icon('warning'),
      h('div', {},
        h('h3', {}, 'Import failed'),
        h('p', {}, state.failure || 'The import could not be completed.'),
        h('p', {}, 'No changes were made to your existing data.'))));
    return wrap;
  }

  /* ---------------- actions bar ---------------- */

  function stepActions() {
    const fragment = document.createDocumentFragment();

    if (state.step === 'select') {
      fragment.appendChild(btn('Cancel', 'btn btn-ghost', close));
      fragment.appendChild(btn('Choose file', 'btn btn-primary', () => fileInput && fileInput.click()));
      return fragment;
    }
    if (state.step === 'preview') {
      fragment.appendChild(btn('Cancel', 'btn btn-ghost', close));
      fragment.appendChild(btn('Back', 'btn btn-secondary', resetToSelect));
      fragment.appendChild(btn('Continue', 'btn btn-primary', goConfirm));
      return fragment;
    }
    if (state.step === 'confirm') {
      fragment.appendChild(btn('Cancel', 'btn btn-ghost', close));
      fragment.appendChild(btn('Back', 'btn btn-secondary', () => { state.step = 'preview'; render(); }));
      const label = state.strategy === 'replace' ? 'Replace my data' : 'Import data';
      const run = btn(label, state.strategy === 'replace' ? 'btn btn-danger' : 'btn btn-primary', runImport);
      fragment.appendChild(run);
      return fragment;
    }
    if (state.step === 'running') {
      const run = btn('Importing…', 'btn btn-primary');
      run.disabled = true;
      fragment.appendChild(run);
      return fragment;
    }
    if (state.step === 'done') {
      fragment.appendChild(btn('Close', 'btn btn-ghost', close));
      fragment.appendChild(btn('Import another file', 'btn btn-secondary', resetToSelect));
      return fragment;
    }
    /* error */
    fragment.appendChild(btn('Close', 'btn btn-ghost', close));
    fragment.appendChild(btn('Back to file', 'btn btn-secondary', resetToSelect));
    return fragment;
  }

  function btn(label, className, onClick) {
    const el = h('button', { class: className, type: 'button' }, label);
    if (onClick) el.addEventListener('click', onClick);
    return el;
  }

  function radioRow(name, value, label, hint, checked, onChange, { danger } = {}) {
    const id = `${name}-${value}`;
    const input = h('input', {
      type: 'radio', name, id, value,
      checked: checked ? true : false,
      onChange: () => onChange(),
    });
    return h('label', {
      class: `import-radio${danger ? ' is-danger' : ''}`,
      for: id,
      // Mirrors :has(input:checked) so selection styling still works where
      // :has() is unavailable.
      dataset: { checked: String(Boolean(checked)) },
    },
      input,
      h('span', { class: 'import-radio-body' },
        h('span', { class: 'import-radio-label' }, label),
        h('span', { class: 'import-radio-hint' }, hint)));
  }

  /* ---------------- open ---------------- */

  const bodyEl = h('div', { class: 'import-body' });
  const actionsEl = h('div', { class: 'dialog-actions import-actions' });
  dialog = openDialog({
    title: 'Import data',
    content: bodyEl,
    actions: actionsEl,
  });
  dialog.body = bodyEl;
  dialog.actions = actionsEl;
  render();

  // openDialog focuses the first input it finds; our file input is visually
  // hidden, so move focus to the drop zone (the real control) instead.
  if (dropZone && typeof dropZone.focus === 'function') dropZone.focus({ preventScroll: true });

  return dialog;
}
