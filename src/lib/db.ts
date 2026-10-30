import type { LogEntry } from '../types';

/**
 * 全部数据留在本地：日志原文与解析结果进 IndexedDB（不支持时退回 localStorage）。
 * 没有账号、没有云同步、没有任何上报。
 */
const DB_NAME = 'mindweb-db';
const DB_VERSION = 1;
const STORE = 'entries';
const LS_KEY = 'mindweb.entries';

let dbPromise: Promise<IDBDatabase> | null = null;

function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      dbPromise = null; // 下次调用重新尝试
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    // file:// 或隐私模式下 indexedDB.open 可能既不 success 也不 error，不能一直等
    const timer = setTimeout(
      () => fail(new Error('本地数据库没有响应（file:// 打开时浏览器会禁用 IndexedDB）')),
      2500,
    );
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('date', 'date', { unique: false });
        }
      };
      req.onsuccess = () => {
        if (settled) {
          req.result.close();
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(req.result);
      };
      req.onerror = () => fail(req.error ?? new Error('无法打开本地数据库'));
      req.onblocked = () => fail(new Error('本地数据库被另一个标签页占用'));
    } catch (err) {
      fail(err);
    }
  });
  return dbPromise;
}

function readLocal(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LogEntry[]) : [];
  } catch {
    return [];
  }
}

function writeLocal(entries: LogEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries));
  } catch {
    /* 本地存储满了也先不打断用户 */
  }
}

export async function loadEntries(): Promise<LogEntry[]> {
  if (!idbAvailable()) return readLocal();
  try {
    const db = await openDb();
    return await new Promise<LogEntry[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const rows = (req.result as LogEntry[]) ?? [];
        resolve(rows.sort((a, b) => b.date.localeCompare(a.date)));
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return readLocal();
  }
}

export async function putEntry(entry: LogEntry): Promise<void> {
  if (!idbAvailable()) {
    const rest = readLocal().filter((e) => e.id !== entry.id);
    writeLocal([...rest, entry]);
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    const rest = readLocal().filter((e) => e.id !== entry.id);
    writeLocal([...rest, entry]);
  }
}

export async function removeEntry(id: string): Promise<void> {
  if (!idbAvailable()) {
    writeLocal(readLocal().filter((e) => e.id !== id));
    return;
  }
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    writeLocal(readLocal().filter((e) => e.id !== id));
  }
}

/** 清空全部本地数据（设置页的"抹去一切"）。 */
export async function clearAll(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* 忽略 */
  }
  if (!idbAvailable()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* 已经清过 localStorage，够用了 */
  }
}
