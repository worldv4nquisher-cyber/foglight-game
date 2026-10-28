import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // 相对路径，方便以后 Capacitor / Electron 以 file:// 或本地 webview 加载
  base: './',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'static',
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      output: {
        // three 单独分包：游戏代码迭代时 three chunk 的哈希不变，可长期缓存
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
});
