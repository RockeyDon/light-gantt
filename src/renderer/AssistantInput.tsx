import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateTask, DailyProgress, ProgressDraft, SaveProgress, Task } from '../shared/contracts';
import { Icon } from './icons';
import { ProgressDialog } from './ProgressEditor';
import { TaskEditor } from './TaskEditor';

interface Batch {
  tasks: CreateTask[];
  index: number;
  created: number;
}

export function AssistantInput({
  tasks,
  records,
  onSaveProgress,
  onDeleteProgress,
  blocked,
  disabled,
  onCreate,
  onSettings,
  onNotice,
}: {
  tasks: Task[];
  records: DailyProgress[];
  onSaveProgress: (input: SaveProgress) => Promise<void>;
  onDeleteProgress: (record: DailyProgress) => Promise<void>;
  blocked: boolean;
  disabled: boolean;
  onCreate: (input: CreateTask) => Promise<void>;
  onSettings: () => void;
  onNotice: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState('');
  const [needsSettings, setNeedsSettings] = useState(false);
  const [progressBatch, setProgressBatch] = useState<{ records: ProgressDraft[]; index: number; saved: number } | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const parseLock = useRef(false);
  const saved = useRef(false);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!batch && !progressBatch && returnFocus.current) {
      returnFocus.current = false;
      input.current?.focus();
    }
  }, [batch, progressBatch]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (parseLock.current || batch || progressBatch || blocked || disabled || !text.trim()) return;
    parseLock.current = true;
    setParsing(true);
    setError('');
    setNeedsSettings(false);
    try {
      const result = await window.assistant.parse(text);
      if (!result.ok) {
        setNeedsSettings(result.error.code === 'LLM_CONFIG_MISSING');
        setError(result.error.message);
      } else if (result.data.kind === 'unsupported') {
        setError(result.data.message);
      } else if (result.data.kind === 'record_progress') {
        saved.current = false;
        setProgressBatch({ records: result.data.records, index: 0, saved: 0 });
      } else {
        saved.current = false;
        setBatch({ tasks: result.data.tasks, index: 0, created: 0 });
      }
    } catch {
      setError('解析失败，请稍后重试');
    } finally {
      parseLock.current = false;
      setParsing(false);
    }
  }

  function finish(created: number, total: number) {
    returnFocus.current = true;
    setBatch(null);
    setText('');
    onNotice(`已创建 ${created} 项任务，跳过 ${total - created} 项`);
  }

  function advance() {
    if (!batch) return;
    const created = batch.created + Number(saved.current);
    saved.current = false;
    if (batch.index + 1 === batch.tasks.length) finish(created, batch.tasks.length);
    else setBatch({ ...batch, created, index: batch.index + 1 });
  }

  function finishProgress(count: number, total: number) {
    returnFocus.current = true;
    setProgressBatch(null);
    setText('');
    onNotice(`已保存 ${count} 条进展，跳过 ${total - count} 条`);
  }

  function advanceProgress() {
    if (!progressBatch) return;
    const count = progressBatch.saved + Number(saved.current);
    saved.current = false;
    if (progressBatch.index + 1 === progressBatch.records.length) finishProgress(count, progressBatch.records.length);
    else setProgressBatch({ ...progressBatch, saved: count, index: progressBatch.index + 1 });
  }

  return (
    <>
      <form
        className="assistant-input"
        onSubmit={(event) => {
          void submit(event);
        }}
        aria-label="通用输入"
      >
        {error && (
          <div className="assistant-error" role="alert">
            <span>{error}</span>
            {needsSettings && (
              <button type="button" className="text-button" onClick={onSettings}>
                打开配置
              </button>
            )}
          </div>
        )}
        <div className="assistant-composer">
          <textarea
            ref={input}
            aria-label="输入你想安排的事"
            placeholder="输入你想安排的事…"
            rows={1}
            value={text}
            disabled={parsing || !!batch || !!progressBatch}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {parsing && (
            <span className="assistant-status" role="status">
              正在理解…
            </span>
          )}
          <button
            type="submit"
            className="icon-button"
            aria-label="发送"
            title="发送（Enter）"
            disabled={parsing || !!batch || !!progressBatch || blocked || disabled || !text.trim()}
          >
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </form>
      {progressBatch && (
        <ProgressDialog
          key={`progress-${progressBatch.index}`}
          tasks={tasks}
          records={records}
          draft={progressBatch.records[progressBatch.index]}
          active={!blocked}
          batchLabel={`第 ${progressBatch.index + 1} / ${progressBatch.records.length} 条`}
          onClose={advanceProgress}
          onEndBatch={() => finishProgress(progressBatch.saved, progressBatch.records.length)}
          onSave={async (input) => {
            await onSaveProgress(input);
            saved.current = true;
          }}
          onDelete={onDeleteProgress}
        />
      )}
      {batch && (
        <TaskEditor
          key={batch.index}
          task={null}
          draft={batch.tasks[batch.index]}
          active={!blocked}
          progress={`第 ${batch.index + 1} / ${batch.tasks.length} 项`}
          onClose={advance}
          onEndBatch={() => finish(batch.created, batch.tasks.length)}
          onDelete={() => {
            /* Drafts have no persisted task to delete. */
          }}
          onSave={async (draft) => {
            await onCreate(draft);
            saved.current = true;
          }}
        />
      )}
    </>
  );
}
