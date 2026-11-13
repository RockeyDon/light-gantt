import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { CreateTask } from '../shared/contracts';
import { Icon } from './icons';
import { TaskEditor } from './TaskEditor';

interface Batch {
  tasks: CreateTask[];
  index: number;
  created: number;
}

export function AssistantInput({
  blocked,
  disabled,
  onCreate,
  onSettings,
  onNotice,
}: {
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
  const [batch, setBatch] = useState<Batch | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const parseLock = useRef(false);
  const saved = useRef(false);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!batch && returnFocus.current) {
      returnFocus.current = false;
      input.current?.focus();
    }
  }, [batch]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (parseLock.current || batch || blocked || disabled || !text.trim()) return;
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
            disabled={parsing || !!batch}
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
          <button type="submit" className="icon-button" aria-label="发送" title="发送（Enter）" disabled={parsing || !!batch || blocked || disabled || !text.trim()}>
            <Icon name="arrow" size={18} />
          </button>
        </div>
      </form>
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
