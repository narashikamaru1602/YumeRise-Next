/**
 * Daily schedule generator, validation, export, and save behaviour.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { defaultOptionsForDate } from '../src/data/schedule/defaults.js';
import { generateDailySchedule, materializeFromItems } from '../src/data/schedule/generate.js';
import { validateSchedule } from '../src/data/schedule/validate.js';
import { buildScheduleExport, scheduleToJsonText } from '../src/data/schedule/exportJson.js';
import { parseExportText } from '../src/data/import/parse.js';
import { timeToMinutes } from '../src/core/utils.js';

describe('defaultOptionsForDate', () => {
  it('enables school and coaching on a weekday', () => {
    // 2026-10-19 is a Monday
    const o = defaultOptionsForDate('2026-10-19');
    assert.equal(o.hasSchool, true);
    assert.equal(o.hasCoaching, true);
  });

  it('disables school and coaching on a weekend', () => {
    // 2026-10-24 is a Saturday
    const o = defaultOptionsForDate('2026-10-24');
    assert.equal(o.hasSchool, false);
    assert.equal(o.hasCoaching, false);
  });
});

describe('generateDailySchedule', () => {
  it('creates paired tasks and blocks with matching linkedTaskId', () => {
    const schedule = generateDailySchedule({ date: '2026-10-20', hasSchool: true, hasCoaching: true });
    assert.ok(schedule.tasks.length > 0);
    assert.equal(schedule.tasks.length, schedule.blocks.length);
    for (const block of schedule.blocks) {
      assert.ok(schedule.tasks.some((t) => t.id === block.linkedTaskId));
      assert.equal(block.date, '2026-10-20');
    }
    for (const task of schedule.tasks) {
      assert.equal(task.date, '2026-10-20');
      assert.equal(task.status, 'todo');
      assert.ok(['Low', 'Medium', 'High'].includes(task.priority));
    }
  });

  it('omits school and coaching when toggled off', () => {
    const schedule = generateDailySchedule({
      date: '2026-10-20',
      hasSchool: false,
      hasCoaching: false,
      includeMinecraft: false,
      includeVolleyball: false,
    });
    const titles = schedule.tasks.map((t) => t.title);
    assert.ok(!titles.some((t) => /school/i.test(t)));
    assert.ok(!titles.some((t) => /coaching/i.test(t)));
  });

  it('produces non-overlapping blocks on a school day', () => {
    const schedule = generateDailySchedule({ date: '2026-10-21', hasSchool: true, hasCoaching: true });
    const ranges = schedule.blocks
      .map((b) => ({ start: timeToMinutes(b.startTime), end: timeToMinutes(b.endTime), title: b.title }))
      .filter((r) => r.start != null && r.end != null)
      .sort((a, b) => a.start - b.start);
    for (let i = 1; i < ranges.length; i += 1) {
      assert.ok(
        ranges[i].start >= ranges[i - 1].end,
        `overlap: ${ranges[i - 1].title} and ${ranges[i].title}`
      );
    }
  });

  it('uses unique ids across tasks and blocks', () => {
    const schedule = generateDailySchedule({ date: '2026-10-22' });
    const ids = [...schedule.tasks.map((t) => t.id), ...schedule.blocks.map((b) => b.id)];
    assert.equal(ids.length, new Set(ids).size);
  });
});

describe('validateSchedule', () => {
  it('accepts a generated schedule', () => {
    const schedule = generateDailySchedule({ date: '2026-10-20' });
    const result = validateSchedule(schedule);
    assert.equal(result.ok, true);
  });

  it('rejects invalid dates', () => {
    const result = validateSchedule({ date: 'not-a-date', tasks: [], blocks: [] });
    assert.equal(result.ok, false);
  });

  it('rejects overlapping blocks', () => {
    const result = validateSchedule({
      date: '2026-10-20',
      tasks: [
        { id: 't1', title: 'A', date: '2026-10-20', startTime: '09:00', endTime: '10:00', priority: 'Medium', status: 'todo', checklist: [], createdAt: '', updatedAt: '' },
        { id: 't2', title: 'B', date: '2026-10-20', startTime: '09:30', endTime: '10:30', priority: 'Medium', status: 'todo', checklist: [], createdAt: '', updatedAt: '' },
      ],
      blocks: [
        { id: 'b1', title: 'A', date: '2026-10-20', startTime: '09:00', endTime: '10:00', linkedTaskId: 't1', createdAt: '', updatedAt: '' },
        { id: 'b2', title: 'B', date: '2026-10-20', startTime: '09:30', endTime: '10:30', linkedTaskId: 't2', createdAt: '', updatedAt: '' },
      ],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /overlap/i.test(e)));
  });

  it('rejects broken linkedTaskId', () => {
    const result = validateSchedule({
      date: '2026-10-20',
      tasks: [
        { id: 't1', title: 'A', date: '2026-10-20', startTime: '09:00', endTime: '10:00', priority: 'Medium', status: 'todo', checklist: [], createdAt: '', updatedAt: '' },
      ],
      blocks: [
        { id: 'b1', title: 'A', date: '2026-10-20', startTime: '09:00', endTime: '10:00', linkedTaskId: 'missing', createdAt: '', updatedAt: '' },
      ],
    });
    assert.equal(result.ok, false);
  });

  it('rejects end before start', () => {
    const result = validateSchedule({
      date: '2026-10-20',
      tasks: [
        { id: 't1', title: 'A', date: '2026-10-20', startTime: '11:00', endTime: '10:00', priority: 'Medium', status: 'todo', checklist: [], createdAt: '', updatedAt: '' },
      ],
      blocks: [
        { id: 'b1', title: 'A', date: '2026-10-20', startTime: '11:00', endTime: '10:00', linkedTaskId: 't1', createdAt: '', updatedAt: '' },
      ],
    });
    assert.equal(result.ok, false);
  });
});

describe('materializeFromItems', () => {
  it('preserves existing task/block ids when editing', () => {
    const { tasks, blocks } = materializeFromItems('2026-10-20', [
      { taskId: 'keep-t', blockId: 'keep-b', title: 'Study', startTime: '14:00', endTime: '15:00', priority: 'High' },
    ]);
    assert.equal(tasks[0].id, 'keep-t');
    assert.equal(blocks[0].id, 'keep-b');
    assert.equal(blocks[0].linkedTaskId, 'keep-t');
  });
});

describe('schedule JSON export', () => {
  it('builds an envelope the importer accepts', () => {
    const schedule = generateDailySchedule({ date: '2026-10-23', hasSchool: true, hasCoaching: false });
    const text = scheduleToJsonText(schedule);
    const parsed = parseExportText(text);
    assert.equal(parsed.ok, true, parsed.error || JSON.stringify(parsed));
    assert.ok(parsed.payload.records.tasks.length > 0);
    assert.ok(parsed.payload.records.blocks.length > 0);
  });

  it('uses chatgpt-plan kind and empty sessions', () => {
    const schedule = generateDailySchedule({ date: '2026-10-23' });
    const envelope = buildScheduleExport(schedule);
    assert.equal(envelope.app, 'yumerise-next');
    assert.equal(envelope.version, 1);
    assert.equal(envelope.kind, 'chatgpt-plan');
    assert.equal(envelope.sessions.length, 0);
    assert.equal(envelope.goals.length, 0);
  });
});
