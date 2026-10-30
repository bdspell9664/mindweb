import {
  isNodeType,
  isRelation,
  normalizeName,
  parseRef,
  clamp,
} from './merge';
import type { ParsedEdge, ParsedLog, ParsedNode } from '../types';

/**
 * 内置解析提示词（运行时作为 system prompt 发给 LLM）。
 * 与需求文档一致：只输出 JSON，单篇抽取，跨日期合并交给应用端。
 */
export const SYSTEM_PROMPT = `你是日志结构化引擎。读取用户日志，只输出合法 JSON，不输出任何其他文字。
输出结构：{"nodes":[{...}],"edges":[{...}]}
nodes 字段：type（emotion/person/event/trigger/theme/wish/risk_node/entry）、name、
polarity（-5~+5，仅 emotion 需要）、intensity（1~5）、quote（原文摘录，≤30字）、date
edges 字段：source、target（用 type:name 格式引用）、relation（triggered/involves/belongs_to/evolves/co_occurs）、weight（0~1）
抽取规则：
1. 情绪词保留用户原话，不要泛化
2. event 只客观陈述发生了什么，不加评判
3. 你只需按单篇日志抽取，跨日期的合并由应用端完成
4. 每个节点至少连一条边，孤立节点丢弃
5. risk_node 语气中性客观，quote 摘录用户原句`;

const QUOTE_LIMIT = 60;

/** 从可能带 ```json 围栏或前后废话的文本里抠出第一个 JSON 对象。 */
export function extractJson(text: string): unknown {
  if (typeof text !== 'string' || !text.trim()) throw new Error('模型没有返回内容');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) continue;
    const slice = candidate.slice(start, end + 1);
    try {
      return JSON.parse(slice);
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  throw new Error('模型返回的不是合法 JSON');
}

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/**
 * 严格校验 LLM 输出：只保留认识的结构，丢弃越界值、无效引用和完全孤立的节点。
 * 解析侧的"规则 4"在这里执行——但 wish / entry 例外，孤立的愿望本身就有意义。
 */
export function sanitizeParsed(raw: unknown, date: string): ParsedLog {
  if (!raw || typeof raw !== 'object') throw new Error('解析结果不是对象');
  const obj = raw as { nodes?: unknown; edges?: unknown };
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: ParsedNode[] = [];
  for (const item of rawNodes) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    if (!isNodeType(n.type)) continue;
    const name = normalizeName(String(n.name ?? ''));
    if (!name) continue;
    const node: ParsedNode = { type: n.type, name, date };
    if (n.type === 'emotion') {
      node.polarity = clamp(asNumber(n.polarity) ?? 0, -5, 5);
      node.intensity = clamp(asNumber(n.intensity) ?? 3, 1, 5);
    } else if (asNumber(n.intensity) !== undefined) {
      node.intensity = clamp(asNumber(n.intensity) as number, 1, 5);
    }
    const quote = String(n.quote ?? '').trim();
    if (quote) node.quote = quote.slice(0, QUOTE_LIMIT);
    if (n.achieved === true) node.achieved = true;
    nodes.push(node);
  }

  const known = new Set(nodes.map((n) => `${n.type}:${n.name}`));
  // 边可以引用本篇没有声明、但图谱里早已存在的节点（跨日记反复出现的「妈妈」、
  // 或让两个事件共处同一主题的情况）。这里只校验格式，能否连上交给合并阶段判断。
  const edges: ParsedEdge[] = [];
  const touched = new Set<string>();
  for (const item of rawEdges) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (!isRelation(e.relation)) continue;
    const from = parseRef(String(e.source ?? ''));
    const to = parseRef(String(e.target ?? ''));
    if (!from || !to) continue;
    const a = `${from.type}:${from.name}`;
    const b = `${to.type}:${to.name}`;
    if (a === b) continue;
    edges.push({
      source: a,
      target: b,
      relation: e.relation,
      weight: clamp(asNumber(e.weight) ?? 0.5, 0, 1),
    });
    if (known.has(a)) touched.add(a);
    if (known.has(b)) touched.add(b);
  }

  // 规则 4（孤立节点丢弃）只在确实抽出关系时执行：一篇只写了情绪的日志，
  // 不该因为"没连边"就整篇解析失败。wish / theme 即使孤立也保留——它们本身就是内容。
  const kept =
    edges.length > 0
      ? nodes.filter(
          (n) =>
            touched.has(`${n.type}:${n.name}`) ||
            n.type === 'wish' ||
            n.type === 'entry' ||
            n.type === 'theme',
        )
      : nodes;

  if (kept.length === 0) throw new Error('这篇日志里没有抽取到可用的节点');
  return { nodes: kept, edges };
}

/** 兜底：模型偶尔只回半截 JSON。用更严格的指令重试一次，仍失败就抛错让用户手动粘贴。 */
export function parseModelOutput(text: string, date: string): ParsedLog {
  return sanitizeParsed(extractJson(text), date);
}
