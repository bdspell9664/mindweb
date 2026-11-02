/**
 * 心络 API —— Cloudflare Worker + D1
 *
 * 认证：邮箱 + 密码（PBKDF2-SHA256，12 万次迭代），会话是 httpOnly Cookie 里的随机 token。
 * 数据：一篇日志一行，parsed 存 JSON。未登录的请求一律 401。
 * 静态资源：同一 Worker 通过 [assets] 托管前端，所以前后端同源。
 */

import {
  b64,
  hashPassword,
  normalizeEmail,
  randomToken,
  readCookie,
  safeEqual,
  validateEntry,
  type ValidEntry,
} from './util';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const COOKIE_NAME = 'mw_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SYNC_BATCH = 500;

interface SessionUser {
  id: string;
  email: string;
  createdAt: number;
}

interface EntryRow {
  id: string;
  date: string;
  text: string;
  created_at: number;
  parsed: string;
  updated_at: number;
}

// ── 小工具 ────────────────────────────────────────────

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function fail(message: string, status = 400): Response {
  return json({ error: message }, status);
}

async function safeJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await req.text();
    if (!text) return null;
    const data: unknown = JSON.parse(text);
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function sessionCookie(req: Request, token: string, maxAgeSec: number): string {
  // localhost 是 http，浏览器会拒绝 Secure Cookie，所以按实际协议决定
  const secure = new URL(req.url).protocol === 'https:';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

function clearCookie(req: Request): string {
  return sessionCookie(req, '', 0);
}

// ── 会话 ──────────────────────────────────────────────

async function currentUser(req: Request, env: Env): Promise<SessionUser | null> {
  const token = readCookie(req.headers.get('Cookie'), COOKIE_NAME);
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.created_at AS createdAt
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`,
  )
    .bind(token, Date.now())
    .first<SessionUser>();
  return row ?? null;
}

async function createSession(env: Env, userId: string, now: number): Promise<string> {
  const token = randomToken(32);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
  await env.DB.prepare(
    'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(token, userId, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

// ── 认证接口 ──────────────────────────────────────────

async function register(req: Request, env: Env): Promise<Response> {
  const body = await safeJson(req);
  if (!body) return fail('请求体不是合法 JSON');
  const email = normalizeEmail(body.email);
  if (!email) return fail('邮箱格式看起来不对');
  const password = String(body.password ?? '');
  if (password.length < 8) return fail('密码至少 8 位');
  if (password.length > 200) return fail('密码太长了');

  const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (exists) return fail('这个邮箱已经注册过了', 409);

  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await hashPassword(password, salt);
  const id = crypto.randomUUID();
  const now = Date.now();

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, email, hash, salt, now)
    .run();

  const token = await createSession(env, id, now);
  return json(
    { user: { id, email, createdAt: now } },
    201,
    { 'Set-Cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000) },
  );
}

async function login(req: Request, env: Env): Promise<Response> {
  const body = await safeJson(req);
  if (!body) return fail('请求体不是合法 JSON');
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  if (!email || !password) return fail('邮箱和密码都要填');

  const row = await env.DB.prepare(
    'SELECT id, email, password_hash, password_salt, created_at FROM users WHERE email = ?',
  )
    .bind(email)
    .first<{ id: string; email: string; password_hash: string; password_salt: string; created_at: number }>();

  // 邮箱不存在也走一次哈希，避免用响应时间猜出哪些邮箱注册过
  const salt = row?.password_salt ?? b64(new Uint8Array(16));
  const attempt = await hashPassword(password, salt);
  if (!row || !safeEqual(attempt, row.password_hash)) {
    return fail('邮箱或密码不对', 401);
  }

  const now = Date.now();
  const token = await createSession(env, row.id, now);
  return json(
    { user: { id: row.id, email: row.email, createdAt: row.created_at } },
    200,
    { 'Set-Cookie': sessionCookie(req, token, SESSION_TTL_MS / 1000) },
  );
}

async function logout(req: Request, env: Env): Promise<Response> {
  const token = readCookie(req.headers.get('Cookie'), COOKIE_NAME);
  if (token) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  }
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(req) });
}

async function me(req: Request, env: Env): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return json({ user: null });
  return json({ user });
}

// ── 日志接口 ──────────────────────────────────────────

function rowToEntry(row: EntryRow) {
  let parsed: unknown = { nodes: [], edges: [] };
  try {
    parsed = JSON.parse(row.parsed);
  } catch {
    /* 数据坏了也别让整个列表挂掉 */
  }
  return {
    id: row.id,
    date: row.date,
    text: row.text,
    createdAt: row.created_at,
    parsed,
  };
}

async function listEntries(req: Request, env: Env): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return fail('请先登录', 401);

  const { results } = await env.DB.prepare(
    'SELECT id, date, text, created_at, parsed, updated_at FROM entries WHERE user_id = ? ORDER BY date DESC',
  )
    .bind(user.id)
    .all<EntryRow>();

  return json({ entries: (results ?? []).map(rowToEntry) });
}

async function upsertEntry(req: Request, env: Env): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return fail('请先登录', 401);

  const body = await safeJson(req);
  const entry = validateEntry(body?.entry ?? body);
  if (!entry) return fail('日志数据不完整');

  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO entries (user_id, id, date, text, created_at, parsed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       date = excluded.date,
       text = excluded.text,
       parsed = excluded.parsed,
       updated_at = excluded.updated_at`,
  )
    .bind(user.id, entry.id, entry.date, entry.text, entry.createdAt, JSON.stringify(entry.parsed), now)
    .run();

  return json({ ok: true, updatedAt: now });
}

async function deleteEntry(req: Request, env: Env, id: string): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return fail('请先登录', 401);
  if (!id) return fail('缺少 id');

  await env.DB.prepare('DELETE FROM entries WHERE user_id = ? AND id = ?').bind(user.id, id).run();
  return json({ ok: true });
}

/** 把本地已有的日志一次性搬上云。云端已有的同 id 日志不覆盖（云端为准）。 */
async function syncEntries(req: Request, env: Env): Promise<Response> {
  const user = await currentUser(req, env);
  if (!user) return fail('请先登录', 401);

  const body = await safeJson(req);
  const list = body?.entries;
  if (!Array.isArray(list)) return fail('entries 必须是数组');
  if (list.length > MAX_SYNC_BATCH) return fail(`一次最多同步 ${MAX_SYNC_BATCH} 篇`, 413);

  const valid = list.map(validateEntry).filter((v): v is ValidEntry => v !== null);
  if (valid.length === 0) return fail('没有可用的日志');

  const now = Date.now();
  const stmt = env.DB.prepare(
    `INSERT INTO entries (user_id, id, date, text, created_at, parsed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO NOTHING`,
  );

  await env.DB.batch(
    valid.map((e) =>
      stmt.bind(user.id, e.id, e.date, e.text, e.createdAt, JSON.stringify(e.parsed), now),
    ),
  );

  return json({ imported: valid.length, skipped: list.length - valid.length });
}

// ── 路由 ──────────────────────────────────────────────

async function handleApi(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;

  if (path === '/api/health') return json({ ok: true });

  if (path === '/api/auth/register' && method === 'POST') return register(req, env);
  if (path === '/api/auth/login' && method === 'POST') return login(req, env);
  if (path === '/api/auth/logout' && method === 'POST') return logout(req, env);
  if (path === '/api/auth/me' && method === 'GET') return me(req, env);

  if (path === '/api/entries' && method === 'GET') return listEntries(req, env);
  if (path === '/api/entries' && method === 'PUT') return upsertEntry(req, env);
  if (path === '/api/entries/sync' && method === 'POST') return syncEntries(req, env);
  if (path.startsWith('/api/entries/') && method === 'DELETE') {
    return deleteEntry(req, env, decodeURIComponent(path.slice('/api/entries/'.length)));
  }

  return fail('没有这个接口', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, url);
      } catch (err) {
        console.error('api error', err);
        return fail('服务器出错了，稍后再试', 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
