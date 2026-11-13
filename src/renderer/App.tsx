import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { CreateTask, Result, Task, UpdateTask } from '../shared/contracts';
import { chineseDate, today } from '../shared/dates';
import { Gantt, taskColor } from './Gantt';
import { TimelineControls, safeShift, type TimelineView } from './TimelineControls';
import { Icon } from './icons';
import { DeleteConfirmation, TaskEditor } from './TaskEditor';
import { SettingsDialog } from './SettingsDialog';
import { AssistantInput } from './AssistantInput';

async function unwrap<T>(request: Promise<Result<T>>): Promise<T> {
  const result = await request;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => a.start_time.localeCompare(b.start_time) || a.id.localeCompare(b.id));
}

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<{ task: Task | null } | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [completedHeight, setCompletedHeight] = useState(36);
  const [workspaceHeight, setWorkspaceHeight] = useState(0);
  const [timeline, setTimeline] = useState<TimelineView>(() => ({ anchor: safeShift(today(), -7), scale: 'day' }));
  const [currentDay, setCurrentDay] = useState(today);
  const workspace = useRef<HTMLDivElement>(null);
  const resizing = useRef<{ y: number; height: number } | null>(null);
  const mutationLock = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setTasks(await unwrap(window.tasks.list()));
    } catch (error) {
      setError(error instanceof Error ? error.message : '读取任务失败，请重试');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const unsubscribe = window.settings.onOpen(() => setSettingsOpen(true));
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ',') {
        event.preventDefault();
        setSettingsOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDay(today()), 30_000);
    const focus = () => setCurrentDay(today());
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const element = workspace.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const height = element.clientHeight;
      setWorkspaceHeight(height);
      setCompletedHeight((previous) => Math.max(36, Math.min(previous, height - 36)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  async function mutate<T>(operation: () => Promise<T>): Promise<T> {
    if (mutationLock.current) throw new Error('正在保存，请稍候');
    mutationLock.current = true;
    setBusy(true);
    setError('');
    try {
      return await operation();
    } finally {
      mutationLock.current = false;
      setBusy(false);
    }
  }

  function replaceTask(task: Task) {
    setTasks((previous) => sortTasks([...previous.filter((item) => item.id !== task.id), task]));
  }

  async function save(input: CreateTask) {
    await mutate(async () => {
      const task = await unwrap(editor?.task ? window.tasks.update(editor.task.id, input) : window.tasks.create(input));
      replaceTask(task);
      setNotice(editor?.task ? '修改已保存' : '新任务已加入计划');
    });
  }

  async function updateDates(task: Task, patch: UpdateTask) {
    try {
      await mutate(async () => {
        replaceTask({ ...task, ...patch });
        try {
          replaceTask(await unwrap(window.tasks.update(task.id, patch)));
          setNotice('排期已更新');
        } catch (error) {
          replaceTask(task);
          throw error;
        }
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '修改失败，已恢复原排期');
    }
  }

  async function toggleDone(task: Task) {
    try {
      await mutate(async () => {
        replaceTask(await unwrap(window.tasks.setDone(task.id, !task.is_done)));
        setNotice(task.is_done ? '任务已恢复到进行中' : '又完成了一件事，做得不错');
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '状态更新失败');
    }
  }

  async function removeTask() {
    if (!deleting) return;
    await mutate(async () => {
      await unwrap(window.tasks.remove(deleting.id));
      setTasks((previous) => previous.filter((task) => task.id !== deleting.id));
      setDeleting(null);
      setEditor(null);
      setNotice('任务已删除');
    });
  }

  function clampHeight(height: number): number {
    return Math.max(36, Math.min(height, (workspace.current?.clientHeight ?? 72) - 36));
  }

  function resize(event: PointerEvent<HTMLDivElement>) {
    if (!resizing.current) return;
    setCompletedHeight(clampHeight(resizing.current.height + resizing.current.y - event.clientY));
  }

  const active = tasks.filter((task) => !task.is_done);
  const completed = tasks.filter((task) => task.is_done);
  const maxCompletedHeight = Math.max(36, workspaceHeight - 36);

  return (
    <div className="app-shell">
      <main>
        <div className="page-heading">
          <h1>任务计划</h1>
          <div className="page-actions">
            <TimelineControls view={timeline} today={currentDay} onChange={setTimeline} />
            <button className="button primary create-task" disabled={loading || busy} onClick={() => setEditor({ task: null })}>
              <Icon name="plus" size={16} />
              新建任务
            </button>
            <button className="icon-button" aria-label="配置" title="配置（⌘,）" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <Icon name="warning" size={17} />
            <span>{error}</span>
            <button
              className="text-button"
              disabled={busy || loading}
              onClick={() => {
                void load();
              }}
            >
              重新读取
            </button>
            <button className="icon-button" aria-label="关闭错误提示" onClick={() => setError('')}>
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        <div className="workspace" ref={workspace} style={{ '--completed-height': `${completedHeight}px` } as CSSProperties}>
          <Gantt
            tasks={active}
            view={timeline}
            onViewChange={setTimeline}
            collapsed={completedHeight >= maxCompletedHeight}
            today={currentDay}
            loading={loading}
            busy={busy}
            onEdit={(task) => setEditor({ task })}
            onCreate={() => setEditor({ task: null })}
            onUpdate={updateDates}
            onDone={(task) => {
              void toggleDone(task);
            }}
          />
          <section className="completed-pane" aria-label="已完成任务">
            <div
              className="completed-heading"
              role="separator"
              aria-label="调整已完成区域高度"
              aria-controls="completed-content"
              aria-orientation="horizontal"
              tabIndex={0}
              title="上下拖动调整高度，或使用方向键、Home、End"
              aria-valuemin={36}
              aria-valuemax={maxCompletedHeight}
              aria-valuenow={completedHeight}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                resizing.current = { y: event.clientY, height: completedHeight };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={resize}
              onPointerUp={() => {
                resizing.current = null;
              }}
              onPointerCancel={() => {
                resizing.current = null;
              }}
              onLostPointerCapture={() => {
                resizing.current = null;
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  setCompletedHeight((height) => clampHeight(height + (event.key === 'ArrowUp' ? 24 : -24)));
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault();
                  setCompletedHeight(event.key === 'Home' ? 36 : maxCompletedHeight);
                }
              }}
            >
              <span className="section-label">
                <Icon name="archive" size={15} />
                已完成<span className="count-pill">{completed.length}</span>
              </span>
              <span className="card-grip" aria-hidden="true" />
            </div>
            <div className="completed-scroll" id="completed-content" inert={completedHeight === 36}>
              {completed.length === 0 ? (
                <p className="completed-empty">暂无已完成任务</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>任务名称</th>
                      <th>负责人</th>
                      <th>开始日期</th>
                      <th>结束日期</th>
                      <th className="table-actions" aria-label="任务操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {completed.map((task) => (
                      <tr key={task.id}>
                        <td>
                          <button className="completed-name" disabled={busy} onClick={() => setEditor({ task })}>
                            <span className="done-check">
                              <Icon name="check" size={12} />
                            </span>
                            {task.name}
                          </button>
                        </td>
                        <td>
                          <span className={`assignee-dot ${taskColor(task.assign)}`} />
                          {task.assign || '未分配'}
                        </td>
                        <td>{chineseDate(task.start_time)}</td>
                        <td>{task.end_time ? chineseDate(task.end_time) : '未设置'}</td>
                        <td className="table-actions">
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              void toggleDone(task);
                            }}
                            aria-label={`恢复任务：${task.name}`}
                          >
                            <Icon name="undo" size={14} />
                            恢复
                          </button>
                          <button className="icon-button delete-task" disabled={busy} aria-label={`删除任务：${task.name}`} onClick={() => setDeleting(task)}>
                            <Icon name="trash" size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
        <AssistantInput
          blocked={!!editor || !!deleting || settingsOpen}
          disabled={loading || busy}
          onSettings={() => setSettingsOpen(true)}
          onNotice={setNotice}
          onCreate={async (input) => {
            await mutate(async () => {
              replaceTask(await unwrap(window.tasks.create(input)));
            });
          }}
        />
      </main>
      {notice && (
        <div className="toast" role="status">
          <span className="toast-check">
            <Icon name="check" size={14} />
          </span>
          {notice}
        </div>
      )}
      {editor && <TaskEditor task={editor.task} onClose={() => setEditor(null)} onSave={save} onDelete={setDeleting} />}
      {deleting && <DeleteConfirmation task={deleting} onClose={() => setDeleting(null)} onConfirm={removeTask} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
