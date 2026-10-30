import {
  NODE_TYPES,
  RELATIONS,
  type Graph,
  type GraphNode,
  type LogEntry,
  type NodeType,
  type ParsedNode,
  type Relation,
} from '../types';

/*
 * 合并策略（体现在 nodeIdFor 里）：
 * emotion / person / trigger / theme / wish / risk_node 同名合并、计数累加；
 * event 不合并（一次性的事，绑定日期）；entry 一天一个。
 * risk_node 也合并——同一个念头反复出现，计数比流水更有意义，也更贴"关怀而非告警"的调性。
 */

/** 无向关系：合并时把 (a,b) 与 (b,a) 视为同一条。 */
const UNDIRECTED: Relation[] = ['involves', 'co_occurs'];

const DEFAULT_INTENSITY = 3;
const DEFAULT_WEIGHT = 0.5;

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

export function isNodeType(v: unknown): v is NodeType {
  return typeof v === 'string' && (NODE_TYPES as readonly string[]).includes(v);
}

export function isRelation(v: unknown): v is Relation {
  return typeof v === 'string' && (RELATIONS as readonly string[]).includes(v);
}

/** 解析 LLM 使用的 `type:name` 引用（name 里可以再出现冒号）。 */
export function parseRef(ref: string): { type: NodeType; name: string } | null {
  if (typeof ref !== 'string') return null;
  const idx = ref.indexOf(':');
  if (idx <= 0) return null;
  const type = ref.slice(0, idx).trim();
  const name = normalizeName(ref.slice(idx + 1));
  if (!isNodeType(type) || !name) return null;
  return { type, name };
}

/** 可合并类型的稳定 id；event/entry 的 id 与日期绑定。 */
export function nodeIdFor(type: NodeType, name: string, date: string): string {
  if (type === 'event') return `event:${date}:${normalizeName(name)}`;
  if (type === 'entry') return `entry:${date}`;
  return `${type}:${normalizeName(name)}`;
}

function edgeKey(relation: Relation, a: string, b: string): string {
  const [s, t] = UNDIRECTED.includes(relation) && a > b ? [b, a] : [a, b];
  return `${relation}|${s}|${t}`;
}

interface MergeCtx {
  date: string;
  entryId: string;
}

/** 同一篇日志内重复提到的同名节点，合并成一次出现。 */
function dedupeParsedNodes(nodes: ParsedNode[]): ParsedNode[] {
  const seen = new Map<string, ParsedNode>();
  for (const n of nodes) {
    if (!isNodeType(n?.type)) continue;
    const name = normalizeName(String(n.name ?? ''));
    if (!name) continue;
    const key = `${n.type}:${name}`;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, { ...n, name });
      continue;
    }
    seen.set(key, {
      ...prev,
      // 保留原始措辞里最强的那次，剩下的取第一条非空摘录
      intensity: Math.max(prev.intensity ?? DEFAULT_INTENSITY, n.intensity ?? DEFAULT_INTENSITY),
      polarity: n.polarity ?? prev.polarity,
      quote: prev.quote && prev.quote.length > 0 ? prev.quote : n.quote,
      achieved: Boolean(prev.achieved || n.achieved),
    });
  }
  return [...seen.values()];
}

function upsertNode(graph: Graph, pn: ParsedNode, ctx: MergeCtx): string {
  const id = nodeIdFor(pn.type, pn.name, ctx.date);
  const isEmotion = pn.type === 'emotion';
  const intensity = isEmotion ? clamp(pn.intensity ?? DEFAULT_INTENSITY, 1, 5) : undefined;
  const polarity = isEmotion ? clamp(pn.polarity ?? 0, -5, 5) : undefined;
  const appearance = {
    date: ctx.date,
    quote: (pn.quote ?? '').trim().slice(0, 60),
    entryId: ctx.entryId,
    ...(isEmotion ? { intensity, polarity } : {}),
  };

  const prev = graph.nodes[id];
  if (!prev) {
    graph.nodes[id] = {
      id,
      type: pn.type,
      name: pn.name,
      count: 1,
      firstDate: ctx.date,
      lastDate: ctx.date,
      appearances: [appearance],
      ...(isEmotion ? { intensity, polarity } : {}),
      ...(pn.achieved ? { achieved: true, achievedAt: ctx.date } : {}),
    };
    return id;
  }

  // 同一个 entry 重复解析（用户改了日志再解析）时替换那一次的记录
  const sameEntry = prev.appearances.findIndex((a) => a.entryId === ctx.entryId);
  if (sameEntry >= 0) prev.appearances.splice(sameEntry, 1);
  prev.appearances.push(appearance);
  prev.appearances.sort((a, b) => a.date.localeCompare(b.date));
  prev.count = prev.appearances.length;
  prev.firstDate = prev.appearances[0].date;
  prev.lastDate = prev.appearances[prev.appearances.length - 1].date;
  if (isEmotion) {
    prev.intensity = intensity;
    prev.polarity = polarity;
  }
  if (pn.achieved && !prev.achieved) {
    prev.achieved = true;
    prev.achievedAt = ctx.date;
  }
  return id;
}

/** 本篇没声明、但图谱里已经有的节点：允许连过去，而不是把这条边丢掉。 */
function existingId(graph: Graph, ref: { type: NodeType; name: string }, date: string): string | undefined {
  const id = nodeIdFor(ref.type, ref.name, date);
  return graph.nodes[id] ? id : undefined;
}

function upsertEdge(
  graph: Graph,
  relation: Relation,
  a: string,
  b: string,
  date: string,
  weight: number,
): void {
  const key = edgeKey(relation, a, b);
  const w = clamp(weight, 0, 1);
  const prev = graph.edges[key];
  if (!prev) {
    graph.edges[key] = {
      id: key,
      source: a,
      target: b,
      relation,
      weight: w,
      count: 1,
      firstDate: date,
      lastDate: date,
    };
    return;
  }
  prev.weight = (prev.weight * prev.count + w) / (prev.count + 1);
  prev.count += 1;
  prev.firstDate = prev.firstDate <= date ? prev.firstDate : date;
  prev.lastDate = prev.lastDate >= date ? prev.lastDate : date;
}

/** 把一篇日志的解析结果增量并进图谱（会直接修改传入的 graph）。 */
export function mergeEntry(graph: Graph, entry: LogEntry): Graph {
  const ctx: MergeCtx = { date: entry.date, entryId: entry.id };
  const nodes = dedupeParsedNodes(entry.parsed.nodes ?? []);

  // 日期锚点：一天一个，不改名
  if (!graph.nodes[`entry:${entry.date}`]) {
    graph.nodes[`entry:${entry.date}`] = {
      id: `entry:${entry.date}`,
      type: 'entry',
      name: entry.date,
      count: 0,
      firstDate: entry.date,
      lastDate: entry.date,
      appearances: [],
    };
  }

  const idByRef = new Map<string, string>();
  for (const pn of nodes) {
    const id = upsertNode(graph, pn, ctx);
    idByRef.set(`${pn.type}:${pn.name}`, id);
  }

  for (const pe of entry.parsed.edges ?? []) {
    if (!isRelation(pe?.relation)) continue;
    const from = parseRef(String(pe.source ?? ''));
    const to = parseRef(String(pe.target ?? ''));
    if (!from || !to) continue;
    const source = idByRef.get(`${from.type}:${from.name}`) ?? existingId(graph, from, entry.date);
    const target = idByRef.get(`${to.type}:${to.name}`) ?? existingId(graph, to, entry.date);
    if (!source || !target || source === target) continue;
    upsertEdge(graph, pe.relation, source, target, entry.date, pe.weight ?? DEFAULT_WEIGHT);
  }

  return graph;
}

/**
 * 演变边：同一主题下、不同日期的两个 event 之间，画出"从旧状态到新状态"的虚线箭头。
 * LLM 只按单篇抽取，跨日期的时间关系只能由应用端推断——这就是那一步。
 */
function deriveEvolvesEdges(graph: Graph): void {
  const eventsByTheme = new Map<string, Set<string>>();
  const push = (theme: string, ev: string) => {
    const set = eventsByTheme.get(theme) ?? new Set<string>();
    set.add(ev);
    eventsByTheme.set(theme, set);
  };

  for (const e of Object.values(graph.edges)) {
    if (e.relation !== 'belongs_to') continue;
    const src = graph.nodes[e.source];
    const tgt = graph.nodes[e.target];
    if (src?.type === 'event' && tgt?.type === 'theme') push(tgt.id, src.id);
    if (tgt?.type === 'event' && src?.type === 'theme') push(src.id, tgt.id);
  }

  const themesOf = new Map<string, Set<string>>();
  for (const [theme, evs] of eventsByTheme) {
    for (const ev of evs) {
      const set = themesOf.get(ev) ?? new Set<string>();
      set.add(theme);
      themesOf.set(ev, set);
    }
  }

  for (const evs of eventsByTheme.values()) {
    const ordered = [...evs]
      .map((id) => graph.nodes[id])
      .filter((n): n is GraphNode => Boolean(n))
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.id.localeCompare(b.id));

    for (let i = 0; i < ordered.length - 1; i += 1) {
      const a = ordered[i];
      const b = ordered[i + 1];
      if (a.firstDate === b.firstDate) continue; // 同一天不构成"时间上的变化"
      const sharedA = themesOf.get(a.id);
      const sharedB = themesOf.get(b.id);
      let shared = 0;
      if (sharedA && sharedB) for (const t of sharedA) if (sharedB.has(t)) shared += 1;
      const weight = clamp(0.35 + 0.15 * Math.max(0, shared - 1), 0.35, 0.9);
      const id = `evolves|${a.id}|${b.id}`;
      const prev = graph.edges[id];
      if (prev) {
        prev.weight = Math.max(prev.weight, weight);
        prev.lastDate = prev.lastDate >= b.firstDate ? prev.lastDate : b.firstDate;
      } else {
        graph.edges[id] = {
          id,
          source: a.id,
          target: b.id,
          relation: 'evolves',
          weight,
          count: 1,
          firstDate: b.firstDate,
          lastDate: b.firstDate,
        };
      }
    }
  }
}

/** 图谱完全由日志派生：改一篇日志 = 重建一次，不留残影。 */
export function buildGraph(entries: LogEntry[]): Graph {
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt,
  );
  const graph: Graph = { nodes: {}, edges: {} };
  for (const entry of sorted) mergeEntry(graph, entry);
  deriveEvolvesEdges(graph);
  return graph;
}
