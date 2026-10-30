import { useSyncExternalStore } from 'react';
import { buildGraph } from './lib/merge';
import { clearAll, loadEntries, putEntry, removeEntry } from './lib/db';
import {
  DEFAULT_SETTINGS,
  clearSettings,
  loadSettings,
  saveSettings,
  type LlmSettings,
} from './lib/settings';
import { LlmError, parseEntry } from './lib/llm';
import { parseBackup, serializeBackup } from './lib/backup';
import type { Graph, LogEntry, NodeType, ParsedLog, ViewMode } from './types';

export interface Filters {
  /** 要高亮的类型；空集表示不高亮（全部正常显示） */
  highlight: Set<NodeType>;
  from: string | null;
  to: string | null;
}

export interface Notice {
  kind: 'ok' | 'error' | 'info';
  text: string;
  detail?: string;
}

export interface AppState {
  ready: boolean;
  entries: LogEntry[];
  graph: Graph;
  settings: LlmSettings;
  filters: Filters;
  /** 时间回放游标；null = 看全图 */
  cursor: string | null;
  playing: boolean;
  selectedId: string | null;
  mode: ViewMode;
  busy: boolean;
  notice: Notice | null;
  /** 每次有念想被标记实现，递增一次 —— 图谱据此泛起一次金色涟漪 */
  ripple: number;
}

const EMPTY_GRAPH: Graph = { nodes: {}, edges: {} };

function sortEntries(entries: LogEntry[]): LogEntry[] {
  return [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
}

class Store {
  private state: AppState = {
    ready: false,
    entries: [],
    graph: EMPTY_GRAPH,
    settings: DEFAULT_SETTINGS,
    filters: { highlight: new Set<NodeType>(), from: null, to: null },
    cursor: null,
    playing: false,
    selectedId: null,
    mode: 'graph',
    busy: false,
    notice: null,
    ripple: 0,
  };

  private listeners = new Set<() => void>();

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): AppState => this.state;

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private setEntries(entries: LogEntry[]): void {
    const sorted = sortEntries(entries);
    this.set({ entries: sorted, graph: buildGraph(sorted) });
  }

  async init(): Promise<void> {
    const isFile = typeof location !== 'undefined' && location.protocol === 'file:';
    try {
      const [entries, settings] = await Promise.all([
        loadEntries(),
        Promise.resolve(loadSettings()),
      ]);
      const sorted = sortEntries(entries);
      this.set({
        ready: true,
        entries: sorted,
        graph: buildGraph(sorted),
        settings,
        mode: sorted.length === 0 ? 'compose' : 'graph',
      });
      if (isFile && sorted.length === 0) {
        this.set({
          notice: {
            kind: 'error',
            text: '这是用 file:// 直接打开的文件。浏览器在这种源下会禁用 IndexedDB 与 localStorage，写下的东西存不下来——请用 npm run dev 或 npm run preview 打开。',
          },
        });
      }
    } catch (err) {
      // 存储不可用也要让人看到界面，而不是一直盯着加载态
      this.set({
        ready: true,
        notice: {
          kind: 'error',
          text: '本地存储打不开，这一会儿的改动可能存不下来',
          detail: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  setMode(mode: ViewMode): void {
    this.set({ mode });
  }

  select(id: string | null): void {
    this.set({ selectedId: id });
  }

  /** 点标签高亮某几类节点，再点一次取消；全部取消就回到常态 */
  toggleHighlight(type: NodeType): void {
    const highlight = new Set(this.state.filters.highlight);
    if (highlight.has(type)) highlight.delete(type);
    else highlight.add(type);
    this.set({ filters: { ...this.state.filters, highlight } });
  }

  clearHighlight(): void {
    this.set({ filters: { ...this.state.filters, highlight: new Set<NodeType>() } });
  }

  setRange(from: string | null, to: string | null): void {
    this.set({ filters: { ...this.state.filters, from, to } });
  }

  setCursor(cursor: string | null): void {
    this.set({ cursor });
  }

  setPlaying(playing: boolean): void {
    this.set({ playing });
  }

  dismiss(): void {
    this.set({ notice: null });
  }

  notify(notice: Notice): void {
    this.set({ notice });
  }

  updateSettings(settings: LlmSettings): void {
    saveSettings(settings);
    this.set({ settings, notice: { kind: 'ok', text: '已保存在这台设备上' } });
  }

  /** 录入 + 解析 + 合并 + 落盘。同一天只留一篇，再写就覆盖。 */
  async analyze(text: string, date: string): Promise<boolean> {
    const trimmed = text.trim();
    if (!trimmed) {
      this.notify({ kind: 'error', text: '先写点什么吧' });
      return false;
    }
    this.set({ busy: true, notice: null });
    try {
      const parsed = await parseEntry(this.state.settings, trimmed, date);
      const existing = this.state.entries.find((e) => e.date === date);
      const entry: LogEntry = {
        id: existing?.id ?? `day-${date}`,
        date,
        text: trimmed,
        createdAt: existing?.createdAt ?? Date.now(),
        parsed,
      };
      await putEntry(entry);
      const others = this.state.entries.filter((e) => e.date !== date);
      this.setEntries([...others, entry]);

      const count = parsed.nodes.length;
      this.set({
        busy: false,
        mode: 'graph',
        selectedId: this.state.selectedId,
        notice: {
          kind: 'ok',
          text: existing
            ? `这一天的日志已更新，${count} 个节点重新连回图谱`
            : `这一天的日志已经长进图谱了：${count} 个节点`,
        },
      });
      return true;
    } catch (err) {
      const detail = err instanceof LlmError ? err.detail : undefined;
      this.set({
        busy: false,
        notice: {
          kind: 'error',
          text: err instanceof Error ? err.message : '解析失败了',
          ...(detail ? { detail } : {}),
        },
      });
      return false;
    }
  }

  /** 手动粘贴 JSON 的后路：模型抽风时用户依然能把日志放上图谱。 */
  async importParsed(parsed: ParsedLog, text: string, date: string): Promise<boolean> {
    const existing = this.state.entries.find((e) => e.date === date);
    const entry: LogEntry = {
      id: existing?.id ?? `day-${date}`,
      date,
      text,
      createdAt: existing?.createdAt ?? Date.now(),
      parsed,
    };
    await putEntry(entry);
    this.setEntries([...this.state.entries.filter((e) => e.date !== date), entry]);
    this.set({
      mode: 'graph',
      notice: { kind: 'ok', text: `手动导入成功：这一天有 ${parsed.nodes.length} 个节点` },
    });
    return true;
  }

  async remove(id: string): Promise<void> {
    await removeEntry(id);
    this.setEntries(this.state.entries.filter((e) => e.id !== id));
    if (this.state.selectedId && !this.state.graph.nodes[this.state.selectedId]) {
      this.set({ selectedId: null });
    }
    this.set({ notice: { kind: 'ok', text: '删掉了。图谱重新长了一遍' } });
  }

  /** 标记念想已实现：写进那一天的解析结果，图上泛起一次金色涟漪。 */
  async achieve(nodeId: string): Promise<void> {
    const node = this.state.graph.nodes[nodeId];
    if (!node || node.type !== 'wish') return;
    const updated: LogEntry[] = [];
    for (const entry of this.state.entries) {
      let changed = false;
      const nodes = entry.parsed.nodes.map((n) => {
        if (n.type === 'wish' && n.name === node.name && !n.achieved) {
          changed = true;
          return { ...n, achieved: true };
        }
        return n;
      });
      if (changed) {
        const next = { ...entry, parsed: { ...entry.parsed, nodes } };
        updated.push(next);
        await putEntry(next);
      } else {
        updated.push(entry);
      }
    }
    this.setEntries(updated);
    this.set({
      ripple: this.state.ripple + 1,
      notice: { kind: 'ok', text: `「${node.name}」亮起来了` },
    });
  }

  /** 导出一份 JSON 备份：换端口、换浏览器之后，靠它把数据搬过去。 */
  exportAll(): string {
    return serializeBackup(this.state.entries);
  }

  /** 导入备份：按日期合并，同一天以备份为准（一天一篇）。 */
  async importAll(raw: string): Promise<void> {
    try {
      const { entries, skipped } = parseBackup(raw);
      const byDate = new Map(this.state.entries.map((e) => [e.date, e] as const));
      let added = 0;
      let replaced = 0;

      for (const entry of entries) {
        const prev = byDate.get(entry.date);
        // 沿用原 id 与创建时间，避免同一天出现两条记录
        const merged = prev ? { ...entry, id: prev.id, createdAt: prev.createdAt } : entry;
        if (prev) replaced += 1;
        else added += 1;
        byDate.set(entry.date, merged);
        await putEntry(merged);
      }

      this.setEntries([...byDate.values()]);
      this.set({
        mode: 'graph',
        notice: {
          kind: 'ok',
          text: `导入完成：新增 ${added} 篇、覆盖 ${replaced} 篇${skipped ? `，跳过 ${skipped} 条无效记录` : ''}`,
        },
      });
    } catch (err) {
      this.notify({
        kind: 'error',
        text: '导入失败',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async wipe(): Promise<void> {
    await clearAll();
    clearSettings();
    this.set({
      entries: [],
      graph: EMPTY_GRAPH,
      settings: { ...DEFAULT_SETTINGS },
      selectedId: null,
      cursor: null,
      mode: 'compose',
      notice: { kind: 'info', text: '本地数据已全部抹去' },
    });
  }
}

export const store = new Store();

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function nodeSubtitle(node: { count: number; type: NodeType }): string {
  return node.count > 1 ? `${node.count} 次` : '1 次';
}
