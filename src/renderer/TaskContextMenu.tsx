import { useEffect, useRef } from 'react';
import type { Task } from '../shared/contracts';

export function TaskContextMenu({ task, x, y, hasToday, onRecord, onClose }: { task: Task; x: number; y: number; hasToday: boolean; onRecord: () => void; onClose: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const dismiss = (event: globalThis.PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') {
        event.preventDefault();
        onClose();
      }
    };
    const scroll = () => onClose();
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', key);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', scroll);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', key);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', scroll);
      previous?.focus({ preventScroll: true });
    };
  }, [onClose]);
  return (
    <div
      ref={menu}
      role="menu"
      aria-label={`${task.name}的操作`}
      className="task-context-menu"
      style={{ left: Math.max(8, Math.min(x, window.innerWidth - 180)), top: Math.max(8, Math.min(y, window.innerHeight - 58)) }}
    >
      <button role="menuitem" onClick={onRecord}>
        {hasToday ? '编辑今日进展' : '记录今日进展'}
      </button>
    </div>
  );
}
