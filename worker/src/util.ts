/**
 * Worker 里的纯逻辑：不碰 D1、不碰 env，单独可测。
 */

export interface ValidEntry {
  id: string;
  date: string;
  text: string;
  createdAt: number;
  parsed: { nodes: unknown[]; edges: unknown[] };
}

export function normalizeEmail(raw: unknown): string | null {
  const email = String(raw ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (email.length > 254) return null;
  return email;
}

export function validateEntry(raw: unknown): ValidEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return null;
  if (typeof e.text !== 'string') return null;
  const parsed = e.parsed as { nodes?: unknown; edges?: unknown } | undefined;
  if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
  return {
    id: typeof e.id === 'string' && e.id ? e.id : `day-${e.date}`,
    date: e.date,
    text: e.text,
    createdAt:
      typeof e.createdAt === 'number' && Number.isFinite(e.createdAt) ? e.createdAt : Date.now(),
    parsed: { nodes: parsed.nodes, edges: parsed.edges },
  };
}

export function b64(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += String.fromCharCode(b);
  return btoa(out);
}

export function unb64(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export async function hashPassword(
  password: string,
  saltB64: string,
  iterations = 120_000,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: unb64(saltB64), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return b64(new Uint8Array(bits));
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64(buf).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 定长比较，避免用字符串相等泄露匹配长度 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}
