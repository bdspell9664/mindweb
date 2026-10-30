import { isNodeType, isRelation } from './merge';
import type { LogEntry, ParsedEdge, ParsedLog, ParsedNode } from '../types';

/**
 * 备份文件格式。日志与图谱从来只留在本机，所以"迁移"这件事只能靠一个文件：
 * 换端口、换浏览器、换机器之后，用它把数据搬过去。
 */
export interface BackupFile {
  app: 'mindweb';
  version: 1;
  exportedAt: string;
  entries: LogEntry[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function serializeBackup(entries: LogEntry[], now = new Date()): string {
  const payload: BackupFile = {
    app: 'mindweb',
    version: 1,
    exportedAt: now.toISOString(),
    entries: [...entries].sort((a, b) => a.date.localeCompare(b.date)),
  };
  return JSON.stringify(payload, null, 2);
}

function asParsed(raw: unknown): ParsedLog | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as { nodes?: unknown; edges?: unknown };
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null;

  const nodes: ParsedNode[] = [];
  for (const item of obj.nodes) {
    if (!item || typeof item !== 'object') continue;
    const n = item as Record<string, unknown>;
    if (!isNodeType(n.type) || typeof n.name !== 'string' || !n.name.trim()) continue;
    nodes.push(item as ParsedNode);
  }

  const edges: ParsedEdge[] = [];
  for (const item of obj.edges) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    if (typeof e.source !== 'string' || typeof e.target !== 'string') continue;
    if (!isRelation(e.relation)) continue;
    edges.push(item as ParsedEdge);
  }

  if (nodes.length === 0) return null;
  return { nodes, edges };
}

function asEntry(raw: unknown): LogEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.date !== 'string' || !DATE_RE.test(e.date)) return null;
  if (typeof e.text !== 'string') return null;
  const parsed = asParsed(e.parsed);
  if (!parsed) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : `day-${e.date}`,
    date: e.date,
    text: e.text,
    createdAt: typeof e.createdAt === 'number' ? e.createdAt : Date.now(),
    parsed,
  };
}

/** 宽容读取备份：接受完整备份对象，也接受直接是日志数组的老格式。 */
export function parseBackup(raw: string): { entries: LogEntry[]; skipped: number } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('这不是一个 JSON 文件');
  }

  let list: unknown[] | null = null;
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object' && Array.isArray((data as { entries?: unknown }).entries)) {
    list = (data as { entries: unknown[] }).entries;
  }
  if (!list) throw new Error('文件里没有 entries 列表，可能不是心络导出的备份');

  const entries: LogEntry[] = [];
  let skipped = 0;
  for (const item of list) {
    const entry = asEntry(item);
    if (entry) entries.push(entry);
    else skipped += 1;
  }
  if (entries.length === 0) throw new Error('备份里没有一条可用的日志');
  return { entries, skipped };
}
