// batch25 第 1 项：__game / __qa / __perfSpot / __s1..__s3 / __testbed 只进「测试构建」（vite build --mode smoke），生产 dist 里没有。
// 所有要用这些钩子的脚本（smoke、smoke:xb、verify-budget / load / memory、shots-*、check-027、probe-d2）都通过这里起服务：
//   - dev: true（SMOKE_DEV=1 / XB_DEV=1）→ vite 开发服务器（src 现状，DEV 下钩子本来就在）
//   - 环境变量 SMOKE_DIST=<目录> → 复用一份已建好的测试构建（scripts/with-smoke-build.mjs 建在 /tmp，跑完自己删；不在这里删）
//   - 否则 → 临时建一份测试构建到 /tmp/foglight-smoke-dist-XXXX，跑完（含 Ctrl+C / timeout 的 SIGTERM）删掉——不长期占盘、不碰 dist/
// 测试构建和生产构建同一份 vite.config（同样的拆包、解码器裁剪、美术拷贝），差别只有 import.meta.env.MODE === 'smoke' 打开的调试钩子。
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer, preview } from 'vite';

export const SMOKE_MODE = 'smoke';

/** 目录里是不是测试构建（JS 里有 __qa 钩子）。生产 dist 返回 false。 */
export function isSmokeBuild(dir) {
  const st = join(dir, 'static');
  if (!existsSync(join(dir, 'index.html')) || !existsSync(st)) return false;
  return readdirSync(st).some((f) => f.endsWith('.js') && readFileSync(join(st, f), 'utf8').includes('__qa'));
}

/** 建一份测试构建到 dir（会清空 dir）。 */
export async function buildSmoke(root, dir) {
  const t0 = Date.now();
  await build({ root, mode: SMOKE_MODE, logLevel: 'warn', build: { outDir: dir, emptyOutDir: true } });
  if (!isSmokeBuild(dir)) throw new Error(`测试构建 ${dir} 里找不到 __qa 钩子（--mode ${SMOKE_MODE} 没生效？）`);
  console.log(`  · 测试构建（--mode ${SMOKE_MODE}）→ ${dir}，${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const owned = new Set();
function cleanupOwned() {
  for (const d of owned) rmSync(d, { recursive: true, force: true });
  owned.clear();
}
let hooked = false;
function hookExit() {
  if (hooked) return;
  hooked = true;
  process.on('exit', cleanupOwned);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => {
      cleanupOwned();
      process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[sig] ?? 0));
    });
  }
}

/**
 * 起游戏服务。返回 { server, port, kind: 'dev' | 'smoke-dist', dir, close() }。
 * opts.dev = true 用开发服务器；opts.port 固定端口（默认 0 = 随机）。
 */
export async function startGameServer(root, opts = {}) {
  const port = opts.port ?? 0;
  if (opts.dev) {
    const server = await (await createServer({ root, server: { host: '127.0.0.1', port, strictPort: !!opts.port, open: false, hmr: false }, logLevel: 'silent' })).listen();
    return { server, port: server.httpServer.address().port, kind: 'dev', dir: null, close: () => server.close() };
  }
  let dir;
  let mine = false;
  if (process.env.SMOKE_DIST) {
    dir = resolve(root, process.env.SMOKE_DIST);
    if (!isSmokeBuild(dir)) throw new Error(`SMOKE_DIST=${dir} 不是测试构建（没有 __qa 钩子）。生产 dist 不含调试钩子，冒烟要用 --mode ${SMOKE_MODE} 的构建`);
  } else {
    hookExit();
    dir = mkdtempSync(join(tmpdir(), 'foglight-smoke-dist-'));
    owned.add(dir);
    mine = true;
    await buildSmoke(root, dir);
  }
  const server = await preview({ root, mode: SMOKE_MODE, build: { outDir: dir }, preview: { host: '127.0.0.1', port, strictPort: !!opts.port, open: false }, logLevel: 'silent' });
  return {
    server,
    port: server.httpServer.address().port,
    kind: 'smoke-dist',
    dir,
    close: async () => {
      await new Promise((r) => server.httpServer.close(r));
      if (mine) {
        rmSync(dir, { recursive: true, force: true });
        owned.delete(dir);
      }
    },
  };
}
