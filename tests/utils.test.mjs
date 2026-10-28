import test from 'node:test';
import assert from 'node:assert/strict';
import {
  todayLabel,
  addDaysLabel,
  labelToDate,
  timeToMinutes,
  minutesToTime,
  formatDuration,
  formatClock,
  dayIndex,
  startOfWeek,
} from '../src/core/utils.js';

test('todayLabel formats YYYY-MM-DD with zero padding', () => {
  assert.equal(todayLabel(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(todayLabel(new Date(2026, 10, 23)), '2026-11-23');
});

test('addDaysLabel rolls across month and year boundaries', () => {
  assert.equal(addDaysLabel('2026-01-01', -1), '2025-12-31');
  assert.equal(addDaysLabel('2026-02-28', 1), '2026-03-01');
  assert.equal(addDaysLabel('2026-12-31', 1), '2027-01-01');
});

test('labelToDate returns a local-midnight date', () => {
  const d = labelToDate('2026-10-18');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 9);
  assert.equal(d.getDate(), 18);
});

test('timeToMinutes parses HH:MM and rejects garbage', () => {
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('0:05'), 5);
  assert.equal(timeToMinutes('23:59'), 1439);
  assert.equal(timeToMinutes('24:00'), null);
  assert.equal(timeToMinutes(''), null);
  assert.equal(timeToMinutes('abc'), null);
  assert.equal(timeToMinutes(null), null);
});

test('minutesToTime round-trips and normalises negatives', () => {
  assert.equal(minutesToTime(570), '09:30');
  assert.equal(minutesToTime(0), '00:00');
  assert.equal(minutesToTime(-30), '23:30');
  assert.equal(minutesToTime(undefined), '');
});

test('formatDuration produces compact human text', () => {
  assert.equal(formatDuration(0), '0m');
  assert.equal(formatDuration(45), '45m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(90), '1h 30m');
  assert.equal(formatDuration(120), '2h');
});

test('formatClock renders mm:ss and clamps negatives', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(65), '01:05');
  assert.equal(formatClock(1500), '25:00');
  assert.equal(formatClock(-5), '00:00');
});

test('dayIndex is Monday-first', () => {
  assert.equal(dayIndex('2026-10-19'), 0); // Monday
  assert.equal(dayIndex('2026-10-25'), 6); // Sunday
});

test('startOfWeek returns the Monday of the same week', () => {
  assert.equal(startOfWeek('2026-10-21'), '2026-10-19'); // Wednesday -> Monday
  assert.equal(startOfWeek('2026-10-19'), '2026-10-19'); // Monday stays
  assert.equal(startOfWeek('2026-10-25'), '2026-10-19'); // Sunday -> prior Monday
});
