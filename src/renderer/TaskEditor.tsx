import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateTask, Task } from '../shared/contracts';
import { today } from '../shared/dates';
import { Icon } from './icons';

export function TaskEditor({
  task,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task | null;
  onClose: () => void;
  onSave: (input: CreateTask) => Promise<void>;
  onDelete: (task: Task) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(task?.name ?? '');
  const [assign, setAssign] = useState(task?.assign ?? '');
  const [start, setStart] = useState(task?.start_time ?? today());
  const [end, setEnd] = useState(task?.end_time ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({ name, assign, start_time: start, end_time: end || null });
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试');
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby="editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <form
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">TASK DETAILS</span>
            <h2 id="editor-title">{task ? '编辑任务' : '安排一个新任务'}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭编辑" disabled={saving} onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <label className="field">
          任务名称 <span className="required">*</span>
          <input name="name" autoFocus required value={name} placeholder="这次准备做什么？" onChange={(event) => setName(event.target.value)} disabled={saving} />
        </label>
        <label className="field">
          负责人
          <input name="assign" value={assign} placeholder="填写姓名，可留空" onChange={(event) => setAssign(event.target.value)} disabled={saving} />
        </label>
        <div className="date-fields">
          <label className="field">
            开始日期 <span className="required">*</span>
            <input name="start_time" type="date" min="0001-01-01" max="9999-12-31" required value={start} onChange={(event) => setStart(event.target.value)} disabled={saving} />
          </label>
          <label className="field">
            结束日期
            <input name="end_time" type="date" min={start || '0001-01-01'} max="9999-12-31" value={end} onChange={(event) => setEnd(event.target.value)} disabled={saving} />
          </label>
        </div>
        <p className="field-hint">结束日期留空时，任务将持续到今天；未来任务显示为起始标记。</p>
        {error && (
          <p role="alert" className="form-error">
            <Icon name="warning" size={16} />
            {error}
          </p>
        )}
        <div className="modal-footer">
          {task && (
            <button type="button" className="button danger-text" disabled={saving} onClick={() => onDelete(task)}>
              <Icon name="trash" size={16} />
              删除任务
            </button>
          )}
          <div className="modal-actions">
            <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button primary" disabled={saving}>
              {saving ? '保存中…' : task ? '保存修改' : '创建任务'}
              <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

export function DeleteConfirmation({ task, onClose, onConfirm }: { task: Task; onClose: () => void; onConfirm: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      className="modal confirm-modal"
      aria-labelledby="delete-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
    >
      <div className="delete-icon">
        <Icon name="trash" size={24} />
      </div>
      <h2 id="delete-title">删除这个任务？</h2>
      <p className="delete-message">“{task.name}”将被永久删除，此操作无法撤销。</p>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button className="button secondary" disabled={saving} onClick={onClose}>
          保留任务
        </button>
        <button
          className="button destructive"
          disabled={saving}
          onClick={() => {
            setSaving(true);
            void onConfirm().catch((error) => {
              setError(error instanceof Error ? error.message : '删除失败');
              setSaving(false);
            });
          }}
        >
          {saving ? '删除中…' : '确认删除'}
        </button>
      </div>
    </dialog>
  );
}
