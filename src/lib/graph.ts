import { RELATION_LABEL, type Graph, type GraphNode, type NodeType, type Relation } from '../types';
import { clamp } from './merge';

export interface ViewOptions {
  /** 要高亮的类型；空集表示不高亮，全部正常显示 */
  highlight: Set<NodeType>;
  /** YYYY-MM-DD，闭区间；null 表示不限 */
  from: string | null;
  to: string | null;
  /** 时间回放游标；null 表示看全图 */
  cursor: string | null;
  /** 日志锚点默认不画，否则一天一个小暗点会淹没图 */
  includeEntries?: boolean;
}

export interface VisNode {
  node: GraphNode;
  /** 发光亮度 0~1，时间回放里旧节点会变暗 */
  lum: number;
  /** 被类型高亮排除在外：仍然画出来，但压到很暗，保留上下文 */
  dimmed: boolean;
}

export interface VisLink {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  weight: number;
  /** 连线不透明度，越久远的连接越淡 */
  opacity: number;
  evaporating: boolean;
  dimmed: boolean;
}

export interface View {
  nodes: VisNode[];
  links: VisLink[];
  /** 时间轴范围 */
  range: { min: string; max: string } | null;
}

export function dayDiff(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

const DEEP = '#0a0f1e';
const COOL = '#7f8dff';
const WARM = '#ffb16b';
const NEUTRAL = '#9aa6cc';
const PERSON_COLORS = ['#7fd4c1', '#c79bff', '#ffd479', '#8fb8ff', '#ff9ec4', '#a8e6a1', '#f0a5a5'];

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** 类型 → 代表色，过滤栏与图例共用。 */
export const TYPE_COLOR: Record<NodeType, string> = {
  emotion: COOL,
  person: PERSON_COLORS[0],
  event: '#b9c6ea',
  trigger: '#5d6f8d',
  theme: '#6f7fd8',
  wish: '#ffd479',
  risk_node: '#cfe3f5',
  entry: '#39445c',
};

export function colorOf(node: GraphNode): string {
  switch (node.type) {
    case 'emotion': {
      const p = node.polarity ?? 0;
      if (p > 0.5) return WARM;
      if (p < -0.5) return COOL;
      return NEUTRAL;
    }
    case 'person':
      return PERSON_COLORS[hash(node.name) % PERSON_COLORS.length];
    case 'event':
      return '#b9c6ea';
    case 'trigger':
      return '#5d6f8d';
    case 'theme':
      return '#6f7fd8';
    case 'wish':
      return '#ffd479';
    case 'risk_node':
      return '#cfe3f5';
    case 'entry':
      return '#39445c';
    default:
      return DEEP;
  }
}

/** 半径：情绪强度、主题分量、念想是否已实现，都长在半径上。 */
export function radiusOf(node: GraphNode): number {
  switch (node.type) {
    case 'emotion':
      return 6 + clamp(node.intensity ?? 3, 1, 5) * 1.5;
    case 'person':
      return 9;
    case 'event':
      return 7;
    case 'trigger':
      return 4.5;
    case 'theme':
      return 16 + Math.min(node.count, 10) * 1.2;
    case 'wish':
      return node.achieved ? 7.5 : 5;
    case 'risk_node':
      return 6.5;
    case 'entry':
      return 3.5;
    default:
      return 5;
  }
}

/** emotion 的发光强度随 intensity 增长；其余类型固定亮度。 */
export function glowOf(node: GraphNode): number {
  if (node.type === 'emotion') return 0.35 + clamp(node.intensity ?? 3, 1, 5) / 5 * 0.65;
  if (node.type === 'theme') return 0.4;
  if (node.type === 'entry') return 0.2;
  return 0.6;
}

/** 全图日期跨度（不受类型过滤影响），时间轴用这个。 */
export function graphDateRange(graph: Graph): { min: string; max: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'entry') continue;
    if (!min || n.firstDate < min) min = n.firstDate;
    if (!max || n.lastDate > max) max = n.lastDate;
  }
  return min && max ? { min, max } : null;
}

export function selectView(graph: Graph, opts: ViewOptions): View {
  const all = Object.values(graph.nodes);
  const range = graphDateRange(graph);
  const cursor = opts.cursor;
  const focus = opts.highlight;
  const hasFocus = focus.size > 0;

  const visible = all.filter((n) => {
    if (n.type === 'entry' && !opts.includeEntries) return false;
    if (opts.from && n.lastDate < opts.from) return false;
    if (opts.to && n.firstDate > opts.to) return false;
    if (cursor && n.firstDate > cursor) return false; // 时间回放：还没长出来
    return true;
  });
  const visibleIds = new Set(visible.map((n) => n.id));

  const nodes: VisNode[] = visible.map((node) => {
    let lum = glowOf(node);
    if (cursor) {
      const age = dayDiff(node.lastDate, cursor);
      lum *= clamp(1 - age / 90, 0.3, 1);
    }
    // 高亮某几类时，其余类型不消失、只压暗——保留上下文，图也不会跳动
    return { node, lum, dimmed: hasFocus && !focus.has(node.type) };
  });
  const dimmedIds = new Set(nodes.filter((n) => n.dimmed).map((n) => n.node.id));

  const links: VisLink[] = [];
  for (const e of Object.values(graph.edges)) {
    if (!visibleIds.has(e.source) || !visibleIds.has(e.target)) continue;
    if (opts.from && e.lastDate < opts.from) continue;
    if (opts.to && e.firstDate > opts.to) continue;
    if (cursor && e.firstDate > cursor) continue;
    const age = cursor ? dayDiff(e.lastDate, cursor) : 0;
    const opacity = cursor ? clamp(1 - age / 45, 0.12, 1) : 0.55 + e.weight * 0.45;
    links.push({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.relation,
      weight: e.weight,
      opacity,
      evaporating: Boolean(cursor && age > 20),
      dimmed: dimmedIds.has(e.source) || dimmedIds.has(e.target),
    });
  }

  return { nodes, links, range };
}

const UNDIRECTED_RELATIONS = new Set<Relation>(['involves', 'co_occurs']);

/** 有向关系读成"引发 / 被引发"，无向关系两个方向读起来一样，不加"被" */
export function relationLabelFor(relation: Relation, direction: 'out' | 'in'): string {
  if (UNDIRECTED_RELATIONS.has(relation)) return RELATION_LABEL[relation];
  return direction === 'out' ? RELATION_LABEL[relation] : `被${RELATION_LABEL[relation]}`;
}

export interface NeighborLink {
  node: GraphNode;
  relation: Relation;
  /** out = 我指向它（如"我引发的情绪"），in = 它指向我 */
  direction: 'out' | 'in';
  weight: number;
  lastDate: string;
}

export interface AdjacencyEntry {
  links: NeighborLink[];
  /** 相连边的权重之和：越高的节点在图里牵连得越多 */
  weight: number;
  /** 最近一次和任何节点产生关联的日期 */
  lastDate: string;
}

/**
 * 一次遍历把所有边折成邻接表。列表视图靠它回答
 * "这个节点连着什么、牵连有多深"，不必每行再扫一遍全部边。
 */
export function buildAdjacency(graph: Graph): Map<string, AdjacencyEntry> {
  const map = new Map<string, AdjacencyEntry>();

  const touch = (id: string): AdjacencyEntry => {
    let entry = map.get(id);
    if (!entry) {
      entry = { links: [], weight: 0, lastDate: '' };
      map.set(id, entry);
    }
    return entry;
  };

  for (const e of Object.values(graph.edges)) {
    const source = graph.nodes[e.source];
    const target = graph.nodes[e.target];
    if (!source || !target) continue;

    const a = touch(source.id);
    a.links.push({ node: target, relation: e.relation, direction: 'out', weight: e.weight, lastDate: e.lastDate });
    a.weight += e.weight;
    if (e.lastDate > a.lastDate) a.lastDate = e.lastDate;

    const b = touch(target.id);
    b.links.push({ node: source, relation: e.relation, direction: 'in', weight: e.weight, lastDate: e.lastDate });
    b.weight += e.weight;
    if (e.lastDate > b.lastDate) b.lastDate = e.lastDate;
  }

  for (const entry of map.values()) {
    // 强关联在前，同权重时按最近时间
    entry.links.sort((x, y) => y.weight - x.weight || y.lastDate.localeCompare(x.lastDate));
  }

  return map;
}

/** 节点详情：一跳关联（含方向说明），用于侧栏。 */
export function neighborsOf(graph: Graph, id: string): { node: GraphNode; relation: Relation; direction: 'out' | 'in' }[] {
  const out: { node: GraphNode; relation: Relation; direction: 'out' | 'in' }[] = [];
  for (const e of Object.values(graph.edges)) {
    if (e.source === id && graph.nodes[e.target]) {
      out.push({ node: graph.nodes[e.target], relation: e.relation, direction: 'out' });
    } else if (e.target === id && graph.nodes[e.source]) {
      out.push({ node: graph.nodes[e.source], relation: e.relation, direction: 'in' });
    }
  }
  return out.sort((a, b) => b.node.count - a.node.count);
}

export interface Report {
  averagePolarity: number | null;
  emotionCount: number;
  newNodes: GraphNode[];
  fadingNodes: GraphNode[];
  themeShift: { node: GraphNode; delta: number }[];
}

/** 周报（MVP 之后的功能，先把纯计算放在这里，视图可单独迭代）。 */
export function weeklyReport(graph: Graph, referenceDate: string, days = 7): Report {
  const from = new Date(`${referenceDate}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  const start = from.toISOString().slice(0, 10);

  const emotions = Object.values(graph.nodes).filter((n) => n.type === 'emotion');
  const recent = emotions.filter((n) => n.lastDate >= start);
  const avg =
    recent.length > 0
      ? recent.reduce((sum, n) => sum + (n.polarity ?? 0), 0) / recent.length
      : null;

  const newNodes = Object.values(graph.nodes).filter((n) => n.firstDate >= start && n.type !== 'entry');
  const fadingNodes = Object.values(graph.nodes).filter(
    (n) => n.lastDate < start && n.count >= 2 && n.type !== 'entry',
  );
  const themeShift = Object.values(graph.nodes)
    .filter((n) => n.type === 'theme')
    .map((node) => ({
      node,
      delta: node.appearances.filter((a) => a.date >= start).length,
    }))
    .filter((t) => t.delta > 0)
    .sort((a, b) => b.delta - a.delta);

  return { averagePolarity: avg, emotionCount: recent.length, newNodes, fadingNodes, themeShift };
}
