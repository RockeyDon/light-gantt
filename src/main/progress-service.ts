import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { DailyProgress } from '../shared/contracts';
import { isDate, today } from '../shared/dates';
import { TaskError } from './task-service';

export const progressFields = {
  date: z
    .string()
    .refine(isDate, '请填写有效日期')
    .refine((date) => date <= today(), '不能记录未来的进展'),
  content: z.string().trim().min(1, '进展内容不能为空'),
};
const idSchema = z.string().uuid('任务 ID 无效');
const recordSchema = z.object({ task_id: idSchema, ...progressFields }).strict();
const saveSchema = recordSchema.extend({ expected_content: z.string().nullable() });

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new TaskError('INVALID_INPUT', result.error.issues.map((issue) => issue.message).join('；'));
  return result.data;
}

export class ProgressService {
  constructor(private readonly db: Database.Database) {}

  private task(id: unknown): string {
    const validId = parse(idSchema, id);
    if (!this.db.prepare('SELECT id FROM gantt WHERE id = ?').get(validId)) throw new TaskError('NOT_FOUND', '任务不存在，可能已被删除');
    return validId;
  }

  list(taskId?: unknown): DailyProgress[] {
    if (taskId === undefined) return this.db.prepare('SELECT * FROM task_progress ORDER BY date DESC, task_id').all() as DailyProgress[];
    return this.db.prepare('SELECT * FROM task_progress WHERE task_id = ? ORDER BY date DESC').all(this.task(taskId)) as DailyProgress[];
  }

  save(input: unknown): DailyProgress {
    const data = parse(saveSchema, input);
    return this.db.transaction(() => {
      this.task(data.task_id);
      const existing = this.db.prepare('SELECT content FROM task_progress WHERE task_id = ? AND date = ?').get(data.task_id, data.date) as { content: string } | undefined;
      if ((existing?.content ?? null) !== data.expected_content) throw new TaskError('CONFLICT', '这一天的进展已发生变化，请重新打开后确认保存');
      this.db
        .prepare(
          `INSERT INTO task_progress (task_id, date, content) VALUES (?, ?, ?)
        ON CONFLICT (task_id, date) DO UPDATE SET content = excluded.content`,
        )
        .run(data.task_id, data.date, data.content);
      return { task_id: data.task_id, date: data.date, content: data.content };
    })();
  }

  remove(input: unknown): void {
    const data = parse(recordSchema, input);
    this.task(data.task_id);
    const result = this.db.prepare('DELETE FROM task_progress WHERE task_id = ? AND date = ? AND content = ?').run(data.task_id, data.date, data.content);
    if (!result.changes) throw new TaskError('CONFLICT', '这条进展已发生变化，请重新打开后确认删除');
  }
}
