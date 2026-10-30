import { describe, expect, it } from 'vitest';
import { extractJson, parseModelOutput, sanitizeParsed } from './parse';

describe('extractJson', () => {
  it('从 ```json 围栏里取出 JSON', () => {
    const text = '这是结果：\n```json\n{"nodes":[],"edges":[]}\n```\n希望有帮助';
    expect(extractJson(text)).toEqual({ nodes: [], edges: [] });
  });

  it('容忍前后废话与裸 JSON', () => {
    expect(extractJson('好的 {"nodes":[],"edges":[]} 完')).toEqual({ nodes: [], edges: [] });
  });

  it('不是 JSON 时抛错', () => {
    expect(() => extractJson('抱歉我无法完成')).toThrow();
    expect(() => extractJson('')).toThrow();
  });
});

describe('sanitizeParsed', () => {
  it('保留情绪原话，极性/强度夹到合法区间', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [
          { type: 'emotion', name: '撕裂', polarity: -99, intensity: 99, quote: '整个人被撕裂' },
          { type: 'person', name: '妈妈' },
        ],
        edges: [{ source: 'person:妈妈', target: 'emotion:撕裂', relation: 'involves', weight: 2 }],
      },
      '2024-05-01',
    );
    const emotion = parsed.nodes.find((n) => n.type === 'emotion')!;
    expect(emotion.name).toBe('撕裂');
    expect(emotion.polarity).toBe(-5);
    expect(emotion.intensity).toBe(5);
    expect(emotion.quote).toBe('整个人被撕裂');
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.edges[0].relation).toBe('involves');
    expect(parsed.edges[0].weight).toBe(1);
  });

  it('未知 relation 的边被丢弃，但节点不因此整篇丢失', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [
          { type: 'emotion', name: '疲惫' },
          { type: 'person', name: '妹妹' },
        ],
        edges: [{ source: 'person:妹妹', target: 'emotion:疲惫', relation: 'triggers' }],
      },
      '2024-05-01',
    );
    expect(parsed.edges).toHaveLength(0);
    expect(parsed.nodes.map((n) => n.name).sort()).toEqual(['妹妹', '疲惫']);
  });

  it('丢弃孤立节点，但保留 wish（孤立的愿望本身有意义）', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [
          { type: 'emotion', name: '孤独' },
          { type: 'person', name: '妹妹' },
          { type: 'wish', name: '去应天门' },
        ],
        edges: [{ source: 'emotion:孤独', target: 'person:妹妹', relation: 'involves' }],
      },
      '2024-05-01',
    );
    const names = parsed.nodes.map((n) => n.name);
    expect(names).toContain('孤独');
    expect(names).toContain('妹妹');
    expect(names).toContain('去应天门');
    expect(names).not.toContain('妈妈');
  });

  it('边可以引用本篇未声明的节点，交由合并阶段判断能否连上', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [{ type: 'emotion', name: '疲惫' }],
        // person:老板 没在本篇声明，但可能是往期日志里已有的节点
        edges: [{ source: 'person:老板', target: 'emotion:疲惫', relation: 'involves' }],
      },
      '2024-05-02',
    );
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.nodes.map((n) => n.name)).toEqual(['疲惫']);
  });

  it('有合法边时清理完全孤立的普通节点', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [
          { type: 'emotion', name: '疲惫' },
          { type: 'person', name: '老板' },
          { type: 'person', name: '同事' },
        ],
        edges: [{ source: 'person:老板', target: 'emotion:疲惫', relation: 'involves' }],
      },
      '2024-05-02',
    );
    expect(parsed.nodes.map((n) => n.name)).toEqual(['疲惫', '老板']);
  });

  it('日期统一使用用户设置的日志日期', () => {
    const parsed = sanitizeParsed(
      {
        nodes: [
          { type: 'event', name: '吃面', date: '1999-01-01' },
          { type: 'trigger', name: '面馆的老歌', date: '1999-01-01' },
        ],
        edges: [
          { source: 'trigger:面馆的老歌', target: 'event:吃面', relation: 'triggered', weight: 0.5 },
        ],
      },
      '2024-05-03',
    );
    expect(parsed.nodes.every((n) => n.date === '2024-05-03')).toBe(true);
  });

  it('完全没有可用节点时抛错', () => {
    expect(() => sanitizeParsed({ nodes: [{ type: '乱写', name: 'x' }], edges: [] }, '2024-05-01')).toThrow();
    expect(() => sanitizeParsed('不是对象', '2024-05-01')).toThrow();
  });
});

describe('parseModelOutput', () => {
  it('端到端：围栏 JSON → 合法结构', () => {
    const raw = `\`\`\`json
{"nodes":[{"type":"emotion","name":"撕裂","polarity":-4,"intensity":5,"quote":"整个人被撕裂"},
{"type":"person","name":"妈妈"}],
"edges":[{"source":"person:妈妈","target":"emotion:撕裂","relation":"involves","weight":0.8}]}
\`\`\``;
    const parsed = parseModelOutput(raw, '2024-05-01');
    expect(parsed.nodes).toHaveLength(2);
    expect(parsed.edges[0].relation).toBe('involves');
  });
});
