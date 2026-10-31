/**
 * v0.1-M7 兼容性冒烟（Firefox / WebKit，playwright）：主菜单 → 新游戏 → S1 首帧 → 出口 → S2 → 出口 → S3。
 * 不进 npm 依赖：playwright 装在仓库外，用 PW_MODULE 指过去（M7 时装在 /workspace/pw-tools，浏览器在 /workspace/pw-browsers）。
 *   PW_MODULE=/workspace/pw-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers \
 *   XB_BROWSER=firefox|webkit|chromium npm run smoke:xb
 * 用 dist（vite preview），?smoke=1 暴露 __game；任一 console.error / 未捕获异常记为失败（与 smoke-browser 同口径）。
 * WebKit 只是 Safari 的同引擎近似（Linux WPE/GTK 端口，GPU / 媒体栈 / 字体都不同），结论不能代替真 Safari。
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const which = process.env.XB_BROWSER ?? 'firefox';
const pw = await import(pathToFileURL(process.env.PW_MODULE ?? 'playwright').href);
const LOAD_MS = Number(process.env.XB_LOAD_MS ?? 240000);
const shotDir = process.env.XB_SHOTS ?? mkdtempSync(join(tmpdir(), `m7-xb-${which}-`));

const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const port = server.httpServer.address().port;
const base = `http://127.0.0.1:${port}/?smoke=1${process.env.XB_QUERY ? '&' + process.env.XB_QUERY : ''}`;

const errors = [];
const infos = [];
const steps = [];
let browser;
const t0 = Date.now();
const step = (name, extra = '') => {
  const s = `${((Date.now() - t0) / 1000).toFixed(1)}s ${name}${extra ? ' ' + extra : ''}`;
  steps.push(s);
  console.log('  ' + s);
};
try {
  browser = await pw[which].launch({ headless: true, timeout: 60000 });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('console.error: ' + m.text());
    else if (m.type() === 'warning' || /\[assets\]|\[quality\]|\[render\]/.test(m.text())) infos.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push('pageerror: ' + (e.stack ?? e.message)));
  const until = async (expr, ms, label) => {
    try {
      await page.waitForFunction(expr, null, { timeout: ms, polling: 200 });
    } catch {
      throw new Error(`${label}（${ms / 1000}s 超时）`);
    }
  };
  const shot = async (name) => {
    const f = join(shotDir, `${which}-${name}.png`);
    await page.screenshot({ path: f, timeout: 60000 });
    return `${name}.png ${(statSync(f).size / 1024).toFixed(0)}KB`;
  };
  const env = async () =>
    page.evaluate(() => {
      const g = window.__game;
      const gl = g.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const k = g.assets.ktx2?.workerConfig ?? {};
      const exts = gl.getSupportedExtensions() ?? [];
      return {
        ua: navigator.userAgent,
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        ktx2Targets: Object.entries(k).filter(([, v]) => v === true).map(([n]) => n),
        cbHalf: exts.includes('EXT_color_buffer_half_float'),
        cbFloat: exts.includes('EXT_color_buffer_float'),
        floatLinear: exts.includes('OES_texture_float_linear'),
        audio: g.audio.context?.state ?? 'none',
        quality: g.quality?.tier ?? null,
        fonts: [...document.fonts].map((f) => `${f.family}:${f.status}`),
        fullscreenApi: typeof document.documentElement.requestFullscreen === 'function' || typeof document.documentElement.webkitRequestFullscreen === 'function',
        pointerLockApi: typeof document.documentElement.requestPointerLock === 'function',
      };
    });
  /** 当前场景里实际用到的贴图格式（compressed:<GL 格式常量> = KTX2 转成了 GPU 压缩格式；raw = RGBA 回落 / 普通图片） */
  const texFormats = () =>
    page.evaluate(() => {
      const out = {};
      const seen = new Set();
      window.__game.scenes.current.scene.traverse((o) => {
        for (const m of [o.material].flat().filter(Boolean))
          for (const v of Object.values(m))
            if (v && v.isTexture && !seen.has(v)) {
              seen.add(v);
              const key = `${v.isCompressedTexture ? 'compressed' : 'raw'}:${v.format}`;
              out[key] = (out[key] ?? 0) + 1;
            }
      });
      return out;
    });

  // ---- 主菜单
  await page.goto(base, { timeout: 60000 });
  await until(() => !!window.__game && !!document.querySelector('.main-menu [data-act="new"]')?.getClientRects().length, LOAD_MS, '主菜单没出现');
  step('主菜单', await shot('menu'));
  const e0 = await env();
  // ---- 新游戏 → S1 首帧
  await page.click('.main-menu [data-act="new"]', { timeout: 20000 });
  await until(() => window.__game.scenes.current?.name === 's1-ebb-shore', LOAD_MS, '新游戏没进 S1');
  await until(() => window.__game.input.context === 'explore' && !window.__game.flow.transitioning, LOAD_MS, 'S1 没回到可操作');
  // 实际出帧：等主循环再走 30 个 fixed tick
  const tick0 = await page.evaluate(() => window.__game.time.fixedTick);
  await until(`window.__game.time.fixedTick > ${tick0} + 30`, 120000, 'S1 主循环不走');
  step('S1 首帧可操作', await shot('s1'));
  const fmt = await texFormats();
  const audio1 = await page.evaluate(() => ({ state: window.__game.audio.context?.state, music: window.__game.audio.musicKey ?? null }));
  // ---- S1 出口 → S2 → 出口 → S3（「外 → 内」踩出口；不解谜，同 010）
  const exit = async (next) => {
    await page.evaluate(async () => {
      const s = window.__game.scenes.current;
      const c = s.exits[0].opts.center.clone();
      s.rig.body.teleport(c.clone().add(new c.constructor(2.5, 0.02, 2.5)));
      for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
      s.rig.body.teleport(c.clone().setY(c.y + 0.02));
    });
    await until(`window.__game.scenes.current?.name === '${next}'`, LOAD_MS, `出口没进 ${next}`);
    await until(() => window.__game.input.context === 'explore' && !window.__game.flow.transitioning, LOAD_MS, `${next} 没回到可操作`);
    const t = await page.evaluate(() => window.__game.time.fixedTick);
    await until(`window.__game.time.fixedTick > ${t} + 30`, 120000, `${next} 主循环不走`);
  };
  await exit('s2-keeper-house');
  step('S2 可操作', await shot('s2'));
  await exit('s3-lighthouse');
  step('S3 可操作', await shot('s3'));
  const save = await page.evaluate(() => JSON.parse(localStorage.getItem('foglight.save.v1') ?? 'null'));
  if (save?.sceneId !== 's3') throw new Error('进 S3 后存档不是 s3：' + JSON.stringify(save));
  // ---- 刷新 → 继续（存档在本浏览器能读回）
  await page.goto(base, { timeout: 60000 });
  await until(() => !!document.querySelector('.main-menu [data-act="continue"]')?.getClientRects().length, LOAD_MS, '刷新后没有「继续」');
  await page.click('.main-menu [data-act="continue"]', { timeout: 20000 });
  await until(() => window.__game.scenes.current?.name === 's3-lighthouse' && window.__game.input.context === 'explore' && !window.__game.flow.transitioning, LOAD_MS, '继续没回 S3');
  step('刷新 → 继续回 S3');
  const perf = await page.evaluate(() => ({ fps: window.__game.time?.fps ?? null, mem: performance.memory?.usedJSHeapSize ?? null }));
  console.log(JSON.stringify({ browser: which, version: browser.version(), env: e0, texFormats: fmt, audioAfterClick: audio1, perf }, null, 1));
} catch (err) {
  errors.push('FAIL: ' + (err?.message ?? err));
} finally {
  await browser?.close().catch(() => undefined);
  server.httpServer.close();
}
if (infos.length) console.log('info/warn:\n  ' + [...new Set(infos)].slice(0, 30).join('\n  '));
console.log(`screens: ${shotDir}`);
if (!process.env.XB_SHOTS && process.env.XB_KEEP_SHOTS !== '1') rmSync(shotDir, { recursive: true, force: true });
if (errors.length) {
  console.log(`✗ ${which}: ${errors.length} 个错误\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`✓ ${which}: ${steps.length} 步通过（${((Date.now() - t0) / 1000).toFixed(0)}s）`);
process.exit(0);
