import { describe, expect, it } from 'vitest';
import {
  b64,
  hashPassword,
  normalizeEmail,
  randomToken,
  readCookie,
  safeEqual,
  unb64,
  validateEntry,
} from '../src/util';

describe('normalizeEmail', () => {
  it('去空格、转小写', () => {
    expect(normalizeEmail('  Someone@Example.COM ')).toBe('someone@example.com');
  });

  it('拒绝明显不合法的输入', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('没有at符号')).toBeNull();
    expect(normalizeEmail('a@b')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(123)).toBeNull();
  });
});

describe('validateEntry', () => {
  const good = {
    id: 'day-2024-05-01',
    date: '2024-05-01',
    text: '今天很累',
    createdAt: 1000,
    parsed: { nodes: [{ type: 'emotion', name: '疲惫' }], edges: [] },
  };

  it('接受完整的一篇', () => {
    const v = validateEntry(good);
    expect(v).not.toBeNull();
    expect(v!.id).toBe('day-2024-05-01');
    expect(v!.parsed.nodes).toHaveLength(1);
  });

  it('缺 id 时按日期补一个', () => {
    const v = validateEntry({ ...good, id: undefined });
    expect(v!.id).toBe('day-2024-05-01');
  });

  it('createdAt 不合法时用当前时间兜底', () => {
    const v = validateEntry({ ...good, createdAt: 'x' });
    expect(typeof v!.createdAt).toBe('number');
    expect(v!.createdAt).toBeGreaterThan(0);
  });

  it('日期格式不对、缺 text、缺 parsed 一律拒绝', () => {
    expect(validateEntry({ ...good, date: '2024/05/01' })).toBeNull();
    expect(validateEntry({ ...good, text: 123 })).toBeNull();
    expect(validateEntry({ ...good, parsed: { nodes: [] } })).toBeNull();
    expect(validateEntry({ ...good, parsed: { nodes: [], edges: [] } })).not.toBeNull();
    expect(validateEntry(null)).toBeNull();
    expect(validateEntry('字符串')).toBeNull();
  });
});

describe('base64 往返', () => {
  it('编码再解码回到原字节', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);
    expect([...unb64(b64(bytes))]).toEqual([...bytes]);
  });
});

describe('hashPassword', () => {
  it('同密码同盐得到同一个哈希', async () => {
    const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
    const a = await hashPassword('correct horse', salt, 1000);
    const b = await hashPassword('correct horse', salt, 1000);
    expect(a).toBe(b);
  });

  it('同密码不同盐得到不同哈希（说明确实加了盐）', async () => {
    const a = await hashPassword('correct horse', b64(new Uint8Array(16)), 1000);
    const b = await hashPassword('correct horse', b64(new Uint8Array([1, ...new Array(15).fill(0)])), 1000);
    expect(a).not.toBe(b);
  });

  it('密码不同则哈希不同', async () => {
    const salt = b64(new Uint8Array(8));
    expect(await hashPassword('aaaaaaaa', salt, 1000)).not.toBe(
      await hashPassword('aaaaaaab', salt, 1000),
    );
  });
});

describe('safeEqual', () => {
  it('相等才返回 true，长度不同直接 false', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('readCookie', () => {
  it('从 Cookie 头里取出指定名字', () => {
    expect(readCookie('a=1; mw_session=token-123; b=2', 'mw_session')).toBe('token-123');
    expect(readCookie('mw_session=only', 'mw_session')).toBe('only');
  });

  it('没有就返回 null，名字前缀相同也不会误取', () => {
    expect(readCookie(null, 'mw_session')).toBeNull();
    expect(readCookie('other=1', 'mw_session')).toBeNull();
    expect(readCookie('mw_session_old=x', 'mw_session')).toBeNull();
  });

  it('值里的百分号编码会被还原', () => {
    expect(readCookie('mw_session=a%2Fb%2Bc', 'mw_session')).toBe('a/b+c');
  });
});

describe('randomToken', () => {
  it('默认 32 字节，URL 安全，且每次不同', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 字节 → base64 43 个字符（去掉 padding）
    expect(a.length).toBe(43);
  });
});
