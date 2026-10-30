import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 相对路径：部署到任意子路径（或从 dist 目录直接由静态服务器打开）都不会断资源
  base: './',
  // 端口必须固定：浏览器的 IndexedDB 按「协议+主机+端口」隔离，
  // 一旦 vite 自己换到 5174，用户看到的就是一个空数据库（旧日志“消失”）。
  // 宁可在端口被占用时直接报错，也不静默换地址。
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
