/**
 * Cloudflare 运行时类型的最小声明。
 *
 * 为什么不直接用 @cloudflare/workers-types：安装它需要重写 node_modules，
 * 而本机有 dev server 正占用原生模块（EBUSY）。这里只声明 Worker 代码真正用到的几个接口，
 * wrangler 部署时用 esbuild 转译、不做类型检查，所以不影响上线。
 *
 * 如果你后来装了 @cloudflare/workers-types，删掉这个文件并在 tsconfig 里加
 * "types": ["@cloudflare/workers-types"] 即可。
 */

interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface Fetcher {
  fetch(input: Request): Promise<Response>;
}

interface ExportedHandler<E> {
  fetch(req: Request, env: E): Promise<Response> | Response;
}
