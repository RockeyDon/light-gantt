import { afterEach, describe, expect, it, vi } from 'vitest';
import { addDays, chineseDate, daysBetween, isDate, shiftTask, taskRange, today } from '../../src/shared/dates';

afterEach(() => {
  vi.useRealTimers();
});

describe('calendar dates', () => {
  it('validates leap years and supported boundaries', () => {
    expect(isDate('2024-02-29')).toBe(true);
    for (const date of ['2025-02-29', '2026-04-31', '2026-1-01', '0000-01-01', '10000-01-01', '2026-11-12T00:00:00Z']) {
      expect(isDate(date)).toBe(false);
    }
    expect(isDate('0001-01-01')).toBe(true);
    expect(isDate('9999-12-31')).toBe(true);
    expect(() => addDays('0001-01-01', -1)).toThrow(RangeError);
    expect(() => addDays('9999-12-31', 1)).toThrow(RangeError);
  });

  it('calculates civil days across month/year and daylight saving boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
    expect(daysBetween('2026-03-07', '2026-03-10')).toBe(3);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    expect(chineseDate('2026-01-02')).toBe('2026年1月2日');
  });

  it('uses local calendar components for today', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 12, 23, 59));
    expect(today()).toBe('2026-11-12');
  });
});

describe('task ranges and drag behavior', () => {
  const currentDay = '2026-11-12';

  it('extends open-ended tasks to today and future tasks to their start day', () => {
    expect(taskRange('2026-11-01', null, currentDay)).toEqual({ start: '2026-11-01', end: currentDay });
    expect(taskRange('2026-12-01', null, currentDay)).toEqual({ start: '2026-12-01', end: '2026-12-01' });
    expect(taskRange(currentDay, currentDay, currentDay)).toEqual({ start: currentDay, end: currentDay });
  });

  it('moves a fixed range without changing its inclusive duration', () => {
    expect(shiftTask('2026-11-01', '2026-11-04', 'move', 3, currentDay)).toEqual({ start_time: '2026-11-04', end_time: '2026-11-07' });
    expect(shiftTask('2026-11-01', null, 'move', 3, currentDay)).toEqual({ start_time: '2026-11-04', end_time: null });
  });

  it('clamps edges to prevent inverted dates and allows setting an open end by dragging', () => {
    expect(shiftTask('2026-11-01', '2026-11-04', 'start', 10, currentDay)).toEqual({ start_time: '2026-11-04', end_time: '2026-11-04' });
    expect(shiftTask('2026-11-01', '2026-11-04', 'end', -10, currentDay)).toEqual({ start_time: '2026-11-01', end_time: '2026-11-01' });
    expect(shiftTask('2026-11-01', null, 'end', 2, currentDay)).toEqual({ start_time: '2026-11-01', end_time: '2026-11-14' });
    expect(shiftTask('2026-11-15', null, 'end', 2, currentDay)).toEqual({ start_time: '2026-11-15', end_time: '2026-11-17' });
  });
});
