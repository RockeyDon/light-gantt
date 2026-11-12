import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { CreateTask, ErrorCode, Task, UpdateTask } from '../shared/contracts';
import { isDate } from '../shared/dates';

export class TaskError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const dateSchema = z.string().refine(isDate, '请填写有效的年月日');
const fields = {
  name: z.string().trim().min(1, '任务名称不能为空'),
  start_time: dateSchema,
  end_time: dateSchema.nullable(),
  assign: z.string().trim(),
};
const createSchema = z.object(fields).strict();
const updateSchema = createSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, '请提供要修改的字段')
  .refine((value) => Object.values(value).every((field) => field !== undefined), '修改字段不能是 undefined，请用 null 清空结束日期');
const idSchema = z.string().uuid('任务 ID 无效');

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaskError('INVALID_INPUT', result.error.issues.map((issue) => issue.message).join('；'));
  return result.data;
}

type TaskRow = Omit<Task, 'is_done'> & { is_done: number };

export class TaskService {
  constructor(private readonly db: Database.Database) {}

  list(isDone?: unknown): Task[] {
    if (isDone !== undefined && typeof isDone !== 'boolean') throw new TaskError('INVALID_INPUT', '完成状态必须是布尔值');
    const rows =
      isDone === undefined
        ? this.db.prepare('SELECT * FROM gantt ORDER BY start_time, id').all()
        : this.db.prepare('SELECT * FROM gantt WHERE is_done = ? ORDER BY start_time, id').all(Number(isDone));
    return (rows as TaskRow[]).map((row) => ({ ...row, is_done: Boolean(row.is_done) }));
  }

  private get(id: unknown): Task {
    const validId = parse(idSchema, id);
    const row = this.db.prepare('SELECT * FROM gantt WHERE id = ?').get(validId) as TaskRow | undefined;
    if (!row) throw new TaskError('NOT_FOUND', '任务不存在，可能已被删除');
    return { ...row, is_done: Boolean(row.is_done) };
  }

  private checkRange(task: CreateTask): void {
    if (task.end_time !== null && task.end_time < task.start_time) throw new TaskError('INVALID_INPUT', '结束日期不能早于开始日期');
  }

  create(input: unknown): Task {
    const data = parse(createSchema, input);
    this.checkRange(data);
    const task: Task = { ...data, id: randomUUID(), is_done: false };
    this.db
      .prepare('INSERT INTO gantt (id, name, start_time, end_time, assign, is_done) VALUES (?, ?, ?, ?, ?, 0)')
      .run(task.id, task.name, task.start_time, task.end_time, task.assign);
    return task;
  }

  update(id: unknown, input: unknown): Task {
    const data: UpdateTask = parse(updateSchema, input);
    const task = { ...this.get(id), ...data };
    this.checkRange(task);
    this.db.prepare('UPDATE gantt SET name = ?, start_time = ?, end_time = ?, assign = ? WHERE id = ?').run(task.name, task.start_time, task.end_time, task.assign, task.id);
    return task;
  }

  remove(id: unknown): void {
    const task = this.get(id);
    this.db.prepare('DELETE FROM gantt WHERE id = ?').run(task.id);
  }

  setDone(id: unknown, isDone: unknown): Task {
    const validDone = parse(z.boolean(), isDone);
    const task = this.get(id);
    this.db.prepare('UPDATE gantt SET is_done = ? WHERE id = ?').run(Number(validDone), task.id);
    return { ...task, is_done: validDone };
  }
}
