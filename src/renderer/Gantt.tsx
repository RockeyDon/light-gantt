import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type UIEvent } from 'react';
import type { Task, UpdateTask } from '../shared/contracts';
import { addDays, chineseDate, daysBetween, shiftTask, shortDate, taskRange, weekDay, type DragMode } from '../shared/dates';
import { Icon } from './icons';
import { safeShift, timelineCount, type TimelineView } from './TimelineControls';

const PALETTE = ['sage', 'blue', 'amber', 'violet', 'rose', 'teal'];
export function taskColor(assign: string): string {
  let hash = 0;
  for (const char of assign || '未分配') hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

type Preview = { id: string; start_time: string; end_time: string | null };

export function Gantt({
  tasks,
  view,
  onViewChange,
  collapsed,
  today,
  loading,
  busy,
  onEdit,
  onCreate,
  onUpdate,
  onDone,
}: {
  tasks: Task[];
  view: TimelineView;
  onViewChange: (view: TimelineView) => void;
  collapsed: boolean;
  today: string;
  loading: boolean;
  busy: boolean;
  onEdit: (task: Task) => void;
  onCreate: () => void;
  onUpdate: (task: Task, patch: UpdateTask) => Promise<void>;
  onDone: (task: Task) => void;
}) {
  const { scale, anchor } = view;
  const [preview, setPreview] = useState<Preview | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const horizontalScroll = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(false);
  const drag = useRef<{ task: Task; mode: DragMode; x: number; delta: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const dayWidth = scale === 'day' ? 44 : 18;
  // A bounded date window keeps distant tasks from creating oversized browser layouts.
  const count = timelineCount(view);
  const end = safeShift(anchor, count - 1);
  const width = count * dayWidth;
  const dates = useMemo(() => Array.from({ length: count }, (_, index) => addDays(anchor, index)), [anchor, count]);
  const months = useMemo(() => {
    const result: { label: string; start: number; count: number }[] = [];
    dates.forEach((date, index) => {
      const label = `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月`;
      if (result.at(-1)?.label === label) result[result.length - 1].count++;
      else result.push({ label, start: index, count: 1 });
    });
    return result;
  }, [dates]);

  useEffect(() => {
    if (loading || firstLoad.current) return;
    firstLoad.current = true;
    const earliest = tasks.reduce((min, task) => (task.start_time < min ? task.start_time : min), today);
    onViewChange({ ...view, anchor: safeShift(earliest, -7) });
  }, [loading, tasks, today, view, onViewChange]);

  useEffect(() => {
    scroll.current?.querySelectorAll<HTMLElement>('.timeline-window').forEach((element) => {
      element.scrollLeft = 0;
    });
    if (horizontalScroll.current) horizontalScroll.current.scrollLeft = 0;
  }, [anchor, scale]);

  // Each row clips its own timeline, leaving both fixed columns outside horizontal scrolling.
  function syncHorizontal(event: UIEvent<HTMLDivElement>) {
    const left = event.currentTarget.scrollLeft;
    scroll.current?.querySelectorAll<HTMLElement>('.timeline-window').forEach((element) => {
      if (element.scrollLeft !== left) element.scrollLeft = left;
    });
    if (horizontalScroll.current && horizontalScroll.current.scrollLeft !== left) horizontalScroll.current.scrollLeft = left;
  }

  useLayoutEffect(() => {
    const left = horizontalScroll.current?.scrollLeft ?? 0;
    scroll.current?.querySelectorAll<HTMLElement>('.timeline-window').forEach((element) => {
      element.scrollLeft = left;
    });
  }, [tasks]);

  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    function wheel(event: WheelEvent) {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta || !horizontalScroll.current) return;
      event.preventDefault();
      horizontalScroll.current.scrollLeft += delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientWidth : 1);
      if (!event.shiftKey) element!.scrollTop += event.deltaY;
    }
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  useLayoutEffect(() => {
    const dateHeader = scroll.current?.querySelector<HTMLElement>('.date-heading');
    const scrollbar = horizontalScroll.current;
    if (!dateHeader || !scrollbar) return;
    const observer = new ResizeObserver(() => {
      scrollbar.style.width = `${dateHeader.clientWidth}px`;
    });
    observer.observe(dateHeader);
    return () => observer.disconnect();
  }, []);

  function begin(event: PointerEvent<HTMLButtonElement>, task: Task) {
    if (busy || event.button !== 0) return;
    const target = event.target as HTMLElement;
    const mode = target.dataset.edge as DragMode | undefined;
    drag.current = { task, mode: mode ?? 'move', x: event.clientX, delta: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressClick.current = false;
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = drag.current;
    if (!current) return;
    if (Math.abs(event.clientX - current.x) < 4 && !current.moved) return;
    current.moved = true;
    suppressClick.current = true;
    current.delta = Math.round((event.clientX - current.x) / dayWidth);
    try {
      setPreview({ id: current.task.id, ...shiftTask(current.task.start_time, current.task.end_time, current.mode, current.delta, today) });
    } catch {
      /* Keep the last valid preview at the supported date boundaries. */
    }
  }

  function finish() {
    const current = drag.current;
    drag.current = null;
    if (!current?.moved) return;
    if (preview && (preview.start_time !== current.task.start_time || preview.end_time !== current.task.end_time)) {
      void onUpdate(current.task, { start_time: preview.start_time, end_time: preview.end_time }).finally(() => setPreview(null));
    } else setPreview(null);
  }

  function focus(date: string) {
    onViewChange({ ...view, anchor: safeShift(date, -7) });
    scroll.current?.querySelectorAll<HTMLElement>('.timeline-window').forEach((element) => {
      element.scrollLeft = 0;
    });
    if (horizontalScroll.current) horizontalScroll.current.scrollLeft = 0;
  }

  return (
    <section className="schedule" aria-label="未完成任务甘特图">
      <div className="schedule-heading">
        <span className="section-label">
          <span className="status-dot" />
          进行中<span className="count-pill">{tasks.length}</span>
        </span>
      </div>
      <div className="gantt-viewport" inert={collapsed}>
        <div
          ref={scroll}
          className="gantt-scroll"
          data-testid="gantt-scroll"
          aria-busy={loading}
          style={{ '--timeline-width': `${width}px`, '--day-width': `${dayWidth}px` } as CSSProperties}
        >
          <div className="gantt-content">
            <div className="gantt-header gantt-grid">
              <div className="task-heading sticky-left">
                <span>任务 / 负责人</span>
                <span className="muted">开始日期</span>
              </div>
              <div className="date-heading timeline-window" onScroll={syncHorizontal}>
                <div className="date-scales">
                  <div className="month-scale">
                    {months.map((month) => (
                      <span key={month.label} style={{ left: month.start * dayWidth, width: month.count * dayWidth }}>
                        <b>{month.label}</b>
                      </span>
                    ))}
                  </div>
                  <div className="day-scale">
                    {dates.map((date, index) =>
                      scale === 'day' ? (
                        <span
                          key={date}
                          className={`${weekDay(date) % 6 === 0 ? 'weekend-label' : ''} ${date === today ? 'today-label' : ''}`}
                          style={{ left: index * dayWidth, width: dayWidth }}
                        >
                          <b>{Number(date.slice(-2))}</b>
                          <small>{'日一二三四五六'[weekDay(date)]}</small>
                        </span>
                      ) : (
                        (weekDay(date) === 1 || index === 0) && (
                          <span key={date} className="week-label" style={{ left: index * dayWidth, width: dayWidth * 7 }}>
                            {Number(date.slice(5, 7))}月{Number(date.slice(-2))}日
                          </span>
                        )
                      ),
                    )}
                  </div>
                </div>
              </div>
              <div className="action-heading" aria-label="任务操作" />
            </div>
            {tasks.map((task) => {
              const displayed = preview?.id === task.id ? { ...task, ...preview } : task;
              const range = taskRange(displayed.start_time, displayed.end_time, today);
              const startX = daysBetween(anchor, range.start) * dayWidth;
              const endX = (daysBetween(anchor, range.end) + 1) * dayWidth;
              const visible = endX > 0 && startX < width;
              const left = Math.max(0, startX) + 5;
              const barWidth = Math.max(dayWidth - 10, Math.min(width, endX) - Math.max(0, startX) - 10);
              const overdue = task.end_time !== null && task.end_time < today;
              return (
                <div className={`gantt-row gantt-grid ${preview?.id === task.id ? 'is-dragging' : ''}`} key={task.id} data-testid={`task-${task.id}`}>
                  <div className="task-info sticky-left">
                    <button className="task-name" onClick={() => onEdit(task)} disabled={busy} title={task.name}>
                      {task.name}
                    </button>
                    <div className="task-meta">
                      <span className={`assignee-dot ${taskColor(task.assign)}`} />
                      <span className="assignee">{task.assign || '未分配'}</span>
                      <span className="meta-separator">·</span>
                      <button className="task-date" title="定位到开始日期" onClick={() => focus(task.start_time)}>
                        {shortDate(task.start_time)}
                      </button>
                      {overdue && (
                        <span className="overdue-label" title="已超过计划结束日期">
                          已逾期
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="timeline-window" onScroll={syncHorizontal}>
                    <div className="timeline-row">
                      {dates.map((date, index) => weekDay(date) % 6 === 0 && <span className="weekend-cell" key={date} style={{ left: index * dayWidth, width: dayWidth }} />)}
                      {today >= anchor && today <= end && <span className="today-line" style={{ left: (daysBetween(anchor, today) + 0.5) * dayWidth }} />}
                      {visible && (
                        <button
                          className={`task-bar ${taskColor(task.assign)} ${displayed.end_time === null ? 'open-ended' : ''}`}
                          data-testid={`bar-${task.id}`}
                          style={{ left, width: barWidth }}
                          disabled={busy}
                          aria-label={`编辑任务：${task.name}`}
                          title={`${task.name}\n${chineseDate(displayed.start_time)} — ${displayed.end_time ? chineseDate(displayed.end_time) : '持续到今天'}\n拖动改期，拖动边缘调整日期，点击编辑`}
                          onPointerDown={(event) => begin(event, task)}
                          onPointerMove={move}
                          onPointerUp={finish}
                          onPointerCancel={() => {
                            drag.current = null;
                            setPreview(null);
                            suppressClick.current = true;
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Escape' && drag.current) {
                              drag.current = null;
                              setPreview(null);
                              suppressClick.current = true;
                            }
                          }}
                          onClick={() => {
                            if (!suppressClick.current) onEdit(task);
                            suppressClick.current = false;
                          }}
                        >
                          {startX >= 0 && <span data-edge="start" className="resize-handle start" aria-hidden="true" />}
                          <span className="bar-label">{barWidth >= 125 ? shortDate(displayed.start_time) : ''}</span>
                          {barWidth >= 170 && <span className="bar-end">{displayed.end_time ? shortDate(displayed.end_time) : '持续中'}</span>}
                          {endX <= width && <span data-edge="end" className="resize-handle end" aria-hidden="true" />}
                        </button>
                      )}
                      {!visible && (
                        <button className="offscreen-task" style={endX <= 0 ? { left: 10 } : { right: 10 }} onClick={() => focus(task.start_time)}>
                          {endX <= 0 ? '← 定位任务' : '定位任务 →'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="task-action">
                    <button className="complete-button" disabled={busy} onClick={() => onDone(task)} aria-label={`完成任务：${task.name}`} title="完成任务">
                      <Icon name="check" size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
            <div className="timeline-fill gantt-grid">
              <div className="sticky-left" />
              <div className="timeline-window" onScroll={syncHorizontal}>
                <div className="timeline-row">
                  {dates.map((date, index) => weekDay(date) % 6 === 0 && <span className="weekend-cell" key={date} style={{ left: index * dayWidth, width: dayWidth }} />)}
                  {today >= anchor && today <= end && (
                    <span className="today-line" style={{ left: (daysBetween(anchor, today) + 0.5) * dayWidth }}>
                      <span>今天</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="action-fill" />
            </div>
          </div>
        </div>
        {(loading || tasks.length === 0) && (
          <div className="empty-overlay">
            <div className="empty-icon">
              <Icon name="calendar" size={28} />
            </div>
            <h3>{loading ? '正在读取计划…' : '给下一件事，留一点时间'}</h3>
            <p>{loading ? '从本机加载任务' : '创建你的第一个任务，在时间轴上看见进展。'}</p>
            {!loading && (
              <button className="button primary" onClick={onCreate}>
                <Icon name="plus" size={16} />
                新建任务
              </button>
            )}
          </div>
        )}
      </div>
      <div className="timeline-scrollbar-wrap" inert={collapsed}>
        <div ref={horizontalScroll} className="timeline-scrollbar" data-testid="timeline-scroll" aria-label="横向滚动时间轴" tabIndex={0} onScroll={syncHorizontal}>
          <div style={{ width, height: 1 }} />
        </div>
      </div>
    </section>
  );
}
