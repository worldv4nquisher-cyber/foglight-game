import { fileURLToPath, URL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/**
 * three 的 DRACOLoader 用 `new URL('../libs/draco/…', import.meta.url)` 静态引用了三套解码器，
 * Vite 会把它们全部拷进 dist（看起来像「draco_decoder / draco_wasm_wrapper 各两份」）：
 *   1. 通用版 wasm：draco_decoder.wasm（286KB）+ draco_wasm_wrapper.js（59KB）
 *   2. glTF 专用 wasm：gltf/draco_decoder.wasm（192KB）+ gltf/draco_wasm_wrapper.js（58KB）← 我们用这套
 *   3. 纯 JS 回退：draco_decoder.js（719KB，无 WebAssembly 时才用）
 * 运行时只会加载其中一套，不是重复打包，但另外两套白占包体。AssetLoader 固定使用 DRACO_GLTF_CONFIG，
 * 这里在构建时把 1、3 的 URL 置空，让 Rollup 不再产出它们。
 * basis_transcoder.js + .wasm 是同一套 KTX2 转码器的胶水代码和二进制，两者都需要，不处理。
 * three 升级后若源码格式变化导致替换数不对，构建直接报错，避免悄悄失效。
 */
function threeDecodersWasmOnly(): Plugin {
  const unused = ['draco_decoder.wasm', 'draco_wasm_wrapper.js', 'draco_decoder.js'];
  return {
    name: 'three-decoders-wasm-only',
    apply: 'build',
    transform(code, id) {
      if (!/three[\\/]examples[\\/]jsm[\\/]loaders[\\/]DRACOLoader\.js$/.test(id)) return null;
      let count = 0;
      let out = code;
      for (const file of unused) {
        const re = new RegExp(`new URL\\(\\s*'\\.\\./libs/draco/${file.replace('.', '\\.')}',\\s*import\\.meta\\.url\\s*\\)\\.toString\\(\\)`);
        if (re.test(out)) {
          out = out.replace(re, "''");
          count++;
        }
      }
      if (count !== unused.length) {
        throw new Error(`[three-decoders-wasm-only] DRACOLoader.js 只替换了 ${count}/${unused.length} 处，three 源码可能已变化，请检查插件`);
      }
      return { code: out, map: null };
    },
  };
}

export default defineConfig({
  // 相对路径，方便以后 Capacitor / Electron 以 file:// 或本地 webview 加载
  base: './',
  plugins: [threeDecodersWasmOnly()],
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
