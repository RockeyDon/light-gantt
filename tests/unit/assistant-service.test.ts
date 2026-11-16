import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../src/shared/contracts';
import { AssistantService, taskPrompt } from '../../src/main/assistant-service';

const task = { name: '设计评审', assign: '自己', start_time: '2026-11-13', end_time: null };
afterEach(() => vi.useRealTimers());

describe('AssistantService', () => {
  it('supplies local date, weekday, timezone and explicit parsing defaults without task history', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 12));
    const prompt = taskPrompt();
    expect(prompt).toContain('2026-11-13，星期五');
    expect(prompt).toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(prompt).toContain('未提负责人默认“自己”');
    expect(prompt).toContain('未提开始日期默认今天');
    expect(prompt).toContain('未提结束日期默认 null');
    expect(prompt).toContain('下一自然周的周一');
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ kind: 'create_tasks', tasks: [task] }));
    expect(await new AssistantService({ complete }).parse('  安排设计评审  ')).toEqual({ kind: 'create_tasks', tasks: [task] });
    expect(complete).toHaveBeenCalledWith(prompt, '安排设计评审');
  });

  it('accepts multiple drafts in order and an entire JSON code fence', async () => {
    const tasks = [task, { ...task, name: '开发', assign: '小林', start_time: '2026-11-16', end_time: '2026-11-18' }];
    const complete = vi.fn().mockResolvedValue('```json\n' + JSON.stringify({ kind: 'create_tasks', tasks }) + '\n```');
    expect(await new AssistantService({ complete }).parse('设计和开发')).toEqual({ kind: 'create_tasks', tasks });
  });

  it('returns unsupported intent without inventing drafts', async () => {
    const result = { kind: 'unsupported', message: '目前仅支持新建任务' };
    expect(await new AssistantService({ complete: vi.fn().mockResolvedValue(JSON.stringify(result)) }).parse('删除所有任务')).toEqual(result);
  });

  it.each(['', '  ', null, 123, {}])('rejects invalid IPC input before calling the model: %j', async (input) => {
    const complete = vi.fn();
    await expect(new AssistantService({ complete }).parse(input)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(complete).not.toHaveBeenCalled();
  });

  it.each([
    '说明：{"kind":"create_tasks","tasks":[]}',
    '{broken',
    JSON.stringify({ kind: 'create_tasks', tasks: [] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [task, { ...task, start_time: '2026-02-30' }] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [{ ...task, end_time: '2026-11-12' }] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [{ ...task, name: '' }] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [{ ...task, id: 'model-id' }] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [{ name: '缺少字段' }] }),
    JSON.stringify({ kind: 'create_tasks', tasks: [{ ...task, is_done: true }] }),
    JSON.stringify({ kind: 'delete_tasks', tasks: [task] }),
    JSON.stringify({ kind: 'unsupported', message: '' }),
  ])('rejects malformed model output as a whole: %s', async (output) => {
    await expect(new AssistantService({ complete: vi.fn().mockResolvedValue(output) }).parse('安排任务')).rejects.toMatchObject({ code: 'LLM_RESPONSE_INVALID' });
  });
});

describe('progress intent', () => {
  const tasks: Task[] = [
    { ...task, id: 'a', is_done: false, name: '接口联调', assign: '自己' },
    { ...task, id: 'b', is_done: true, name: '接口联调', assign: '小林' },
    { ...task, id: 'c', is_done: false, name: '设计评审' },
  ];
  it('matches exact or partial names without trusting model IDs and includes minimal task context', async () => {
    const records = ['接口联调', '设计', '不存在'].map((task_query) => ({ task_query, date: '2026-11-13', content: '完成初稿' }));
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ kind: 'record_progress', records }));
    const result = await new AssistantService({ complete }, () => tasks).parse('记录进展');
    expect(result).toEqual({
      kind: 'record_progress',
      records: [
        { ...records[0], candidates: ['a', 'b'] },
        { ...records[1], candidates: ['c'] },
        { ...records[2], candidates: [] },
      ],
    });
    const prompt = complete.mock.calls[0][0] as string;
    expect(prompt).toContain('接口联调');
    expect(prompt).not.toContain('"id":');
    expect(prompt).toContain('未提日期默认今天');
    expect(prompt).toContain('混合了新建与进展');
  });

  it.each([
    { task_query: '设计', date: '9999-12-31', content: '完成' },
    { task_query: '设计', date: '2026-02-30', content: '完成' },
    { task_query: '', date: '2026-11-13', content: '完成' },
    { task_query: '设计', date: '2026-11-13', content: '' },
    { task_query: '设计', date: '2026-11-13', content: '完成', candidates: ['invented'] },
  ])('rejects invalid progress output: %j', async (record) => {
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ kind: 'record_progress', records: [record] }));
    await expect(new AssistantService({ complete }).parse('记录进展')).rejects.toMatchObject({ code: 'LLM_RESPONSE_INVALID' });
  });
});
