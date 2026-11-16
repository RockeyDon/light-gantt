import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../../src/main/database';
import { TaskService } from '../../src/main/task-service';
import { ProgressService } from '../../src/main/progress-service';

let db: ReturnType<typeof openDatabase>;
let tasks: TaskService;
let progress: ProgressService;
let taskId: string;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 14, 12));
  db = openDatabase(':memory:');
  tasks = new TaskService(db);
  progress = new ProgressService(db);
  taskId = tasks.create({ name: '设计', assign: '自己', start_time: '2026-11-14', end_time: null }).id;
});
afterEach(() => {
  if (db.open) db.close();
  vi.useRealTimers();
});
const data = () => ({ task_id: taskId, date: '2026-11-14', content: '完成设计', expected_content: null });

describe('daily progress', () => {
  it('creates one entry per day, sorts history, trims text and rejects stale writes and deletes', () => {
    const first = progress.save({ ...data(), content: '  完成设计  ' });
    expect(first.content).toBe('完成设计');
    expect(() => progress.save(data())).toThrow('已发生变化');
    expect(() => progress.save({ ...data(), expected_content: '旧记录' })).toThrow('已发生变化');
    const updated = progress.save({ ...data(), expected_content: first.content, content: '设计通过评审' });
    expect(() => progress.remove(first)).toThrow('已发生变化');
    progress.save({ ...data(), date: '2026-11-12' });
    expect(progress.list(taskId).map((entry) => entry.date)).toEqual(['2026-11-14', '2026-11-12']);
    expect(progress.list()).toHaveLength(2);
    progress.remove(updated);
    expect(progress.list()).toHaveLength(1);
  });

  it.each([
    { date: '2026-11-15' },
    { date: '2026-02-30' },
    { date: '2026-1-01' },
    { date: '' },
    { content: '  ' },
    { content: 123 },
    { task_id: 'bad' },
    { expected_content: undefined },
    { unexpected: true },
  ])('validates IPC requests: %j', (patch) => {
    expect(() => progress.save({ ...data(), ...patch })).toThrow();
    expect(progress.list()).toEqual([]);
  });

  it('requires an existing task for writes, reads and removes', () => {
    const missing = randomUUID();
    expect(() => progress.save({ ...data(), task_id: missing })).toThrow('任务不存在');
    expect(() => progress.list(missing)).toThrow('任务不存在');
    expect(() => progress.list('invalid')).toThrow('任务 ID 无效');
    expect(() => progress.remove({ task_id: missing, date: '2026-11-14', content: 'test' })).toThrow('任务不存在');
  });

  it('keeps history independent from scheduling and completion, and cascades task deletion', () => {
    progress.save({ ...data(), date: '2026-10-01' });
    tasks.update(taskId, { start_time: '2026-12-01' });
    tasks.setDone(taskId, true);
    progress.save(data());
    expect(progress.list(taskId).map((entry) => entry.date)).toEqual(['2026-11-14', '2026-10-01']);
    tasks.remove(taskId);
    expect(progress.list()).toEqual([]);
  });

  it('preserves data after reopening and adds the table to an existing dev database', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-progress-'));
    let disk = openDatabase(path.join(directory, 'gantt.sqlite'));
    try {
      disk.exec('DROP TABLE task_progress');
      const task = new TaskService(disk).create({ name: 'existing', assign: '', start_time: '2026-11-01', end_time: null });
      disk.close();
      disk = openDatabase(path.join(directory, 'gantt.sqlite'));
      const record = new ProgressService(disk).save({ ...data(), task_id: task.id });
      disk.close();
      disk = openDatabase(path.join(directory, 'gantt.sqlite'));
      expect(new ProgressService(disk).list()).toEqual([record]);
      expect(new TaskService(disk).list()).toEqual([task]);
    } finally {
      if (disk.open) disk.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('propagates storage failures without altering data', () => {
    db.pragma('query_only = ON');
    expect(() => progress.save(data())).toThrow();
    expect(progress.list()).toEqual([]);
  });
});
