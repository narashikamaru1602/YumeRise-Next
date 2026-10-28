/**
 * Settings screen — appearance (light/dark/system), local data controls,
 * and an honest about panel. No accounts, no XP, no streaks: out of scope.
 */

import { h } from '../core/dom.js';
import { icon } from '../core/icons.js';
import { pageHead, card } from '../ui/components.js';
import { toast } from '../ui/kit.js';
import { getMode, setMode, getAccent, setAccent, getApplied, onThemeChange } from '../core/theme.js';
import { STORES, getAll, clearAll } from '../core/db.js';
import { openImportDialog } from '../features/import/dialog.js';

const MODES = [
  { value: 'light', label: 'Light', iconName: 'sun' },
  { value: 'dark', label: 'Dark', iconName: 'moon' },
  { value: 'system', label: 'System', iconName: 'monitor' },
];

/* Dark accent palettes (Exact Theme Color Specification §5–6).
   Shown only when Dark is explicitly selected — hidden for Light and
   System, per spec §7. The stored accent itself is always preserved. */
const ACCENTS = [
  { value: 'rose', label: 'Rose Pink & Warm Golden Tan', swatch: ['#f9a8d4', '#e9c46a'] },
  { value: 'graphite', label: 'Graphite Grey & Warm Golden Tan', swatch: ['#94a3b8', '#e9c46a'] },
];

export async function settingsView() {
  const root = h('div', { class: 'page' });

  function render() {
    root.replaceChildren();
    root.appendChild(pageHead({ title: 'Settings', sub: 'Make YumeRise feel like yours.' }));

    /* ---- Appearance ---- */
    const cards = h('div', { class: 'theme-cards', role: 'radiogroup', 'aria-label': 'Theme' });
    const mode = getMode();
    for (const m of MODES) {
      cards.appendChild(
        h(
          'button',
          {
            class: 'theme-card',
            role: 'radio',
            'aria-checked': String(mode === m.value),
            onClick: () => {
              setMode(m.value);
              render();
            },
          },
          icon(m.iconName),
          m.label
        )
      );
    }

    /* Accent selector: only when Dark is explicitly chosen (never for
       Light or System selections — spec §7). The stored accent choice
       survives mode switches because theme.js keeps them separate. */
    let accentGroup = null;
    if (mode === 'dark') {
      const accent = getAccent();
      const options = h('div', { class: 'theme-cards accent-cards', role: 'radiogroup', 'aria-label': 'Dark accent' });
      for (const a of ACCENTS) {
        options.appendChild(
          h(
            'button',
            {
              class: 'theme-card',
              role: 'radio',
              'aria-checked': String(accent === a.value),
              onClick: () => {
                setAccent(a.value);
                render();
              },
            },
            h(
              'span',
              { class: 'accent-swatches', 'aria-hidden': 'true' },
              h('span', { class: 'accent-swatch', style: { background: a.swatch[0] } }),
              h('span', { class: 'accent-swatch', style: { background: a.swatch[1] } })
            ),
            a.label
          )
        );
      }
      accentGroup = options;
    }

    root.appendChild(
      h(
        'section',
        { class: 'settings-section' },
        h('h2', {}, 'Appearance'),
        h(
          'div',
          { class: 'card' },
          cards,
          accentGroup
            ? h(
                'div',
                { class: 'accent-picker' },
                h('p', { class: 'accent-picker-label' }, 'Dark accent'),
                accentGroup
              )
            : null,
          h(
            'p',
            { style: { marginTop: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--text-muted)' } },
            `Currently showing the ${getApplied()} theme.` +
              (mode === 'dark' ? ` ${ACCENTS.find((a) => a.value === getAccent()).label} accent.` : '')
          )
        )
      )
    );

    /* ---- Data ---- */
    root.appendChild(
      h(
        'section',
        { class: 'settings-section' },
        h('h2', {}, 'Your data'),
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'switch-row' },
            h(
              'div',
              { class: 'switch-text' },
              h('p', { class: 'switch-title' }, 'Stored on this device'),
              h('p', { class: 'switch-sub' }, 'Tasks, goals, sessions and plans live in this browser\u2019s local storage. Nothing is uploaded.')
            )
          ),
          h(
            'div',
            { style: { display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-3)' } },
            h(
              'button',
              { class: 'btn btn-secondary', onClick: exportData },
              icon('download'),
              'Export data'
            ),
            h(
              'button',
              { class: 'btn btn-secondary', onClick: exportForChatGpt },
              icon('spark'),
              'Export for ChatGPT'
            ),
            h(
              'button',
              { class: 'btn btn-secondary', onClick: openImport },
              icon('upload'),
              'Import data'
            ),
            h(
              'button',
              {
                class: 'btn btn-danger',
                onClick: async () => {
                  if (!confirm('Delete ALL local data? This cannot be undone.')) return;
                  try {
                    // One transaction across every store: all-or-nothing.
                    await clearAll(Object.values(STORES));
                    toast('All local data deleted', { type: 'success' });
                  } catch (err) {
                    console.error(err);
                    toast('Could not clear data', { type: 'error' });
                  }
                },
              },
              icon('trash'),
              'Delete all data'
            )
          )
        )
      )
    );

    /* ---- About ---- */
    root.appendChild(
      h(
        'section',
        { class: 'settings-section' },
        h('h2', {}, 'About'),
        h(
          'div',
          { class: 'card' },
          h(
            'div',
            { class: 'row' },
            h('span', { class: 'goal-icon' }, icon('spark')),
            h(
              'div',
              { class: 'row-main' },
              h('p', { class: 'row-title' }, 'YumeRise Next'),
              h('p', { class: 'row-sub' }, 'Version 0.1.0 · local-first')
            )
          ),
          h(
            'p',
            { style: { marginTop: 'var(--space-3)', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' } },
            'Plan a day that feels like yours. Accounts and cross-device sync arrive in a later release.'
          )
        )
      )
    );
  }

  function openImport() {
    // The dialog owns its own validation/confirm flow and only writes on the
    // final step, so cancelling here (or anywhere inside) changes nothing.
    openImportDialog({
      onImported: () => {
        // Import touched data other screens read; re-render this view too so
        // any counts shown here stay accurate.
        render();
      },
    });
  }

  /** Trigger a client-side JSON download; no network is involved. */
  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Defer: revoking synchronously can cancel the download in some
    // browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportData() {
    try {
      const [tasks, goals, sessions, blocks] = await Promise.all([
        getAll(STORES.tasks),
        getAll(STORES.goals),
        getAll(STORES.sessions),
        getAll(STORES.blocks),
      ]);
      const payload = { app: 'yumerise-next', version: 1, exportedAt: new Date().toISOString(), tasks, goals, sessions, blocks };
      downloadJson(payload, `yumerise-next-export-${new Date().toISOString().slice(0, 10)}.json`);
      toast('Export downloaded', { type: 'success' });
    } catch (err) {
      console.error(err);
      toast('Export failed', { type: 'error' });
    }
  }

  /**
   * ChatGPT-ready export: the same records and schema version as a normal
   * export, plus a `kind` marker and a human-readable field guide so ChatGPT
   * can interpret the file. Settings/preferences are deliberately excluded
   * (documented inside the guide itself). Purely local — the file is handed
   * to the user's browser; uploading it to any service is their action.
   */
  async function exportForChatGpt() {
    try {
      const [tasks, goals, sessions, blocks] = await Promise.all([
        getAll(STORES.tasks),
        getAll(STORES.goals),
        getAll(STORES.sessions),
        getAll(STORES.blocks),
      ]);
      const payload = {
        app: 'yumerise-next',
        kind: 'chatgpt-export',
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks,
        goals,
        sessions,
        blocks,
        guide: {
          about: 'YumeRise Next records prepared for analysis in ChatGPT. Upload this file and ask for a summary of task completion, focus time and goal progress.',
          dateFormats: 'Day labels are YYYY-MM-DD (local day). Timestamps are ISO 8601 UTC, e.g. 2026-10-23T18:00:00.000Z.',
          tasks: 'id, title, description, date, startTime, endTime, priority (Low|Medium|High), status (todo|done), checklist [{id,text,done}], createdAt, updatedAt.',
          goals: 'id, title, kind (active|long), note, progress (0-100), target, current, unit, done (bool), createdAt, updatedAt.',
          sessions: 'id, minutes (actual recorded focus minutes), startedAt (ISO 8601), note, createdAt.',
          blocks: 'id, title, date, startTime, endTime, linkedTaskId, createdAt, updatedAt.',
          excluded: 'Not included: appearance settings and preferences (theme, accent, focus duration) and any credentials - YumeRise stores none.',
        },
      };
      downloadJson(payload, `yumerise-chatgpt-export-${new Date().toISOString().slice(0, 10)}.json`);
      toast('ChatGPT export downloaded', { type: 'success' });
    } catch (err) {
      console.error(err);
      toast('Export failed', { type: 'error' });
    }
  }

  render();
  const off = onThemeChange(() => render());
  return { element: root, dispose: off };
}
