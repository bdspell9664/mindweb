#!/usr/bin/env node
/**
 * npm 在部分版本上装不全原生二进制（npm/cli#4828），
 * 症状是 vite / tsc / lightningcss 报 "Cannot find native binding"。
 *
 * 这里按当前平台找出缺失的那几个，用 --no-save 补进 node_modules，
 * 不改动 package.json 与 package-lock.json —— 所以仓库保持跨平台干净，
 * 而 Windows 上遇到这个 npm bug 的人跑一次 `npm run fix:native` 就好。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hosts = ['rolldown', 'lightningcss', 'typescript'];
const platformTag = `-${process.platform}-${process.arch}`;

function installed(name) {
  return existsSync(path.join(root, 'node_modules', ...name.split('/'), 'package.json'));
}

const missing = [];
for (const host of hosts) {
  const pkgPath = path.join(root, 'node_modules', host, 'package.json');
  if (!existsSync(pkgPath)) continue;
  const optional = JSON.parse(readFileSync(pkgPath, 'utf8')).optionalDependencies ?? {};
  for (const [name, version] of Object.entries(optional)) {
    if (!name.includes(platformTag)) continue;
    if (!installed(name)) missing.push(`${name}@${version}`);
  }
}

if (missing.length === 0) {
  console.log(`[fix-native] ${process.platform}-${process.arch} 的原生二进制齐全，无需处理。`);
  process.exit(0);
}

console.log('[fix-native] 补装缺失的原生二进制：');
for (const item of missing) console.log('  -', item);

try {
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'install',
    '--no-save',
    '--ignore-scripts',
    ...missing,
  ], { stdio: 'inherit', cwd: root });
  console.log('[fix-native] 完成。再跑一次 npm run build 应该就正常了。');
} catch {
  console.error('[fix-native] 自动补装失败。请手动执行：');
  console.error(`  npm install --no-save ${missing.join(' ')}`);
  process.exit(1);
}
