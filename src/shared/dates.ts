const DAY_MS = 86_400_000;

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9999-12-31') return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function dayNumber(value: string): number {
  if (!isDate(value)) throw new RangeError(`无效日期：${value}`);
  return Date.parse(`${value}T00:00:00Z`) / DAY_MS;
}

export function addDays(value: string, count: number): string {
  const result = new Date((dayNumber(value) + count) * DAY_MS).toISOString().slice(0, 10);
  if (!isDate(result)) throw new RangeError('日期超出支持范围');
  return result;
}

export function daysBetween(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start);
}

export function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function chineseDate(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

export function shortDate(value: string): string {
  const [, month, day] = value.split('-').map(Number);
  return `${month}月${day}日`;
}

export function weekDay(value: string): number {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

export function taskRange(start: string, end: string | null, currentDay: string): { start: string; end: string } {
  return { start, end: end ?? (start > currentDay ? start : currentDay) };
}

export type DragMode = 'move' | 'start' | 'end';

export function shiftTask(start: string, end: string | null, mode: DragMode, delta: number, currentDay: string) {
  if (mode === 'move') return { start_time: addDays(start, delta), end_time: end === null ? null : addDays(end, delta) };
  if (mode === 'start') {
    const next = addDays(start, delta);
    return { start_time: end && next > end ? end : next, end_time: end };
  }
  const next = addDays(taskRange(start, end, currentDay).end, delta);
  return { start_time: start, end_time: next < start ? start : next };
}
