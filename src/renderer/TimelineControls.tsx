import { useEffect, useRef, useState } from 'react';
import { addDays, daysBetween, shortDate } from '../shared/dates';
import { Icon } from './icons';

export type TimelineView = { anchor: string; scale: 'day' | 'week' };

export function safeShift(date: string, days: number): string {
  try {
    return addDays(date, days);
  } catch {
    return days < 0 ? '0001-01-01' : '9999-12-31';
  }
}

export function timelineCount({ anchor, scale }: TimelineView): number {
  return Math.min(scale === 'day' ? 120 : 365, daysBetween(anchor, '9999-12-31') + 1);
}

export function TimelineControls({ view, today, onChange }: { view: TimelineView; today: string; onChange: (view: TimelineView) => void }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const end = safeShift(view.anchor, timelineCount(view) - 1);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    function outside(event: globalThis.PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  function choose(next: TimelineView) {
    onChange(next);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div
      className="timeline-controls"
      ref={container}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="icon-button"
        aria-label="时间设置"
        title="时间设置"
        aria-expanded={open}
        aria-controls="timeline-settings"
        aria-haspopup="dialog"
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon name="calendar" size={18} />
      </button>
      {open && (
        <div className="timeline-popover" ref={panel} id="timeline-settings" role="dialog" aria-label="时间设置">
          <div className="timeline-navigation">
            <button className="icon-button" aria-label="向前一个月" onClick={() => onChange({ ...view, anchor: safeShift(view.anchor, -28) })}>
              <Icon name="left" size={16} />
            </button>
            <span className="range-label">
              {shortDate(view.anchor)} — {shortDate(end)}
              <small>
                {view.anchor.slice(0, 4)}
                {end.slice(0, 4) !== view.anchor.slice(0, 4) ? ` / ${end.slice(0, 4)}` : ''}
              </small>
            </span>
            <button className="icon-button" aria-label="向后一个月" onClick={() => onChange({ ...view, anchor: safeShift(view.anchor, 28) })}>
              <Icon name="right" size={16} />
            </button>
          </div>
          <div className="view-controls">
            <button className="button today-button" onClick={() => choose({ ...view, anchor: safeShift(today, -7) })}>
              今天
            </button>
            <div className="segmented" aria-label="时间轴刻度">
              <button aria-pressed={view.scale === 'day'} onClick={() => choose({ ...view, scale: 'day' })}>
                日
              </button>
              <button aria-pressed={view.scale === 'week'} onClick={() => choose({ ...view, scale: 'week' })}>
                周
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
