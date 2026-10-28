/**
 * Build an import-compatible JSON envelope for a single-day schedule.
 * Uses kind "chatgpt-plan" so focus sessions in the file (none) cannot invent history.
 */

import { EXPORT_APP_ID, SUPPORTED_VERSION } from '../import/schema.js';

/**
 * @param {{ date: string, tasks: object[], blocks: object[] }} schedule
 * @returns {object}
 */
export function buildScheduleExport(schedule) {
  return {
    app: EXPORT_APP_ID,
    version: SUPPORTED_VERSION,
    kind: 'chatgpt-plan',
    exportedAt: new Date().toISOString(),
    tasks: schedule.tasks || [],
    goals: [],
    sessions: [],
    blocks: schedule.blocks || [],
    guide: {
      about: 'YumeRise Next daily schedule export. Import via Settings → Import data (merge) to add these tasks and plan blocks without removing existing records.',
      date: schedule.date,
      tasks: 'id, title, description, date, startTime, endTime, priority, status, checklist, createdAt, updatedAt',
      blocks: 'id, title, date, startTime, endTime, linkedTaskId, createdAt, updatedAt',
      excluded: 'Goals and focus sessions are intentionally empty in a daily-schedule export.',
    },
  };
}

/**
 * @param {{ date: string, tasks: object[], blocks: object[] }} schedule
 * @returns {string} UTF-8 JSON text
 */
export function scheduleToJsonText(schedule) {
  return `${JSON.stringify(buildScheduleExport(schedule), null, 2)}\n`;
}

export function scheduleJsonFilename(dateLabel) {
  return `yumerise-schedule-${dateLabel || 'day'}.json`;
}
