/**
 * v0.1-M7 兼容性冒烟（Firefox / WebKit，playwright）：主菜单 → 新游戏 → S1 首帧 → 出口 → S2 → 出口 → S3。
 * 不进 npm 依赖：playwright 装在仓库外，用 PW_MODULE 指过去（M7 时装在 /workspace/pw-tools，浏览器在 /workspace/pw-browsers）。
 *   PW_MODULE=/workspace/pw-tools/node_modules/playwright/index.mjs PLAYWRIGHT_BROWSERS_PATH=/workspace/pw-browsers \
 *   XB_BROWSER=firefox|webkit|chromium npm run smoke:xb
 * 用测试构建（vite build --mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST=已建好的测试构建 可复用），?smoke=1；生产 dist 不含 __game 钩子（batch25）。任一 console.error / 未捕获异常记为失败（与 smoke-browser 同口径）。
 * 手机模拟：XB_DEVICE='iPhone 15'（webkit）/ 'Pixel 7'（chromium，XB_CHROMIUM_PATH 指系统 Chrome）——只模拟视口 / UA / 触摸 / DPR，
 *   GPU、内存、iOS 真 Safari 的限制都模拟不了；只看「能不能打开、给没给提示、能不能跑」。
 * XB_AUDIO_DECODE=reject：把 decodeAudioData 换成立即 EncodingError 拒绝。M7 装的 Linux WebKit（WPE）没有 GStreamer 解码插件，
 *   decodeAudioData 连 WAV 都永不返回，带 art=1 时卡在启动；用它绕过，顺带模拟 Safari 18.4 以前解不了 Ogg 的情况（音频全部缺失也要能玩）。
 * BUG-035：手机模拟（XB_DEVICE）断言主菜单显示 ui.notice.desktop_only、菜单按钮隐藏，然后结束（v0.1 只做桌面，手机不进场）；
 *   桌面断言不出这条提示。XB_DEV=1 用 vite 开发服务器代替测试构建。
 * WebKit 只是 Safari 的同引擎近似（Linux WPE/GTK 端口，GPU / 媒体栈 / 字体都不同），结论不能代替真 Safari。
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const which = process.env.XB_BROWSER ?? 'firefox';
const pw = await import(pathToFileURL(process.env.PW_MODULE ?? 'playwright').href);
const LOAD_MS = Number(process.env.XB_LOAD_MS ?? 240000);
const tag = `${which}${process.env.XB_DEVICE ? '-' + process.env.XB_DEVICE.replace(/\W+/g, '') : ''}`;
const shotDir = process.env.XB_SHOTS ?? mkdtempSync(join(tmpdir(), `m7-xb-${tag}-`));

const TEXT = JSON.parse(readFileSync(resolve(root, '../docs/gdd/text-ch1.json'), 'utf8')).strings;
const DEV_SERVER = process.env.XB_DEV === '1';
// batch25：生产 dist 不含 __game 钩子 → 测试构建（--mode smoke，临时建在 /tmp、跑完删；SMOKE_DIST 可复用），XB_DEV=1 用开发服务器
const game = await startGameServer(root, { dev: DEV_SERVER });
if (DEV_SERVER) console.log('  ! XB_DEV=1：vite 开发服务器（src 现状），不是构建产物');
const port = game.port;
const base = `http://127.0.0.1:${port}/?smoke=1${process.env.XB_QUERY ? '&' + process.env.XB_QUERY : ''}`;

const errors = [];
const infos = [];
const steps = [];
let browser;
const t0 = Date.now();
let lastStep = '启动';
const step = (name, extra = '') => {
  lastStep = name;
  const s = `${((Date.now() - t0) / 1000).toFixed(1)}s ${name}${extra ? ' ' + extra : ''}`;
  steps.push(s);
  console.log('  ' + s);
};
try {
  const dev = process.env.XB_DEVICE ? pw.devices[process.env.XB_DEVICE] : null;
  if (process.env.XB_DEVICE && !dev) throw new Error('playwright 没有设备 ' + process.env.XB_DEVICE);
  browser = await pw[which].launch({ headless: true, timeout: 60000, ...(which === 'chromium' && process.env.XB_CHROMIUM_PATH ? { executablePath: process.env.XB_CHROMIUM_PATH, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {}) });
  const ctx = await browser.newContext(dev ? { ...dev } : { viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  if (process.env.XB_AUDIO_DECODE === 'reject') {
    await page.addInitScript(() => {
      for (const C of [window.AudioContext, window.webkitAudioContext, window.OfflineAudioContext].filter(Boolean)) {
        C.prototype.decodeAudioData = function (_buf, _ok, fail) {
          const e = new DOMException('stub: decode disabled (XB_AUDIO_DECODE=reject)', 'EncodingError');
          fail?.(e);
          return Promise.reject(e);
        };
      }
    });
  }
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error（${lastStep} 之后，${((Date.now() - t0) / 1000).toFixed(1)}s）: ` + m.text());
    else if (m.type() === 'warning' || /\[assets\]|\[quality\]|\[render\]/.test(m.text())) infos.push(`${m.type()}: ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => errors.push(`pageerror（${lastStep} 之后）: ` + (e.stack || e.message || `${e.name ?? ''} ${String(e)} ${JSON.stringify(e)}`)));
  const until = async (expr, ms, label) => {
    try {
      await page.waitForFunction(expr, null, { timeout: ms, polling: 200 });
    } catch {
      throw new Error(`${label}（${ms / 1000}s 超时）`);
    }
  };
  const shot = async (name) => {
    const f = join(shotDir, `${tag}-${name}.png`);
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
  await until(
    () => !!window.__game && !!(document.querySelector('.main-menu [data-act="new"]')?.getClientRects().length || document.querySelector('.main-desktop-only')?.getClientRects().length),
    LOAD_MS,
    '主菜单没出现',
  );
  step('主菜单', await shot('menu'));
  const e0 = await env();
  // ---- BUG-035：手机出「仅支持电脑」提示（按钮隐藏）后结束，不进场；桌面不出提示，接着走全程
  const notice = await page.evaluate(() => {
    const vis = (sel) => !!document.querySelector(sel)?.getClientRects().length;
    const n = document.querySelector('.main-desktop-only');
    const r = n?.getBoundingClientRect();
    const mm = (q) => matchMedia(q).matches;
    return {
      shown: vis('.main-desktop-only'), text: n?.textContent ?? null, newg: vis('.main-menu [data-act="new"]'), title: vis('.main-title'),
      rect: r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null, vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth,
      coarse: mm('(pointer: coarse)'), hover: mm('(hover: hover)'), anyFine: mm('(any-pointer: fine)'), anyHover: mm('(any-hover: hover)'), touchPoints: navigator.maxTouchPoints,
    };
  });
  if (dev) {
    if (!notice.shown || notice.newg) throw new Error('手机模拟应显示「仅支持电脑」提示、隐藏菜单按钮 ' + JSON.stringify(notice));
    if (notice.text !== TEXT['ui.notice.desktop_only']) throw new Error('提示文字与文本表 ui.notice.desktop_only 不一致：' + JSON.stringify(notice.text));
    const [l, t, r, b] = notice.rect;
    if (!notice.title || l < 0 || t < 0 || r > notice.vw || b > notice.vh || notice.scrollW > notice.vw) throw new Error('提示 / 标题不在竖屏视口内 ' + JSON.stringify(notice));
    step('BUG-035 手机提示', `「${notice.text}」 框 [${notice.rect.join(', ')}] 视口 ${notice.vw}×${notice.vh} coarse ${notice.coarse} hover ${notice.hover} anyFine ${notice.anyFine}`);
    console.log(JSON.stringify({ browser: which, version: browser.version(), device: process.env.XB_DEVICE, notice, env: e0 }, null, 1));
  } else {
  if (notice.shown) throw new Error('桌面不该出「仅支持电脑」提示 ' + JSON.stringify(notice));
  // ---- 新游戏 → S1 首帧
  await page.click('.main-menu [data-act="new"]', { timeout: 20000 });
  await until(() => window.__game.scenes.current?.name === 's1-ebb-shore', LOAD_MS, '新游戏没进 S1');
  await until(() => window.__game.input.context === 'explore' && !window.__game.flow.transitioning, LOAD_MS, 'S1 没回到可操作');
  // 实际出帧：等主循环再走 30 个 fixed tick
  const tick0 = await page.evaluate(() => window.__game.time.fixedTick);
  await until(`window.__game.time.fixedTick > ${tick0} + 30`, 120000, 'S1 主循环不走');
  step('S1 首帧可操作', await shot('s1'));
  const fmt = await texFormats();
  const touchUi = await page.evaluate(() => ({ touchControls: !!document.querySelector('.touch-controls'), touchPoints: navigator.maxTouchPoints, coarse: matchMedia('(pointer: coarse)').matches, hudPrompt: document.querySelector('.hud-prompt')?.textContent ?? null, visibleText: [...document.querySelectorAll('.hud *, .toast, .notice, [role="alert"]')].filter((e) => e.checkVisibility?.() ?? true).map((e) => e.textContent.trim()).filter(Boolean).slice(0, 6) }));
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
  lastStep = '刷新（离开 S3 页）';
  await page.goto(base, { timeout: 60000 });
  lastStep = '刷新后主菜单';
  await until(() => !!document.querySelector('.main-menu [data-act="continue"]')?.getClientRects().length, LOAD_MS, '刷新后没有「继续」');
  await page.click('.main-menu [data-act="continue"]', { timeout: 20000 });
  await until(() => window.__game.scenes.current?.name === 's3-lighthouse' && window.__game.input.context === 'explore' && !window.__game.flow.transitioning, LOAD_MS, '继续没回 S3');
  step('刷新 → 继续回 S3');
  const perf = await page.evaluate(() => ({ fps: window.__game.time?.fps ?? null, mem: performance.memory?.usedJSHeapSize ?? null }));
  console.log(JSON.stringify({ browser: which, version: browser.version(), device: process.env.XB_DEVICE ?? null, touchUi, env: e0, texFormats: fmt, audioAfterClick: audio1, perf }, null, 1));
  }
} catch (err) {
  errors.push('FAIL: ' + (err?.message ?? err));
} finally {
  await browser?.close().catch(() => undefined);
  await game.close();
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
