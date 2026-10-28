/**
 * Domain repositories over IndexedDB.
 *
 * Mirrors the shapes the legacy app used (tasks with priority/date/status/
 * checklist, goals with kind + progress, focus sessions with minutes), so the
 * behaviour carries over while the storage becomes local-first.
 *
 * Every mutation returns the saved record; lists are re-read from the store so
 * the UI always reflects real data (never in-memory-only state).
 */

import { STORES, getAll, get, put, del } from '../core/db.js';
import { uid, todayLabel } from '../core/utils.js';

export const PRIORITIES = ['Low', 'Medium', 'High'];

/* ---------------- Tasks ---------------- */

export function makeTask(input = {}) {
  const now = new Date().toISOString();
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Task title is required');
  return {
    id: uid(),
    title,
    description: String(input.description || '').trim(),
    date: input.date || todayLabel(),
    startTime: input.startTime || '', // 'HH:MM' or ''
    endTime: input.endTime || '',
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'Medium',
    status: input.status || 'todo', // 'todo' | 'done'
    checklist: Array.isArray(input.checklist)
      ? input.checklist
          .map((item) => ({
            id: uid(),
            text: String(item.text || item || '').trim(),
            done: Boolean(item.done),
          }))
          .filter((item) => item.text)
      : [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function listTasks() {
  const tasks = await getAll(STORES.tasks);
  return tasks.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const at = a.startTime || '99:99';
    const bt = b.startTime || '99:99';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });
}

export async function saveTask(task) {
  const record = { ...task, updatedAt: new Date().toISOString() };
  await put(STORES.tasks, record);
  return record;
}

export async function addTask(input) {
  const task = makeTask(input);
  await put(STORES.tasks, task);
  return task;
}

export async function toggleTask(id, done) {
  const task = await get(STORES.tasks, id);
  if (!task) throw new Error('Task not found');
  task.status = done ? 'done' : 'todo';
  task.updatedAt = new Date().toISOString();
  await put(STORES.tasks, task);
  return task;
}

export async function deleteTask(id) {
  await del(STORES.tasks, id);
}

export async function toggleChecklistItem(taskId, itemId, done) {
  const task = await get(STORES.tasks, taskId);
  if (!task) throw new Error('Task not found');
  const item = task.checklist.find((c) => c.id === itemId);
  if (!item) throw new Error('Checklist item not found');
  item.done = Boolean(done);
  task.updatedAt = new Date().toISOString();
  await put(STORES.tasks, task);
  return task;
}

/* ---------------- Goals ---------------- */

export function makeGoal(input = {}) {
  const now = new Date().toISOString();
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Goal title is required');
  return {
    id: uid(),
    title,
    kind: input.kind === 'long' ? 'long' : 'active', // 'active' | 'long'
    note: String(input.note || '').trim(),
    progress: Math.min(100, Math.max(0, Number(input.progress) || 0)),
    // Clamped at 0: counts/targets can't be negative.
    target: Math.max(0, Number(input.target) || 0),   // optional numeric target (e.g. sessions)
    current: Math.max(0, Number(input.current) || 0),
    unit: String(input.unit || '').trim(),
    done: false,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listGoals() {
  const goals = await getAll(STORES.goals);
  return goals.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

export async function addGoal(input) {
  const goal = makeGoal(input);
  await put(STORES.goals, goal);
  return goal;
}

export async function updateGoal(id, patch) {
  const goal = await get(STORES.goals, id);
  if (!goal) throw new Error('Goal not found');
  const next = { ...goal, ...patch, id: goal.id, updatedAt: new Date().toISOString() };
  next.progress = Math.min(100, Math.max(0, Number(next.progress) || 0));
  // Same floor as makeGoal: a patch can't push counts negative.
  next.target = Math.max(0, Number(next.target) || 0);
  next.current = Math.max(0, Number(next.current) || 0);
  await put(STORES.goals, next);
  return next;
}

export async function deleteGoal(id) {
  await del(STORES.goals, id);
}

/* ---------------- Focus sessions ---------------- */

export async function listSessions() {
  const sessions = await getAll(STORES.sessions);
  return sessions.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)); // newest first
}

export async function addSession({ minutes, startedAt, note = '' }) {
  const record = {
    id: uid(),
    minutes: Math.max(1, Math.round(Number(minutes) || 0)),
    startedAt: startedAt || new Date().toISOString(),
    note: String(note).trim(),
    createdAt: new Date().toISOString(),
  };
  if (!record.minutes) throw new Error('Session minutes must be positive');
  await put(STORES.sessions, record);
  return record;
}

export async function deleteSession(id) {
  await del(STORES.sessions, id);
}

/* ---------------- Plan blocks ---------------- */

export function makeBlock(input = {}) {
  const now = new Date().toISOString();
  const title = String(input.title || '').trim();
  if (!title) throw new Error('Block title is required');
  return {
    id: uid(),
    title,
    date: input.date || todayLabel(),
    startTime: input.startTime || '09:00',
    endTime: input.endTime || '',
    linkedTaskId: input.linkedTaskId || null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function listBlocks() {
  const blocks = await getAll(STORES.blocks);
  return blocks.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startTime < b.startTime ? -1 : 1;
  });
}

export async function addBlock(input) {
  const block = makeBlock(input);
  await put(STORES.blocks, block);
  return block;
}

export async function deleteBlock(id) {
  await del(STORES.blocks, id);
}
