import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, posix, relative, resolve, sep } from 'node:path';
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

/**
 * v0.1-013：美术交付目录 ../art 直接作为运行时资源源（不复制进 git 的 public/）。
 * - URL 约定：`assets/art/<相对 art 的路径>`，如 assets/art/models/env/env-cliff-s1.glb；
 *   GLB 里外部 KTX2 写的是 `../../textures/tex-*.ktx2`，相对 GLB URL 解析后正好落在 assets/art/textures/，GLTFLoader + KTX2Loader 原样可用。
 * - dev：中间件把 /assets/art/** 映射到 ../art/**（只放行 models/ textures/ audio/ 下的 glb / ktx2 / webp / png / ogg）。
 * - build：把 src/assets/manifest.ts 里登记的 assets/art/ 资源 + 每个 GLB 引用的外部贴图拷进 dist/assets/art/（npm run size 按实际文件统计）。
 *   ../art 不存在（只拉了 game/ 的环境）时什么也不拷，清单项都是 optional，运行时退回白盒。
 */
const ART_DIR = fileURLToPath(new URL('../art', import.meta.url));
const ART_PREFIX = 'assets/art/';
const ART_OK = /^(models|textures|audio)\/[^\0]*\.(glb|ktx2|webp|png|ogg|mp3|m4a)$/;
const MIME: Record<string, string> = { glb: 'model/gltf-binary', ktx2: 'image/ktx2', webp: 'image/webp', png: 'image/png', ogg: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4' };

function artFile(rel: string): string | null {
  const clean = posix.normalize(decodeURIComponent(rel));
  if (!ART_OK.test(clean) || clean.startsWith('..')) return null;
  const abs = normalize(join(ART_DIR, clean));
  if (!abs.startsWith(ART_DIR + sep) || !existsSync(abs) || !statSync(abs).isFile()) return null;
  return abs;
}

/** GLB 的 JSON 块里外部 uri（图片 / buffer） */
export function glbExternalUris(file: string): string[] {
  const b = readFileSync(file);
  if (b.length < 20 || b.toString('ascii', 0, 4) !== 'glTF') return [];
  const len = b.readUInt32LE(12);
  const json = JSON.parse(b.toString('utf8', 20, 20 + len)) as { images?: Array<{ uri?: string }>; buffers?: Array<{ uri?: string }> };
  return [...(json.images ?? []), ...(json.buffers ?? [])].map((x) => x.uri).filter((u): u is string => !!u && !u.startsWith('data:'));
}

function manifestArtUrls(): string[] {
  const src = readFileSync(fileURLToPath(new URL('./src/assets/manifest.ts', import.meta.url)), 'utf8');
  return [...src.matchAll(/^\s*\{[^\n]*url:\s*'(assets\/art\/[^']+)'/gm)].map((m) => m[1] ?? '');
}

function artAssets(): Plugin {
  let outDir = 'dist';
  return {
    name: 'foglight-art-assets',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? '';
        const i = url.indexOf('/' + ART_PREFIX);
        if (i < 0) return next();
        const abs = artFile(url.slice(i + 1 + ART_PREFIX.length));
        if (!abs) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', MIME[abs.split('.').pop() ?? ''] ?? 'application/octet-stream');
        res.setHeader('Content-Length', String(statSync(abs).size));
        createReadStream(abs).pipe(res);
      });
    },
    writeBundle() {
      if (!existsSync(ART_DIR)) {
        this.warn('../art 不存在：美术资源没有打进 dist，运行时用白盒');
        return;
      }
      const todo = manifestArtUrls().map((u) => u.slice(ART_PREFIX.length));
      const done = new Set<string>();
      while (todo.length) {
        const rel = posix.normalize(todo.pop()!);
        if (done.has(rel)) continue;
        done.add(rel);
        const abs = artFile(rel);
        if (!abs) {
          this.warn(`清单里的美术资源 ${rel} 不在 ../art 里（运行时用占位）`);
          continue;
        }
        const out = join(outDir, ART_PREFIX, rel);
        mkdirSync(dirname(out), { recursive: true });
        copyFileSync(abs, out);
        if (rel.endsWith('.glb')) for (const u of glbExternalUris(abs)) todo.push(relative(ART_DIR, resolve(dirname(abs), decodeURIComponent(u))).split(sep).join('/'));
      }
    },
  };
}

export default defineConfig({
  // 相对路径，方便以后 Capacitor / Electron 以 file:// 或本地 webview 加载
  base: './',
  plugins: [threeDecodersWasmOnly(), artAssets()],
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
