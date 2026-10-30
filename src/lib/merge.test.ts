import { describe, expect, it } from 'vitest';
import { buildGraph, nodeIdFor, parseRef } from './merge';
import { buildAdjacency, colorOf, dayDiff, radiusOf, selectView } from './graph';
import type { LogEntry, NodeType, ParsedLog } from '../types';

function entry(date: string, parsed: Partial<ParsedLog>, id = date): LogEntry {
  return {
    id,
    date,
    text: `日志 ${date}`,
    createdAt: Date.parse(`${date}T12:00:00Z`),
    parsed: { nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] },
  };
}

describe('节点合并', () => {
  it('同名情绪跨日志合并并累加次数，保留原话不泛化', () => {
    const graph = buildGraph([
      entry('2024-05-01', {
        nodes: [{ type: 'emotion', name: '撕裂', polarity: -4, intensity: 4 }],
        edges: [],
      }),
      entry('2024-05-03', {
        nodes: [{ type: 'emotion', name: '撕裂', polarity: -3, intensity: 2 }],
        edges: [],
      }),
    ]);

    const node = graph.nodes['emotion:撕裂'];
    expect(node).toBeDefined();
    expect(node.name).toBe('撕裂');
    expect(node.count).toBe(2);
    expect(node.appearances.map((a) => a.intensity)).toEqual([4, 2]);
    expect(node.firstDate).toBe('2024-05-01');
    expect(node.lastDate).toBe('2024-05-03');
    expect(node.intensity).toBe(2); // 最近一次
  });

  it('event 同名但不同日期是两个节点，绑定各自日期', () => {
    const graph = buildGraph([
      entry('2024-05-01', { nodes: [{ type: 'event', name: '向妈妈坦白' }] }),
      entry('2024-05-09', { nodes: [{ type: 'event', name: '向妈妈坦白' }] }),
    ]);
    const events = Object.values(graph.nodes).filter((n) => n.type === 'event');
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.firstDate).sort()).toEqual(['2024-05-01', '2024-05-09']);
  });

  it('同一篇日志重新解析不会重复计数', () => {
    const parsed: Partial<ParsedLog> = {
      nodes: [{ type: 'emotion', name: '麻木' }],
    };
    const once = buildGraph([entry('2024-05-01', parsed, 'e1')]);
    const twice = buildGraph([
      entry('2024-05-01', parsed, 'e1'),
      entry('2024-05-01', parsed, 'e1b'),
    ]);
    expect(once.nodes['emotion:麻木'].count).toBe(1);
    // 同一天两篇日志 ≠ 重复解析：entryId 不同，应各计一次
    expect(twice.nodes['emotion:麻木'].count).toBe(2);
  });

  it('risk_node 同名合并，且不使用刺眼红色', () => {
    const graph = buildGraph([
      entry('2024-05-01', { nodes: [{ type: 'risk_node', name: '不想醒来' }] }),
      entry('2024-05-04', { nodes: [{ type: 'risk_node', name: '不想醒来' }] }),
    ]);
    const node = graph.nodes['risk_node:不想醒来'];
    expect(node.count).toBe(2);
    const color = colorOf(node).toLowerCase();
    expect(color).toBe('#cfe3f5');
    expect(color).not.toContain('ff0000');
  });

  it('节点 id 对可合并类型稳定，event/entry 带日期', () => {
    expect(nodeIdFor('emotion', ' 难过 ', '2024-05-01')).toBe('emotion:难过');
    expect(nodeIdFor('event', '坦白', '2024-05-01')).toBe('event:2024-05-01:坦白');
    expect(nodeIdFor('entry', '2024-05-01', '2024-05-01')).toBe('entry:2024-05-01');
  });

  it('parseRef 支持名字里带冒号', () => {
    expect(parseRef('event:那天:下雨了')).toEqual({ type: 'event', name: '那天:下雨了' });
    expect(parseRef('不存在:东西')).toBeNull();
    expect(parseRef('没有冒号')).toBeNull();
  });
});

describe('边合并', () => {
  it('无向关系 a↔b 与 b↔a 合并为一条，权重取平均', () => {
    const graph = buildGraph([
      entry('2024-05-01', {
        nodes: [
          { type: 'person', name: '妈妈' },
          { type: 'emotion', name: '愧疚', polarity: -3, intensity: 3 },
        ],
        edges: [{ source: 'emotion:愧疚', target: 'person:妈妈', relation: 'involves', weight: 0.4 }],
      }),
      entry('2024-05-02', {
        nodes: [
          { type: 'person', name: '妈妈' },
          { type: 'emotion', name: '愧疚', polarity: -3, intensity: 3 },
        ],
        edges: [{ source: 'person:妈妈', target: 'emotion:愧疚', relation: 'involves', weight: 0.8 }],
      }),
    ]);
    const edges = Object.values(graph.edges).filter((e) => e.relation === 'involves');
    expect(edges).toHaveLength(1);
    expect(edges[0].count).toBe(2);
    expect(edges[0].weight).toBeCloseTo(0.6, 5);
  });

  it('可以连到往期日志里已存在的节点', () => {
    const graph = buildGraph([
      entry('2024-05-01', {
        nodes: [
          { type: 'theme', name: '家庭接纳' },
          { type: 'event', name: '第一次提起' },
        ],
        edges: [{ source: 'event:第一次提起', target: 'theme:家庭接纳', relation: 'belongs_to' }],
      }),
      entry('2024-05-20', {
        // 这一天没有再次声明 theme，但边可以直接挂到已有的「家庭接纳」上
        nodes: [{ type: 'event', name: '妈妈说可以试试' }],
        edges: [{ source: 'event:妈妈说可以试试', target: 'theme:家庭接纳', relation: 'belongs_to' }],
      }),
    ]);
    const evolves = Object.values(graph.edges).filter((e) => e.relation === 'evolves');
    expect(evolves).toHaveLength(1);
    expect(evolves[0].source).toBe('event:2024-05-01:第一次提起');
    expect(evolves[0].target).toBe('event:2024-05-20:妈妈说可以试试');
  });

  it('丢弃引用不存在节点的边', () => {
    const graph = buildGraph([
      entry('2024-05-01', {
        nodes: [{ type: 'emotion', name: '疲惫' }],
        edges: [{ source: 'emotion:疲惫', target: 'person:不存在的人', relation: 'involves' }],
      }),
    ]);
    expect(Object.values(graph.edges)).toHaveLength(0);
  });
});

describe('演变边', () => {
  it('同一主题下不同日期的事件之间生成 evolves，方向为旧→新', () => {
    const graph = buildGraph([
      entry('2024-04-01', {
        nodes: [
          { type: 'theme', name: '自我和解' },
          { type: 'event', name: '认定这条路是错的' },
        ],
        edges: [
          { source: 'event:认定这条路是错的', target: 'theme:自我和解', relation: 'belongs_to' },
        ],
      }),
      entry('2024-06-20', {
        nodes: [
          { type: 'theme', name: '自我和解' },
          { type: 'event', name: '可以给你买女装' },
        ],
        edges: [
          { source: 'event:可以给你买女装', target: 'theme:自我和解', relation: 'belongs_to' },
        ],
      }),
    ]);

    const evolves = Object.values(graph.edges).filter((e) => e.relation === 'evolves');
    expect(evolves).toHaveLength(1);
    expect(evolves[0].source).toBe('event:2024-04-01:认定这条路是错的');
    expect(evolves[0].target).toBe('event:2024-06-20:可以给你买女装');
    expect(evolves[0].firstDate).toBe('2024-06-20');
  });

  it('同一天的两个事件之间不生成演变边', () => {
    const graph = buildGraph([
      entry('2024-06-01', {
        nodes: [
          { type: 'theme', name: '家庭接纳' },
          { type: 'event', name: 'A' },
          { type: 'event', name: 'B' },
        ],
        edges: [
          { source: 'event:A', target: 'theme:家庭接纳', relation: 'belongs_to' },
          { source: 'event:B', target: 'theme:家庭接纳', relation: 'belongs_to' },
        ],
      }),
    ]);
    expect(Object.values(graph.edges).filter((e) => e.relation === 'evolves')).toHaveLength(0);
  });
});

describe('邻接表（列表视图的关联数据）', () => {
  const graph = buildGraph([
    entry('2024-05-01', {
      nodes: [
        { type: 'person', name: '妈妈' },
        { type: 'emotion', name: '愧疚', polarity: -3, intensity: 3 },
        { type: 'theme', name: '家庭接纳' },
      ],
      edges: [
        { source: 'emotion:愧疚', target: 'person:妈妈', relation: 'involves', weight: 0.4 },
        { source: 'emotion:愧疚', target: 'theme:家庭接纳', relation: 'belongs_to', weight: 0.9 },
      ],
    }),
    entry('2024-06-01', {
      nodes: [
        { type: 'person', name: '妈妈' },
        { type: 'emotion', name: '愧疚', polarity: -2, intensity: 2 },
      ],
      edges: [{ source: 'emotion:愧疚', target: 'person:妈妈', relation: 'involves', weight: 0.6 }],
    }),
  ]);

  it('一条边在两个端点上各记一次，方向相反', () => {
    const adj = buildAdjacency(graph);
    const guilt = adj.get('emotion:愧疚')!;
    const mom = adj.get('person:妈妈')!;

    expect(guilt.links).toHaveLength(2);
    expect(mom.links).toHaveLength(1);

    const toMom = guilt.links.find((l) => l.node.name === '妈妈')!;
    expect(toMom.direction).toBe('out');
    expect(mom.links[0].direction).toBe('in');
    expect(mom.links[0].node.name).toBe('愧疚');
  });

  it('权重是相连边之和，邻居按权重降序', () => {
    const guilt = buildAdjacency(graph).get('emotion:愧疚')!;
    // 0.5（两天的 involves 平均）+ 0.9（belongs_to）
    expect(guilt.weight).toBeCloseTo(1.4, 5);
    expect(guilt.links[0].node.name).toBe('家庭接纳'); // 0.9 > 0.5
    expect(guilt.links[1].node.name).toBe('妈妈');
  });

  it('lastDate 取相连边里最新的一次', () => {
    const mom = buildAdjacency(graph).get('person:妈妈')!;
    expect(mom.lastDate).toBe('2024-06-01');
  });

  it('没有任何边的节点不出现在邻接表里', () => {
    const lonely = buildGraph([entry('2024-07-01', { nodes: [{ type: 'wish', name: '去应天门' }] })]);
    expect(buildAdjacency(lonely).get('wish:去应天门')).toBeUndefined();
    expect(buildAdjacency(lonely).size).toBe(0);
  });
});

describe('视图派生', () => {
  const graph = buildGraph([
    entry('2024-05-01', {
      nodes: [
        { type: 'emotion', name: '撕裂', polarity: -5, intensity: 5 },
        { type: 'trigger', name: '看到别人母女亲密' },
      ],
      edges: [
        {
          source: 'trigger:看到别人母女亲密',
          target: 'emotion:撕裂',
          relation: 'triggered',
          weight: 0.9,
        },
      ],
    }),
    entry('2024-07-01', {
      nodes: [{ type: 'wish', name: '被叫一声女儿' }],
    }),
  ]);

  it('时间回放：早于游标的节点不出现', () => {
    const early = selectView(graph, {
      highlight: new Set<NodeType>(),
      from: null,
      to: null,
      cursor: '2024-05-02',
    });
    expect(early.nodes.map((n) => n.node.name)).toContain('撕裂');
    expect(early.nodes.map((n) => n.node.name)).not.toContain('被叫一声女儿');
  });

  it('时间回放：旧连接保留但更淡', () => {
    const view = selectView(graph, {
      highlight: new Set<NodeType>(),
      from: null,
      to: null,
      cursor: '2024-07-01',
    });
    const link = view.links.find((l) => l.relation === 'triggered');
    expect(link).toBeDefined();
    expect(link!.opacity).toBeLessThan(0.5);
    expect(link!.evaporating).toBe(true);
  });

  it('高亮某类型时其余节点不消失，只标记 dimmed', () => {
    const view = selectView(graph, {
      highlight: new Set<NodeType>(['wish']),
      from: null,
      to: null,
      cursor: null,
    });
    const names = view.nodes.map((n) => n.node.name);
    expect(names).toContain('被叫一声女儿');
    expect(names).toContain('撕裂');

    const wish = view.nodes.find((n) => n.node.name === '被叫一声女儿')!;
    const emotion = view.nodes.find((n) => n.node.name === '撕裂')!;
    expect(wish.dimmed).toBe(false);
    expect(emotion.dimmed).toBe(true);
    // 连到被压暗节点的边也一起压暗
    expect(view.links.length).toBeGreaterThan(0);
    expect(view.links.every((l) => l.dimmed)).toBe(true);
  });

  it('空的高亮集合表示不高亮，全部正常显示', () => {
    const view = selectView(graph, {
      highlight: new Set<NodeType>(),
      from: null,
      to: null,
      cursor: null,
    });
    expect(view.nodes.every((n) => n.dimmed === false)).toBe(true);
    expect(view.links.every((l) => l.dimmed === false)).toBe(true);
  });

  it('按日期区间过滤', () => {
    const view = selectView(graph, {
      highlight: new Set<NodeType>(),
      from: '2024-06-01',
      to: '2024-08-01',
      cursor: null,
    });
    expect(view.nodes.map((n) => n.node.name)).toEqual(['被叫一声女儿']);
  });

  it('情绪半径随强度增长，dayDiff 跨月正确', () => {
    const strong = graph.nodes['emotion:撕裂'];
    expect(radiusOf(strong)).toBeGreaterThan(6);
    expect(dayDiff('2024-05-01', '2024-07-01')).toBe(61);
  });
});
