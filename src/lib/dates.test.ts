import { describe, expect, it } from 'vitest';
import { daysAgoLocal, formatLocalDate, lastNDaysStart, todayLocal } from './dates';

describe('本地日期', () => {
  it('格式化成本地 YYYY-MM-DD（补零）', () => {
    expect(formatLocalDate(new Date(2024, 0, 5))).toBe('2024-01-05');
    expect(formatLocalDate(new Date(2024, 11, 31))).toBe('2024-12-31');
  });

  it('用本地时区而不是 UTC —— 当地时间晚上 11 点仍然是当天', () => {
    const lateNight = new Date(2024, 4, 1, 23, 30, 0);
    expect(todayLocal(lateNight)).toBe('2024-05-01');
    // 同一时刻若按 UTC 会变成 05-02（东八区），这里必须仍是 05-01
  });

  it('daysAgoLocal(0) 就是今天', () => {
    const now = new Date(2024, 4, 20, 9, 0, 0);
    expect(daysAgoLocal(0, now)).toBe(todayLocal(now));
  });

  it('跨月、跨年正确', () => {
    expect(daysAgoLocal(1, new Date(2024, 5, 1))).toBe('2024-05-31');
    expect(daysAgoLocal(6, new Date(2024, 0, 3))).toBe('2023-12-28');
    expect(daysAgoLocal(29, new Date(2024, 2, 1))).toBe('2024-02-01');
  });

  it('lastNDaysStart(7) 是 6 天前（区间含今天共 7 天）', () => {
    const now = new Date(2024, 4, 20);
    expect(lastNDaysStart(7, now)).toBe('2024-05-14');
    expect(lastNDaysStart(30, now)).toBe('2024-04-21');
    expect(lastNDaysStart(1, now)).toBe('2024-05-20');
    expect(lastNDaysStart(0, now)).toBe('2024-05-20');
  });
});
