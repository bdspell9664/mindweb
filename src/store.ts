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
import { ApiUnavailable, api, type ApiUser } from './lib/api';
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

/** cloud = 有后端且已连上；local = 纯本地（没后端，或还没登录） */
export type Backend = 'local' | 'cloud';

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
  /** 当前登录的账号；null 表示本地模式 */
  user: ApiUser | null;
  backend: Backend;
  authBusy: boolean;
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
    user: null,
    backend: 'local',
    authBusy: false,
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
      const [localEntries, settings] = await Promise.all([
        loadEntries(),
        Promise.resolve(loadSettings()),
      ]);
      let entries = sortEntries(localEntries);
      let user: ApiUser | null = null;
      let backend: Backend = 'local';

      // 先问后端要会话。纯静态托管（GitHub Pages）上会失败，那就安静地留在本地模式。
      try {
        const me = await api.me();
        backend = 'cloud';
        user = me.user;
        if (user) {
          const remote = await api.entries();
          entries = sortEntries(remote.entries);
          await this.cacheEntries(entries);
        }
      } catch {
        backend = 'local';
      }

      this.set({
        ready: true,
        entries,
        graph: buildGraph(entries),
        settings,
        user,
        backend,
        mode: entries.length === 0 ? 'compose' : 'graph',
      });
      if (isFile && entries.length === 0) {
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

  // ── 账号与同步 ───────────────────────────────────────

  /** 云端为准：把云端数据写进本地缓存，并清掉云端已不存在的旧缓存 */
  private async cacheEntries(entries: LogEntry[]): Promise<void> {
    try {
      const keep = new Set(entries.map((e) => e.id));
      for (const cached of await loadEntries()) {
        if (!keep.has(cached.id)) await removeEntry(cached.id);
      }
      for (const entry of entries) await putEntry(entry);
    } catch {
      /* 缓存写失败不影响主流程 */
    }
  }

  /** 已登录时把一篇推上云；本地已经存过了，这里只是尽力同步 */
  private async pushEntry(entry: LogEntry): Promise<boolean> {
    if (!this.state.user) return true;
    try {
      await api.saveEntry(entry);
      return true;
    } catch {
      return false;
    }
  }

  async signUp(email: string, password: string): Promise<boolean> {
    return this.authenticate(() => api.register(email, password));
  }

  async signIn(email: string, password: string): Promise<boolean> {
    return this.authenticate(() => api.login(email, password));
  }

  private async authenticate(call: () => Promise<{ user: ApiUser }>): Promise<boolean> {
    this.set({ authBusy: true, notice: null });
    try {
      const { user } = await call();
      await this.afterAuth(user);
      return true;
    } catch (err) {
      this.set({
        authBusy: false,
        notice: {
          kind: 'error',
          text:
            err instanceof ApiUnavailable
              ? '这个地址没有后端，只能本地使用。要用账号请部署到 Cloudflare。'
              : err instanceof Error
                ? err.message
                : '登录失败',
        },
      });
      return false;
    }
  }

  /** 登录成功后：云端为准拉一份下来；第一次登录且云端为空时，先把本地搬上去 */
  private async afterAuth(user: ApiUser): Promise<void> {
    const local = this.state.entries;
    let remote = await api.entries();
    let uploaded = 0;

    if (remote.entries.length === 0 && local.length > 0) {
      const result = await api.sync(local);
      uploaded = result.imported;
      remote = await api.entries();
    }

    const entries = sortEntries(remote.entries);
    await this.cacheEntries(entries);
    this.set({
      authBusy: false,
      user,
      backend: 'cloud',
      entries,
      graph: buildGraph(entries),
      selectedId: null,
      notice: {
        kind: 'ok',
        text:
          uploaded > 0
            ? `已登录 ${user.email}，把本地的 ${uploaded} 篇搬到了云端`
            : `已登录 ${user.email}，共 ${entries.length} 篇日志`,
      },
    });
  }

  async signOut(): Promise<void> {
    await api.logout().catch(() => {});
    let entries: LogEntry[] = [];
    try {
      entries = sortEntries(await loadEntries());
    } catch {
      entries = [];
    }
    this.set({
      user: null,
      backend: 'local',
      entries,
      graph: buildGraph(entries),
      selectedId: null,
      notice: { kind: 'info', text: '已退出登录。本地还留着一份缓存，可以继续离线用。' },
    });
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

      const synced = await this.pushEntry(entry);
      const count = parsed.nodes.length;
      this.set({
        busy: false,
        mode: 'graph',
        selectedId: this.state.selectedId,
        notice: {
          kind: synced ? 'ok' : 'info',
          text: existing
            ? `这一天的日志已更新，${count} 个节点重新连回图谱`
            : `这一天的日志已经长进图谱了：${count} 个节点`,
          ...(synced ? {} : { detail: '已经存在本地，但没能同步到云端' }),
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
    const synced = await this.pushEntry(entry);
    this.set({
      mode: 'graph',
      notice: {
        kind: synced ? 'ok' : 'info',
        text: `手动导入成功：这一天有 ${parsed.nodes.length} 个节点`,
        ...(synced ? {} : { detail: '已经存在本地，但没能同步到云端' }),
      },
    });
    return true;
  }

  async remove(id: string): Promise<void> {
    await removeEntry(id);
    if (this.state.user) await api.deleteEntry(id).catch(() => {});
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
        await this.pushEntry(next);
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
