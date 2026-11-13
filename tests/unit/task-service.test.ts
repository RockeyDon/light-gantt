import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/main/database';
import { TaskError, TaskService } from '../../src/main/task-service';

const input = { name: '设计评审', assign: '小林', start_time: '2026-11-12', end_time: '2026-11-15' };
let db: Database.Database;
let service: TaskService;

beforeEach(() => {
  db = openDatabase(':memory:');
  service = new TaskService(db);
});
afterEach(() => {
  if (db.open) db.close();
});

describe('TaskService', () => {
  it('supports a complete lifecycle and explicit null end dates', () => {
    const created = service.create({ ...input, name: '  设计评审  ', assign: ' 小林 ' });
    expect(created).toMatchObject({ ...input, is_done: false });
    expect(service.list(false)).toEqual([created]);
    expect(service.update(created.id, { name: '确认方案', end_time: null })).toMatchObject({ name: '确认方案', end_time: null, assign: '小林' });
    expect(service.setDone(created.id, true).is_done).toBe(true);
    expect(service.list(false)).toHaveLength(0);
    expect(service.list(true)).toHaveLength(1);
    expect(service.setDone(created.id, false).is_done).toBe(false);
    service.remove(created.id);
    expect(service.list()).toEqual([]);
  });

  it('allows a same-day task, an unassigned task, and an open-ended future task', () => {
    expect(service.create({ ...input, end_time: input.start_time }).end_time).toBe(input.start_time);
    expect(service.create({ ...input, assign: '', start_time: '2030-01-01', end_time: null })).toMatchObject({ assign: '', end_time: null });
  });

  it.each([
    { ...input, name: '   ' },
    { ...input, start_time: '2026-02-30' },
    { ...input, start_time: '2026-1-01' },
    { ...input, start_time: '2026-11-12T00:00:00Z' },
    { ...input, start_time: '0000-01-01' },
    { ...input, end_time: '2026-11-01' },
    { ...input, end_time: '' },
    { ...input, assign: null },
    { ...input, unknown_field: true },
  ])('rejects malformed create requests without writing data: %j', (invalid) => {
    expect(() => service.create(invalid)).toThrow(TaskError);
    expect(service.list()).toEqual([]);
  });

  it('validates merged dates and does not partially update a task on failure', () => {
    const task = service.create(input);
    expect(() => service.update(task.id, { name: '不可保存', start_time: '2026-12-01' })).toThrow('结束日期不能早于开始日期');
    expect(service.list()).toEqual([task]);
    for (const patch of [{}, { name: undefined }, { is_done: true }, { end_time: 'invalid' }]) {
      expect(() => service.update(task.id, patch)).toThrow(TaskError);
    }
    expect(service.update(task.id, { start_time: '2026-12-01', end_time: null }).start_time).toBe('2026-12-01');
  });

  it('reports invalid identifiers, unknown tasks, and invalid completion flags', () => {
    const task = service.create(input);
    expect(() => service.remove('invalid')).toThrow('任务 ID 无效');
    expect(() => service.setDone(task.id, 1)).toThrow(TaskError);
    expect(() => service.list('false')).toThrow(TaskError);
    service.remove(task.id);
    for (const operation of [() => service.update(task.id, { name: '已删除' }), () => service.remove(task.id), () => service.setDone(task.id, true)]) {
      try {
        operation();
        throw new Error('expected NOT_FOUND');
      } catch (error) {
        expect(error).toMatchObject({ code: 'NOT_FOUND' });
      }
    }
  });

  it('sorts by start date and then id, with completion filtering', () => {
    const a = service.create({ ...input, start_time: '2026-11-11' });
    const b = service.create(input);
    const c = service.create(input);
    expect(service.list().map((task) => task.id)).toEqual([a.id, ...[b.id, c.id].sort()]);
    service.setDone(b.id, true);
    expect(service.list(true).map((task) => task.id)).toEqual([b.id]);
    expect(service.list(false)).toHaveLength(2);
  });
});

describe('database initialization and persistence', () => {
  it('creates the completion/date index and reopens existing data without recreating the schema', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-db-'));
    const filename = path.join(directory, 'gantt.sqlite');
    let disk = openDatabase(filename);
    try {
      const task = new TaskService(disk).create(input);
      expect(disk.pragma('user_version', { simple: true })).toBe(2);
      expect(disk.prepare('PRAGMA index_info(idx_gantt_done_start)').all()).toMatchObject([{ name: 'is_done' }, { name: 'start_time' }]);
      disk.close();
      disk = openDatabase(filename);
      expect(new TaskService(disk).list()).toEqual([task]);
    } finally {
      if (disk.open) disk.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses a database from a newer application version without changing it', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'light-gantt-version-'));
    const filename = path.join(directory, 'gantt.sqlite');
    const future = new Database(filename);
    future.pragma('user_version = 3');
    future.close();
    try {
      expect(() => openDatabase(filename)).toThrow('数据库版本高于此应用支持的版本');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('propagates storage failures instead of reporting a successful write', () => {
    const task = service.create(input);
    db.pragma('query_only = ON');
    expect(() => service.update(task.id, { name: '不应保存' })).toThrow();
    expect(service.list()).toEqual([task]);
  });
});
