import type { LogEntry } from '../types';

export interface ApiUser {
  id: string;
  email: string;
  createdAt: number;
}

/** 这个地址根本没有后端（比如部署在 GitHub Pages 上） */
export class ApiUnavailable extends Error {
  constructor(message = '这个地址没有后端') {
    super(message);
    this.name = 'ApiUnavailable';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiUnavailable('连不上服务器');
  }

  // 纯静态托管会把 /api/* 当成未知路径返回 index.html，用 content-type 区分
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new ApiUnavailable('这个地址没有后端');
  }

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (data as { error?: string } | null)?.error;
    throw new Error(message ?? `请求失败（HTTP ${res.status}）`);
  }
  return data as T;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const api = {
  me: () => request<{ user: ApiUser | null }>('/api/auth/me'),

  register: (email: string, password: string) =>
    request<{ user: ApiUser }>('/api/auth/register', postJson({ email, password })),

  login: (email: string, password: string) =>
    request<{ user: ApiUser }>('/api/auth/login', postJson({ email, password })),

  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  entries: () => request<{ entries: LogEntry[] }>('/api/entries'),

  saveEntry: (entry: LogEntry) =>
    request<{ ok: true; updatedAt: number }>('/api/entries', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entry }),
    }),

  deleteEntry: (id: string) =>
    request<{ ok: true }>(`/api/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 把本地已有的日志一次性搬上云（云端已有的不覆盖） */
  sync: (entries: LogEntry[]) =>
    request<{ imported: number; skipped: number }>('/api/entries/sync', postJson({ entries })),
};
