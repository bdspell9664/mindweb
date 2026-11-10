/**
 * 日期一律用本地时区的 YYYY-MM-DD。
 * 不能用 toISOString().slice(0,10) —— 那是 UTC，东八区晚上 8 点后会算成第二天。
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayLocal(now = new Date()): string {
  return formatLocalDate(now);
}

/** n 天前的日期；n = 0 就是今天 */
export function daysAgoLocal(days: number, now = new Date()): string {
  const d = new Date(now.getTime());
  d.setDate(d.getDate() - days);
  return formatLocalDate(d);
}

/** 「近 N 天」包含今天，所以起点是 N-1 天前 */
export function lastNDaysStart(days: number, now = new Date()): string {
  return daysAgoLocal(Math.max(0, days - 1), now);
}
