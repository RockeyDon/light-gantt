import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { DailyProgress, ProgressDraft, SaveProgress, Task } from '../shared/contracts';
import { chineseDate, today } from '../shared/dates';
import { Icon } from './icons';

export function discardProgress(): boolean {
  return window.confirm('进展尚未保存，放弃这些修改？');
}

interface FormProps {
  tasks: Task[];
  records: DailyProgress[];
  taskId?: string;
  date?: string;
  draft?: ProgressDraft;
  onSave: (input: SaveProgress) => Promise<void>;
  onDelete: (record: DailyProgress) => Promise<void>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function ProgressForm({ tasks, records, taskId, date: initialDate, draft, onSave, onDelete, onClose, onDirtyChange, onBusyChange }: FormProps) {
  const initialTask = taskId ?? (draft?.candidates.length === 1 ? draft.candidates[0] : '');
  const initialDay = initialDate ?? draft?.date ?? today();
  const find = (id: string, day: string) => records.find((record) => record.task_id === id && record.date === day);
  const initialRecord = find(initialTask, initialDay);
  const [selected, setSelected] = useState(initialTask);
  const [date, setDate] = useState(initialDay);
  const [content, setContent] = useState(draft?.content ?? initialRecord?.content ?? '');
  const [baseline, setBaseline] = useState(draft?.content ?? initialRecord?.content ?? '');
  const [original, setOriginal] = useState<DailyProgress | undefined>(initialRecord);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const lock = useRef(false);
  const dirty = content !== baseline;
  const id = useId();
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(
    () => () => {
      onDirtyChange?.(false);
    },
    [onDirtyChange],
  );

  function changeTarget(nextTask: string, nextDate: string) {
    if (dirty && !discardProgress()) return;
    const record = find(nextTask, nextDate);
    // Preserve the proposed summary while selecting its target task.
    const text = draft && nextDate === initialDay ? draft.content : (record?.content ?? '');
    setSelected(nextTask);
    setDate(nextDate);
    setOriginal(record);
    setContent(text);
    setBaseline(text);
    setError('');
    setDeleting(false);
  }

  function close() {
    if (!lock.current && (!dirty || discardProgress())) onClose();
  }

  async function commit(remove = false) {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    onBusyChange?.(true);
    setError('');
    try {
      if (remove && original) await onDelete(original);
      else await onSave({ task_id: selected, date, content, expected_content: original?.content ?? null });
      setBaseline(content);
      onDirtyChange?.(false);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试');
    } finally {
      lock.current = false;
      setSaving(false);
      onBusyChange?.(false);
    }
  }

  return (
    <form
      className="progress-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void commit();
      }}
    >
      {!taskId && (
        <label className="field" htmlFor={`${id}-task`}>
          任务
          <select id={`${id}-task`} value={selected} required disabled={saving} onChange={(event) => changeTarget(event.target.value, date)}>
            <option value="">请选择任务</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name} · {task.assign || '未分配'} · {task.start_time}
                {task.is_done ? ' · 已完成' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {draft && draft.candidates.length !== 1 && (
        <p className="field-hint">
          {draft.candidates.length ? `“${draft.task_query}”匹配到多个任务，请选择目标。` : `未找到“${draft.task_query}”，请从现有任务中选择，或跳过后修改描述。`}
        </p>
      )}
      <label className="field">
        日期
        <input type="date" required min="0001-01-01" max={today()} value={date} disabled={saving} onChange={(event) => changeTarget(selected, event.target.value)} />
      </label>
      {draft && original && (
        <div className="progress-original">
          <span className="muted">这一天已有进展，确认保存后更新：</span>
          <p>{original.content}</p>
        </div>
      )}
      <label className="field">
        进展内容
        <textarea
          autoFocus={!!taskId}
          required
          rows={4}
          value={content}
          disabled={saving}
          placeholder="今天推进了什么？有什么值得留下的记录？"
          onChange={(event) => setContent(event.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {deleting && (
        <div className="progress-delete-confirm" role="alert">
          <span>删除这一天的进展？</span>
          <button type="button" className="text-button danger-text" disabled={saving} onClick={() => void commit(true)}>
            确认删除进展
          </button>
          <button type="button" className="text-button" disabled={saving} onClick={() => setDeleting(false)}>
            保留
          </button>
        </div>
      )}
      <div className="modal-footer">
        {original && !draft && (
          <button type="button" className="button danger-text" disabled={saving} onClick={() => setDeleting(true)}>
            <Icon name="trash" size={15} />
            删除进展
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={saving} onClick={close}>
            {draft ? '跳过' : '取消'}
          </button>
          <button type="submit" className="button primary" disabled={saving || !selected || !content.trim()}>
            {saving ? '保存中…' : original ? '保存进展' : '记录进展'}
          </button>
        </div>
      </div>
    </form>
  );
}

export function ProgressDialog(props: FormProps & { active?: boolean; batchLabel?: string; onEndBatch?: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const { active = true } = props;
  useEffect(() => {
    const element = dialog.current!;
    if (active) element.showModal();
    else element.close();
    return () => element.close();
  }, [active]);
  const task = props.tasks.find((task) => task.id === props.taskId);
  function close(end = false) {
    if (!busy && (!dirty || discardProgress())) {
      if (end) props.onEndBatch?.();
      else props.onClose();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="modal progress-modal"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <div>
          <h2 id={titleId}>{props.draft ? '确认每日进展' : '每日进展'}</h2>
          {task && <p className="progress-task-name">{task.name}</p>}
          {props.batchLabel && <span className="muted">{props.batchLabel}</span>}
        </div>
        <button className="icon-button" aria-label="关闭进展" disabled={busy} onClick={() => close()}>
          <Icon name="close" />
        </button>
      </div>
      <ProgressForm {...props} onDirtyChange={setDirty} onBusyChange={setBusy} />
      {props.onEndBatch && (
        <button type="button" className="text-button progress-end-batch" disabled={busy} onClick={() => close(true)}>
          结束本次
        </button>
      )}
    </dialog>
  );
}

export function ProgressPanel({
  task,
  records,
  onSave,
  onDelete,
  onDirtyChange,
  onBusyChange,
}: {
  task: Task;
  records: DailyProgress[];
  onSave: FormProps['onSave'];
  onDelete: FormProps['onDelete'];
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const entries = records.filter((record) => record.task_id === task.id).sort((a, b) => b.date.localeCompare(a.date));
  if (editing !== null)
    return (
      <ProgressForm
        key={editing}
        tasks={[task]}
        records={records}
        taskId={task.id}
        date={editing}
        onSave={onSave}
        onDelete={onDelete}
        onClose={() => setEditing(null)}
        onDirtyChange={onDirtyChange}
        onBusyChange={onBusyChange}
      />
    );
  return (
    <div className="progress-panel">
      <div className="progress-panel-toolbar">
        <span className="muted">{entries.length} 条记录</span>
        <button type="button" className="button secondary" onClick={() => setEditing(today())}>
          <Icon name="plus" size={15} />
          {entries.some((entry) => entry.date === today()) ? '编辑今日进展' : '记录今日进展'}
        </button>
      </div>
      <button type="button" className="text-button progress-backfill" onClick={() => setEditing('')}>
        补记其他日期
      </button>
      {entries.length === 0 ? (
        <p className="progress-empty">还没有进展记录，留下一点今天的收获。</p>
      ) : (
        <ol className="progress-list">
          {entries.map((entry) => (
            <li key={entry.date}>
              <button type="button" onClick={() => setEditing(entry.date)}>
                <time dateTime={entry.date}>{chineseDate(entry.date)}</time>
                <span>{entry.content}</span>
                <small>编辑</small>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
