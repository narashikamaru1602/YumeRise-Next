/**
 * Persist a validated daily schedule into IndexedDB (merge-only).
 * Never clears existing stores; uses one atomic transaction for tasks + blocks.
 */

import { STORES, atomicWrite, getAll } from '../../core/db.js';
import { validateSchedule } from './validate.js';

/**
 * Save tasks and blocks. Rejects if validation fails or any id already exists
 * (prevents accidental duplicate imports from repeated clicks).
 *
 * @param {{ date: string, tasks: object[], blocks: object[] }} schedule
 * @param {{ allowExistingIds?: boolean }} [options]
 * @returns {Promise<{ ok: true, addedTasks: number, addedBlocks: number } | { ok: false, errors: string[] }>}
 */
export async function saveSchedule(schedule, { allowExistingIds = false } = {}) {
  const check = validateSchedule(schedule);
  if (!check.ok) return check;

  const existingTasks = await getAll(STORES.tasks);
  const existingBlocks = await getAll(STORES.blocks);
  const existingTaskIds = new Set(existingTasks.map((t) => t.id));
  const existingBlockIds = new Set(existingBlocks.map((b) => b.id));

  const collisions = [];
  for (const t of schedule.tasks) {
    if (existingTaskIds.has(t.id)) collisions.push(`Task id already exists: ${t.id}`);
  }
  for (const b of schedule.blocks) {
    if (existingBlockIds.has(b.id)) collisions.push(`Block id already exists: ${b.id}`);
  }
  if (collisions.length && !allowExistingIds) {
    return {
      ok: false,
      errors: [
        'These items were already saved (duplicate ids). Generate a fresh schedule or edit existing tasks in My Tasks / Plan.',
        ...collisions.slice(0, 5),
      ],
    };
  }

  try {
    await atomicWrite({
      [STORES.tasks]: schedule.tasks,
      [STORES.blocks]: schedule.blocks,
    });
  } catch (err) {
    console.error('schedule save failed', err);
    return { ok: false, errors: ['Could not save the schedule. Nothing was changed.'] };
  }

  return {
    ok: true,
    addedTasks: schedule.tasks.length,
    addedBlocks: schedule.blocks.length,
  };
}
