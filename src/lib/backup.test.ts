import { describe, expect, it } from 'vitest';
import { parseBackup, serializeBackup } from './backup';
import type { LogEntry } from '../types';

function entry(date: string, text = `日志 ${date}`): LogEntry {
  return {
    id: `day-${date}`,
    date,
    text,
    createdAt: Date.parse(`${date}T12:00:00Z`),
    parsed: {
      nodes: [
        { type: 'emotion', name: '撕裂', polarity: -4, intensity: 5, quote: '整个人被撕裂' },
        { type: 'person', name: '妈妈' },
      ],
      edges: [{ source: 'person:妈妈', target: 'emotion:撕裂', relation: 'involves', weight: 0.8 }],
    },
  };
}

describe('备份往返', () => {
  it('导出再导入，日志与解析结果一字不差', () => {
    const entries = [entry('2024-06-20'), entry('2024-04-02')];
    const { entries: restored, skipped } = parseBackup(serializeBackup(entries));
    expect(skipped).toBe(0);
    expect(restored.map((e) => e.date)).toEqual(['2024-04-02', '2024-06-20']);
    expect(restored[1].text).toBe('日志 2024-06-20');
    expect(restored[1].parsed.nodes[0].quote).toBe('整个人被撕裂');
    expect(restored[1].parsed.edges[0].relation).toBe('involves');
  });

  it('接受直接是数组的老格式', () => {
    const { entries } = parseBackup(JSON.stringify([entry('2024-05-01')]));
    expect(entries).toHaveLength(1);
    expect(entries[0].date).toBe('2024-05-01');
  });

  it('跳过坏记录，但保留好记录', () => {
    const raw = JSON.stringify({
      app: 'mindweb',
      version: 1,
      entries: [
        entry('2024-05-01'),
        { date: '不是日期', text: 'x', parsed: { nodes: [], edges: [] } },
        { date: '2024-05-02', text: '缺 parsed' },
        { date: '2024-05-03', text: 'x', parsed: { nodes: [], edges: [] } },
      ],
    });
    const { entries, skipped } = parseBackup(raw);
    expect(entries.map((e) => e.date)).toEqual(['2024-05-01']);
    expect(skipped).toBe(3);
  });

  it('缺少 id 的条目按日期补一个，保证能落库', () => {
    const raw = JSON.stringify({
      entries: [
        {
          date: '2024-05-09',
          text: '没有 id',
          parsed: { nodes: [{ type: 'emotion', name: '空', polarity: 0, intensity: 2 }], edges: [] },
        },
      ],
    });
    const { entries } = parseBackup(raw);
    expect(entries[0].id).toBe('day-2024-05-09');
    expect(entries[0].createdAt).toBeGreaterThan(0);
  });

  it('不是 JSON、或结构不对，给出能看懂的错误', () => {
    expect(() => parseBackup('随便一段话')).toThrow(/JSON/);
    expect(() => parseBackup('{"foo":1}')).toThrow(/entries/);
    expect(() => parseBackup('{"entries":[]}')).toThrow(/没有一条可用/);
  });
});
