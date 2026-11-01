// 无头 Chrome 冒烟测试：测试构建（vite build --mode smoke，带 __game / __qa 钩子；临时建在 /tmp、跑完删）用 vite preview 起服务 → 无头 Chrome 打开 ?smoke=1 →
// 等主场景就绪 → 跑下面的 CHECKS → 汇总控制台错误 / 未捕获异常。任何一项失败退出码 1。
// 用法：npm run smoke（需要本机有 Chrome/Chromium；路径可用 CHROME=/path 指定）。生产 dist/ 不含钩子，不能拿来冒烟（batch25）；
// SMOKE_DIST=<已建好的测试构建> 复用（scripts/with-smoke-build.mjs），SMOKE_DEV=1 用 vite 开发服务器。
// 依赖：只用 Node 内置（child_process、WebSocket），不额外装 puppeteer。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';
import { S1, s1StepLinks } from '@/levels/s1/layout';
import { ENDING_CUES } from '@/systems/audio/endingMusic';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 文本表原文（005 检查对照显示的文字） */
const TEXT = JSON.parse(readFileSync(resolve(root, '../docs/gdd/text-ch1.json'), 'utf8')).strings;
/** SMOKE_DEV=1：用 vite 开发服务器代替测试构建（跳过构建产物检查，结果不代表构建产物） */
const DEV = process.env.SMOKE_DEV === '1';
if (DEV) console.log('  ! SMOKE_DEV=1：vite 开发服务器（src 现状），不是构建产物');
// batch25：服务先起（非 DEV 时这一步会建测试构建）；测试构建和生产构建同一份 vite.config，解码器 / 美术拷贝一样
const game = await startGameServer(root, { dev: DEV });
const server = game.server;
// 构建产物：DRACO 只应有 glTF 专用 wasm 一套（wrapper.js + .wasm），不应有通用版和纯 JS 回退
if (!DEV) {
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(game.dir, 'static'));
  const draco = files.filter((f) => f.startsWith('draco_'));
  const basis = files.filter((f) => f.startsWith('basis_'));
  const okDraco = draco.length === 2 && draco.some((f) => /^draco_wasm_wrapper-.*\.js$/.test(f)) && draco.some((f) => /^draco_decoder-.*\.wasm$/.test(f));
  const okBasis = basis.length === 2 && basis.some((f) => f.endsWith('.js')) && basis.some((f) => f.endsWith('.wasm'));
  if (!okDraco || !okBasis) {
    console.error(`  ✗ 构建产物解码器文件不对：${[...draco, ...basis].join(', ')}`);
    process.exit(1);
  }
  console.log(`  ✓ 构建产物解码器各一套：${[...draco, ...basis].join(', ')}`);
}
/**
 * 建立镜头（进场演出）结束、交还 explore 的等待上限（ms，墙钟）。镜头按游戏时间走（单帧截断 0.25 s），
 * box 负载高（13–18）时 3 s 演出要几十秒到上百秒墙钟，写死 60 s 会误报（batch16 制作人 ⑨）。
 * 默认 180 s；SMOKE_ESTAB_TIMEOUT_MS=… 覆盖（如本机快可调小、负载更高可调大）。
 */
const ESTAB_MS = (() => {
  const v = Number(process.env.SMOKE_ESTAB_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 180000;
})();
/** 换地址 / 刷新后等场景就绪的上限（ms，墙钟）：软件渲染 + box 高负载下 S3 冷启动会超过 60 s。默认 120 s，SMOKE_LOAD_TIMEOUT_MS 覆盖 */
const LOAD_MS = (() => {
  const v = Number(process.env.SMOKE_LOAD_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : 120000;
})();
const chromePath =
  process.env.CHROME ??
  ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(
    (p) => existsSync(p),
  );
if (!chromePath) {
  console.error('找不到 Chrome，用 CHROME=/path/to/chrome 指定');
  process.exit(1);
}

/**
 * 页面内执行的检查（字符串形式的 async 函数体，可用 g = window.__game）。返回描述字符串；抛错即失败。
 * 各需求单的可自动校验项加在这里。
 */
const CHECKS = [
  {
    name: '主场景运行、渲染循环在走',
    code: `
      // 无头 SwiftShader 进场头几帧在编译着色器，单帧可达 2–3 s：最多等 8 s 看到帧数增加
      const f0 = g.time.frame;
      for (let i = 0; i < 16 && g.time.frame < f0 + 2; i++) await sleep(500);
      if (g.time.frame <= f0) throw new Error('帧计数没有增加');
      return 'scene=' + g.scenes.current.name + ' frames+' + (g.time.frame - f0);`,
  },
  {
    name: 'DRACO glTF 专用 wasm 解码器可加载并运行',
    code: `
      const d = g.assets.draco;
      if (!/draco_wasm_wrapper/.test(d.decoderPaths.js) || !/draco_decoder.*\\.wasm/.test(d.decoderPaths.wasm)) throw new Error('decoderPaths 不对: ' + JSON.stringify(d.decoderPaths));
      if (d.decoderPaths.dep_js !== null) throw new Error('仍然保留了 JS 回退');
      // 喂一段无效数据：如果 wasm 成功实例化，worker 会返回解码器自己的错误（Unexpected geometry type / Decoding failed）
      const msg = await new Promise((res) => d.parse(new Uint8Array(64).buffer, () => res('意外成功'), (e) => res(String(e?.error ?? e?.message ?? e))));
      if (!/Unexpected geometry type|Decoding failed/.test(msg)) throw new Error('解码器未正常运行: ' + msg);
      return 'wasm=' + d.decoderPaths.wasm.split('/').pop() + '；无效数据 → ' + msg;`,
  },
  {
    name: 'KTX2 Basis 转码器（js 胶水 + wasm）可加载',
    code: `
      const k = g.assets.ktx2;
      await k.init();
      if (!k.workerSourceURL) throw new Error('转码器 worker 未建立');
      const files = performance.getEntriesByType('resource').map((e) => e.name.split('/').pop()).filter((n) => /basis_transcoder/.test(n));
      if (files.length !== 2) throw new Error('应加载 basis_transcoder .js + .wasm 各一次，实际: ' + files.join(','));
      return files.join(' + ');`,
  },
  {
    name: 'v0.1-013 美术外部 KTX2：GLB 里 ../../textures/*.ktx2 按 GLB URL 解析加载、转码成压缩纹理；渔网 alphaHash',
    code: `
      const e = (k, f) => ({ key: 'smoke-' + k, type: 'gltf', url: 'assets/art/models/env/' + f + '.glb', group: 's1', optional: true });
      await g.assets.loadEntries([e('net', 'env-net-rack-a'), e('netb', 'env-net-rack-b')]);
      if (g.assets.isMissing('smoke-net')) throw new Error('env-net-rack-a 没加载（dist/assets/art 里没有？）');
      const m = g.assets.getModel('smoke-net');
      const texs = new Map(); let net = null;
      m.traverse((o) => { if (!o.isMesh) return; for (const mat of [o.material].flat()) { if (mat.name === 'mat-env-net') net = mat; for (const v of Object.values(mat)) if (v && v.isTexture) texs.set(v.uuid, v); } });
      if (!net || !net.alphaHash || net.alphaTest !== 0) throw new Error('渔网材质没开 alphaHash：' + JSON.stringify(net && { h: net.alphaHash, t: net.alphaTest }));
      const list = [...texs.values()];
      if (list.length < 3) throw new Error('贴图太少 ' + list.length);
      const bad = list.filter((t) => !t.isCompressedTexture && !(t.isDataTexture) || !(t.mipmaps?.[0]?.width > 1 || t.image?.width > 1));
      if (bad.length) throw new Error('外部 KTX2 没转码成纹理：' + bad.map((t) => t.name + ':' + (t.image?.width ?? '?')).join(','));
      const req = performance.getEntriesByType('resource').map((r) => r.name).filter((n) => n.includes('/assets/art/textures/tex-') && n.endsWith('.ktx2'));
      if (req.length < 3) throw new Error('没有从 assets/art/textures/ 请求 KTX2：' + req.join(','));
      const w = list.map((t) => t.mipmaps?.[0]?.width ?? t.image?.width);
      // 两个 GLB 共用 tex-wood-ch1-*：只加载一份（同一个纹理对象）
      const texB = new Set(); g.assets.getModel('smoke-netb').traverse((o) => { if (o.isMesh) for (const mat of [o.material].flat()) for (const v of Object.values(mat)) if (v && v.isTexture) texB.add(v.uuid); });
      const sharedN = [...texs.keys()].filter((u) => texB.has(u)).length;
      if (sharedN < 3) throw new Error('net-rack-a / b 共用的木头贴图没有共享：' + sharedN);
      const woodReq = req.filter((n) => /tex-wood-ch1-albedo/.test(n)).length;
      if (woodReq !== 1) throw new Error('tex-wood-ch1-albedo 请求了 ' + woodReq + ' 次');
      g.assets.unload('smoke-net');
      g.assets.unload('smoke-netb');
      return list.length + ' 张（' + [...new Set(w)].join('/') + ' px，' + (list[0].isCompressedTexture ? '压缩纹理 format ' + list[0].format : '未压缩回退') + '），请求 ' + req.map((n) => n.split('/').pop()).join(', ') + '；两 GLB 共享 ' + sharedN + ' 张 ✓；mat-env-net alphaHash ✓';`,
  },
  {
    name: 'v0.1-003 建立镜头：进场 3 s 演出（cutscene 上下文），结束交还 explore',
    code: `
      const until = async (pred, ms = 20000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
      const cam = g.scenes.current.cameraFollow;
      const first = cam.modeName;
      // 镜头按游戏时间走（单帧截断 0.25 s），机器极忙时 3 s 演出可能要几十秒墙钟：上限 SMOKE_ESTAB_TIMEOUT_MS（默认 180 s）
      if (!(await until(() => g.input.context === 'explore' && cam.modeName === 'explore' && !cam.blending, ${ESTAB_MS}))) throw new Error('建立镜头没有结束：' + g.input.context + ' ' + cam.modeName);
      return (first === 'cutscene' ? '开场是演出 ✓' : '（检查开始时已结束）') + '，已交还 explore ✓';`,
  },
  {
    name: 'v0.1-001 输入：键位按上下文映射、Esc 暂停压 menu、F4 调试面板',
    code: `
      const inp = g.input;
      const key = (code, type) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      const tap = async (code) => { key(code, 'keydown'); key(code, 'keyup'); await sleep(50); };
      const last = () => inp.recent[0] && inp.recent[0].context + ':' + inp.recent[0].action;
      // SwiftShader 只有个位数帧率：按下要等下一帧 tick 才被 Game 消费，轮询等待
      const until = async (pred, ms = 3000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); };
      if (inp.context !== 'explore') throw new Error('初始上下文 ' + inp.context);
      if (!document.querySelector('canvas').requestPointerLock) throw new Error('无 requestPointerLock');
      await tap('KeyE'); if (last() !== 'explore:interact') throw new Error('explore E → ' + last());
      await tap('Space'); if (last() !== 'explore:advance') throw new Error('explore Space → ' + last());
      const pop = inp.pushContext('puzzle');
      await tap('KeyE'); if (last() !== 'puzzle:partNext') throw new Error('puzzle E → ' + last());
      await tap('Tab'); if (last() !== 'puzzle:exitPuzzle') throw new Error('puzzle Tab → ' + last());
      pop();
      await tap('Escape'); await until(() => g.isPaused);
      if (!g.isPaused || inp.context !== 'menu') throw new Error('Esc 后 paused=' + g.isPaused + ' ctx=' + inp.context);
      if (document.querySelector('.pause-menu').hidden) throw new Error('暂停菜单没显示');
      await tap('Escape'); await until(() => !g.isPaused);
      if (g.isPaused || inp.context !== 'explore') throw new Error('再按 Esc 后 paused=' + g.isPaused + ' ctx=' + inp.context);
      await tap('F4'); await sleep(400);
      const panel = document.querySelector('.debug-panel');
      const shown = panel && panel.style.display !== 'none' && /上下文/.test(panel.textContent);
      return 'E/Space/Tab/Esc 映射正确；F4 调试面板=' + (shown ? '显示' : '未开启（非调试模式）');`,
  },
  {
    name: 'v0.1-001 指针锁定：点击画面锁定、移动直接转视角、Esc 暂停、继续后再点可重新锁定',
    async run({ evaluate, cdp, sleep }) {
      const state = () =>
        evaluate(`({ locked: document.pointerLockElement === document.querySelector('canvas'), paused: __game.isPaused, ctx: __game.input.context, yaw: __game.scenes.current.cameraFollow?.yaw ?? null })`);
      const waitFor = async (pred, ms = 3000) => {
        const end = Date.now() + ms;
        let s = await state();
        while (!pred(s) && Date.now() < end) {
          await sleep(100);
          s = await state();
        }
        return s;
      };
      await cdp.click(640, 400);
      await waitFor((s) => s.locked);
      let s = await state();
      if (!s.locked) throw new Error('点击画面后没有进入指针锁定 ' + JSON.stringify(s));
      const yaw0 = s.yaw;
      for (let i = 1; i <= 5; i++) await cdp.move(640 + i * 20, 400);
      await sleep(300);
      s = await state();
      const turned = yaw0 === null ? '（未暴露 yaw）' : Math.abs(s.yaw - yaw0) > 1e-3 ? '转动 ' + (s.yaw - yaw0).toFixed(3) + ' rad' : null;
      if (!turned) throw new Error('锁定后移动鼠标视角没变 ' + JSON.stringify(s));
      await cdp.key('Escape', 'Escape', 27);
      s = await waitFor((s) => s.paused && !s.locked);
      if (!s.paused || s.locked) throw new Error('Esc 后应解锁并暂停 ' + JSON.stringify(s));
      const r = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(r.x, r.y); // 真实点击「继续」
      await sleep(1300); // 浏览器：解锁后约 1 秒内不能重新锁定
      s = await state();
      if (s.paused) throw new Error('继续后仍是暂停');
      await cdp.click(640, 400);
      s = await waitFor((s) => s.locked);
      if (!s.locked) throw new Error('继续后再点画面没有重新锁定 ' + JSON.stringify(s));
      await evaluate(`document.exitPointerLock()`);
      s = await waitFor((s) => !s.locked && s.paused);
      if (s.paused) await evaluate('__game.resume()');
      return '锁定 ✓，视角' + turned + '，Esc→暂停 ✓，重新锁定 ✓';
    },
  },
  {
    name: 'v0.1-006 存档 / 设置：进场自动存档、设置刷新保留且立即生效、坏存档提示、旧画质键迁移',
    async run({ evaluate, cdp, sleep }) {
      const read = () =>
        evaluate(`({
          save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null'),
          settings: JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null'),
          legacy: localStorage.getItem('game.quality'),
          status: __game.save.status, startup: __game.save.startupNotice,
          sens: __game.input.lookSensitivity, inv: __game.input.invertY, tier: __game.quality.tier,
          toast: (() => { const t = document.querySelector('.hud-toast'); return t && !t.hidden ? t.textContent : null; })(),
        })`);
      let s = await read();
      if (!s.save || s.save.version !== 1 || s.save.sceneId !== 's1') throw new Error('进场没有自动存档：' + JSON.stringify(s.save));
      // 首次启动的画质检测（009）：建立镜头里开始，降档重测最多 3 轮 × 3 s
      for (let i = 0; i < 120 && s.settings?.qualityDetected !== true; i++) {
        await sleep(250);
        s = await read();
      }
      if (!s.settings || s.settings.qualityDetected !== true) throw new Error('首次启动没有记下画质检测：' + JSON.stringify(s.settings));
      // 修改设置立即生效
      await evaluate(`__game.settings.update({ mouseSensitivity: 2.5, invertY: true })`);
      s = await read();
      if (s.sens !== 2.5 || s.inv !== true) throw new Error('设置没有立即生效 ' + JSON.stringify(s));
      // 写坏存档 + 旧画质键（模拟老版本残留），刷新
      await evaluate(`localStorage.setItem('foglight.save.v1', JSON.stringify({ ...JSON.parse(localStorage.getItem('foglight.save.v1')), version: 0 })); 1`);
      await cdp.reload();
      await sleep(300);
      s = await read();
      if (s.sens !== 2.5 || s.inv !== true) throw new Error('刷新后设置没保留 ' + JSON.stringify(s));
      if (s.startup !== '存档无法读取，只能开始新游戏。') throw new Error('坏存档没有提示：' + s.startup);
      if (!s.toast || !/存档无法读取/.test(s.toast)) throw new Error('HUD 没显示坏存档提示：' + s.toast);
      if (!s.save || s.save.version !== 1) throw new Error('坏存档后新游戏没有重新存档');
      // 旧键迁移：清掉设置、写旧键，刷新
      await evaluate(`localStorage.removeItem('foglight.settings.v1'); localStorage.setItem('game.quality', 'high'); 1`);
      await cdp.reload();
      s = await read();
      if (s.legacy !== null || s.settings?.quality !== 'high' || s.tier !== 'high') throw new Error('旧画质键迁移不对 ' + JSON.stringify(s));
      // 恢复干净状态
      await evaluate(`localStorage.clear(); 1`);
      await cdp.reload();
      return '自动存档 ✓，设置即时生效 / 刷新保留 ✓，坏存档提示 ✓，旧键迁移 ✓';
    },
  },
  {
    name: 'v0.1-009 画质：默认极致、3 秒检测（simulateFps=40 连降两档）、只测一次、手动改回保存、恢复默认、运行时切档、F3 面板',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const st = () =>
        evaluate(`({ tier: __game.quality.tier, bench: __game.benchmark.state, rounds: __game.benchmark.rounds.map((r) => r.tier + ':' + Math.round(r.fps)),
          settings: JSON.parse(localStorage.getItem('foglight.settings.v1') || 'null') })`);
      // 1) 实机（SwiftShader）首次检测：006 检查最后清空了设置并刷新，这里等那一次检测跑完
      let s = await st();
      for (let i = 0; i < 160 && s.bench === 'running'; i++) {
        await sleep(250);
        s = await st();
      }
      if (!s.settings?.qualityDetected || s.settings.qualitySource !== 'auto' || s.settings.quality !== s.tier) throw new Error('实测检测结果不对 ' + JSON.stringify(s));
      out.push('SwiftShader 实测 → ' + s.tier + '（' + s.rounds.join(' / ') + '）');
      // 2) 清空设置 + ?simulateFps=40：开场是极致，3 s 后高，再 3 s 后标准，之后不再降
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('simulateFps=40');
      s = await st();
      if (s.settings?.qualityDetected) throw new Error('清空设置后应重新检测');
      // 009 制作人裁定：第一轮在建立镜头内测完（第一次降档时还在 cutscene），后续轮次在玩家可操作后继续
      await evaluate(`(() => { const g = __game; window.__qcam = []; window.__qclock = [];
        g.events.on('quality:changed', (e) => { if (e.source === 'auto') { window.__qcam.push(e.previous + '>' + e.tier + ':' + g.scenes.current.cameraFollow.modeName); window.__qclock.push([g.time.elapsed, performance.now() / 1000]); } }); return 1; })()`);
      const seen = [s.tier];
      const end = Date.now() + 40000;
      while (Date.now() < end && s.bench !== 'done') {
        await sleep(150);
        s = await st();
        if (seen.at(-1) !== s.tier) seen.push(s.tier);
      }
      if (seen.join('>') !== 'ultra>high>standard') throw new Error('降档顺序 ' + seen.join('>') + ' ' + JSON.stringify(s));
      await sleep(4000);
      s = await st();
      if (s.tier !== 'standard' || s.rounds.length !== 3) throw new Error('应停在标准且只测 3 轮 ' + JSON.stringify(s));
      const ss = s.settings;
      if (!ss.qualityDetected || ss.quality !== 'standard' || ss.qualityDetectedTier !== 'standard' || ss.qualitySource !== 'auto') throw new Error('检测结果没写对 ' + JSON.stringify(ss));
      const qcam = await evaluate(`window.__qcam`);
      // 开场 start() 的 'high>ultra'（如有）在监听之前；只看降档
      const drops = qcam.filter((x) => /^ultra>high|^high>standard/.test(x));
      // 检测按墙钟计时，建立镜头按游戏时间（单帧截断 0.25 s）走：机器极忙、单帧 > 0.25 s 时游戏时间落后墙钟，
      // 第二轮 3 s 墙钟可能在镜头交还前就测完。两次降档之间游戏时间 / 墙钟 < 0.6 时，第二轮时机只记录不判定
      const qclock = await evaluate(`window.__qclock`);
      const ratio = qclock.length >= 2 ? (qclock[1][0] - qclock[0][0]) / Math.max(1e-3, qclock[1][1] - qclock[0][1]) : 1;
      const lagged = ratio < 0.6;
      if (drops.length !== 2 || !/:cutscene$/.test(drops[0]) || (/:cutscene$/.test(drops[1]) && !lagged)) throw new Error('第一轮应在建立镜头内、第二轮在交还之后：' + qcam.join(', ') + '（游戏时间 / 墙钟 ' + ratio.toFixed(2) + '）');
      if (/:cutscene$/.test(drops[1])) out.push('⚠ 负载过高（游戏时间 / 墙钟 ' + ratio.toFixed(2) + '），第二轮时机未判定');
      out.push('simulateFps=40：' + seen.join(' → ') + ' ✓（第一轮在建立镜头内、第二轮玩家可操作后 ✓）');
      // 设置界面（暂停菜单）画质项下显示 quality_auto_note
      const note = await evaluate(`(async () => { __game.pause('user'); __game.ui.pause.openSettings(); await new Promise((r) => setTimeout(r, 300));
        const n = document.querySelector('[data-role="quality-note"]'); const t = n && !n.hidden ? n.textContent : null; __game.resume(); return t; })()`);
      if (note !== '已根据这台电脑自动选择画质，可以随时改回。') throw new Error('降档提示没显示：' + note);
      out.push('降档提示 ✓');
      // 3) 刷新：不再检测
      await cdp.reload();
      await sleep(4500);
      s = await st();
      if (s.tier !== 'standard' || s.bench !== 'idle' || s.rounds.length) throw new Error('刷新后又检测了 ' + JSON.stringify(s));
      // 4) 手动改回极致：生效、保存、刷新后保持、提示消失
      await evaluate(`__game.quality.set('ultra'); 1`);
      await cdp.reload();
      await sleep(4500);
      s = await st();
      if (s.tier !== 'ultra' || s.settings.quality !== 'ultra' || s.settings.qualitySource !== 'user' || s.bench !== 'idle') throw new Error('手动改回极致没保存 ' + JSON.stringify(s));
      out.push('刷新不再检测 ✓，手动改回极致保存 ✓');
      // 5) 恢复默认：回到检测结果（标准），不重新检测
      await evaluate(`__game.settings.resetToDefaults(); 1`);
      await sleep(300);
      s = await st();
      if (s.tier !== 'standard' || s.settings.qualitySource !== 'auto' || s.bench !== 'idle') throw new Error('恢复默认不对 ' + JSON.stringify(s));
      out.push('恢复默认 → 检测结果 ✓');
      // 6) 运行时切三档：不重载场景，阴影贴图 / 雨量 / 像素比跟着变，最长帧间隔 < 1 s
      const sw = await evaluate(`(async () => {
        const g = __game; const scene = g.scenes.current; const res = [];
        let events = 0; const off = g.events.on('quality:changed', () => events++);
        for (const t of ['ultra', 'high', 'standard', 'ultra']) {
          let last = performance.now(), worst = 0, run = true;
          const tick = (now) => { worst = Math.max(worst, now - last); last = now; if (run) requestAnimationFrame(tick); };
          requestAnimationFrame(tick);
          g.quality.set(t);
          await new Promise((r) => setTimeout(r, 1500));
          run = false;
          const p = g.quality.preset;
          const sun = scene.scene.getObjectByProperty('isDirectionalLight', true);
          const rain = scene.scene.getObjectByName('rain');
          res.push({ t, same: g.scenes.current === scene, worst: Math.round(worst), shadow: sun.shadow.mapSize.width, shadowMap: sun.shadow.map ? sun.shadow.map.width : null,
            wantShadow: p.shadowType.mapSize, rain: rain.dropCount /* 028 起 Rain 是 Group，数量读 dropCount */, wantRain: p.rainParticles.count,
            pr: g.renderer.getPixelRatio(), wantPr: Math.min(devicePixelRatio, p.maxPixelRatio, 2) * p.renderScale });
        }
        off();
        return { res, events };
      })()`);
      for (const r of sw.res) {
        if (!r.same) throw new Error('切档重载了场景');
        if (r.shadow !== r.wantShadow || (r.shadowMap !== null && r.shadowMap !== r.wantShadow)) throw new Error('阴影贴图没重建 ' + JSON.stringify(r));
        if (r.rain !== r.wantRain) throw new Error('雨量不对 ' + JSON.stringify(r));
        if (Math.abs(r.pr - r.wantPr) > 1e-6) throw new Error('像素比不对 ' + JSON.stringify(r));
        // SwiftShader（CPU 软件渲染）里着色器编译 / 渲染目标重建本身就要 1–2 s，这里只拦「卡死」；
        // 验收的 < 1 s 要在真显卡上看（F3 面板的 max 帧时间），见 README
        if (r.worst >= 5000) throw new Error('切档卡死 ≥ 5 s ' + JSON.stringify(r));
      }
      if (sw.events < 4) throw new Error('quality:changed 事件数 ' + sw.events);
      // 切档不能有可见黑帧：画布重建（setPixelRatio / setSize 会清空绘图缓冲）必须发生在渲染之前
      const rar = await evaluate(`__game.debugStats.resizeAfterRender`);
      if (rar !== 0) throw new Error('有 ' + rar + ' 次画布重建发生在本帧渲染之后（可见黑帧）');
      out.push('切档无渲染后重建画布 ✓');
      out.push('运行时切档 ✓（最长帧间隔 ' + sw.res.map((r) => r.t + ' ' + r.worst + 'ms').join(' / ') + '）');
      // 7) F3 性能面板
      const panel = await evaluate(`(async () => { const f = __game.ui.fps; const was = f.visible; f.setVisible(true);
        // 面板按真实帧刷新：无头 SwiftShader 刚切档时帧很慢，最多等 10 s 出第一份读数
        const end = Date.now() + 10000; await new Promise((r) => setTimeout(r, 2600));
        while (!/FPS/.test(f.el.textContent) && Date.now() < end) await new Promise((r) => setTimeout(r, 250));
        const text = f.el.textContent; const snap = f.snapshot; f.setVisible(was); return { text, snap }; })()`);
      for (const re of [/FPS/, /ms/, /draw call \d+ \/ 2000/, /三角面 \S+ \/ 6\.00M/, /显存≈ \d+ MB/]) {
        if (!re.test(panel.text)) throw new Error('F3 面板缺 ' + re + '：' + panel.text);
      }
      if (!(panel.snap?.stats?.calls > 0 && panel.snap.stats.triangles > 0)) throw new Error('renderer.info 读数为 0 ' + JSON.stringify(panel.snap));
      out.push('F3：' + panel.text.split('\n').slice(0, 3).join(' | '));
      // 8) BUG-002：检测中途在暂停菜单手动改档 → 底栏「尚未自动检测」、恢复默认回极致（来源 default）、没写 qualityDetectedTier
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('simulateFps=40');
      for (let i = 0; i < 200; i++) {
        s = await st();
        if (s.tier === 'high') break;
        await sleep(100);
      }
      if (s.tier !== 'high' || s.bench !== 'running') throw new Error('没进到第二轮 ' + JSON.stringify(s));
      const b2 = await evaluate(`(async () => { const g = __game; g.pause('user'); g.ui.pause.openSettings(); await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.pause-menu [data-role="quality"] button')].find((b) => b.textContent === '标准').click();
        await new Promise((r) => setTimeout(r, 200));
        const foot = document.querySelector('.pause-menu .settings-status').textContent;
        const set1 = JSON.parse(localStorage.getItem('foglight.settings.v1'));
        g.settings.resetToDefaults(); await new Promise((r) => setTimeout(r, 200));
        const foot2 = (g.resume(), g.pause('user'), g.ui.pause.openSettings(), await new Promise((r) => setTimeout(r, 200)), document.querySelector('.pause-menu .settings-status').textContent);
        g.resume();
        return { foot, foot2, state: g.benchmark.state, set1, set2: JSON.parse(localStorage.getItem('foglight.settings.v1')), tier: g.quality.tier };
      })()`);
      if (b2.state !== 'aborted') throw new Error('检测应被打断 ' + JSON.stringify(b2));
      const undet = TEXT['ui.settings.quality_undetected'];
      if (!b2.foot.startsWith(undet) || !b2.foot2.startsWith(undet)) throw new Error('底栏应显示「' + undet + '」：' + b2.foot + ' / ' + b2.foot2);
      if (b2.set1.qualityDetectedTier !== null || b2.set1.quality !== 'standard' || b2.set1.qualitySource !== 'user') throw new Error('打断后设置不对 ' + JSON.stringify(b2.set1));
      if (b2.tier !== 'ultra' || b2.set2.quality !== 'ultra' || b2.set2.qualitySource !== 'default' || b2.set2.qualityDetectedTier !== null) throw new Error('恢复默认应回极致 ' + JSON.stringify(b2));
      out.push('BUG-002 打断后「尚未自动检测」、恢复默认 → 极致 ✓');
      // 恢复干净状态（回到无 simulateFps 的地址）
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-002 角色控制器：测试场地速度、dev 面板读数、自动跨越、黑场送回',
    code: `
      const until = async (pred, ms = 8000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
      await g.scenes.change('testbed');
      if (!(await until(() => window.__testbed && window.__testbed.rig && g.scenes.current && g.scenes.current.name === 'testbed'))) throw new Error('测试场地没进去');
      const tb = window.__testbed;
      const body = tb.rig.body.body;
      const ctl = tb.rig.controller;
      const inp = g.input;
      const hv = () => Math.hypot(body.actualVelocity.x, body.actualVelocity.z);
      if (!(await until(() => body.onGround))) throw new Error('出生后没着地');
      // 慢走 / 小跑（速度按固定步计算，与帧率无关）
      // 往左走（这一排一直到场地边缘都是空的）
      inp.setRaw('smoke', 'KeyA', true);
      if (!(await until(() => Math.abs(hv() - 1.6) < 0.08))) throw new Error('慢走速度 ' + hv().toFixed(2));
      inp.setRaw('smoke', 'ShiftLeft', true);
      if (!(await until(() => Math.abs(hv() - 3.2) < 0.16))) throw new Error('小跑速度 ' + hv().toFixed(2));
      inp.setRaw('smoke', 'ShiftLeft', false);
      inp.setRaw('smoke', 'KeyA', false);
      g.ui.debug.setVisible(true);
      await until(() => /速度 .* m\\/s/.test(document.querySelector('.debug-panel').textContent) && /碰撞 .* ms/.test(document.querySelector('.debug-panel').textContent));
      const panel = document.querySelector('.debug-panel').textContent;
      g.ui.debug.setVisible(false);
      if (!/碰撞 [0-9.]+ ms/.test(panel)) throw new Error('dev 面板没有碰撞耗时：' + panel);
      // 自动跨越：站到起点按 E，跨越中按住 W 也不影响路径，结束在终点
      tb.rig.body.teleport(tb.link.start.clone().setY(tb.link.start.y + 0.02));
      await until(() => body.onGround);
      if (!(await until(() => ctl.nearLink === tb.link))) throw new Error('起点没有识别到跨越点');
      if (!/跨过/.test(document.querySelector('.hud-prompt')?.textContent ?? '')) throw new Error('没显示跨越提示');
      inp.setRaw('smoke', 'KeyE', true);
      const started = await until(() => ctl.busy, 3000);
      inp.setRaw('smoke', 'KeyE', false);
      if (!started) throw new Error('按 E 没有开始跨越');
      // 跨越中按住 D（应被忽略）；在跨越结束前松开，避免轮询间隔（50 ms）里结束后的那几帧被 D 推走（原来偶发 0.10 m 偏差）
      inp.setRaw('smoke', 'KeyD', true);
      await sleep(600);
      inp.setRaw('smoke', 'KeyD', false);
      await until(() => !ctl.busy, 20000);
      let d = body.position.distanceTo(tb.link.end);
      // 高负载时（无头 SwiftShader，单帧可达 2 s）偶发终点偏差（见过 0.58 / 0.85 m）：不带 D 干扰再跨一次，
      // 第二次仍偏才算失败（真回归两次都会偏）；第一次的偏差写进结果里留痕
      let retryNote = '';
      if (d > 0.1) {
        retryNote = '，首次偏差 ' + d.toFixed(2) + ' m 重试';
        tb.rig.body.teleport(tb.link.start.clone().setY(tb.link.start.y + 0.02));
        await until(() => body.onGround);
        await until(() => ctl.nearLink === tb.link);
        inp.setRaw('smoke', 'KeyE', true);
        await until(() => ctl.busy, 3000);
        inp.setRaw('smoke', 'KeyE', false);
        await until(() => !ctl.busy, 20000);
        await sleep(200);
        d = body.position.distanceTo(tb.link.end);
      }
      if (d > 0.1) throw new Error('跨越终点偏差 ' + d.toFixed(2) + retryNote + ' 位置 ' + body.position.toArray().map((v) => v.toFixed(2)) + ' 终点 ' + tb.link.end.toArray());
      // 黑场送回：黑场出现 → 回到出生点并着地 → 黑场消失
      let sawBlack = false;
      const done = ctl.teleportTo(tb.course.anchors.spawn);
      const poll = (async () => { while (ctl.busy) { if (g.ui.fade.opacity >= 1) sawBlack = true; await sleep(30); } })();
      await Promise.race([done, sleep(20000)]);
      await poll;
      if (!sawBlack) throw new Error('没有黑场');
      if (g.ui.fade.opacity !== 0) throw new Error('黑场没退');
      await until(() => body.onGround);
      if (body.position.distanceTo(tb.course.anchors.spawn) > 0.05 || !body.onGround) throw new Error('送回位置不对 ' + body.position.toArray());
      await g.scenes.change('s1-ebb-shore');
      await until(() => g.scenes.current && g.scenes.current.name === 's1-ebb-shore');
      return '慢走 1.6 / 小跑 3.2 ✓，dev 面板读数 ✓，跨越（' + tb.link.duration.toFixed(2) + ' s' + retryNote + '）✓，黑场送回 ✓';`,
  },
  {
    name: 'v0.1-003 相机：室内 ≤ 2 m、观察 FOV 30°、机关机位进出、观察点对准、测试镜头交还',
    code: `
      const until = async (pred, ms = 15000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
      await g.scenes.change('testbed');
      if (!(await until(() => window.__testbed && window.__testbed.rig && g.scenes.current && g.scenes.current.name === 'testbed'))) throw new Error('测试场地没进去');
      const tb = window.__testbed;
      const cam = tb.cameraFollow;
      const camera = g.scenes.current.camera;
      const inp = g.input;
      const a = tb.course.anchors;
      const out = [];
      // 室内
      tb.rig.body.teleport(a.room.inside.clone().setY(0.02));
      if (!(await until(() => cam.indoor && cam.currentDistance <= 2.0001))) throw new Error('室内距离 ' + cam.currentDistance.toFixed(2) + ' indoor=' + cam.indoor);
      out.push('室内 ' + cam.currentDistance.toFixed(2) + ' m ✓');
      tb.rig.body.teleport(a.spawn.clone().setY(0.02));
      if (!(await until(() => !cam.indoor && cam.currentDistance > 3.5))) throw new Error('出屋后距离没恢复 ' + cam.currentDistance.toFixed(2));
      // 观察
      inp.setRaw('smoke', 'Mouse2', true);
      const obs = await until(() => Math.abs(camera.fov - 30) < 0.01 && inp.lookScale === 0.5);
      inp.setRaw('smoke', 'Mouse2', false);
      if (!obs) throw new Error('观察 FOV ' + camera.fov.toFixed(1) + ' lookScale ' + inp.lookScale);
      if (!(await until(() => Math.abs(camera.fov - 55) < 0.01 && inp.lookScale === 1))) throw new Error('松开后 FOV ' + camera.fov.toFixed(1));
      out.push('观察 30° ✓');
      // 机关机位
      const yaw0 = cam.yaw, pitch0 = cam.pitch;
      tb.rig.body.teleport(a.mechanism.stand.clone().setY(0.02));
      // 004 起机关是 puzzle 交互：要面向机关才有提示（距离 ≤ 1.8 m、夹角 ≤ 60°）
      tb.rig.controller.facing = Math.atan2(a.mechanism.center.x - a.mechanism.stand.x, a.mechanism.center.z - a.mechanism.stand.z);
      if (!(await until(() => /E\\s*操作/.test(document.querySelector('.hud-prompt')?.textContent ?? '')))) throw new Error('机关旁没有提示');
      inp.setRaw('smoke', 'KeyE', true);
      const entered = await until(() => inp.context === 'puzzle', 3000);
      inp.setRaw('smoke', 'KeyE', false);
      if (!entered) throw new Error('按 E 没进机关');
      const nodePos = a.mechanism.cam.getWorldPosition(camera.position.clone());
      if (!(await until(() => !cam.blending && camera.position.distanceTo(nodePos) < 0.01))) throw new Error('没到机位');
      inp.setRaw('smoke', 'Tab', true);
      const left = await until(() => inp.context === 'explore', 3000);
      inp.setRaw('smoke', 'Tab', false);
      if (!left) throw new Error('Tab 没退出机关');
      if (!(await until(() => cam.modeName === 'explore' && !cam.blending))) throw new Error('没回到探索相机');
      if (cam.yaw !== yaw0 || cam.pitch !== pitch0) throw new Error('退出后朝向变了');
      out.push('机关进出 ✓');
      // 观察点：站上去，把视线对准立柱顶
      tb.rig.body.teleport(a.viewpoint.center.clone().setY(0.02));
      await until(() => tb.viewpoint.inRegion);
      for (let i = 0; i < 6; i++) {
        const d = a.viewpoint.target.clone().sub(camera.position).normalize();
        cam.yaw = Math.atan2(-d.x, -d.z);
        cam.pitch = Math.asin(d.y);
        await sleep(150);
      }
      if (!(await until(() => tb.viewpoint.alignment === 1, 3000))) throw new Error('对准度 ' + tb.viewpoint.alignment.toFixed(2) + ' 偏差 ' + tb.viewpoint.angleDeg.toFixed(1));
      cam.yaw += (9 * Math.PI) / 180;
      await until(() => tb.viewpoint.alignment < 0.9, 3000);
      const half = tb.viewpoint.alignment;
      if (!(half > 0 && half < 1)) throw new Error('偏 9° 时对准度 ' + half.toFixed(2));
      out.push('观察点对准 1.00 / 偏 9° ' + half.toFixed(2) + ' ✓');
      // 测试镜头
      const yaw1 = cam.yaw;
      const done = tb.playTestCutscene();
      if (inp.context !== 'cutscene') throw new Error('演出没切到 cutscene 上下文');
      let resolved = false;
      void done.then(() => (resolved = true));
      if (!(await until(() => resolved, 60000))) throw new Error('测试镜头没结束');
      if (inp.context !== 'explore' || cam.yaw !== yaw1) throw new Error('演出后没交还 / 朝向变了');
      out.push('测试镜头交还 ✓');
      g.ui.debug.setVisible(true);
      await until(() => /相机/.test(document.querySelector('.debug-panel').textContent));
      const panel = document.querySelector('.debug-panel').textContent;
      g.ui.debug.setVisible(false);
      if (!/FOV/.test(panel)) throw new Error('dev 面板没有相机读数');
      await g.scenes.change('s1-ebb-shore');
      await until(() => g.scenes.current && g.scenes.current.name === 's1-ebb-shore');
      return out.join('，');`,
  },
  {
    name: 'v0.1-004 回归（制作人①）：主场景真实 Esc 打开暂停菜单（未检测 / 已检测降档两种状态）不报错',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      for (const detected of [null, 'high', 'standard']) {
        await evaluate(`(() => { const s = __game.settings; ${detected ? `s.update({ qualityDetected: true, qualityDetectedTier: '${detected}' });` : `s.update({ qualityDetected: false });`} return 1; })()`);
        await cdp.click(640, 400);
        await sleep(400);
        await cdp.key('Escape', 'Escape', 27);
        // 指针锁定时第一下 Esc 可能被浏览器用来解锁（页面收不到，走 pointerlock 暂停）；无头低帧率偶发吞键：1.5 s 没暂停再补按一次
        const end = Date.now() + 4000;
        let st = null;
        let retried = false;
        while (Date.now() < end) {
          if (!retried && Date.now() > end - 2500 && !(await evaluate('__game.isPaused'))) {
            retried = true;
            await cdp.key('Escape', 'Escape', 27);
          }
          st = await evaluate(`(() => { const shown = !document.querySelector('.pause-menu').hidden; if (shown) __game.ui.pause.openSettings(); return { paused: __game.isPaused, foot: document.querySelector('.pause-menu .settings-status')?.textContent ?? '', shown, scene: __game.scenes.current?.name, tr: __game.flow.transitioning, ctx: __game.input.context, lock: document.pointerLockElement != null }; })()`);
          if (st.paused && st.shown) break;
          await sleep(100);
        }
        if (!st?.paused || !st.shown) throw new Error('Esc 没打开暂停菜单 ' + JSON.stringify(st));
        if (/undefined|null|NaN/.test(st.foot)) throw new Error('暂停菜单底栏有 undefined：' + st.foot);
        if (detected && !st.foot.includes(TEXT['ui.settings.quality_detected'].split('{tier}')[0])) throw new Error('已检测状态底栏不对：' + st.foot);
        // 菜单开着时切档（refresh 再跑一次）
        await evaluate(`(() => { document.querySelector('.pause-menu [data-role="quality"] button:last-child').click(); document.querySelector('.pause-menu [data-role="quality"] button').click(); document.querySelector('.pause-menu .settings-panel [data-act="back"]').click(); return 1; })()`);
        const r = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        await cdp.click(r.x, r.y);
        await sleep(1300);
        if (await evaluate('__game.isPaused')) throw new Error('继续后仍暂停');
        out.push((detected ?? '未检测') + ' ✓');
      }
      await evaluate(`(() => { __game.settings.resetToDefaults(); __game.quality.set('ultra'); return 1; })()`);
      return '暂停菜单刷新无异常：' + out.join('，') + '（控制台错误由总表把关）';
    },
  },
  {
    name: 'v0.1-004 回归（制作人①）：?scene=testbed 直接打开跑 6 s，fixedUpdate 无 undefined body',
    async run({ evaluate, cdp, sleep }) {
      await cdp.goto('scene=testbed', 'testbed');
      const f0 = await evaluate('__game.time?.frame ?? performance.now()');
      await sleep(6000);
      const s = await evaluate(`(() => { const tb = window.__testbed; const p = tb.rig.body.position; return { ok: [p.x, p.y, p.z].every(Number.isFinite), name: __game.scenes.current.name, f: __game.time?.frame ?? performance.now() }; })()`);
      if (!s.ok || s.name !== 'testbed') throw new Error('测试场地状态不对 ' + JSON.stringify(s));
      if (!(s.f > f0)) throw new Error('循环没在走');
      // 场地里 Esc 暂停 / 继续
      await cdp.click(640, 400);
      await sleep(300);
      await cdp.key('Escape', 'Escape', 27);
      await sleep(500);
      if (!(await evaluate('__game.isPaused'))) throw new Error('测试场地 Esc 没暂停');
      await evaluate('__game.resume()');
      await sleep(500);
      return '6 s 无异常，角色位置有效，Esc 暂停 / 继续 ✓';
    },
  },
  {
    name: 'v0.1-017 汐模型 + 动画：?scene=testbed&art=1 真模型（73 骨 / LOD / hand_r_socket 挂手持点）、31 个 clip、走 1.6 / 跑 3.2 播放率 1、停下回 idle、原地转身 +90°、汐材质（ramp / 脸 SDF / 湿痕）shader 链接',
    async run({ evaluate, cdp, sleep }) {
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      await cdp.goto('scene=testbed&art=1', 'testbed');
      if (!(await until(`!!window.__testbed?.rig?.body?.body?.onGround`, 60000))) throw new Error('art=1 测试场地没进去');
      const info = await evaluate(`(() => { const r = __testbed.rig; const a = r.animator; if (!a) return null; let bones = 0, skinned = 0;
        r.visual.traverse((o) => { if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
        const hand = r.visual.getObjectByName('hand-item');
        return { clips: a.clips.size, missing: a.missing, bones, skinned, hand: hand?.parent?.name, state: a.state }; })()`);
      if (!info) throw new Error('art=1 下没有 XiAnimator（char-xi / char-xi-anims 没加载？）');
      if (info.clips !== 31 || info.missing.length) throw new Error('clip 不全 ' + JSON.stringify(info));
      if (info.bones < 73 || info.skinned < 3) throw new Error('模型不对 ' + JSON.stringify(info));
      if (info.hand !== 'hand_r_socket') throw new Error('hand-item 没挂在 hand_r_socket：' + info.hand);
      // 材质：ramp 卡通明暗 + 脸 SDF + 湿痕 shader 真编译（编译错误 three 会打 console.error，由总表把关；这里查程序都链接成功）
      await sleep(500);
      const mat = await evaluate(`(() => { const r = __testbed.rig; const progs = (__game.renderer.info.programs ?? []).filter((p) => /xi-(body|face|hair)(-sdf)?$/.test(p.cacheKey) || /,xi-(body|face|hair)/.test(p.cacheKey));
        const gl = __game.renderer.getContext(); const A = __game.assets; return { tex: ['tex-xi-ramp', 'tex-xi-sdf-face'].map((k) => [A.has(k), A.isMissing(k)]), patched: r.look?.look.patched ?? 0, progs: progs.length, linked: progs.every((p) => gl.getProgramParameter(p.program, gl.LINK_STATUS)) }; })()`);
      if (mat.patched !== 3 || mat.progs < 2 || !mat.linked) throw new Error('汐材质没生效 / shader 没链接 ' + JSON.stringify(mat));
      const st = `(() => { const a = __testbed.rig.animator; const b = __testbed.rig.body.body; return { s: a.state, w: a.blend.walk, wr: a.blend.walkRate, j: a.blend.jog, jr: a.blend.jogRate, v: Math.hypot(b.actualVelocity.x, b.actualVelocity.z) }; })()`;
      await evaluate(`__game.input.setRaw('smoke', 'KeyA', true)`);
      const walk = await until(`(() => { const r = ${st}; return r.s === 'walk' && Math.abs(r.v - 1.6) < 0.08 && Math.abs(r.wr - 1) < 0.06 ? r : null; })()`);
      await evaluate(`__game.input.setRaw('smoke', 'ShiftLeft', true)`);
      const jog = await until(`(() => { const r = ${st}; return r.s === 'jog' && Math.abs(r.v - 3.2) < 0.16 && Math.abs(r.jr - 1) < 0.06 ? r : null; })()`);
      await evaluate(`(__game.input.setRaw('smoke', 'ShiftLeft', false), __game.input.setRaw('smoke', 'KeyA', false))`);
      if (!walk) throw new Error('慢走动画 / 播放率不对 ' + JSON.stringify(await evaluate(st)));
      if (!jog) throw new Error('小跑动画 / 播放率不对 ' + JSON.stringify(await evaluate(st)));
      if (!(await until(`${st}.s === 'idle'`))) throw new Error('停下没回 idle ' + JSON.stringify(await evaluate(st)));
      const turn = await evaluate(`(async () => { const r = __testbed.rig; const f0 = r.controller.facing; const t0 = performance.now();
        await r.animator.turnInPlace('l'); return { d: (r.controller.facing - f0) * 180 / Math.PI, ms: performance.now() - t0, locked: r.controller.locked, s: r.animator.state }; })()`);
      if (Math.abs(turn.d - 90) > 0.5 || turn.locked) throw new Error('原地转身不对 ' + JSON.stringify(turn));
      return `char-xi ${info.bones} 骨 / ${info.skinned} 蒙皮网格、31 clip、hand-item → hand_r_socket；材质 ${mat.patched} 个 / shader ${mat.progs} 个已链接；走 ${walk.v.toFixed(2)} m/s 播放率 ${walk.wr.toFixed(2)}、跑 ${jog.v.toFixed(2)} m/s 播放率 ${jog.jr.toFixed(2)}、停下 idle；转身 +${turn.d.toFixed(1)}°（${(turn.ms / 1000).toFixed(2)} s）✓`;
    },
  },
  {
    name: 'v0.1-004 交互：提示 / 图标、八种交互样例、hold 圆环、push、机关暂停后右键直接退出、demo 灯塔',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      if ((await evaluate(`__game.scenes.current?.name`)) !== 'testbed') await cdp.goto('scene=testbed', 'testbed');
      await evaluate(`(() => { window.__ix = []; const e = __game.events;
        for (const n of ['interact:used', 'interact:pushEnd', 'item:pickup', 'item:place', 'puzzle:enter', 'puzzle:exit']) e.on(n, (p) => __ix.push([n, p]));
        return 1; })()`);
      const until = async (expr, ms = 5000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(80);
        }
        return v;
      };
      const goTo = (id) =>
        evaluate(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`);
      const prompt = () => `((p) => (p && !p.hidden ? p.textContent : ''))(document.querySelector('.hud-prompt'))`;
      const usedCount = (id) => `__ix.filter(([n, p]) => n === 'interact:used' && p.id === '${id}').length`;
      const tapE = async () => {
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
        await sleep(60);
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      };
      const expectPrompt = async (id, re) => {
        await goTo(id);
        let p = await until(`(${re}).test(${prompt()}) && ${prompt()}`, 3000);
        // 高负载时传送后第一帧交互候选可能还没刷新：再传送一次、多等一会儿
        if (!p) {
          await goTo(id);
          p = await until(`(${re}).test(${prompt()}) && ${prompt()}`, 6000);
        }
        if (!p)
          throw new Error(
            id + ' 没有提示 ' + re + '，当前「' + (await evaluate(prompt())) + '」 ' +
              JSON.stringify(await evaluate(`(() => { const tb = __testbed; const ix = tb.interaction; const b = tb.rig.body.position; return { pos: [b.x, b.z], facing: tb.rig.controller.facing, cur: ix.current?.id ?? null, cands: ix.items.filter((i) => ix.canInteract(i)).map((i) => i.id) }; })()`)),
          );
        return p;
      };
      // 图标
      await goTo('sample-inspect');
      const markers = await until(`document.querySelectorAll('.hud-marker:not([hidden])').length`, 3000);
      if (!markers) throw new Error('3.5 m 内没有交互图标');
      out.push('图标 ' + markers + ' 个');
      // inspect / read
      for (const [id, re] of [['sample-inspect', '/E\\s*查看/'], ['sample-read', '/E\\s*阅读/']]) {
        await expectPrompt(id, re);
        await tapE();
        if (!(await until(usedCount(id)))) throw new Error(id + ' 按 E 没触发');
        // 005：read 打开阅读界面（冻结游戏逻辑），Tab 关掉再继续
        if (id === 'sample-read') {
          if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('read 没打开阅读界面');
          await cdp.key('Tab', 'Tab', 9);
          if (!(await until(`!__game.ui.reader.isOpen && __game.input.context === 'explore'`, 3000))) throw new Error('Tab 没关阅读界面');
        }
      }
      out.push('inspect / read ✓');
      // pickup → place（另一个插槽）
      await expectPrompt('sample-lantern', '/E\\s*拾起/');
      await tapE();
      if (!(await until(`__testbed.interaction.held.isHolding('lantern')`))) throw new Error('没拿起提灯');
      await expectPrompt('sample-stand-a', '/E\\s*放下/');
      await tapE();
      if (!(await until(usedCount('sample-stand-a')))) throw new Error('没放到 stand-a');
      out.push('pickup / place ✓');
      // use（敲钟：自动走位）
      await expectPrompt('sample-bell', '/E\\s*敲钟/');
      const t0 = Date.now();
      await tapE();
      // 自动走位 + 动作按游戏时间走，机器极忙时要多等；按键在走位开始前丢了（提示仍在、没有忙碌）就再按一次
      if (!(await until(usedCount('sample-bell'), 15000))) {
        if (await evaluate(`__testbed.interaction.actionKind === 'none' && /E\\s*敲钟/.test(${prompt()})`)) await tapE();
        if (!(await until(usedCount('sample-bell'), 15000))) throw new Error('敲钟没触发 ' + (await evaluate(prompt())));
      }
      out.push('use ✓（' + (Date.now() - t0) + ' ms 含轮询）');
      // hold（2 s；圆环）
      await expectPrompt('sample-valve', '/按住\\s*E/');
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
      // 无头 SwiftShader 帧率低、每帧物理步数有上限，游戏时间比真实时间慢：按游戏内进度等，不按墙钟
      const ring = await until(`(() => { const r = document.querySelector('.hud-hold'); return r && !r.hidden && Number(r.dataset.progress) > 0.3; })()`, 15000);
      const valve = await until(usedCount('sample-valve'), 30000);
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      if (!ring) throw new Error('hold 圆环没显示');
      if (!valve) throw new Error('按住 2 s 没完成');
      out.push('hold 2 s + 圆环 ✓');
      // push（按住推到头）
      await expectPrompt('sample-raft', '/按住\\s*E\\s*推/');
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
      const pushed = await until(`__ix.some(([n, p]) => n === 'interact:pushEnd' && p.id === 'sample-raft')`, 60000);
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      if (!pushed) throw new Error('push 没推到头');
      out.push('push ✓');
      // 机关：真实按键进入 → 真实 Esc 暂停 → 点「继续」→ 仍在机关里 → 第一下真实右键：重新锁定 + 退出
      await cdp.click(640, 400);
      await until(`document.pointerLockElement === document.querySelector('canvas')`, 3000);
      await expectPrompt('sample-mechanism', '/E\\s*操作/');
      await cdp.key('KeyE', 'e', 69);
      if (!(await until(`__game.input.context === 'puzzle'`, 3000))) throw new Error('E 没进机关');
      const bar = await evaluate(`document.querySelector('.hud-puzzle-bar')?.textContent ?? ''`);
      if (!/Q·E/.test(bar)) throw new Error('操作条不对：' + bar);
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.isPaused && __game.input.context === 'menu'`, 3000))) throw new Error('Esc 没暂停');
      const r = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(r.x, r.y);
      await sleep(1300);
      const st = await evaluate(`({ ctx: __game.input.context, paused: __game.isPaused, locked: document.pointerLockElement === document.querySelector('canvas') })`);
      if (st.paused || st.ctx !== 'puzzle' || st.locked) throw new Error('继续后应在机关里且指针未锁定 ' + JSON.stringify(st));
      await cdp.click(640, 400, 'right');
      const after = await until(`(() => { const s = { ctx: __game.input.context, locked: document.pointerLockElement === document.querySelector('canvas') }; return s.ctx === 'explore' && s.locked ? s : null; })()`, 3000);
      if (!after) throw new Error('暂停继续后第一下右键没有同时锁定 + 退出 ' + JSON.stringify(await evaluate(`({ ctx: __game.input.context, locked: document.pointerLockElement === document.querySelector('canvas') })`)));
      out.push('机关 Esc→继续→右键一下退出并锁定 ✓');
      await evaluate(`document.exitPointerLock(); 1`);
      await sleep(400);
      if (await evaluate('__game.isPaused')) await evaluate('__game.resume()');
      // demo 灯塔（沙盒 = 原 v0.1 demo 岛；013 起 S1 是正式白盒，第一章点灯前没有可开关的灯塔）
      await cdp.goto('scene=sandbox&debug=1', 'sandbox');
      if (!(await until(`__game.input.context === 'explore' && !__game.isPaused`, ESTAB_MS))) throw new Error('沙盒开场演出没交还');
      const on0 = await evaluate(`__game.scenes.current.lighthouseOn`);
      await evaluate(`(() => { const s = __game.scenes.current; s.rig.body.teleport(new s.rig.body.position.constructor(11, 2.45, -8.3)); s.rig.controller.facing = Math.PI; return 1; })()`);
      const lp = await until(`/E\\s*操作/.test(${prompt()})`, 10000);
      if (!lp)
        throw new Error(
          '灯塔旁没有「E 操作」提示：' + JSON.stringify(await evaluate(`(() => { const s = __game.scenes.current; const b = s.rig.body.position; const ix = s.interaction; return { pos: [b.x, b.y, b.z], facing: s.rig.controller.facing, ctx: __game.input.context, cand: ix.items.map((i) => [i.id, ix.canInteract(i)]) }; })()`)),
        );
      await tapE();
      // 高负载（软件渲染一帧可达 2 s+）下给足时间；只确认状态最终翻转（QA batch4）
      if (!(await until(`__game.scenes.current.lighthouseOn !== ${on0}`, 15000))) throw new Error('E 没切换灯塔');
      out.push('灯塔 ✓');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-005 字幕 / 阅读界面 / 日志：时长 2.0 / 3.6 s、手动推进、样式与字号、5 页翻阅 + 第 6 页、右键 / Tab 关闭（含暂停后）、不能移动、日志更新提示与不重复、当前目标',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      if ((await evaluate(`__game.scenes.current?.name`)) !== 'testbed') await cdp.goto('scene=testbed', 'testbed');
      const until = async (expr, ms = 5000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(80);
        }
        return v;
      };
      if (!(await until(`__game.input.context === 'explore' && !__game.isPaused`, ESTAB_MS))) throw new Error('测试场地没进 explore');
      // 干净的进度（前面的检查读过告示）；事件记录
      await evaluate(`(() => { __game.save.newGame('ch1', 'testbed'); __game.narrative.resetMemory(); window.__nx = [];
        for (const n of ['subtitle:show', 'subtitle:hide', 'journal:updated', 'reader:open', 'reader:close', 'goal:changed']) __game.events.on(n, (p) => __nx.push([n, p]));
        return 1; })()`);
      const hides = () => `__nx.filter(([n]) => n === 'subtitle:hide').map(([, p]) => p)`;
      const sub = `__game.ui.subtitles`;

      // ---- 1. 时长：10 字（表内 ch1.s2.cups.inspect）2.0 s、30 字 3.6 s，到时自动消失
      // 游戏时间按帧累加：无头 SwiftShader 每帧可能到 maxFrameDelta，允许 [时长, 时长 + 一帧上限]（精确值由 test:narrative 按 1/60 帧验）
      const fmax = await evaluate(`__game.time.maxFrameDelta`);
      const okDur = (p, d) => p && p.reason === 'timeout' && p.shown >= d - 1e-6 && p.shown <= d + fmax + 1e-6;
      await evaluate(`${sub}.play(['ch1.s2.cups.inspect']); 1`);
      const h1 = await until(`${hides()}.find((p) => p.id === 'ch1.s2.cups.inspect')`, 30000);
      if (!okDur(h1, 2.0)) throw new Error('10 字行显示时长不对 ' + JSON.stringify(h1));
      await evaluate(`${sub}.track.playText('${'一二三四五六七八九十'.repeat(3)}'); 1`);
      const h2 = await until(`${hides()}.find((p) => p.id === '')`, 40000);
      if (!okDur(h2, 3.6)) throw new Error('30 字行显示时长不对 ' + JSON.stringify(h2));
      out.push(`时长 ${h1.shown.toFixed(2)} / ${h2.shown.toFixed(2)} s`);

      // ---- 2. 样式：底部居中、无底框、浅阴影、汐的字色
      await evaluate(`${sub}.play(['ch1.s1.boat.inspect', 'ch1.s1.tide_pillar.inspect']); 1`);
      const style = await evaluate(`(() => { const el = document.querySelector('.subtitle-line'); const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
        return { text: el.textContent, hidden: el.hidden, bg: cs.backgroundColor, border: cs.borderTopStyle, shadow: cs.textShadow, color: cs.color,
          cx: r.x + r.width / 2, bottom: r.bottom, w: innerWidth, h: innerHeight, size: cs.fontSize }; })()`);
      if (style.hidden || style.text !== TEXT['ch1.s1.boat.inspect']) throw new Error('字幕没显示 ' + JSON.stringify(style));
      if (Math.abs(style.cx - style.w / 2) > 2 || style.bottom < style.h * 0.8) throw new Error('字幕不在底部居中 ' + JSON.stringify(style));
      if (style.bg !== 'rgba(0, 0, 0, 0)' || (style.border !== 'none' && style.border !== '')) throw new Error('字幕有底框 ' + JSON.stringify(style));
      if (!style.shadow || style.shadow === 'none') throw new Error('字幕没有阴影');
      if (style.color !== 'rgb(228, 232, 234)') throw new Error('汐的字色不对 ' + style.color);
      // ---- 3. Space 立即推进（真实按键）；左键（指针锁定后的点击）也推进
      await cdp.key('Space', ' ', 32);
      const adv = await until(`${hides()}.find((p) => p.id === 'ch1.s1.boat.inspect')`, 3000);
      if (!adv || adv.reason !== 'advance' || adv.shown > 1.5) throw new Error('Space 没有立即推进 ' + JSON.stringify(adv));
      if ((await evaluate(`${sub}.current?.id`)) !== 'ch1.s1.tide_pillar.inspect') throw new Error('推进后不是下一行');
      await cdp.click(640, 400);
      await until(`document.pointerLockElement === document.querySelector('canvas')`, 3000);
      if (await evaluate(`${sub}.current?.id !== 'ch1.s1.tide_pillar.inspect'`)) throw new Error('用于锁定指针的那一下点击不该推进字幕');
      await cdp.click(640, 400);
      const adv2 = await until(`${hides()}.find((p) => p.id === 'ch1.s1.tide_pillar.inspect')`, 3000);
      if (!adv2 || adv2.reason !== 'advance') throw new Error('左键没推进 ' + JSON.stringify(adv2));
      out.push('Space / 左键推进 ✓');
      await evaluate(`document.exitPointerLock(); 1`);
      await sleep(400);
      if (await evaluate('__game.isPaused')) await evaluate('__game.resume()');
      // 父亲的文字用次要色
      await evaluate(`${sub}.play(['ch1.s1.goal.find_bell']); 1`);
      const fc = await evaluate(`getComputedStyle(document.querySelector('.subtitle-line')).color`);
      if (fc !== 'rgb(139, 149, 157)') throw new Error('父亲的文字字色不对 ' + fc);

      // ---- 4. 字号三档：暂停菜单里点，立即生效
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.isPaused`, 3000))) throw new Error('Esc 没暂停');
      await evaluate(`__game.ui.pause.openSettings(); 1`);
      await sleep(100);
      const sizes = [];
      for (const sz of ['s', 'l', 'm']) {
        const b = await evaluate(`(() => { const r = document.querySelector('.pause-menu [data-size="${sz}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await cdp.click(b.x, b.y);
        await sleep(100);
        sizes.push(await evaluate(`getComputedStyle(document.querySelector('.subtitle-line')).fontSize + '/' + __game.settings.get('subtitleSize')`));
      }
      if (sizes.join(',') !== '18px/s,28px/l,22px/m') throw new Error('字号切换不对 ' + sizes.join(','));
      await evaluate(`document.querySelector('.pause-menu .settings-panel [data-act="back"]').click(); 1`);
      await sleep(100);
      const resume = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(resume.x, resume.y);
      await until(`!__game.isPaused`, 3000);
      await evaluate(`${sub}.track.clear(); 1`);
      out.push('字号 ' + sizes.map((x) => x.split('/')[0]).join(' / ') + ' ✓');

      // ---- 5. 阅读界面：父亲日志 5 页，A/D 和箭头翻页，打开期间不能移动，首次阅读 → 日志更新提示
      const goTo = (id) =>
        evaluate(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`);
      const promptText = `((p) => (p && !p.hidden ? p.textContent : ''))(document.querySelector('.hud-prompt'))`;
      await goTo('sample-journal');
      if (!(await until(`/E\\s*阅读/.test(${promptText})`, 5000))) throw new Error('日志本旁没有「E 阅读」');
      await cdp.key('KeyE', 'e', 69);
      if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('E 没打开阅读界面');
      const rd = () => evaluate(`(() => { const r = __game.ui.reader; return { doc: r.docId, page: r.page, n: r.pageCount, body: document.querySelector('.reader-body').textContent, idx: document.querySelector('.reader-page').textContent, title: document.querySelector('.reader-title').textContent, ctx: __game.input.context, frozen: __game.isFrozen }; })()`);
      let st = await rd();
      const journalPages = TEXT['ch1.s2.journal.doc'];
      if (st.doc !== 'ch1.s2.journal.doc' || st.n !== 5 || st.body !== journalPages[0] || st.idx !== '1 / 5') throw new Error('日志第 1 页不对 ' + JSON.stringify(st));
      if (st.title !== TEXT['ui.doc_title.journal'] || st.ctx !== 'reading' || !st.frozen) throw new Error('阅读状态不对 ' + JSON.stringify(st));
      const readerBlur = await evaluate(`getComputedStyle(document.querySelector('.reader')).backdropFilter`);
      if (readerBlur !== 'blur(6px) brightness(0.6)') throw new Error('阅读界面遮罩没有背景模糊（BUG-003）backdropFilter=' + readerBlur);
      // BUG-004：阅读界面开着时提示挂起（已排队、不显示），关掉之后才露出来
      const toastQueued = await until(`__game.ui.toastLeft.pending && document.querySelector('.toast-left').hidden`, 2000);
      if (!toastQueued) throw new Error('首次阅读应排队「日志已更新」且阅读期间不显示 ' + JSON.stringify(await evaluate(`({ pending: __game.ui.toastLeft.pending, hidden: document.querySelector('.toast-left').hidden })`)));
      // 不能移动：按住 W 1 s，角色不动
      const p0 = await evaluate(`(() => { const b = __testbed.rig.body.position; return [b.x, b.z]; })()`);
      await evaluate(`__game.input.setRaw('smoke', 'KeyW', true); 1`);
      await sleep(1000);
      await evaluate(`__game.input.setRaw('smoke', 'KeyW', false); 1`);
      const p1 = await evaluate(`(() => { const b = __testbed.rig.body.position; return [b.x, b.z]; })()`);
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 1e-4) throw new Error('阅读时角色移动了 ' + JSON.stringify([p0, p1]));
      // 翻页：D ×4 到第 5 页（每页文字对照），A 回一页，再点箭头翻回
      for (let i = 1; i < 5; i++) {
        await cdp.key('KeyD', 'd', 68);
        if (!(await until(`__game.ui.reader.page === ${i}`, 4000)) && (await evaluate(`__game.ui.reader.page`)) === i - 1) {
          // 高负载下偶发丢键：仍停在上一页才补按一次，不会多翻
          await cdp.key('KeyD', 'd', 68);
          await until(`__game.ui.reader.page === ${i}`, 6000);
        }
        st = await rd();
        if (st.page !== i || st.body !== journalPages[i]) throw new Error(`D 翻到第 ${i + 1} 页不对 ` + JSON.stringify(st));
      }
      await cdp.key('KeyD', 'd', 68);
      // 等这一下被某一帧消费掉（无头低帧率），再按 A
      await until(`!__game.input.pressed.has('pageNext')`, 6000);
      if ((await rd()).page !== 4) throw new Error('最后一页再按 D 不该再翻');
      await cdp.key('KeyA', 'a', 65);
      if (!(await until(`__game.ui.reader.page === 3`, 6000))) throw new Error('A 没翻回 ' + JSON.stringify(await rd()) + ' ' + JSON.stringify(await evaluate(`({ held: [...__game.input.rawHeld.entries()].filter(([, v]) => v.size).map(([k, v]) => k + ':' + [...v]), pressed: [...__game.input.pressed.keys()] })`)));
      const arrow = await evaluate(`(() => { const r = document.querySelector('.reader-arrow[data-act="next"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp.click(arrow.x, arrow.y);
      if (!(await until(`__game.ui.reader.page === 4 && document.querySelector('.reader-page').textContent === '5 / 5'`, 6000))) throw new Error('点箭头没翻页');
      out.push('5 页翻阅（A/D + 箭头）✓，打开时不能移动 ✓，日志已更新阅读时挂起 ✓');
      // 右键关闭
      await cdp.click(640, 600, 'right');
      if (!(await until(`!__game.ui.reader.isOpen && __game.input.context === 'explore' && !__game.isFrozen`, 3000))) throw new Error('右键没关阅读界面');
      const toast = await until(`(() => { const t = document.querySelector('.toast-left'); return t && !t.hidden ? t.textContent : ''; })()`, 3000);
      if (toast !== TEXT['ch1.common.journal_updated']) throw new Error('关掉阅读界面后没显示「日志已更新」：' + toast);
      // 不和左下角操作提示重叠，且没有别的界面盖着
      const tg = await evaluate(`(() => { const a = document.querySelector('.toast-left').getBoundingClientRect(); const h = document.querySelector('.hud-hint'); const b = h && !h.hidden && h.textContent ? h.getBoundingClientRect() : null;
        const overlap = b ? !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top) : false;
        return { overlap, toast: [a.left, a.top, a.right, a.bottom].map(Math.round), hint: b && [b.left, b.top, b.right, b.bottom].map(Math.round), covered: __game.ui.reader.isOpen || __game.ui.journal.isOpen || __game.ui.pause.isOpen }; })()`);
      if (tg.overlap || tg.covered) throw new Error('「日志已更新」和操作提示重叠 / 被盖住 ' + JSON.stringify(tg));
      // BUG-009：提示再变长（折三行）时 toast 跟着上移，仍不重叠；之后还原
      const hint0 = await evaluate(`document.querySelector('.hud-hint').innerHTML`);
      await evaluate(`__game.ui.hud.setHint(document.querySelector('.hud-hint').innerHTML + '<br>BUG-009 第三行')`);
      const OVL = `(() => { const a = document.querySelector('.toast-left').getBoundingClientRect(); const b = document.querySelector('.hud-hint').getBoundingClientRect(); return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top); })()`;
      const lines3 = await evaluate(`document.querySelector('.hud-hint').offsetHeight`);
      if (await evaluate(OVL)) throw new Error(`提示变成 ${lines3}px 高后「日志已更新」又和它重叠（BUG-009）`);
      await evaluate(`__game.ui.hud.setHint(${JSON.stringify(hint0)})`);
      await sleep(1000);
      if (await evaluate(`document.querySelector('.toast-left').hidden`)) throw new Error('「日志已更新」关掉阅读界面后不到 1 s 就消失了');
      const toastGone = await until(`document.querySelector('.toast-left').hidden`, 15000);
      if (!toastGone) throw new Error('「日志已更新」没有消失');
      out.push('关掉后显示「日志已更新」、不压操作提示 ✓');

      // ---- 6. 再次阅读：不重复添加、不再提示；Esc 暂停 → 继续 → 第一下右键直接关闭
      const upd0 = await evaluate(`__nx.filter(([n]) => n === 'journal:updated').length`);
      await goTo('sample-journal');
      await until(`/E\\s*阅读/.test(${promptText})`, 5000);
      await cdp.key('KeyE', 'e', 69);
      if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('第二次 E 没打开');
      await sleep(300);
      const upd1 = await evaluate(`__nx.filter(([n]) => n === 'journal:updated').length`);
      const toast2 = await evaluate(`!document.querySelector('.toast-left').hidden || __game.ui.toastLeft.pending`);
      if (upd1 !== upd0 || toast2) throw new Error('再次阅读不该再提示 / 添加');
      if ((await evaluate(`__game.narrative.journal.length`)) !== 1) throw new Error('日志条目重复了');
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.isPaused && __game.input.context === 'menu'`, 3000))) throw new Error('阅读时 Esc 没暂停');
      const rs = await evaluate(`(() => { const b = document.querySelector('.pause-menu [data-act="resume"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(rs.x, rs.y);
      if (!(await until(`!__game.isPaused && __game.input.context === 'reading' && __game.ui.reader.isOpen`, 3000))) throw new Error('继续后应回到阅读界面');
      await sleep(300);
      await cdp.click(640, 600, 'right');
      if (!(await until(`!__game.ui.reader.isOpen && __game.input.context === 'explore'`, 3000))) throw new Error('暂停继续后第一下右键没关阅读界面');
      out.push('再读不重复 ✓，暂停→继续→右键一下关闭 ✓');

      // ---- 7. 日志（J）：分组条目、当前目标由代码更新、点条目打开阅读、Tab 关阅读回到日志、J 关日志
      await evaluate(`__game.narrative.setGoal('ch1.s1.goal.find_bell'); 1`);
      await cdp.key('KeyJ', 'j', 74);
      if (!(await until(`__game.ui.journal.isOpen && !document.querySelector('.journal').hidden`, 3000))) throw new Error('J 没打开日志');
      const jl = await evaluate(`(() => { const el = document.querySelector('.journal'); return { goal: el.querySelector('.journal-goal-text').textContent, chapter: el.querySelector('.journal-chapter h3')?.textContent, entries: [...el.querySelectorAll('.journal-entry')].map((b) => [b.closest('.journal-group').dataset.group, b.dataset.doc, b.textContent]), ctx: __game.input.context, frozen: __game.isFrozen }; })()`);
      if (jl.goal !== TEXT['ch1.s1.goal.find_bell']) throw new Error('日志顶部目标不对 ' + jl.goal);
      if (jl.chapter !== TEXT['ui.journal.chapter1'] || JSON.stringify(jl.entries) !== JSON.stringify([['father', 'ch1.s2.journal.doc', TEXT['ui.doc_title.journal']]])) throw new Error('日志条目不对 ' + JSON.stringify(jl));
      if (jl.ctx !== 'reading' || !jl.frozen) throw new Error('日志打开时应冻结游戏 ' + JSON.stringify(jl));
      await evaluate(`__game.narrative.setGoal('ch1.s1.goal.reef_path'); 1`);
      const g2 = await until(`document.querySelector('.journal-goal-text').textContent === ${JSON.stringify(TEXT['ch1.s1.goal.reef_path'])}`, 2000);
      if (!g2) throw new Error('当前目标没随代码更新');
      // 结尾演出写下第 6 页
      await evaluate(`__game.narrative.unlockOutroEntry(); 1`);
      const en = await evaluate(`(() => { const r = document.querySelector('.journal-entry[data-doc="ch1.s2.journal.doc"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp.click(en.x, en.y);
      if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('点日志条目没打开阅读界面');
      // 逐页按 D；2 s 内没翻过去再补按一次（无头 Chrome 帧率低时偶发吞键，原来不检查）
      for (let i = 1; i <= 5; i++) {
        let ok = false;
        for (let tries = 0; tries < 3 && !ok; tries++) {
          await cdp.key('KeyD', 'd', 68);
          ok = await until(`__game.ui.reader.page === ${i}`, 2000);
        }
        if (!ok) throw new Error('第 ' + (i + 1) + ' 页翻不过去 ' + JSON.stringify(await rd()));
      }
      st = await rd();
      if (st.n !== 6 || st.page !== 5 || st.body !== TEXT['ch1.outro.journal_entry'] || st.idx !== '6 / 6') throw new Error('结尾后第 6 页不对 ' + JSON.stringify(st));
      await cdp.key('Tab', 'Tab', 9);
      if (!(await until(`!__game.ui.reader.isOpen && __game.ui.journal.isOpen && __game.input.context === 'reading'`, 3000))) throw new Error('Tab 关阅读后应回到日志');
      await cdp.key('KeyJ', 'j', 74);
      if (!(await until(`!__game.ui.journal.isOpen && __game.input.context === 'explore' && !__game.isFrozen`, 3000))) throw new Error('J 没关日志');
      out.push('日志分组 / 目标更新 / 第 6 页 ✓');
      // 第二种文档（告示）进「信与纸条」
      // 关日志后第一帧可能还没落地 / 交互候选没刷新：等提示出现，没出现就再传送一次（原来这里不检查，偶发漏读）
      let readPrompt = false;
      for (let tries = 0; tries < 2 && !readPrompt; tries++) {
        await goTo('sample-read');
        readPrompt = await until(`/E\\s*阅读/.test(${promptText})`, 5000);
      }
      if (!readPrompt) throw new Error('告示旁没有「E 阅读」：' + (await evaluate(promptText)));
      // 无头低帧率偶发吞键：2 s 没打开再补按一次
      let noticeOpen = false;
      for (let tries = 0; tries < 3 && !noticeOpen; tries++) {
        await cdp.key('KeyE', 'e', 69);
        noticeOpen = await until(`__game.ui.reader.isOpen && __game.ui.reader.docId === 'ch1.s1.notice.doc'`, 2000);
      }
      if (!noticeOpen) throw new Error('E 没打开告示 ' + JSON.stringify(await evaluate(`({ prompt: ${promptText}, ctx: __game.input.context, paused: __game.isPaused, frozen: __game.isFrozen, reader: __game.ui.reader.docId })`)));
      await cdp.key('Tab', 'Tab', 9);
      if (!(await until(`!__game.ui.reader.isOpen`, 3000))) throw new Error('Tab 没关告示');
      const groups = await evaluate(`__game.narrative.journal.map((e) => e.group + ':' + e.docId).join(',')`);
      if (groups !== 'father:ch1.s2.journal.doc,letters:ch1.s1.notice.doc') throw new Error('日志分组不对 ' + groups);
      out.push('信与纸条分组 ✓');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-008 主菜单 / 设置 / 暂停 / 章节结束页：§10 流程、无存档无「继续」、覆盖确认、设置即时生效并保存、恢复默认、回到主菜单→继续回场景开头、结束页用时与提示次数、样式、菜单内不锁指针',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await evaluate(expr).catch(() => false)) return true;
          await sleep(100);
        }
        return false;
      };
      const clickSel = async (sel) => {
        const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.checkVisibility()) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
        if (!r) throw new Error('看不到 ' + sel);
        await cdp.click(r.x, r.y);
      };
      const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility(); })()`;
      const menuState = `({ scene: __game.scenes.current?.name, ctx: __game.input.context, locked: !!document.pointerLockElement, view: __game.ui.mainMenu.view })`;

      // ---- 1. 无存档进主菜单（不带 autostart）：没有「继续」，菜单上下文、指针不锁
      await evaluate(`localStorage.clear(); 1`);
      await cdp.gotoMenu();
      await sleep(500);
      let m = await evaluate(`({ ...${menuState}, cont: ${visible('.main-menu [data-act="continue"]')}, newg: ${visible('.main-menu [data-act="new"]')}, title: document.querySelector('.main-title').textContent, ver: document.querySelector('.main-version').textContent })`);
      if (m.cont || !m.newg) throw new Error('无存档时不该有「继续」' + JSON.stringify(m));
      if (m.title !== TEXT['ui.title'] || m.ver !== TEXT['ui.menu.version']) throw new Error('标题 / 版本号文字不对 ' + JSON.stringify(m));
      if (m.ctx !== 'menu' || m.locked) throw new Error('主菜单应是菜单上下文、不锁指针 ' + JSON.stringify(m));
      // 点画面不会锁指针
      await cdp.click(100, 650);
      await sleep(400);
      if (await evaluate(`!!document.pointerLockElement`)) throw new Error('主菜单里点画面锁定了指针');
      out.push('无存档：无「继续」、不锁指针 ✓');

      // ---- 2. 样式：面板底色、琥珀色悬停
      await clickSel('.main-menu [data-act="settings"]');
      if (!(await until(`__game.ui.mainMenu.view === 'settings'`, 3000))) throw new Error('主菜单「设置」没打开');
      const st = await evaluate(`(() => { const p = document.querySelector('.main-menu .settings-panel'); return { bg: getComputedStyle(p).backgroundColor, txt: p.textContent }; })()`);
      if (st.bg !== 'rgba(26, 33, 40, 0.8)') throw new Error('面板底色应为 rgba(26,33,40,0.8)：' + st.bg);
      if (/点击移动|点击寻路|分辨率|渲染比例/.test(st.txt)) throw new Error('设置里出现了不该有的选项：' + st.txt);
      if (/undefined|null|NaN|\{[a-z]+\}/.test(st.txt)) throw new Error('设置文字有占位没替换：' + st.txt);
      const hb = await evaluate(`(() => { const b = document.querySelector('.main-menu .settings-panel [data-act="back"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.move(hb.x, hb.y);
      // 悬停有 CSS 过渡，机器负载高时 400 ms 可能还没走完：最多等 3 s 到终值
      const hovExpr = `getComputedStyle(document.querySelector('.main-menu .settings-panel [data-act="back"]')).borderColor`;
      // 030：主按钮（设置「返回」）悬停描边 = --ui-primary #D9A257
      await until(`${hovExpr} === 'rgb(217, 162, 87)'`, 3000);
      const hov = await evaluate(hovExpr);
      if (hov !== 'rgb(217, 162, 87)') throw new Error('悬停应为琥珀色描边 #D9A257：' + hov);
      // 设置即时生效：字幕字号、灵敏度
      await clickSel('.main-menu .settings-panel [data-size="l"]');
      await evaluate(`(() => { const r = document.querySelector('.main-menu .settings-panel input[data-act="sens"]') ?? document.querySelector('.main-menu .settings-panel [data-act="sens"] input'); r.value = '2.5'; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); return 1; })()`);
      await sleep(200);
      const s1 = await evaluate(`({ size: __game.settings.get('subtitleSize'), sens: __game.settings.get('mouseSensitivity'), stored: JSON.parse(localStorage.getItem('foglight.settings.v1') ?? '{}') })`);
      if (s1.size !== 'l' || Math.abs(s1.sens - 2.5) > 1e-6 || s1.stored.subtitleSize !== 'l' || Math.abs(s1.stored.mouseSensitivity - 2.5) > 1e-6) throw new Error('设置没即时生效 / 没写入 ' + JSON.stringify(s1));
      // Esc：从设置返回主菜单首页（主菜单不能暂停）
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.ui.mainMenu.view === 'home' && !__game.isPaused`, 3000))) throw new Error('主菜单设置里 Esc 应回首页 ' + JSON.stringify(await evaluate(menuState)));
      // 刷新后仍保留
      await cdp.gotoMenu();
      const s2 = await evaluate(`({ size: __game.settings.get('subtitleSize'), sens: __game.settings.get('mouseSensitivity') })`);
      if (s2.size !== 'l' || Math.abs(s2.sens - 2.5) > 1e-6) throw new Error('刷新后设置没保留 ' + JSON.stringify(s2));
      // 恢复默认：画质回默认档（有检测结果回检测档，否则极致）、灵敏度 1.0
      await clickSel('.main-menu [data-act="settings"]');
      await until(`__game.ui.mainMenu.view === 'settings'`, 3000);
      await clickSel('.main-menu .settings-panel [data-act="reset"]');
      await sleep(200);
      const s3 = await evaluate(`({ q: __game.settings.get('quality'), det: __game.settings.get('qualityDetectedTier'), tier: __game.quality.tier, sens: __game.settings.get('mouseSensitivity'), size: __game.settings.get('subtitleSize') })`);
      if (s3.q !== (s3.det ?? 'ultra') || s3.tier !== s3.q || s3.sens !== 1 || s3.size !== 'm') throw new Error('恢复默认不对 ' + JSON.stringify(s3));
      await clickSel('.main-menu .settings-panel [data-act="back"]');
      // 制作名单 → 返回
      await clickSel('.main-menu [data-act="credits"]');
      if (!(await until(`__game.ui.mainMenu.view === 'credits'`, 3000))) throw new Error('制作名单没打开');
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.ui.mainMenu.view === 'home'`, 3000))) throw new Error('制作名单 Esc 没回首页');
      out.push(`样式 ✓，设置即时生效 / 刷新保留 ✓，恢复默认 → ${s3.q} + 灵敏度 1.0 ✓，制作名单 ✓`);

      // ---- 3. 新游戏（无存档直接开始）→ 加载 → 主场景；记下开头位置
      await clickSel('.main-menu [data-act="new"]');
      if (!(await until(`__game.scenes.current?.name === 's1-ebb-shore'`, 60000))) throw new Error('新游戏没进主场景');
      await sleep(1500);
      const pos = `(() => { const p = __game.scenes.current.rig.body.position; return { x: p.x, y: p.y, z: p.z }; })()`;
      const p0 = await evaluate(pos);
      if (!(await evaluate(`!!localStorage.getItem('foglight.save.v1') && !__game.flow.holdingMenu`))) throw new Error('进场后应有存档、流程不再压菜单上下文');
      // 走开一段（直接挪身体）
      // 沿码头往陆地方向走 3 m（013：起点在码头尽头，往旁边挪会掉进涨潮的水里被送回）
      await evaluate(`(() => { const b = __game.scenes.current.rig.body; const p = b.position; b.teleport(__game.scenes.current.camera.position.clone().set(p.x - 2.83, p.y + 0.02, p.z + 0.99)); return 1; })()`);
      await sleep(300);

      // ---- 4. 暂停 → 回到主菜单：确认框取消回暂停菜单，确认回主菜单
      await cdp.click(640, 400);
      await sleep(400);
      await cdp.key('Escape', 'Escape', 27);
      if (!(await until(`__game.isPaused && __game.ui.pause.isOpen`, 3000))) throw new Error('Esc 没暂停');
      const pp = await evaluate(`({ blur: getComputedStyle(document.querySelector('.pause-menu')).backdropFilter, bg: getComputedStyle(document.querySelector('.pause-panel')).backgroundColor, btns: [...document.querySelectorAll('.pause-panel button')].filter((b) => b.checkVisibility()).map((b) => b.dataset.act).join(','), locked: !!document.pointerLockElement })`);
      if (pp.btns !== 'resume,settings,to-menu' || pp.bg !== 'rgba(26, 33, 40, 0.8)' || pp.locked) throw new Error('暂停菜单不对 ' + JSON.stringify(pp));
      // BUG-003：生产构建里遮罩背景模糊不能丢
      if (pp.blur !== 'blur(6px)') throw new Error('暂停遮罩没有背景模糊（BUG-003）backdropFilter=' + pp.blur);
      await clickSel('.pause-menu [data-act="to-menu"]');
      if (!(await until(`__game.ui.pause.view === 'confirm'`, 3000))) throw new Error('回到主菜单没弹确认');
      const cb = await evaluate(`document.querySelector('.pause-menu .confirm-body').textContent`);
      if (cb !== TEXT['ui.pause.to_menu_confirm']) throw new Error('确认文字不对 ' + cb);
      await clickSel('.pause-menu .confirm-dialog [data-act="cancel"]');
      if (!(await until(`__game.ui.pause.view === 'main' && __game.isPaused && __game.scenes.current?.name === 's1-ebb-shore'`, 3000))) throw new Error('取消后应回暂停菜单');
      await clickSel('.pause-menu [data-act="to-menu"]');
      await until(`__game.ui.pause.view === 'confirm'`, 3000);
      await clickSel('.pause-menu .confirm-dialog [data-act="confirm"]');
      if (!(await until(`__game.scenes.current?.name === 'menu' && __game.ui.mainMenu.isOpen && !__game.ui.pause.isOpen`, 20000))) throw new Error('确认后没回主菜单 ' + JSON.stringify(await evaluate(menuState)));
      m = await evaluate(`({ ...${menuState}, cont: ${visible('.main-menu [data-act="continue"]')}, paused: __game.isPaused, frozen: __game.isFrozen })`);
      if (!m.cont || m.ctx !== 'menu' || m.locked || m.paused) throw new Error('回主菜单后应有「继续」、不锁指针 ' + JSON.stringify(m));
      out.push('暂停 → 回到主菜单（取消 / 确认）✓');

      // ---- 5. 有存档点「新游戏」：覆盖确认，取消回主菜单、存档不动
      const saveBefore = await evaluate(`localStorage.getItem('foglight.save.v1')`);
      await clickSel('.main-menu [data-act="new"]');
      if (!(await until(`__game.ui.mainMenu.view === 'confirm'`, 3000))) throw new Error('有存档时新游戏没弹覆盖确认');
      const ot = await evaluate(`document.querySelector('.main-menu .confirm-title').textContent + '|' + document.querySelector('.main-menu .confirm-body').textContent`);
      if (ot !== TEXT['ui.menu.overwrite_title'] + '|' + TEXT['ui.menu.overwrite_body']) throw new Error('覆盖确认文字不对 ' + ot);
      await clickSel('.main-menu .confirm-dialog [data-act="cancel"]');
      if (!(await until(`__game.ui.mainMenu.view === 'home' && __game.scenes.current?.name === 'menu'`, 3000))) throw new Error('取消覆盖应回主菜单');
      if ((await evaluate(`localStorage.getItem('foglight.save.v1')`)) !== saveBefore) throw new Error('取消覆盖后存档被改了');
      out.push('覆盖确认 → 取消回主菜单 ✓');

      // ---- 6. 继续 → 回到场景开头
      await clickSel('.main-menu [data-act="continue"]');
      if (!(await until(`__game.scenes.current?.name === 's1-ebb-shore'`, 60000))) throw new Error('继续没进主场景');
      await sleep(1500);
      const p1 = await evaluate(pos);
      const d = Math.hypot(p1.x - p0.x, p1.z - p0.z);
      if (d > 0.6) throw new Error(`继续后应在场景开头，偏了 ${d.toFixed(2)} m`);
      out.push(`继续 → 场景开头（偏 ${d.toFixed(2)} m）✓`);

      // ---- 7. 章节结束页：用时 m:ss、提示次数；回到主菜单；继续回到结束页
      await evaluate(`(() => { __game.save.addHintUsed(); __game.save.addHintUsed(); return 1; })()`);
      await sleep(300);
      await evaluate(`__game.flow.completeChapter().then(() => 1)`);
      if (!(await until(`__game.scenes.current?.name === 'chapter-end' && ${visible('.chapter-end')}`, 15000))) throw new Error('章节结束页没显示');
      const ce = await evaluate(`({ time: document.querySelector('[data-role="playtime"]').textContent, hints: document.querySelector('[data-role="hints"]').textContent, save: JSON.parse(localStorage.getItem('foglight.save.v1')), ctx: __game.input.context, locked: !!document.pointerLockElement })`);
      const tm = /(\d+):(\d\d)/.exec(ce.time);
      if (!tm) throw new Error('用时不是 m:ss：' + ce.time);
      const sec = +tm[1] * 60 + +tm[2];
      if (!ce.save?.chapterComplete || Math.abs(sec - ce.save.playTimeSec) > 1) throw new Error('结束页用时和存档不一致 ' + JSON.stringify(ce));
      if (!ce.hints.includes('2') || ce.save.hintsUsed !== 2) throw new Error('提示次数不对 ' + JSON.stringify(ce));
      if (ce.ctx !== 'menu' || ce.locked) throw new Error('结束页应不锁指针 ' + JSON.stringify(ce));
      await clickSel('.chapter-end [data-act="to-menu"]');
      if (!(await until(`__game.scenes.current?.name === 'menu' && __game.ui.mainMenu.isOpen`, 15000))) throw new Error('结束页没回主菜单');
      await clickSel('.main-menu [data-act="continue"]');
      if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 15000))) throw new Error('已完成存档继续应回结束页');
      out.push(`结束页 ${tm[0]} / 提示 2 次 ✓，回主菜单 / 继续回结束页 ✓`);

      // 恢复干净状态
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-010 场景流程：启动只加载 boot+menu、字体子集、新游戏加载 common+s1、S1 预加载 s2、S1→S2→S3 黑场 ≤ 1.0 s 并存档、释放上一场景、慢加载显示细线进度、S3 点灯→结束页、沙盒仅 debug',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        while (Date.now() < end) {
          if (await evaluate(expr).catch(() => false)) return true;
          await sleep(60);
        }
        return false;
      };
      const st = () =>
        evaluate(`({ scene: __game.scenes.current?.name, groups: __game.assets.loadedGroups, save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null'),
          tr: __game.flow.lastTransition, busy: __game.flow.transitioning, entry: __game.scenes.current?.entryId,
          mem: { ...__game.renderer.info.memory } })`);
      /** 把角色放进当前场景出口（出口是「外 → 内」触发：先放到外面一步再放进去） */
      const walkIntoExit = (i = 0) =>
        evaluate(`(async () => { const s = __game.scenes.current; const ex = s.exits[${i}]; const c = ex.opts.center.clone();
          // S1 出口在崖顶平台上（013）：从东侧 2.5 m 外进；其它场景照旧斜对角 3 m
          s.rig.body.teleport(c.clone().add(s.name === 's1-ebb-shore' ? new c.constructor(2.5, 0.02, 0) : new c.constructor(3, 0.02, 3)));
          // 等两帧（无头软件渲染一帧可能上百 ms）：出口要先看到「在外面」的一步，进去才算走进
          for (let k = 0; k < 2; k++) await new Promise((r) => requestAnimationFrame(r));
          s.rig.body.teleport(c.clone().setY(c.y + 0.02)); return ex.target; })()`);

      // ---- 1. 启动：只加载 boot + menu（字体子集），主菜单出现时间
      await evaluate(`localStorage.clear(); 1`);
      await cdp.gotoMenu();
      let m = await evaluate(`({ groups: __game.assets.loadedGroups, ready: __game.flow.menuReadyMs, boot: __game.flow.bootStartMs,
        glb: performance.getEntriesByType('resource').filter((e) => /\\.(glb|ktx2)$/.test(e.name)).length,
        woff: performance.getEntriesByType('resource').filter((e) => /\\.woff2$/.test(e.name)).map((e) => e.name.split('/').pop()),
        fontOk: document.fonts.check('32px "Foglight Serif"', '雾灯') && document.fonts.check('16px "Foglight Sans"', '继续'),
        family: getComputedStyle(document.querySelector('.main-title')).fontFamily, fonts: __game.assets.fontStats })`);
      if (m.groups.join() !== 'boot,menu') throw new Error('启动应只加载 boot+menu：' + m.groups.join());
      if (m.glb) throw new Error('主菜单阶段不应下载模型 / 贴图');
      // 每个字体只有一次成功下载；被取消重试的次数如实报告（QA batch4 §1 INFO）
      if (m.fonts.length !== 2 || m.fonts.some((f) => !f.ok)) throw new Error('字体加载记录不对 ' + JSON.stringify(m.fonts));
      console.log(`    字体 fetch 次数：${m.fonts.map((f) => f.family + ' ' + f.attempts).join('，')}`);
      if (m.woff.length !== 2 || !m.fontOk || !/Foglight Serif/.test(m.family)) throw new Error('字体子集没加载 / 没用上 ' + JSON.stringify(m));
      // 无头 SwiftShader 下 JS 初始化 / WebGL 着色器编译本身就要数秒（与资源无关），所以这里只卡「boot+menu 加载 → 主菜单」≤ 3 s；
      // 从导航开始的总时间只报告不断言，真机（RTX 3060）上要人工确认 ≤ 3 s
      const loadMs = m.ready - m.boot;
      if (!(m.boot > 0 && loadMs >= 0 && loadMs <= 3000)) throw new Error('boot+menu 加载到主菜单用了 ' + loadMs + ' ms');
      out.push(`主菜单：加载 ${Math.round(loadMs)} ms，导航起 ${Math.round(m.ready)} ms（无头软件渲染，仅供参考；boot+menu、字体 ${m.woff.join('/')}）✓`);

      // ---- 2. 新游戏：加载页（common + s1）→ S1；建立镜头后后台预加载 s2
      await evaluate(`__game.flow.newGame(); 1`);
      if (!(await until(`__game.scenes.current?.name === 's1-ebb-shore'`, 60000))) throw new Error('新游戏没进 S1');
      let s = await st();
      if (s.groups.slice().sort().join() !== 'boot,common,menu,s1') throw new Error('进 S1 时应已加载 boot/menu/common/s1：' + s.groups.join());
      if (s.save?.sceneId !== 's1') throw new Error('进 S1 没存档 ' + JSON.stringify(s.save));
      // BUG-005：地名标题、左下角操作提示来自文本表
      const hudTxt = await evaluate(`({ loc: document.querySelector('.hud-location')?.textContent, hint: document.querySelector('.hud-hint')?.textContent, kbd: document.querySelectorAll('.hud-hint kbd').length })`);
      const wantHint = TEXT['ui.hud.controls'].replace(/\s+/g, '');
      if (hudTxt.loc !== TEXT['ch1.s1.location.title'] || (hudTxt.hint ?? '').replace(/\s+/g, '') !== wantHint || hudTxt.kbd < 9) throw new Error('S1 地名 / 操作提示不是文本表里的 ' + JSON.stringify(hudTxt));
      // 预加载排在懒加载场景曲有结果之后（art=1 时最多再等 45 s 超时）
      if (!(await until(`__game.assets.isGroupLoaded('s2')`, LOAD_MS + 45000))) throw new Error('S1 没有后台预加载 s2');
      // 桌面专做（GDD §15）：v0.1 不注册 TouchInput，页面上没有任何触屏按钮 / 摇杆
      const touchEls = await evaluate(`document.querySelectorAll('.touch-controls, .touch-btn, .joystick-base').length`);
      if (touchEls !== 0) throw new Error('v0.1 不应显示触屏控件，找到 ' + touchEls + ' 个');
      out.push('新游戏 common+s1 → S1、存档 s1、地名 / 操作提示走文本表、无触屏控件、预加载 s2 ✓');

      // ---- 3. S1 → S2：黑场预算 0.96 s（淡出 + 至少 0.3 s 全黑 + 淡入；无头下按「每段最多超一帧」核对）、换场景时全黑、存档 s2、释放 s1、显存对象减少
      await sleep(300);
      const before = (await st()).mem;
      // 释放 S1：014 起 S2 是完整白盒（几何体比 S1 无美术时还多），不能再用「总数减少」判断——改成 S1 场景里的几何体收到 dispose
      await evaluate(`(() => { window.__s1Geo = { total: 0, disposed: 0 }; const seen = new Set(); __game.scenes.current.scene.traverse((o) => { const g = o.geometry; if (!g || seen.has(g)) return; seen.add(g); __s1Geo.total++; g.addEventListener('dispose', () => __s1Geo.disposed++); }); return 1; })()`);
      await evaluate(`window.__fadeLog = []; (function poll() { if (!__game.flow.transitioning && window.__fadeLog.length > 5) return; window.__fadeLog.push([__game.scenes.current?.name, __game.ui.fade.opacity, __game.ui.fade.progress]); requestAnimationFrame(poll); })(); 1`);
      await walkIntoExit(0);
      if (!(await until(`__game.scenes.current?.name === 's2-keeper-house' && !__game.flow.transitioning`, 40000))) throw new Error('走进出口没去 S2 ' + JSON.stringify(await evaluate(`(() => { const s = __game.scenes.current; const ex = s.exits?.[0]; return { scene: s.name, paused: __game.isPaused, tr: __game.flow.transitioning, ex: ex && { inside: ex.inside, primed: ex.primed, enabled: ex.enabled, c: ex.opts.center, contains: ex.contains(s.rig.body.position) }, pos: s.rig.body.position, ctrl: s.rig.controller.locked }; })()`)));
      s = await st();
      const log = await evaluate(`window.__fadeLog`);
      const firstS2 = log.find((l) => l[0] === 's2-keeper-house');
      if (!firstS2 || firstS2[1] < 1) throw new Error('换场景时画面应是全黑：' + JSON.stringify(firstS2));
      if (log.some((l) => l[2] !== null)) throw new Error('已预加载不应显示进度线');
      if (s.tr.waitedForLoad) throw new Error('S1→S2 已预加载却在等加载 ' + JSON.stringify(s.tr));
      {
        // 黑场时间预算：淡出 330 + 至少全黑 300 + 淡入 330 = 960 ms ≤ 1.0 s。无头 SwiftShader 一帧可达数百 ms~2 s，
        // 所以按「每段最多超出一帧」核对；帧时间正常（< 50 ms）时直接要求总时长 ≤ 1000 ms
        const { phases: p, maxFrameMs: f } = s.tr;
        const slack = f + 20;
        if (p.fadeOut > 330 + slack || p.fadeIn > 330 + slack || s.tr.holdMs > Math.max(300, p.swap) + slack)
          throw new Error('S1→S2 切换分段超预算 ' + JSON.stringify(s.tr));
        if (f < 50 && s.tr.ms > 1000) throw new Error('S1→S2 切换超过 1.0 s ' + JSON.stringify(s.tr));
      }
      if (s.save?.sceneId !== 's2') throw new Error('进 S2 没存档 ' + JSON.stringify(s.save));
      if (s.entry !== 'from-s1') throw new Error('入口不对 ' + s.entry);
      const loc2 = await evaluate(`document.querySelector('.hud-location')?.textContent`);
      if (loc2 !== TEXT['ch1.s2.location.title']) throw new Error('S2 地名不是文本表里的 ' + loc2);
      if (s.groups.includes('s1')) throw new Error('s1 没释放：' + s.groups.join());
      await sleep(400);
      const after = (await st()).mem;
      const s1Geo = await evaluate(`window.__s1Geo`);
      if (!(s1Geo.total > 0 && s1Geo.disposed / s1Geo.total >= 0.8)) throw new Error('S1 几何体没释放 ' + JSON.stringify(s1Geo));
      out.push(`S1→S2 ${Math.round(s.tr.ms)} ms（全黑 ${Math.round(s.tr.holdMs)} ms、最长帧 ${Math.round(s.tr.maxFrameMs)} ms，无头软件渲染）、存档 s2、释放 s1（S1 几何体 ${s1Geo.disposed}/${s1Geo.total} 已 dispose）、几何体 ${before.geometries}→${after.geometries} 纹理 ${before.textures}→${after.textures} ✓`);

      // ---- 4. 慢加载（?slowLoad=4000）：直接进 S2（?scene=s2&debug=1），马上走进出口 → s3 没加载完：黑场里显示细线进度，加载完才换场景
      await cdp.goto('slowLoad=4000&debug=1&scene=s2', 's2-keeper-house');
      s = await st();
      if (s.groups.includes('s1')) throw new Error('继续 / 直接进 S2 不该加载 s1：' + s.groups.join());
      await evaluate(`window.__fadeLog = []; (function poll() { if (!__game.flow.transitioning && window.__fadeLog.length > 5) return; window.__fadeLog.push([__game.scenes.current?.name, __game.ui.fade.opacity, __game.ui.fade.progress]); requestAnimationFrame(poll); })(); 1`);
      await walkIntoExit(0);
      if (!(await until(`__game.scenes.current?.name === 's3-lighthouse' && !__game.flow.transitioning`, 40000))) throw new Error('S2 出口没去 S3');
      s = await st();
      const slog = await evaluate(`window.__fadeLog`);
      const withBar = slog.filter((l) => l[2] !== null);
      // 高负载时无头一帧可达 2 s（maxFrameMs），5 s 黑场里 rAF 只采到 1–2 帧：此时只要求采到过进度线；正常帧率仍要 ≥ 3 帧
      const minBar = s.tr.maxFrameMs > 500 ? 1 : 3;
      if (!s.tr.waitedForLoad || !s.tr.progressShown || withBar.length < minBar) throw new Error(`慢加载没显示进度线（采到 ${withBar.length}/${slog.length} 帧，要 ≥ ${minBar}）` + JSON.stringify(s.tr));
      // 进度线只在全黑时出现；没加载满（< 1）时一定还是旧场景（加载完才换场景，满格的线保留到淡入前）
      if (withBar.some((l) => l[1] < 1 || (l[2] < 1 && l[0] !== 's2-keeper-house')))
        throw new Error('进度线应在全黑、旧场景还没换的时候显示 ' + JSON.stringify(withBar));
      if (s.save?.sceneId !== 's3' || s.groups.includes('s2')) throw new Error('S3 存档 / 释放 s2 不对 ' + JSON.stringify({ save: s.save, groups: s.groups }));
      out.push(`慢加载 S2→S3 ${Math.round(s.tr.ms)} ms、进度线 ${withBar.length} 帧（${withBar[0][2].toFixed(2)}→${withBar.at(-1)[2].toFixed(2)}）✓`);

      // ---- 5. S3 点灯 → 章节结束页（存档 chapterComplete），场景组全部释放
      // BUG-006：进 S3 时灯塔熄灭（无光束），点灯后亮
      if (await evaluate(`__game.scenes.current.lighthouseOn`)) throw new Error('BUG-006：进 S3 时灯塔不应已亮');
      await evaluate(`__game.scenes.current.lightTheLamp(); 1`);
      if (!(await evaluate(`__game.scenes.current?.name !== 's3-lighthouse' || __game.scenes.current.lighthouseOn`))) throw new Error('BUG-006：点灯后灯塔没亮');
      // BUG-016：点灯 → 结尾演出结束才切章节结束页（035 起 106 s 演出时钟，下面 seek 到 104 s）。按游戏时间等 8 s（同 e9a58b2 修 015），墙钟 3 分钟兜底
      const untilGame = async (expr, gameSec, wallMs = 180000) => {
        const clock = () => evaluate(`__game.time.fixedTick * __game.time.fixedDelta`).catch(() => null);
        const t0 = await clock();
        const end = Date.now() + wallMs;
        while (Date.now() < end) {
          if (await evaluate(expr).catch(() => false)) return true;
          const t = await clock();
          if (t !== null && t0 !== null && t - t0 >= gameSec) return !!(await evaluate(expr).catch(() => false));
          await sleep(100);
        }
        return false;
      };
      // 035：结尾演出 106 s（演出时钟）才进结束页——这里只测流程，把演出推到 104 s
      await evaluate(`__game.scenes.current?.endingCutscene?.seek(${ENDING_CUES.silence - 2}), 1`);
      if (!(await untilGame(`__game.scenes.current?.name === 'chapter-end'`, 8))) throw new Error('点灯后没进章节结束页（游戏时间 8 s / 墙钟 180 s）');
      s = await st();
      if (!s.save?.chapterComplete) throw new Error('结束页没存 chapterComplete');
      if (s.groups.some((x) => /^s\d$/.test(x))) throw new Error('结束页应释放场景组：' + s.groups.join());
      out.push('S3 进场灯塔熄灭 → 点灯亮起 → 结束页、释放场景组 ✓');

      // ---- 6. 沙盒：正式版不带 debug 打不开；带 ?debug=1 能进，不存档
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('scene=sandbox', 's1-ebb-shore');
      await cdp.goto('scene=sandbox&debug=1', 'sandbox');
      await sleep(300);
      s = await st();
      if (s.save?.sceneId === 'sandbox' || s.groups.includes('s2')) throw new Error('沙盒不该存档 / 预加载 ' + JSON.stringify(s));
      out.push('沙盒仅 debug ✓');

      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-007 三级提示：?hintScale=0.02 时区域内 3.6 s（游戏时间）出风灯、H 弹窗（未解锁 locked）、二级高亮钟 3 s、三级全文、离开暂停、分步骤换文案、敲钟解开后图标消失、hintsUsed 计数',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      await cdp.goto('scene=testbed&hintScale=0.02', 'testbed');
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr).catch(() => false);
          if (v) return v;
          await sleep(80);
        }
        return v;
      };
      // 按 H 并等弹窗状态翻转（高负载时帧很慢）
      const tapH = async () => {
        const was = await evaluate('__game.ui.hints.isOpen');
        await evaluate(`__game.input.setRaw('smoke', 'KeyH', true); 1`);
        await sleep(60);
        await evaluate(`__game.input.setRaw('smoke', 'KeyH', false); 1`);
        if ((await until(`__game.ui.hints.isOpen !== ${was}`, 6000)) !== true) throw new Error('按 H 弹窗没有' + (was ? '关闭' : '打开'));
      };
      const panel = `(() => { const p = document.querySelector('.hint-panel'); return { open: !!p && !p.hidden, rows: [...document.querySelectorAll('.hint-row')].map((r) => (r.classList.contains('locked') ? '×' : '') + r.querySelector('.hint-text').textContent) }; })()`;
      const lantern = `document.querySelector('.hint-lantern').classList.contains('visible')`;
      await evaluate(`(() => { if (!__game.save.active) __game.save.newGame('ch1', 'testbed'); window.__hx = []; for (const n of ['hint:unlocked', 'hint:open', 'highlight:start']) __game.events.on(n, (p) => __hx.push([n, p])); return 1; })()`);
      const used0 = await evaluate('__game.save.hintsUsed');
      if (await evaluate('__testbed.hints.thresholds[0]') > 3.61) throw new Error('hintScale 没生效 ' + (await evaluate('__testbed.hints.thresholds')));
      if (await evaluate(lantern)) throw new Error('进场就有风灯');
      // 不在区域里按 H：三行 locked（「再等等，四处看看」）
      await tapH();
      let p = await evaluate(panel);
      if (!p.open || p.rows.length !== 3 || !p.rows.every((r) => r === '×再等等，四处看看'))
        throw new Error('区域外 H 弹窗不对 ' + JSON.stringify(p));
      await tapH();
      // 站进钟旁区域，等 9 s（游戏时间）解锁一级
      const stand = `(() => { const tb = __testbed; tb.interaction.cancel(); tb.rig.body.teleport(new tb.rig.body.position.constructor(15.3, 0.05, -2)); return 1; })()`;
      await evaluate(stand);
      const t0 = Date.now();
      if (!(await until(lantern, 90000))) throw new Error('区域内 45 s 风灯没出现 ' + (await evaluate('__testbed.hints.debugLine()')));
      out.push(`一级 ${((Date.now() - t0) / 1000).toFixed(1)} s（墙钟）出风灯`);
      await tapH();
      p = await evaluate(panel);
      if (!p.open || p.rows[0].startsWith('×') || !p.rows[1].startsWith('×') || !p.rows[2].startsWith('×')) throw new Error('一级弹窗不对 ' + JSON.stringify(p));
      if ((await evaluate('__game.save.hintsUsed')) !== used0 + 1) throw new Error('看一级没记 hintsUsed');
      if (!(await evaluate(`__game.input.context === 'explore' && !__game.isPaused`))) throw new Error('弹窗不应暂停 / 换上下文');
      // 弹窗开着时升到二级：自动刷新 + 高亮钟
      await evaluate(`__testbed.hints.debugSetTime('test-bell', 7.3); 1`);
      const hl = await until(`__hx.find(([n, p]) => n === 'highlight:start' && p.ids.includes('sample-bell'))`, 4000);
      if (!hl || hl[1].seconds !== 3) throw new Error('二级没高亮钟 3 s ' + JSON.stringify(await evaluate('__hx')));
      p = await evaluate(panel);
      if (p.rows[1].startsWith('×') || !p.rows[2].startsWith('×')) throw new Error('二级弹窗不对 ' + JSON.stringify(p));
      await evaluate(`__testbed.hints.debugSetTime('test-bell', 12.1); 1`);
      await until(`!document.querySelectorAll('.hint-row.locked').length`, 6000);
      p = await evaluate(panel);
      if (p.rows.some((r) => r.startsWith('×'))) throw new Error('三级弹窗不对 ' + JSON.stringify(p));
      if ((await evaluate('__game.save.hintsUsed')) !== used0 + 3) throw new Error('hintsUsed 应 +3，实际 ' + ((await evaluate('__game.save.hintsUsed')) - used0));
      out.push('一二三级 ✓ hintsUsed +3');
      await tapH();
      // 离开区域：计时暂停
      await evaluate(`(() => { const tb = __testbed; tb.rig.body.teleport(new tb.rig.body.position.constructor(0, 0.05, 4)); return 1; })()`);
      await sleep(300);
      const ta = await evaluate(`__testbed.hints.time('test-bell')`);
      await sleep(1500);
      const tb2 = await evaluate(`__testbed.hints.time('test-bell')`);
      if (Math.abs(tb2 - ta) > 0.05) throw new Error(`区域外计时没停 ${ta} → ${tb2}`);
      // 分步骤：油阀区域，二级取 valve；完成 valve 后换成 window_mirror
      await evaluate(`__testbed.hints.debugSetTime('test-steps', 7.3); 1`);
      await evaluate(`(() => { const tb = __testbed; tb.rig.body.teleport(new tb.rig.body.position.constructor(15.5, 0.05, 1)); return 1; })()`);
      await until(`__testbed.hints.currentId === 'test-steps'`, 4000);
      await tapH();
      p = await evaluate(panel);
      const valveL2 = await evaluate(`__game.ui.hints.view?.lines[1]?.textId`);
      if (valveL2 !== 'ch1.hint.p5.valve.l2') throw new Error('步骤二级应为 valve ' + valveL2 + JSON.stringify(p));
      await evaluate(`__testbed.hints.completeStep('test-steps', 'valve'); 1`);
      const ok = await until(`__testbed.hints.view().step === 'window_mirror' && __game.ui.hints.view?.lines[1]?.textId === 'ch1.hint.p5.window_mirror.l2'`, 3000);
      if (!ok) throw new Error('完成 valve 后弹窗没换成 window_mirror');
      await tapH();
      out.push('分步骤换文案 ✓');
      // 敲钟 = 解开 test-bell；区域内不再显示它
      await evaluate(`__game.events.emit('interact:used', { id: 'sample-bell', kind: 'use' }); __testbed.hints.solve('test-steps'); 1`);
      if (!(await evaluate(`__testbed.hints.isSolved('test-bell')`))) throw new Error('敲钟没解开 test-bell');
      if (!(await until(`!document.querySelector('.hint-lantern').classList.contains('visible')`, 3000))) throw new Error('全解开后风灯没消失');
      out.push('解开后风灯消失 ✓');
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('');
      return out.join('；');
    },
  },
  {
    name: 'v0.1-011 潮汐：测试场地敲钟 6 s 退潮（过渡中提示变灰、再按 E 无效）、水面 / uTideLevel / F4 读数、礁石路空气墙、涨潮淹没送回 + 字幕、浮台锚位载人浮起',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      await cdp.goto('scene=testbed&debug=1', 'testbed');
      const until = async (expr, ms = 15000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr).catch(() => false);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      const tapE = async () => {
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
        await sleep(150);
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      };
      // 无头高负载时游戏时间比墙钟慢很多：所有等待都按状态轮询，超时放宽
      const T = 180000;
      await evaluate(`(() => { window.__tx = []; for (const n of ['tide:changing', 'tide:changed', 'tide:bell', 'tide:recall', 'float:state', 'sfx:play']) __game.events.on(n, (p) => __tx.push([n, p])); return 1; })()`);
      const st = `(() => { const tb = __testbed, a = tb.tideArea, t = a.tide, pr = document.querySelector('.hud-prompt'); const p = tb.rig.body.position;
        return { level: t.level, state: t.state, moving: t.transitioning, water: a.water.position.y, gaugeU: a.gauge.material.userData.tideShader?.uniforms.uTideLevel.value ?? null,
          cur: tb.interaction.current?.id ?? null, prompt: pr && !pr.hidden ? pr.textContent : null, grey: !!pr?.classList.contains('is-disabled'), rings: a.bell.rings,
          gate: a.reefGate.enabled, raft: a.raft.state, raftY: a.raft.object.position.y, p: [p.x, p.y, p.z], ground: tb.rig.body.body.onGround, busy: tb.rig.controller.busy,
          debug: document.querySelector('.debug-panel')?.textContent ?? '' }; })()`;
      const place = (x, y, z, facing) => evaluate(`(() => { const tb = __testbed; tb.rig.body.body.teleport(new tb.tideArea.anchors.safe.constructor(${x}, ${y}, ${z})); tb.rig.controller.facing = ${facing}; return 1; })()`);

      // ---- 1. 敲钟：站到钟前，E
      if (!(await until(`__game.input.context === 'explore'`, ESTAB_MS))) throw new Error('测试场地没进 explore');
      let s = await evaluate(st);
      if (s.state !== 'high' || Math.abs(s.level - 1.6) > 1e-6 || s.water !== s.level || !s.gate) throw new Error('初始应为涨潮 1.6、礁石路有墙 ' + JSON.stringify(s));
      await place(-4, 2.02, 22.45, Math.PI);
      if (!(await until(`${st}.cur === 'tide-bell'`, 20000))) throw new Error('站到钟前没有候选 ' + JSON.stringify(await evaluate(st)));
      s = await evaluate(st);
      if (s.prompt !== TEXT['ui.prompt.ring'] || s.grey) throw new Error('钟前提示应为「' + TEXT['ui.prompt.ring'] + '」且不灰 ' + JSON.stringify(s));
      await tapE();
      if (!(await until(`${st}.moving`, 30000))) throw new Error('按 E 没开始退潮 ' + JSON.stringify(await evaluate(st)));
      if (!(await until(`${st}.grey`, 10000))) throw new Error('过渡中提示没变灰 ' + JSON.stringify(await evaluate(st)));
      await tapE();
      await sleep(600);
      s = await evaluate(st);
      if (s.rings !== 1 || s.state !== 'low') throw new Error('过渡中再按 E 不应生效 ' + JSON.stringify(s));
      out.push('E 敲钟 → 退潮、过渡中提示变灰、再按 E 无效 ✓');
      if (!(await until(`!${st}.moving`, T))) throw new Error('退潮没结束 ' + JSON.stringify(await evaluate(st)));
      // 刻度柱可能不在视野里还没编译：强制编译一次再读它着色器里的 uTideLevel
      await evaluate(`(() => { __game.renderer.compile(__testbed.scene, __testbed.camera); return 1; })()`);
      s = await evaluate(st);
      if (s.level !== 0 || s.water !== 0 || s.gaugeU !== 0 || s.gate) throw new Error('退潮到位后 level / 水面 / 刻度柱 uniform / 礁石路墙不对 ' + JSON.stringify(s));
      // 潮位到位在 fixedUpdate，提示灰 / 不灰在下一帧 interaction.update 才刷新：高负载时多等几帧
      if (s.grey || s.prompt !== TEXT['ui.prompt.ring']) {
        await until(`!${st}.grey && ${st}.prompt === ${JSON.stringify(TEXT['ui.prompt.ring'])}`, 8000);
        s = await evaluate(st);
      }
      if (s.grey || s.prompt !== TEXT['ui.prompt.ring']) throw new Error('到位后提示应恢复 ' + JSON.stringify(s));
      await evaluate(`__game.ui.debug.setVisible(true); 1`);
      await until(`/test-tide/.test(document.querySelector('.debug-panel')?.textContent ?? '')`, 20000);
      s = await evaluate(st);
      await evaluate(`__game.ui.debug.setVisible(false); 1`);
      if (!/潮汐/.test(s.debug) || !/test-tide low/.test(s.debug)) throw new Error('F4 面板没有潮汐读数 ' + s.debug.slice(0, 300));
      const ev = await evaluate('__tx.map(([n]) => n)');
      for (const n of ['tide:bell', 'sfx:play', 'tide:changing', 'tide:changed']) if (!ev.includes(n)) throw new Error('缺事件 ' + n + ' ' + ev.join());
      out.push('6 s 后 level 0、水面 / uTideLevel 同步、礁石路墙撤掉、F4「潮汐」✓');

      // ---- 2. 送回：站在礁石路上（0.1 m），Y 遥控涨潮 → 水深 > 0.3 m 时黑场送回岸台安全点 + 字幕
      await place(0, 0.12, 32, 0);
      await until(`${st}.ground`, 10000);
      await evaluate(`__testbed.tideArea.bell.ring(); 1`);
      if (!(await until(`__tx.some(([n]) => n === 'tide:recall')`, T))) throw new Error('涨潮淹没礁石路没有送回 ' + JSON.stringify(await evaluate(st)));
      const sub = await until(`(() => { const l = document.querySelector('.subtitle-line'); return l && l.textContent === ${JSON.stringify(TEXT['ch1.common.tide_return'])} ? l.textContent : false; })()`, 20000);
      if (!sub) throw new Error('送回时没显示「' + TEXT['ch1.common.tide_return'] + '」');
      const lvl = await evaluate(`__testbed.tideArea.tide.level`);
      if (!(await until(`(() => { const s = ${st}; return !s.busy && Math.hypot(s.p[0], s.p[2] - 22) < 0.6 && Math.abs(s.p[1] - 2) < 0.1; })()`, 60000))) throw new Error('没送回到岸台安全点 ' + JSON.stringify(await evaluate(st)));
      out.push(`涨到 ${lvl.toFixed(2)} m 时送回岸台 + 字幕「${sub}」✓`);
      if (!(await until(`!${st}.moving`, T))) throw new Error('涨潮没结束');
      if (!(await evaluate(`${st}.gate`))) throw new Error('涨潮后礁石路墙没恢复');

      // ---- 3. 浮台：退潮、浮台推进锚位，站上去，涨潮 → 浮台载人升到岸台高度；浮起时不可推
      await evaluate(`(() => { const a = __testbed.tideArea; a.tide.set('low', { instant: true }); a.raft.object.position.copy(a.anchors.raftAnchor); a.raftPush.pushT = 1; a.raftPush.locked = true; a.raft.object.updateMatrixWorld(true); return 1; })()`);
      await sleep(300);
      await place(5, 0.62, 24.65, Math.PI);
      if (!(await until(`(() => { const s = ${st}; return s.ground && Math.abs(s.p[1] - 0.6) < 0.05; })()`, 20000))) throw new Error('没站上浮台 ' + JSON.stringify(await evaluate(st)));
      await evaluate(`__testbed.tideArea.bell.ring(); 1`);
      let minGap = 0;
      const end = Date.now() + T;
      while (Date.now() < end) {
        s = await evaluate(st);
        minGap = Math.max(minGap, Math.abs(s.p[1] - (s.raftY + 0.25)));
        if (!s.moving) break;
        await sleep(150);
      }
      if (s.moving) throw new Error('涨潮没结束');
      if (s.raft !== 'floating' || Math.abs(s.raftY - 1.75) > 0.021) throw new Error('锚位浮台应浮到 1.75 ±2 cm ' + JSON.stringify(s));
      if (Math.abs(s.p[1] - 2.0) > 0.05 || Math.hypot(s.p[0] - 5, s.p[2] - 24.65) > 0.3) throw new Error('角色没被浮台带上去 ' + JSON.stringify(s));
      if (minGap > 0.06) throw new Error('上升途中角色与浮台顶面偏差 ' + minGap.toFixed(3) + ' m');
      if (await evaluate(`__testbed.interaction.canInteract(__testbed.tideArea.raftPush)`)) throw new Error('浮起时还能推');
      out.push(`浮台锚位载人浮到 ${(s.raftY + 0.25).toFixed(2)} m（与岸台齐平、途中最大偏差 ${(minGap * 100).toFixed(1)} cm）、浮起不可推 ✓`);
      await cdp.goto('');
      return out.join('；');
    },
  },
  {
    name: 'v0.1-012 光路：测试场地风灯灯台 → 镜 A → 镜 B → 光感锁（机关台 E 进机位、转对 1.5 s 触发、提示解开）、F4 光路读数、O 冷暖切换、U 开油阀 → 天光常亮 → 点火口 1.0 s 可点灯 → E 点灯转暖、?beamDebug=1 调试线',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      await cdp.goto('scene=testbed&debug=1&beamDebug=1', 'testbed');
      const until = async (expr, ms = 15000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr).catch(() => false);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      const st = () =>
        evaluate(`(() => { const b = __testbed.beamArea; const p = b.tracer.paths.find((x) => x.emitter.id === 'beam-lamp');
          return { end: p?.end, refl: p?.reflections, recv: p?.receiver?.id ?? null, lock: b.lock.state, ig: b.igniter.state, lamp: b.lamp.color, sky: b.sky.color,
            segs: b.renderer.root.children.length, solved: __testbed.hints.isSolved('test-beam'), f4: __game.ui.debug.lines.get('光路') ?? '' }; })()`);
      if (!(await until(`__testbed.beamArea.tracer.paths.length === 2`))) throw new Error('光路没算出来');
      let s = await st();
      if (s.recv === 'beam-lock' || s.lock !== 'idle') throw new Error('初始镜 A 偏 30° 时不该命中锁 ' + JSON.stringify(s));
      if (s.lamp !== 'warm' || s.sky !== 'coldWhite') throw new Error('颜色规则：灯台暖、天光冷白 ' + JSON.stringify(s));
      if (!s.segs) throw new Error('光束没渲染');
      out.push(`初始：灯台 ${s.refl} 次反射 · ${s.end}，锁 idle，灯台暖 / 天光冷白 ✓`);
      // 机关台：E 进机位
      await evaluate(`(() => { const tb = __testbed; tb.interaction.cancel(); tb.rig.body.teleport(new tb.rig.body.position.constructor(-16.5, 0.02, 6.1)); tb.rig.controller.facing = Math.PI; return 1; })()`);
      let cur = await until(`__testbed.interaction.current?.id === 'beam-console'`, 8000);
      if (!cur) {
        await evaluate(`(() => { const tb = __testbed; tb.rig.body.teleport(new tb.rig.body.position.constructor(-16.5, 0.02, 6.1)); tb.rig.controller.facing = 0; return 1; })()`);
        cur = await until(`__testbed.interaction.current?.id === 'beam-console'`, 8000);
      }
      if (!cur) throw new Error('机关台没有成为交互候选 ' + JSON.stringify(await evaluate(`(() => { const ix = __testbed.interaction; return { cur: ix.current?.id ?? null, cands: ix.items.filter((i) => ix.canInteract(i)).map((i) => i.id) }; })()`)));
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
      await sleep(60);
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      if (!(await until(`__game.input.context === 'puzzle'`, 8000))) throw new Error('E 没进机关机位');
      if (!(await until(`__testbed.hints.debugLine().includes('test-beam')`, 3000))) throw new Error('机关台前不在 test-beam 提示区');
      out.push('机关台 E 进机位、在 test-beam 提示区 ✓');
      // 转到正解 → 1.5 s（游戏时间）后锁触发
      await evaluate(`__testbed.beamArea.solve(); 1`);
      if (!(await until(`__testbed.beamArea.tracer.paths[0].receiver?.id === 'beam-lock'`, 10000))) throw new Error('转对后光路没打到锁 ' + JSON.stringify(await st()));
      if (!(await until(`__testbed.beamArea.lock.state === 'activated'`, 40000))) throw new Error('光感锁没触发 ' + JSON.stringify(await st()));
      s = await st();
      if (s.refl !== 2) throw new Error('应经两面镜子 ' + JSON.stringify(s));
      if (!(await until(`__testbed.hints.isSolved('test-beam')`, 5000))) throw new Error('锁触发后提示没解开');
      await evaluate(`__testbed.interaction.cancel(); __game.ui.debug.setVisible(true); 1`);
      await until(`__game.input.context === 'explore'`, 5000);
      await until(`(__game.ui.debug.lines.get('光路') ?? '').includes('beam-lock')`, 8000);
      s = await st();
      if (!/光路|反射/.test(s.f4) || !/beam-lock/.test(s.f4)) throw new Error('F4 光路读数不对：' + s.f4);
      out.push(`转对 → 2 次反射命中 beam-lock → 1.5 s 触发、提示解开、F4「${s.f4.slice(0, 40)}…」✓`);
      // O：灯台冷暖
      await cdp.key('KeyO', 'o', 79);
      if (!(await until(`__testbed.beamArea.lamp.color === 'coldWhite'`, 8000))) throw new Error('O 没切到冷白');
      await cdp.key('KeyO', 'o', 79);
      if (!(await until(`__testbed.beamArea.lamp.color === 'warm'`, 8000))) throw new Error('O 没切回暖');
      out.push('O 冷暖切换 ✓');
      // U：开油阀 → 天光常亮 → 点火口 1.0 s 可点灯（015 C 按 E，不自动点燃）→ E → 天光转暖
      if ((await st()).ig === 'activated') throw new Error('没开油阀点火口就触发了');
      await cdp.key('KeyU', 'u', 85);
      if (!(await until(`__testbed.beamArea.oilOpen && __testbed.beamArea.sky.lit`, 8000))) throw new Error('U 没开油阀 / 天光没常亮 ' + JSON.stringify(await evaluate(`({ oil: __testbed.beamArea.oilOpen, sky: __testbed.beamArea.sky.debugLine() })`)));
      if (!(await until(`__testbed.beamArea.igniter.state === 'ready' && __testbed.beamArea.igniteIx.enabled`, 50000))) throw new Error('点火口没进可点灯 ' + JSON.stringify(await st()));
      await sleep(1500);
      if ((await st()).ig !== 'ready') throw new Error('测试场可点灯不应自动点燃（autoIgnite 默认关）');
      await evaluate(`__game.events.emit('interact:used', { id: 'beam-igniter-ignite', kind: 'use' }), 1`);
      if (!(await until(`__testbed.beamArea.igniter.state === 'activated'`, 5000))) throw new Error('按 E 点灯没生效 ' + JSON.stringify(await st()));
      if (!(await until(`__testbed.beamArea.sky.color === 'warm'`, 5000))) throw new Error('点火后天光没转暖');
      out.push('U 开油阀 → 天光常亮 → 1.0 s 可点灯（不自动点）→ E 点灯 → 转暖 ✓');
      const dbg = await evaluate(`!!__testbed.beamArea.renderer.root.getObjectByName('beam-debug') || __testbed.beamArea.renderer.root.children.some((c) => /debug/i.test(c.name))`);
      if (!dbg) throw new Error('?beamDebug=1 没有调试线');
      out.push('beamDebug 调试线 ✓');
      await cdp.goto('');
      return out.join('；');
    },
  },
  {
    name: 'v0.1-013 S1 白盒 + 谜题 1、2：开场涨潮 1.6、礁石小径入口涨潮挡住、敲钟退潮 → 小径尽头解开谜题 1（目标换成过沟）、浮台推进石槽 → 涨潮浮到 1.85（±5 cm）→ 两次跨越到远侧台阶解开谜题 2、不在石槽里涨潮 2 s 漂回、退潮 R 重置浮台、落水送回岸台、交互物齐全；?art=1 美术件加载（岩石 instancing、S3 灯塔熄灭）',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
        }
        return false;
      };
      if ((await evaluate(`__game.scenes.current?.name`)) !== 's1-ebb-shore' || !(await evaluate(`!!window.__s1`))) await cdp.goto('');
      if (!(await until(`!!(window.__s1 && __s1.puzzles) && __game.input.context === 'explore' && !__game.isPaused`, ESTAB_MS))) throw new Error('S1 没就绪');
      // 潮汐 6 s 过渡是游戏时间：高负载下无头软件渲染帧很慢（每帧固定步数封顶）。按游戏时间判超时：
      // 条件 TIDE_GAME_SEC（20 s 游戏时间 > 6 s 过渡 + 漂回）内没满足才算失败；墙钟只做 15 min 兜底（batch14 负载 19 时 art=1 150 s 墙钟只走到一半）
      const TIDE_GAME_SEC = 20;
      const untilTide = async (expr) => {
        const clock = () => evaluate(`__game.time.fixedTick * __game.time.fixedDelta`).catch(() => null);
        const t0 = await clock();
        const end = Date.now() + 900000;
        while (Date.now() < end) {
          if (await evaluate(expr).catch(() => false)) return true;
          const t = await clock();
          if (t !== null && t0 !== null && t - t0 >= TIDE_GAME_SEC) return !!(await evaluate(expr).catch(() => false));
          await sleep(200);
        }
        return false;
      };
      const S = `__s1`;
      const tide = `${S}.puzzles.tide`;
      const tp = (x, y, z, facing) =>
        evaluate(`(() => { const s = ${S}; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); ${facing !== undefined ? `s.rig.controller.facing = ${facing};` : ''} return 1; })()`);
      const ring = async () => {
        await evaluate(`__game.events.emit('interact:used', { id: 'tide-bell-s1', kind: 'use' }); 1`);
        await sleep(200);
      };
      const st = () =>
        evaluate(`(() => { const s = ${S}, p = s.puzzles, b = s.rig.body.position, r = p.raft.object.position; return { tide: p.tide.state, level: +p.tide.level.toFixed(3), tr: p.tide.transitioning, raft: p.raft.state, raftPos: [r.x, r.y, r.z].map((v) => +v.toFixed(2)), inAnchor: p.raft.inAnchor, p1: p.p1Solved, p2: p.p2Solved, pos: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), goal: __game.narrative.goal, busy: s.rig.controller.busy }; })()`);
      let s = await st();
      if (s.tide !== 'high' || Math.abs(s.level - 1.6) > 1e-3) throw new Error('开场应涨潮 1.6 ' + JSON.stringify(s));
      if (Math.hypot(s.pos[0] - 2.277, s.pos[2] + 11.772) > 0.3 || Math.abs(s.pos[1] - 2.2) > 0.1) throw new Error('起点不在码头尽头 ' + JSON.stringify(s));
      const ids = await evaluate(`${S}.interaction.items.map((i) => i.id)`);
      for (const id of ['tide-bell-s1', 'raft-s1', 'stone-slot-s1', 's1-boat', 's1-tide-pillar', 's1-nets-a', 's1-nets-b', 's1-shed', 's1-notice', 's1-neighbor-note'])
        if (!ids.includes(id)) throw new Error('缺交互物 ' + id + '：' + ids.join());
      if (!(await evaluate(`${S}.rig.controller.links.length === 4 && ${S}.exits.length === 1`))) throw new Error('跨越点 / 出口数量不对');
      out.push('开场涨潮 1.6、起点码头尽头、交互物 / 跨越点 / 出口齐 ✓');
      // 013 裁定：检测第 1 轮没测完就跳过开场 → 3 s 不可跳过的 S1 建立镜头（最后一帧最多等 5 s）；测完了跳过就直接交还
      const skipShot = await evaluate(`(() => {
        const s = __s1, b = __game.benchmark, sp = s.spawns.get('start');
        const done = s.establishingAfterSkip(sp, () => true);
        Object.defineProperty(b, 'firstRoundDone', { configurable: true, get: () => false });
        try {
          const t = s.establishingAfterSkip(sp, () => b.firstRoundDone);
          return { realDone: b.constructor.prototype.__lookupGetter__('firstRoundDone').call(b), doneNull: done === null, name: t?.name, skippable: t?.skippable, duration: t?.duration, hold: !!t?.holdUntil, maxHold: t?.maxHold };
        } finally { delete b.firstRoundDone; }
      })()`);
      if (skipShot.name !== 's1-establishing-hold' || skipShot.skippable !== false || skipShot.duration !== 3 || !skipShot.hold || skipShot.maxHold !== 5) throw new Error('S1 跳过后的建立镜头不对 ' + JSON.stringify(skipShot));
      if (skipShot.realDone && !skipShot.doneNull) throw new Error('检测已完成时跳过不该再补镜头');
      out.push('跳过开场 → 3 s 不可跳过建立镜头（等 5 s）✓');

      // 礁石小径入口：涨潮挡住
      const gate = `${S}.physics.colliders.find((c) => c.name === 's1-reef-gate-wall')`;
      if (!(await evaluate(`${gate}.enabled`))) throw new Error('涨潮时礁石小径入口空气墙应启用');
      // 站到钟前：E 提示 + 敲钟
      await tp(-14.45, 2.42, -6.2, -Math.PI / 2);
      if (!(await until(`/E/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 6000))) throw new Error('钟前没有交互提示');
      await ring();
      if (!(await untilTide(`${tide}.state === 'low' && !${tide}.transitioning`))) throw new Error('敲钟没退潮 ' + JSON.stringify(await st()));
      if (await evaluate(`${gate}.enabled`)) throw new Error('退潮后入口空气墙应关闭');
      if (!(await until(`__game.narrative.goal === 'ch1.s1.goal.reef_path'`, 3000))) throw new Error('第一次退潮后目标应换成礁石小径 ' + JSON.stringify(await st()));
      out.push('敲钟 → 退潮、入口打开、目标换成礁石小径 ✓');
      // 台阶顶走下去一点（物理能走）：站在台阶上不被墙挡
      await tp(-9.7, 2.42, -3.0, Math.PI / 2);
      await evaluate(`${S}.cameraFollow.yaw = -Math.PI / 2; 1`); // 相机朝 +X（台阶往下的方向）
      await evaluate(`__game.input.setRaw('smoke', 'KeyW', true); 1`);
      // 013 偶发「停在 x −8.74」根因：原来按真实时间等 8 s；台阶上楼梯步态把水平速度压到 ~0.87 m/s，
      // 走完 1.3 m 要 ~1.4 s 游戏时间（verify-physics 同起点锁住），负载高时每帧最多 5 个固定步，8 s 真实时间不够。
      // 改按游戏时间判定：4 s 游戏时间内到 x > −8.4 才算过；连续 1 s 游戏时间 x 不前进 = 真卡点，带轨迹报错。
      const walkClock = () =>
        evaluate(`(() => { const b = ${S}.rig.body; return { g: __game.time.fixedTick * __game.time.fixedDelta, x: b.position.x, y: b.position.y, on: b.onGround }; })()`);
      const w0 = await walkClock();
      const walkTrace = [];
      let walked = false;
      let wBest = w0.x;
      let wBestG = w0.g;
      const wDeadline = Date.now() + 180000;
      for (;;) {
        const c = await walkClock();
        const g = c.g - w0.g;
        if (!walkTrace.length || g - walkTrace[walkTrace.length - 1].g >= 0.2) walkTrace.push({ g: +g.toFixed(2), x: +c.x.toFixed(2), y: +c.y.toFixed(2), on: c.on });
        if (c.x > -8.4) {
          walked = true;
          out.push(`退潮后走下台阶：${g.toFixed(2)} s 游戏时间到 x ${c.x.toFixed(2)}`);
          break;
        }
        if (c.x > wBest + 0.01) {
          wBest = c.x;
          wBestG = c.g;
        }
        if (g > 4 || c.g - wBestG > 1 || Date.now() > wDeadline) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      await evaluate(`__game.input.setRaw('smoke', 'KeyW', false); 1`);
      if (!walked) throw new Error('退潮后走不下台阶（游戏时间轨迹 ' + JSON.stringify(walkTrace) + '） ' + JSON.stringify(await st()));
      // 小径尽头
      await evaluate(`(() => { window.__s1fp = []; __game.events.on('subtitle:show', (p) => __s1fp.push(p.id)); return 1; })()`);
      await tp(1.8, 0.14, 3.4);
      if (!(await until(`${S}.puzzles.p1Solved && __game.narrative.goal === 'ch1.s1.goal.cross_channel'`, 6000))) throw new Error('小径尽头没解开谜题 1 ' + JSON.stringify(await st()));
      out.push('台阶可走、小径尽头解开谜题 1 → 目标过沟 ✓');
      // 033：「比我的脚印大。」触发区在 T2（4.61, 5.33）r 1.4——小径尽头不弹；走到 T2 才弹（等 1 s 游戏时间再判）
      const fpTick = await evaluate(`__game.time.fixedTick`);
      await until(`__game.time.fixedTick >= ${fpTick} + Math.round(1 / __game.time.fixedDelta)`, 60000);
      if (await evaluate(`__s1fp.includes('ch1.s1.footprints.mono')`)) throw new Error('033：小径尽头不该弹脚印独白 ' + JSON.stringify(await evaluate('__s1fp')));
      await tp(4.61, 0.14, 5.33);
      if (!(await until(`__s1fp.includes('ch1.s1.footprints.mono')`, 60000))) throw new Error('033：走到 T2 没弹「比我的脚印大。」 ' + JSON.stringify({ subs: await evaluate('__s1fp'), st: await st() }));
      out.push('033 脚印独白：小径尽头不弹、T2 弹 ✓');

      // 浮台：不在石槽里涨潮 → 漂回（BUG-010：「它漂回去了。」只在真的被推走又漂回时说、只说一次）
      await evaluate(`(() => { window.__s1subs = []; __game.events.on('subtitle:show', (p) => __s1subs.push(p.id)); return 1; })()`);
      const driftSaid = () => evaluate(`__s1subs.filter((i) => i === 'ch1.s1.raft.drift_back').length`);
      await evaluate(`(() => { const p = ${S}.puzzles; p.raft.object.position.set(5, 0.4, 10.5); p.raft.object.updateMatrixWorld(true); p.raftPush.pushT = 0.4; return 1; })()`);
      await tp(-12.5, 2.42, -4.5);
      await tp(-14.45, 2.42, -6.2, -Math.PI / 2);
      await ring();
      if (!(await untilTide(`${S}.puzzles.raft.state === 'drifting'`))) throw new Error('不在石槽里涨潮应漂回 ' + JSON.stringify(await st()));
      if (!(await untilTide(`${tide}.state === 'high' && !${tide}.transitioning && ${S}.puzzles.raft.state !== 'drifting'`))) throw new Error('漂回没结束 ' + JSON.stringify(await st()));
      s = await st();
      if (Math.hypot(s.raftPos[0] - 9.1, s.raftPos[2] - 10.5) > 0.05) throw new Error('漂回位置不对 ' + JSON.stringify(s));
      if (!(await until(`__s1subs.includes('ch1.s1.raft.drift_back')`, 8000))) throw new Error('漂回后应说「它漂回去了。」 ' + JSON.stringify(await evaluate('__s1subs')));
      // 再来一次漂回（直接发事件模拟）：不应再说
      await evaluate(`(() => { __game.events.emit('float:state', { id: 'raft-s1', state: 'drifting' }); __game.events.emit('float:state', { id: 'raft-s1', state: 'floating' }); return 1; })()`);
      await sleep(3000);
      if ((await driftSaid()) !== 1) throw new Error('「它漂回去了。」应只说一次 ' + JSON.stringify(await evaluate('__s1subs')));
      out.push('不在石槽涨潮 → 漂回原位、「它漂回去了。」只说一次 ✓');

      // 落水送回：涨潮时站到沙地上
      await tp(5, 0.14, 0);
      if (!(await until(`(() => { const b = ${S}.rig.body.position; return Math.hypot(b.x + 12.5, b.z + 4) < 0.3 && Math.abs(b.y - 2.4) < 0.1 && !${S}.rig.controller.busy; })()`, 60000))) throw new Error('落水没送回岸台安全点 ' + JSON.stringify(await st()));
      out.push('落水送回岸台 ✓');

      // 退潮 → 推进石槽（直接把轨道走完）→ R 重置 → 再推进 → 涨潮浮到 1.85
      await tp(-14.45, 2.42, -6.2, -Math.PI / 2);
      await ring();
      if (!(await untilTide(`${tide}.state === 'low' && !${tide}.transitioning`))) throw new Error('第二次退潮失败');
      const toSlot = `(() => { const p = ${S}.puzzles; p.raft.object.position.set(-0.9, 0.4, 10.5); p.raft.object.updateMatrixWorld(true); p.raftPush.pushT = 1; p.raftPush.locked = true; return 1; })()`;
      await evaluate(toSlot);
      // 013 补充：「R 放回浮台」第二行提示——浮台离开原位 + 汐在 3.5 m 内才显示；和交互提示同时出现时排在下面一行
      const p2 = `(document.querySelector('.hud-prompt2:not([hidden])')?.textContent ?? null)`;
      await tp(-0.9, 1.87, 8.15, 0);
      if (!(await until(`${p2} === 'R 放回浮台'`, 4000))) throw new Error('浮台在石槽、汐在 3.5 m 内应显示「R 放回浮台」 ' + JSON.stringify(await st()));
      const lay = await evaluate(`(() => { const h = __game.ui.hud; h.setPrompt('按住 E 推'); const a = document.querySelector('.hud-prompt').getBoundingClientRect(), b = document.querySelector('.hud-prompt2').getBoundingClientRect(); h.setPrompt(null); const c = document.querySelector('.hud-prompt2').getBoundingClientRect(); return { a: a.bottom, b: b.top, alone: Math.abs(c.top - a.top) < 2 }; })()`);
      if (!(lay.b >= lay.a - 1) || !lay.alone) throw new Error('第二行提示布局不对（应在交互提示下面一行；单独出现时占第一行）' + JSON.stringify(lay));
      await tp(3.6, 0.14, 6.5, 0);
      if (!(await until(`${p2} === null`, 4000))) throw new Error('离浮台 3.5 m 外不应显示「R 放回浮台」');
      await tp(-0.9, 1.87, 8.15, 0);
      if (!(await until(`${p2} === 'R 放回浮台'`, 4000))) throw new Error('回到浮台旁提示没再出现');
      await cdp.key('KeyR', 'r', 82);
      if (!(await until(`${S}.puzzles.raft.object.position.x > 9 && ${p2} === null`, 4000))) throw new Error('R 重置后提示应立刻消失 ' + JSON.stringify(await st()));
      if ((await evaluate(`${S}.puzzles.resetRaftPromptVisible(new THREE_V(9.1, 0.4, 9), true)`.replace('THREE_V', `${S}.rig.body.position.constructor`)))) throw new Error('浮台在原位不应显示提示');
      out.push('「R 放回浮台」：石槽 + 3.5 m 内显示、两行布局、3.5 m 外 / 重置后隐藏 ✓');
      await evaluate(toSlot);
      await tp(-12.5, 2.42, -4, Math.PI / 2);
      await sleep(300);
      if ((await evaluate(p2)) !== null) throw new Error('离浮台远时不应显示「R 放回浮台」');
      await cdp.key('KeyR', 'r', 82);
      if (!(await until(`${S}.puzzles.raft.object.position.x > 9 && ${S}.puzzles.raftPush.pushT === 0 && !${S}.puzzles.raftPush.locked`, 4000))) throw new Error('退潮 R 没重置浮台 ' + JSON.stringify(await st()));
      out.push('退潮 R 重置浮台 ✓');
      await evaluate(toSlot);
      await tp(-14.45, 2.42, -6.2, -Math.PI / 2);
      await ring();
      if (!(await untilTide(`${tide}.state === 'high' && !${tide}.transitioning`))) throw new Error('涨潮失败');
      s = await st();
      if (s.raft !== 'floating' || !s.inAnchor || Math.abs(s.raftPos[1] - 1.85) > 0.05) throw new Error('石槽里涨潮应浮到 1.85 ' + JSON.stringify(s));
      out.push(`石槽里浮到 ${s.raftPos[1]} ✓`);

      // 近岸平台 → 浮台 → 远侧台阶（E 跨越）
      const cross = async (x, y, z, facing, label) => {
        await tp(x, y, z, facing);
        if (!(await until(`!!${S}.rig.controller.nearLink`, 6000))) throw new Error(label + '：没有跨越提示 ' + JSON.stringify(await st()));
        // 交互优先级：跨越点（10）压过石槽等 inspect（0），提示必须是「E 跨过去」、E 归跨越（站在浮台上时石槽「E 查看」曾抢 E）
        if (!(await until(`(document.querySelector('.hud-prompt')?.textContent ?? '').includes('跨过去') && ${S}.interaction.current === null`, 3000)))
          throw new Error(label + '：提示不是「E 跨过去」 ' + JSON.stringify(await evaluate(`[document.querySelector('.hud-prompt')?.textContent, ${S}.interaction.current?.id]`)));
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
        await sleep(80);
        await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
        if (!(await until(`${S}.rig.controller.busy`, 4000))) throw new Error(label + '：E 没开始跨越');
        if (!(await until(`!${S}.rig.controller.busy`, 15000))) throw new Error(label + '：跨越没结束');
      };
      // 跨越端点从 layout 算（制作人拍板：起跳离近沿 0.15 m、落点离远沿 0.32 m，路径位移 ×1.14）
      const stepLinks = s1StepLinks();
      // 落点到所在台面最近边沿 ≥ 0.30 m：浮台用实际位置（锚位）+ layout 尺寸，岸台 / 台阶平台用 layout
      const landed = async (surface, label) => {
        const q = await evaluate(`(() => { const b = ${S}.rig.body.position, r = ${S}.puzzles.raft.object.position; return { p: [b.x, b.y, b.z], r: [r.x, r.y, r.z], g: ${S}.rig.body.body.onGround }; })()`);
        const [px, py, pz] = q.p;
        const [rw, , rd] = S1.raft.size;
        const rect = {
          raft: [q.r[0] - rw / 2, q.r[0] + rw / 2, q.r[2] - rd / 2, q.r[2] + rd / 2],
          shore: [S1.nearPlatform.min[0], S1.nearPlatform.max[0], S1.nearPlatform.min[1], S1.nearPlatform.max[1]],
          steps: [S1.farSteps.x[0], S1.farSteps.x[1], S1.farSteps.z0, S1.farSteps.z0 + S1.farSteps.landing],
        }[surface];
        const d = Math.min(px - rect[0], rect[1] - px, pz - rect[2], rect[3] - pz);
        if (!(d >= 0.3) || Math.abs(py - 1.85) > 0.1 || !q.g) throw new Error(`${label}：落点离边沿 ${d.toFixed(3)} m（< 0.30）/ 没站稳 ` + JSON.stringify(q));
        return `${label} 落点 z ${pz.toFixed(2)} 离沿 ${d.toFixed(2)}`;
      };
      const marks = [];
      await cross(-0.9, 1.87, stepLinks[0].start - 0.15, 0, '近岸平台 → 浮台');
      s = await st();
      if (Math.abs(s.pos[2] - stepLinks[0].end) > 0.15 || Math.abs(s.pos[1] - 1.85) > 0.1) throw new Error('没站到浮台上 ' + JSON.stringify(s));
      marks.push(await landed('raft', '岸→浮台'));
      await sleep(500);
      s = await st();
      if (Math.abs(s.pos[1] - 1.85) > 0.1 || s.tide !== 'high') throw new Error('站在浮台上不稳 / 被送回 ' + JSON.stringify(s));
      await cross(-0.9, 1.87, stepLinks[2].start - 0.25, 0, '浮台 → 远侧台阶');
      marks.push(await landed('steps', '浮台→台阶'));
      if (!(await until(`${S}.puzzles.p2Solved`, 6000))) throw new Error('到远侧台阶没解开谜题 2 ' + JSON.stringify(await st()));
      out.push('两次跨越 → 远侧台阶解开谜题 2 ✓');
      // 回程：台阶 → 浮台 → 岸台（站在上一次落点上直接按 E，选中的必须是回程那条）
      await cross(-0.9, 1.87, stepLinks[2].end, Math.PI, '远侧台阶 → 浮台');
      marks.push(await landed('raft', '台阶→浮台'));
      await cross(-0.9, 1.87, stepLinks[1].start, Math.PI, '浮台 → 近岸平台');
      marks.push(await landed('shore', '浮台→岸'));
      out.push(`四条跨越落点离边沿 ≥ 0.30 m ✓（${marks.join('；')}）`);
      // 013 补充（制作人裁定）：谜题 2 解开后 R 不再生效、提示不再显示——即使把潮汐 / 浮台条件都伪造成满足
      const after = await evaluate(`(() => { const p = ${S}.puzzles, t = p.tide, r = p.raft;
        const ts = t.state, rs = r.state; t.state = 'low'; r.state = 'grounded'; Object.defineProperty(t, 'transitioning', { configurable: true, get: () => false });
        try { const near = r.object.position.clone(); return { can: p.canResetRaft, moved: p.raftMoved, show: p.resetRaftPromptVisible(near, true), reset: p.resetRaft(), x: +r.object.position.x.toFixed(2) }; }
        finally { t.state = ts; r.state = rs; delete t.transitioning; } })()`);
      if (after.can || after.show || after.reset || !after.moved || Math.abs(after.x + 0.9) > 0.05) throw new Error('谜题 2 解开后 R / 提示应禁用 ' + JSON.stringify(after));
      await sleep(300);
      if ((await evaluate(`(document.querySelector('.hud-prompt2:not([hidden])')?.textContent ?? null)`)) !== null) throw new Error('谜题 2 解开后不应显示「R 放回浮台」');
      out.push('谜题 2 解开后 R 失效、提示不显示 ✓');
      const hs = await evaluate(`(() => { const h = ${S}.hints; return ['s1-p1-reef', 's1-p2-raft'].map((id) => h.isSolved ? h.isSolved(id) : null); })()`);
      if (hs.some((v) => v === false)) throw new Error('提示系统没记解开 ' + JSON.stringify(hs));
      // ?art=1：S1 美术件
      await cdp.goto('art=1');
      if (!(await until(`!!window.__s1?.art`, 30000))) throw new Error('art=1 没进 S1');
      const art = await evaluate(`(() => { const a = __s1.art; let lit = 0; a.tower?.traverse((o) => { const m = o.material; for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x.emissive && x.emissive.getHex() !== 0 && x.emissiveIntensity > 0) lit++; }); let warm = 0; __s1.scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) warm++; }); return { loaded: a.loaded, rocks: a.rocks.reduce((n, r) => n + r.placements.length, 0), tower: !!a.tower, island: !!a.island, lit, warm, greybox: __s1.greybox.root.visible }; })()`);
      if (!art.loaded || !art.tower || !art.island || art.rocks < 100) throw new Error('S1 美术件没加载全 ' + JSON.stringify(art));
      // BUG-012：GLB / 外部 KTX2 全部加载成功（被浏览器取消的已重试），没有占位降级
      const ls = await evaluate(`(() => { const s = __game.assets.loadStats; return { n: s.length, ktx2: s.filter((x) => x.kind === 'ktx2').length, pending: s.filter((x) => !x.done).length, bad: s.filter((x) => (x.done && !x.ok) || x.fallback), retried: s.filter((x) => x.attempts > 1).map((x) => x.url.split('/').pop() + '×' + x.attempts), degraded: document.documentElement.classList.contains('assets-fallback') }; })()`);
      if (ls.bad.length || ls.degraded || ls.ktx2 < 1) throw new Error('S1 art=1 有加载失败 / 占位 ' + JSON.stringify(ls));
      if (art.lit || art.warm) throw new Error('点灯前远景灯塔应熄灭、无环境暖光 ' + JSON.stringify(art));
      // 033 脚印贴花：4 块 T1–T4 挂在 json 坐标（沙面高度，不打射线）、roughness 0.65；美术模式下白盒脚印暗斑 s1-footprint-* 全部隐藏
      const fp = await evaluate(`(() => { const d = __s1.dressing; const vis = (o) => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
        const gb = __s1.greybox.decor.filter((o) => /^s1-footprint-/.test(o.name));
        return { n: d.decals.length, tiles: d.decals.map((m) => ({ name: m.name, p: m.position.toArray().map((v) => +v.toFixed(3)), yaw: +m.rotation.y.toFixed(4), vis: vis(m), map: !!m.material.map, rough: m.material.roughness })), gb: gb.length, gbVisible: gb.filter(vis).map((o) => o.name) }; })()`);
      const FP_REF = [[2.914, 0.119, 4.272, 0.9482], [4.608, 0.116, 5.331, 1.0499], [6.304, 0.114, 6.389, 0.9619], [7.882, 0.112, 7.615, 0.8414]];
      if (fp.n !== 4 || fp.tiles.some((t, i) => !t.vis || !t.map || t.rough !== 0.65 || t.name !== 's1-footprints-decal-T' + (i + 1) || t.p.some((v, k) => Math.abs(v - FP_REF[i][k]) > 1e-3) || Math.abs(t.yaw - FP_REF[i][3]) > 1e-4)) throw new Error('033 脚印贴花不对 ' + JSON.stringify(fp));
      if (fp.gb < 10 || fp.gbVisible.length) throw new Error('art=1 下白盒脚印暗斑应全部隐藏 ' + JSON.stringify(fp));
      out.push(`033 脚印贴花 4 块 T1–T4 在湿沙上（y ${fp.tiles.map((t) => t.p[1]).join(' / ')}，roughness 0.65）、白盒脚印暗斑 ${fp.gb} 块全隐藏 ✓`);
      // 美术 1030 船绳两版：涨潮 -rope-high 可见 / 退潮 -rope-low 可见（low 默认隐藏写在 extras.defaultVisible），船头端 = 船头环
      const ropeAt = async (st) => {
        await evaluate(`(() => { __s1.puzzles.tide.set('${st}', { instant: true }); window.__rt = __s1.game.time.fixedTick; return 1; })()`);
        await until(`__s1.game.time.fixedTick >= window.__rt + 3`, 5000);
        return evaluate(`(() => { const r = __s1.art.root, V = r.position.constructor; const g = (n) => r.getObjectByName(n); const wp = (o) => o ? o.getWorldPosition(new V()).toArray().map((v) => +v.toFixed(3)) : null; const ring = __s1.art.boat?.getObjectByName('prop-boat-rowboat-bow-ring');
          return { sw: !!__s1.art.rope, state: __s1.art.rope?.state ?? null, level: __s1.puzzles.tide.level, hi: g('env-pier-wood-ch1-rope-high')?.visible ?? null, lo: g('env-pier-wood-ch1-rope-low')?.visible ?? null, end: wp(g('${st === 'high' ? 'env-pier-wood-ch1-rope-bow-end-high' : 'env-pier-wood-ch1-rope-bow-end-low'}')), ring: wp(ring), boatY: +(__s1.art.boat?.position.y ?? NaN).toFixed(3) }; })()`);
      };
      const dist = (a, b) => (a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : Infinity);
      const rh = await ropeAt('high');
      if (!rh.sw || rh.state !== 'high' || rh.hi !== true || rh.lo !== false) throw new Error('涨潮应只显示 -rope-high ' + JSON.stringify(rh));
      if (dist(rh.end, [4.072, 1.98, -10.95]) > 0.01 || dist(rh.end, rh.ring) > 0.01) throw new Error('涨潮船头端不对 ' + JSON.stringify(rh));
      const rl = await ropeAt('low');
      if (rl.state !== 'low' || rl.hi !== false || rl.lo !== true) throw new Error('退潮应只显示 -rope-low ' + JSON.stringify(rl));
      if (Math.abs(rl.boatY + 0.24) > 0.005 || dist(rl.end, [4.072, 0.38, -10.95]) > 0.01 || dist(rl.end, rl.ring) > 0.01) throw new Error('退潮船头端 / 船高不对 ' + JSON.stringify(rl));
      await ropeAt('high');
      out.push(`船绳两版：涨潮 high 可见、船头端 ${rh.end.join(', ')} = 船头环；退潮 low 可见、船 y ${rl.boatY}、船头端 ${rl.end.join(', ')} = 船头环 ✓`);
      out.push(`art=1 美术件（岩石 ${art.rocks} 实例、主岛 + 灯塔熄灭）✓；GLB / KTX2 ${ls.n} 个（已完成 ${ls.n - ls.pending}，预加载中 ${ls.pending}）无失败、无占位（重试过：${ls.retried.join(", ") || "无"}）✓`);
      await cdp.goto('');
      return out.join('，');
    },
  },
  {
    name: 'v0.1-014 S2 白盒：?scene=s2 入口 / 海面 −16 / 室内触发体 / 出口、无环境暖光、远景 S3 灯塔（白盒高柱占位）；?art=1 美术 019 七件 + 远景岛塔（天空层材质、熄灭）+ 地窖门扇挂合页',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      const probe = `(() => { const s = __s2; let warm = 0, glow = 0; s.scene.traverse((o) => {
          // 风灯（汐带着）和它透到窗口的暖光不算环境暖光
          for (let a = o; a; a = a.parent) if (a.userData?.warmLight) return;
          if ((o.isPointLight || o.isSpotLight || o.isRectAreaLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) warm++;
          if (o.isMesh && o.visible) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) glow++; });
        const far = s.scene.getObjectByName('s2-far-s3') ?? s.scene.getObjectByName('s2-far-s3-placeholder');
        return { name: s.name, entry: s.entryId, pos: s.rig.body.position.toArray().map((v) => +v.toFixed(2)), water: s.water?.position.y, indoor: s.cameraFollow.indoorVolumes.length,
          exit: s.exits[0]?.opts.center.toArray(), target: s.exits[0]?.opts.target, warm, glow, far: far?.name, farSky: !!far?.userData.skyLayer,
          art: s.art.loaded, keys: s.art.root.children.map((c) => c.name), door: !!s.art.cellarDoor && s.art.cellarDoor.parent === s.greybox.cellarDoor, gb: s.greybox.colliders[0].visible }; })()`;
      await cdp.goto('debug=1&scene=s2', 's2-keeper-house');
      if (!(await until(`!!window.__s2?.rig`, 30000))) throw new Error('?scene=s2 没进 S2');
      let s = await evaluate(probe);
      if (s.entry !== 'from-s1' || Math.abs(s.pos[0]) > 0.3 || Math.abs(s.pos[2] + 12.5) > 0.3 || Math.abs(s.pos[1]) > 0.1) throw new Error('S2 入口不对 ' + JSON.stringify(s));
      if (s.water !== -16 || s.indoor !== 2 || s.target !== 's3' || JSON.stringify(s.exit) !== '[5,0,23]') throw new Error('S2 海面 / 室内 / 出口不对 ' + JSON.stringify(s));
      if (s.warm || s.glow) throw new Error('S2 环境不应有暖光 / 自发光（暖光只属于风灯）' + JSON.stringify(s));
      // SMOKE_QUERY=art=1 时页面地址里全局 art=1 在前（URLSearchParams 取第一个），这一段实际也是美术版：远景 / 白盒显示的断言留给下面 art=1 段
      const globalArt = /(^|&)art=1/.test(process.env.SMOKE_QUERY ?? '');
      if (!globalArt && (s.far !== 's2-far-s3-placeholder' || !s.farSky || !s.gb)) throw new Error('白盒 S2 远景占位 / 白盒显示不对 ' + JSON.stringify(s));
      out.push(`白盒：入口 (0, 0, −12.5)、海面 −16、室内触发体 ×2、出口 → s3、无暖光、${globalArt ? '（全局 art=1，远景占位不测）' : '远景占位'} ✓`);
      await cdp.goto('debug=1&scene=s2&art=1', 's2-keeper-house');
      if (!(await until(`!!window.__s2?.rig`, 60000))) throw new Error('art=1 没进 S2');
      s = await evaluate(probe);
      const want = ['env-clifftop-s2', 'env-keeper-house-ch1', 'env-keeper-house-ch1-interior', 'env-cellar-s2', 'env-courtyard-wall-s2', 'env-laundry-rack', 's2-far-s3'];
      if (!s.art || want.some((k) => !s.keys.includes(k)) || !s.door) throw new Error('S2 美术件没加载全 ' + JSON.stringify(s));
      if (s.far !== 's2-far-s3' || !s.farSky || s.gb) throw new Error('S2 远景 / 白盒隐藏不对 ' + JSON.stringify(s));
      if (s.warm || s.glow) throw new Error('S2 美术接入后不应有环境暖光 / 自发光 ' + JSON.stringify(s));
      out.push('art=1：019 七件 + 地窖门扇挂合页、远景岛塔天空层熄灭、白盒隐藏、无暖光 ✓');
      // 1030b 立镜 ×2：挂院墙 socket；初始 / 正解两态美术镜面（位置 + 法线）与 mirror-pivot 世界旋转 = 白盒
      const ms = await evaluate(`(() => {
        const s = __s2; const V = s.rig.body.position.constructor; const Q = s.scene.quaternion.constructor; const beam = s.puzzles.beam; const ms = s.artSlots?.mounted ?? []; const r = {};
        const n = (o) => new V(0, 0, 1).transformDirection(o.matrixWorld);
        const find = (root, suf) => { let f = null; root.traverse((o) => { if (!f && (o.name === suf || o.name.endsWith('-' + suf))) f = o; }); return f; };
        for (const k of ['a', 'b']) {
          const m = ms.find((x) => x.id === 'prop-mirror-stand-s2-' + k);
          if (!m) { r[k] = null; continue; }
          const rig = k === 'a' ? beam.mirrorA : beam.mirrorB; const plane = find(m.model, 'mirror-plane'); const pivot = find(m.model, 'mirror-pivot');
          const gp = find(rig.root, 'mirror-plane'); const gy = find(rig.root, 'yaw'); const st = [];
          for (const solved of [false, true]) {
            if (solved) beam.solve(); else { beam.mirrorA.part.setAngle(0, 0); beam.mirrorB.part.setAngle(0, 0); }
            s.artSlots.update(); s.scene.updateMatrixWorld(true);
            st.push({ deg: (n(plane).angleTo(n(gp)) * 180) / Math.PI, q: (pivot.getWorldQuaternion(new Q()).angleTo(gy.getWorldQuaternion(new Q())) * 180) / Math.PI, d: plane.getWorldPosition(new V()).distanceTo(gp.getWorldPosition(new V())) });
          }
          beam.mirrorA.part.setAngle(0, 0); beam.mirrorB.part.setAngle(0, 0); s.artSlots.update();
          r[k] = { st, missing: m.missingNodes, parent: m.model.parent?.name };
        }
        return r;
      })()`);
      for (const k of ['a', 'b']) {
        const g = ms[k];
        if (!g) throw new Error(`art=1 立镜 ${k} 没挂上 ` + JSON.stringify(ms));
        if (g.missing.length || g.parent !== `env-courtyard-wall-s2-mirror-${k}-socket` || g.st.some((x) => x.deg > 0.05 || x.q > 0.05 || x.d > 0.005)) throw new Error(`art=1 立镜 ${k} 不对 ` + JSON.stringify(g));
      }
      out.push('art=1 立镜 a / b 挂院墙 socket、初始 / 正解镜面与 pivot = 白盒 ✓');
      // 1030b 拨盘铁门：挂崖顶 gate-socket；站位 = 美术 -interact；拨盘转到 317 美术 dial rotation.z = −36k°；门扇跟白盒开到生效开角（美术 extras.openDeg 优先，应为 78°）
      const gt = await evaluate(`(() => {
        const s = __s2; const V = s.scene.position.constructor; const Q = s.scene.quaternion.constructor; const E = s.scene.rotation.constructor;
        const m = (s.artSlots?.mounted ?? []).find((x) => x.id === 'prop-dial-gate-s2');
        if (!m) return null;
        const find = (root, suf) => { let f = null; root.traverse((o) => { if (!f && (o.name === suf || o.name.endsWith('-' + suf))) f = o; }); return f; };
        s.scene.updateMatrixWorld(true);
        const ip = s.puzzles.gateInteractable.interactPoint.getWorldPosition(new V()); const ap = find(m.model, 'interact').getWorldPosition(new V());
        const code = [3, 1, 7]; const dz = [];
        s.puzzles.dials.forEach((p, i) => p.setAngle(0, 36 * code[i]));
        s.artSlots.update();
        ['dial-0', 'dial-1', 'dial-2'].forEach((n, i) => { const d = find(m.model, n); dz.push((d.quaternion.angleTo(new Q().setFromEuler(new E(0, 0, (-36 * code[i] * Math.PI) / 180))) * 180) / Math.PI); });
        s.puzzles.dials.forEach((p) => p.setAngle(0, 0));
        const g = s.greybox.dialGate; const open = (s.puzzles.gateOpenAngle * 180) / Math.PI; // 生效开角 = 美术 gate-door extras.openDeg（78）
        g.rotation.y = (open * Math.PI) / 180; s.artSlots.update(); s.scene.updateMatrixWorld(true);
        const door = find(m.model, 'gate-door'); const yaw = (new E().setFromQuaternion(door.getWorldQuaternion(new Q()), 'YXZ').y * 180) / Math.PI;
        g.rotation.y = 0; s.artSlots.update();
        return { parent: m.model.parent?.name, missing: m.missingNodes, stand: ip.distanceTo(ap), standZ: ip.z, dz, yaw, gbOpen: (s.puzzles.state.gateOpen) };
      })()`);
      if (!gt) throw new Error('art=1 拨盘铁门 prop-dial-gate-s2 没挂上');
      if (gt.parent !== 'env-clifftop-s2-gate-socket' || gt.missing.length || gt.stand > 0.01 || gt.dz.some((x) => x > 0.05) || Math.abs(gt.yaw - 78) > 0.05 || gt.gbOpen) throw new Error('art=1 拨盘铁门不对 ' + JSON.stringify(gt));
      out.push(`art=1 拨盘铁门挂 gate-socket、站位读 -interact（差 ${(gt.stand * 1000).toFixed(1)} mm）、317 拨盘 rotation.z = −36k°、门扇开 ${gt.yaw.toFixed(1)}° ✓`);
      // 无头浏览器负载高时只有 1~2 fps：按游戏时间 / 帧数等（同 part2），真实时间 3 分钟兜底
      const gsleep = async (ms, frames = 3) => {
        const clock = () => evaluate(`({ e: __game.time.fixedTick * __game.time.fixedDelta, f: __game.time.frame, z: __game.isFrozen || __game.isPaused })`);
        const c0 = await clock();
        const end = Date.now() + 180000;
        while (Date.now() < end) {
          await sleep(50);
          const c = await clock();
          if (c.f - c0.f >= frames && (c.e - c0.e >= ms / 1000 || c.z)) return;
        }
      };
      // 白石组交付 + 裁定 15 / 16：GLB 挂崖顶 → 七段贴片关；眼位 / FOV 读 viewpoint 节点；对准字组中心（lookAt 下方 3.7°）→ 只有数字石块冷白加亮
      const wsInfo = await evaluate(`(() => { const s = __s2, m = (s.artSlots?.mounted ?? []).find((x) => x.id === 'prop-white-stones-s2'); const a = s.puzzles.whiteStonesAim();
        return m ? { parent: m.model.parent?.name, active: s.puzzles.whiteStonesArtActive, eye: a?.eye.toArray(), fov: a?.fov, target: a?.target.toArray() } : null; })()`);
      if (!wsInfo || wsInfo.parent !== 'env-clifftop-s2' || !wsInfo.active || !wsInfo.eye || Math.hypot(wsInfo.eye[0] - 0.95, wsInfo.eye[1] - 4.35, wsInfo.eye[2] - 1.0) > 0.005 || wsInfo.fov !== 30) throw new Error('art=1 白石组挂载 / 眼位不对 ' + JSON.stringify(wsInfo));
      // 建立镜头可能还没开始 / 刚结束会把角色放回入口：反复送到观察点，直到站稳在观察点上且是探索相机
      {
        const end = Date.now() + 120000;
        let ok = false;
        while (!ok && Date.now() < end) {
          await evaluate(`(() => { const s = __s2; if (s.game.input.context === 'explore' && s.cameraFollow.modeName === 'explore') s.rig.body.teleport(new s.rig.body.body.position.constructor(0.95, 3.05, 1.0)); 1 })()`);
          await gsleep(500);
          ok = await evaluate(`(() => { const s = __s2, p = s.rig.body.position; s.puzzles.viewpoint.evaluate(); return s.game.input.context === 'explore' && s.cameraFollow.modeName === 'explore' && !s.cameraFollow.blending && s.puzzles.viewpoint.inRegion && p.y > 2.5; })()`);
        }
        if (!ok) throw new Error('art=1 送不到观察点 ' + JSON.stringify(await evaluate(`({ p: __s2.rig.body.position.toArray(), ctx: __s2.game.input.context, mode: __s2.cameraFollow.modeName })`)));
      }
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', true); 1`);
      await gsleep(700);
      const wsAim = async (tx, ty, tz) => {
        for (let i = 0; i < 4; i++) {
          await evaluate(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(${tx}, ${ty}, ${tz}).sub(p).normalize();
            s.cameraFollow.yaw = Math.atan2(-t.x, -t.z); s.cameraFollow.pitch = Math.asin(t.y); 1 })()`);
          await gsleep(250);
        }
      };
      const wsSt = () => evaluate(`(() => { const s = __s2, c = s.camera, m = s.scene.getObjectByName('white-stone-d7-b'), dec = s.scene.getObjectByName('white-stone-decor-00');
        return { eye: c.getWorldPosition(c.position.clone()).distanceTo(c.position.clone().set(${wsInfo.eye.join(',')})), fov: c.fov, align: s.puzzles.viewpoint.alignment, digits: s.puzzles.digits.visible,
          glow: m.material.emissiveIntensity, glowHex: m.material.emissive.getHex(), decor: dec.material.emissive.getHex() === 0 ? 0 : dec.material.emissiveIntensity, xi: s.rig.visual.visible,
          mode: s.cameraFollow.modeName, ctx: s.game.input.context, obs: s.cameraFollow.observing, inRegion: s.puzzles.viewpoint.inRegion,
          down: s.game.input.isDown('observe'), enabled: s.game.input.enabled, frozen: !!(__game.isFrozen || __game.isPaused), blending: s.cameraFollow.blending, eyeActive: s.cameraFollow.eyeActive, hasEye: !!s.cameraFollow.observeEye, same: s.game === __game }; })()`);
      let w = await wsSt();
      if (w.eye > 0.01 || Math.abs(w.fov - 30) > 0.01 || w.align > 0 || w.digits || w.xi) throw new Error('art=1 进入眼位：位置 / FOV / 不直接对准 / 角色隐藏 ' + JSON.stringify(w));
      // 对准旧 lookAt 点（偏 3.7°）仍在容差内；对准字组中心 → 完全加亮
      await wsAim(...wsInfo.target);
      await gsleep(300);
      w = await wsSt();
      if (w.align < 0.99 || w.digits || Math.abs(w.glow - 0.35) > 0.01 || w.glowHex !== 0xf2eee4 || w.decor > 0) throw new Error('art=1 对准字组中心：贴片关、数字石块冷白 0.35、装饰石不亮 ' + JSON.stringify(w));
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', false); 1`);
      await gsleep(900);
      w = await wsSt();
      if (Math.abs(w.fov - 55) > 3.5 || !w.xi || w.glow > 0) throw new Error('art=1 松开回第三人称、加亮归零 ' + JSON.stringify(w));
      out.push(`art=1 白石组挂崖顶、七段贴片关、眼位 / FOV 30 读 viewpoint 节点、对准字组中心数字石块加亮 ${w.glow === 0 ? '→ 松开归零' : ''} ✓`);
      // 1030c 光感锁：挂小屋 socket；透镜 #F4C978 × 进度 × 1.6、指针 (60 − 120p)°；解锁后门闩 0.3 s 滑 +0.08；白盒透镜隐藏
      const ll0 = await evaluate(`(() => { const s = __s2, la = s.lightLockArt, m = (s.artSlots?.mounted ?? []).find((x) => x.id === 'prop-light-lock-s2');
        return la && m ? { parent: m.model.parent?.name, k: la.material.emissiveIntensity, hex: la.material.emissive.getHex(), needle: la.needle.rotation.z * 180 / Math.PI, lens: s.puzzles.beam.lockLens.visible, open: s.puzzles.state.lockOpen } : null; })()`);
      if (!ll0 || ll0.parent !== 'env-keeper-house-ch1-light-lock-socket' || ll0.k !== 0 || Math.abs(ll0.needle - 60) > 0.01 || ll0.lens !== false || ll0.open) throw new Error('art=1 光感锁初始不对 ' + JSON.stringify(ll0));
      await evaluate(`(() => { const s = __s2; s.puzzles.beam.lamps.east.emitter.setOn(true, true); s.puzzles.beam.solve(); for (let i = 0; i < 80; i++) s.puzzles.fixedUpdate(0.05); return 1; })()`);
      await gsleep(600);
      const ll1 = await evaluate(`(() => { const s = __s2, la = s.lightLockArt; return { k: la.material.emissiveIntensity, hex: la.material.emissive.getHex(), needle: la.needle.rotation.z * 180 / Math.PI, bolt: la.boltOpen, open: s.puzzles.state.lockOpen }; })()`);
      if (!ll1.open || Math.abs(ll1.k - 1.6) > 1e-6 || ll1.hex !== 0xf4c978 || Math.abs(ll1.needle + 60) > 0.01 || ll1.bolt !== 1) throw new Error('art=1 光感锁解锁后外观不对 ' + JSON.stringify(ll1));
      out.push('art=1 光感锁挂 light-lock-socket、透镜 #F4C978 0 → 1.6、指针 60° → −60°、解锁门闩滑开、白盒透镜隐藏 ✓');
      // 进 S2 会存档 s2，autostart 会接着存档进 S2：清掉存档再回 S1（后面的检查默认在 S1）
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      try { await cdp.goto(''); } catch (e) { throw new Error('回 S1 失败：' + e.message + ' ' + JSON.stringify(await evaluate(`({ scene: __game?.scenes?.current?.name, href: location.href, menu: __game?.ui?.mainMenu?.isOpen, err: window.__lastError ?? null })`).catch((x) => String(x))), { cause: e }); }
      return out.join('，');
    },
  },
  {
    name: 'v0.1-014 part2 S2 谜题：风灯放书桌 → 窗口暖光 → 西灯台被挡 → 东灯台 + 转镜（R 重置）→ 光感锁 → 地窖门 → 钥匙 / 草图 → 观察点 317 → 拨盘铁门',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      // 盒子负载高时无头浏览器可能只有 1~2 fps（游戏单帧最多走 5 个固定步长）：等待一律按游戏时间 / 帧数算，真实时间只做 3 分钟兜底
      const clock = () => evaluate(`({ e: __game.time.fixedTick * __game.time.fixedDelta, f: __game.time.frame, z: __game.isFrozen || __game.isPaused })`);
      const gsleep = async (ms, frames = 2) => {
        const c0 = await clock();
        const end = Date.now() + 180000;
        while (Date.now() < end) {
          await sleep(50);
          const c = await clock();
          if (c.f - c0.f >= frames && (c.e - c0.e >= ms / 1000 || c.z)) return;
        }
      };
      const until = async (expr, ms = 8000) => {
        const c0 = await clock();
        const end = Date.now() + 180000;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
          const c = await clock();
          if (c.e - c0.e > ms / 1000 && c.f - c0.f > 3) return await evaluate(expr);
        }
        return v;
      };
      const key = async (code, ms = 120) => {
        // 只按住 1 帧：低帧率下按 120 ms 游戏时间会跨好几帧，旋钮按住连发会多转一格
        await evaluate(`__game.input.setRaw('smoke', '${code}', true); 1`);
        await gsleep(0, 1);
        await evaluate(`__game.input.setRaw('smoke', '${code}', false); 1`);
        await gsleep(ms);
      };
      const tp = (x, y, z) => evaluate(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.body.position.constructor(${x}, ${y}, ${z})); 1 })()`);
      const trig = (id) => evaluate(`(() => { const s = __s2; const it = s.interaction.get('${id}'); if (!it) return 'no ' + '${id}'; s.interaction.trigger(it); return 'ok'; })()`);
      const st = () => evaluate(`(() => { const s = __s2, p = s.puzzles, b = p.beam; const h = s.interaction.held;
        return { ...p.state, holding: h.current?.id ?? null, sockets: [...h.sockets.entries()], goal: __game.narrative.goal, reader: __game.ui.reader.isOpen, ctx: __game.input.context,
          glow: p.windowGlow.visible, A: b.mirrorA.part.angles[0], B: b.mirrorB.part.angles[0], lock: b.lock.state,
          paths: b.tracer.paths.map((q) => ({ id: q.emitter.id, lit: q.emitter.lit, end: q.end, mirrors: q.mirrors, rx: q.receiver?.id ?? null, z: +q.endPoint.z.toFixed(2) })),
          doorCol: s.colliderOf.get(s.greybox.cellarDoorLeaf).enabled, gateCol: s.colliderOf.get(s.greybox.dialGateLeaf).enabled,
          align: p.viewpoint.alignment, digits: p.digits.visible || (p.whiteStonesArtActive && (s.scene.getObjectByName('white-stone-d7-b')?.material.emissiveIntensity ?? 0) > 0.3), dials: p.dials.map((d) => d.angles[0]), pos: s.rig.body.position.toArray().map((v) => +v.toFixed(2)) }; })()`);
      // BUG-017：交互后等动作播完（art=1 要播 xi-pickup-table / xi-place-* 到 grab 帧才算拿到 / 放下），不固定等时间
      const idle = `!__s2.rig.controller.busy && !__s2.interaction.animState`;
      const trigDone = async (id, expr, what, ms = 8000) => {
        if ((await trig(id)) !== 'ok') throw new Error('没有 ' + id);
        await gsleep(0, 2);
        if (!(await until(`(${expr}) && ${idle}`, ms))) throw new Error(what + '（等动作播完）' + JSON.stringify(await st()));
      };
      /** 传送到交互件的站位（standPoint，跟模型 / 交互点走）并朝向它 */
      const tpStand = (id) => evaluate(`(() => { const s = __s2; const st = s.interaction.get('${id}').standPoint(new s.rig.body.position.constructor()); const p = st.position;
        s.rig.body.teleport(p.clone().setY(p.y + 0.05)); s.rig.controller.facing = st.facing; return p.toArray().map((v) => +v.toFixed(2)); })()`);
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      await cdp.goto('debug=1&scene=s2&art=0', 's2-keeper-house');
      if (!(await until(`!!window.__s2?.puzzles`, 30000))) throw new Error('?scene=s2 没进 S2');
      if (!(await until(`__game.input.context === 'explore' && !__s2.rig.controller.busy`, ESTAB_MS))) throw new Error('建立镜头后没回到 explore');
      let s = await st();
      if (s.holding !== 'lantern' || s.glow || s.goal !== 'ch1.s2.goal.home') throw new Error('进 S2 应拿着风灯、窗口不亮、目标 home ' + JSON.stringify(s));

      // ---- BUG-014：书桌站位（deskInteract，朝 −X）默认视角下 E 选日志 / 风灯，不选墙上海图；抬头看海图、低头看纸条仍能选中
      const deskView = async (dyaw, pitch) => {
        await evaluate(`(() => { const s = __s2; const st = s.interaction.get('journal-s2').standPoint(new s.rig.body.position.constructor()); const p = st.position; s.rig.body.teleport(p.clone().setY(p.y + 0.02)); s.rig.controller.facing = st.facing; s.cameraFollow.yaw = st.facing + Math.PI + ${dyaw}; s.cameraFollow.pitch = ${pitch}; return 1; })()`);
        await gsleep(1000, 6);
        return evaluate(`(() => { const s = __s2, I = s.interaction, V = s.rig.body.position.constructor; const ndc = (id) => { const it = I.get(id); const n = it.focus(new V()).project(s.camera); return +Math.hypot(n.x, n.y).toFixed(2); };
          return { cur: I.current?.id ?? null, chart: ndc('chart-s2'), note: ndc('xi-note-s2'), journal: ndc('journal-s2'), lantern: ndc('lantern-s2') }; })()`);
      };
      const DEF_PITCH = await evaluate(`__s2.cameraFollow.pitch`);
      const aimAt = async (id, views) => {
        const seen = [];
        for (const [dy, p] of views) {
          const v = await deskView(dy, p);
          seen.push([dy, p, v.cur, v[id === 'chart-s2' ? 'chart' : 'note']]);
          if (v.cur === id) return seen;
        }
        throw new Error(`朝 ${id} 看时选不中 ` + JSON.stringify(seen));
      };
      let dv = await deskView(0, DEF_PITCH);
      if (dv.cur !== 'journal-s2') throw new Error('书桌站位默认视角应选中日志（不是海图 / 纸条）' + JSON.stringify(dv));
      const chartSeen = await aimAt('chart-s2', [[0, 0.15], [0.3, 0.15], [0.3, 0], [0, 0.3], [0.4, 0.2]]);
      const noteSeen = await aimAt('xi-note-s2', [[0, -0.3], [0.3, -0.3], [0.3, -0.45], [0, -0.45]]);
      out.push(`BUG-014 书桌站位：默认视角（俯仰 ${(+DEF_PITCH).toFixed(2)}）选日志（海图 NDC ${dv.chart} 让位）✓，抬头选海图（${chartSeen.at(-1).slice(0, 2).join('/')}，NDC ${chartSeen.at(-1)[3]}）✓，低头选纸条（${noteSeen.at(-1).slice(0, 2).join('/')}，NDC ${noteSeen.at(-1)[3]}）✓`);

      // ---- 读日志：汐走到书桌站位 → xi-place-table（占位 1 s）→ 风灯上书桌 → 打开日志
      await tp(-3.9, 3.05, -0.25);
      await gsleep(300);
      if ((await trig('journal-s2')) !== 'ok') throw new Error('没有 journal-s2');
      if (!(await until(`__game.ui.reader.isOpen`, 5000))) throw new Error('日志没打开 ' + JSON.stringify(await st()));
      // BUG-017：灯底高度从模型读（可见网格世界包围盒底）：美术风灯原点在提手、socket 抬高 hang，白盒灯原点在灯底，两者灯底都应 = 桌面 3.75
      const desk = await evaluate(`(() => { const s = __s2; const l = s.puzzles.lantern; const w = l.getWorldPosition(l.position.clone()); const b = s.rig.body.position;
        l.updateMatrixWorld(true); let base = Infinity;
        l.traverseVisible((o) => { if (!o.isMesh || !o.geometry || /collider|glow|cone|halo/i.test(o.name)) return; o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); if (bb.min.y < base) base = bb.min.y; });
        const f = s.rig.controller.facing; return { lp: l.parent?.name, w: w.toArray().map((v) => +v.toFixed(3)), base: +base.toFixed(3), b: b.toArray().map((v) => +v.toFixed(3)), f: +f.toFixed(3) }; })()`);
      // 站位朝 −X：前 0.45、右（−Z）0.10（a9b3403 起 socket z 用美术 019 值 −0.35，制作人 1029），桌面 0.75
      const fwd = desk.b[0] - desk.w[0];
      const right = desk.b[2] - desk.w[2];
      if (desk.lp !== 'desk-lantern-s2-socket' || Math.abs(fwd - 0.45) > 0.03 || Math.abs(right - 0.1) > 0.03 || Math.abs(desk.base - 3.75) > 0.015) throw new Error('风灯应放在书桌 socket（站位前 0.45、右 0.10、灯底 = 桌面 3.75）' + JSON.stringify(desk));
      await gsleep(800);
      s = await st();
      if (!s.glow || s.holding) throw new Error('风灯放书桌后窗口应透暖光 ' + JSON.stringify(s));
      await evaluate(`__game.ui.reader.close(); 1`);
      await gsleep(900);
      s = await st();
      if (!s.journalRead || s.goal !== 'ch1.s2.goal.cellar') throw new Error('读完日志目标应为 cellar ' + JSON.stringify(s));
      out.push(`日志：走到站位 + 占位动作后风灯在书桌 socket（前 ${fwd.toFixed(3)} / 右 ${right.toFixed(3)} m，灯底 ${desk.base} / socket ${desk.w[1]}）、窗口暖光、目标 → cellar ✓`);
      // BUG-014：读完日志、风灯在书桌上，站位默认视角 E 选风灯
      dv = await deskView(0, DEF_PITCH);
      if (dv.cur !== 'lantern-s2') throw new Error('读完日志后书桌站位默认视角应选中风灯 ' + JSON.stringify(dv));
      await aimAt('chart-s2', [[0, 0.15], [0.3, 0.15], [0.3, 0], [0, 0.3], [0.4, 0.2]]);
      out.push(`BUG-014：读完日志后默认视角选风灯（NDC ${dv.lantern}，海图 ${dv.chart} 让位）✓，抬头仍选海图 ✓`);

      // ---- 拿起风灯 → 西灯台（被晾衣架挡，5 s 后独白一次）
      await trigDone('lantern-s2', `__s2.interaction.held.current?.id === 'lantern'`, '没拿起风灯');
      await gsleep(1200);
      if ((await st()).glow) throw new Error('风灯拿走后窗口还亮');
      const westStand = await tpStand('lamp-stand-west-s2');
      await gsleep(200);
      await trigDone('lamp-stand-west-s2', `!__s2.interaction.held.current`, '西灯台没放下风灯 站位 ' + JSON.stringify(westStand));
      await gsleep(300);
      s = await st();
      const west = s.paths.find((q) => q.id === 'lamp-west-s2');
      if (!west?.lit || west.end !== 'blocker' || Math.abs(west.z + 2.95) > 0.06) throw new Error('西灯台应亮且被晾衣架挡在 z −2.95 ' + JSON.stringify(s));
      if (!(await until(`__s2.puzzles.state.westBlockedSaid`, 6500))) throw new Error('西灯台被挡 5 s 后应独白一次');
      out.push('西灯台：光停在晾衣架 z −2.95、5 s 后独白 ✓');

      // ---- 东灯台 + 转镜（机位同时看到两面镜子和光感锁）
      await trigDone('lantern-s2', `__s2.interaction.held.current?.id === 'lantern'`, '没从西灯台拿回风灯');
      const eastStand = await tpStand('lamp-stand-east-s2');
      await gsleep(200);
      await trigDone('lamp-stand-east-s2', `!__s2.interaction.held.current`, '东灯台没放下风灯 站位 ' + JSON.stringify(eastStand));
      await gsleep(300);
      s = await st();
      const east = s.paths.find((q) => q.id === 'lamp-east-s2');
      if (!east?.lit || east.mirrors[0] !== 'mirror-stand-s2-a' || east.rx) throw new Error('东灯台应照到镜 A、初始不开锁 ' + JSON.stringify(s));
      await tp(-12.2, 0.05, 2.0);
      await gsleep(200);
      await trig('mirror-stand-s2-a');
      await gsleep(1500);
      const cam = await evaluate(`(() => { const s = __s2, b = s.puzzles.beam, c = s.camera; c.updateMatrixWorld(); const V = b.mirrorA.center.constructor;
        return [b.mirrorA.center, b.mirrorB.center, b.lock.center(new V())].map((p) => p.clone().project(c).toArray().map((v) => +v.toFixed(2))); })()`);
      if (cam.some(([x, y, z]) => Math.abs(x) > 0.92 || Math.abs(y) > 0.92 || z > 1)) throw new Error('镜子机位应同时看到两面镜子和光感锁 ' + JSON.stringify(cam));
      if ((await st()).ctx !== 'puzzle') throw new Error('没进机关模式');
      await key('KeyD');
      await key('KeyD');
      await key('KeyE');
      for (let i = 0; i < 3; i++) await key('KeyA');
      s = await st();
      if (s.A !== 30 || s.B !== 315) throw new Error('D ×2 / E / A ×3 后应 A 30° B 315° ' + JSON.stringify(s));
      await key('KeyR');
      s = await st();
      if (s.A !== 0 || s.B !== 0) throw new Error('R 应重置两面镜子 ' + JSON.stringify(s));
      await key('KeyQ');
      await key('KeyD');
      await key('KeyD');
      await key('KeyE');
      for (let i = 0; i < 3; i++) await key('KeyA');
      await key('Tab');
      if (!(await until(`__s2.puzzles.state.lockOpen`, 4000))) throw new Error('光感锁 1.5 s 后应打开 ' + JSON.stringify(await st()));
      if (!(await until(`__s2.puzzles.state.doorOpen >= 1`, 3000))) throw new Error('地窖门没转开');
      s = await st();
      if (s.doorCol) throw new Error('地窖门开后门扇碰撞应关掉');
      out.push(`镜子：机位看得到 A / B / 锁（NDC ${JSON.stringify(cam.map((p) => p.slice(0, 2)))}）、D/E/A 转到 30° / 315°、R 重置、受光 1.5 s 开锁、地窖门转开 ✓`);

      // ---- 地窖：钥匙 + 草图
      await tpStand('cellar-key-s2');
      await gsleep(300);
      await trigDone('cellar-key-s2', `__s2.puzzles.state.hasKey`, '拿钥匙', 12000);
      s = await st();
      if (!s.hasKey || s.goal !== 'ch1.s2.goal.gate') throw new Error('拿到钥匙后目标应为 gate ' + JSON.stringify(s));
      await trig('sketch-s2');
      if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('草图没打开');
      await evaluate(`__game.ui.reader.close(); 1`);
      out.push('地窖：钥匙 → 目标 gate、草图可读 ✓');

      // ---- 观察点：站上去换提示；按住右键对准 ≤ 6° 数字完全显影 + 风铃 / 独白；偏开 / 不在观察点上看不出
      const aim = async (offYaw = 0) => {
        for (let i = 0; i < 4; i++) {
          await evaluate(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(18, 0.2, 1).sub(p).normalize();
            s.cameraFollow.yaw = Math.atan2(-t.x, -t.z) + ${offYaw}; s.cameraFollow.pitch = Math.asin(t.y); 1 })()`);
          await gsleep(250);
        }
      };
      await tp(0.95, 3.05, 1.0);
      await gsleep(400);
      const prompt = await evaluate(`__s2.extraPrompt()`);
      if (!prompt || !/右键/.test(prompt)) throw new Error('观察点上应显示「按住右键 观察」：' + prompt);
      // 裁定 16：按住右键 → 固定第一人称眼位 (0.95, 4.35, 1.0)、FOV 30°、角色隐藏、进入时朝西窗偏约 15°（不显影）
      const eyeSt = () => evaluate(`(() => { const s = __s2, c = s.camera, p = c.getWorldPosition(c.position.clone()), f = c.getWorldDirection(p.clone());
        const t = p.clone().set(18, 0.2, 1).sub(p).normalize();
        return { eye: p.distanceTo(p.clone().set(0.95, 4.35, 1.0)), fov: c.fov, eyeActive: s.cameraFollow.eyeActive, xi: s.rig.visual.visible,
          off: f.angleTo(t) * 180 / Math.PI, fx: f.x, align: s.puzzles.viewpoint.alignment, digits: s.puzzles.digits.visible || (s.puzzles.whiteStonesArtActive && (s.scene.getObjectByName('white-stone-d7-b')?.material.emissiveIntensity ?? 0) > 0.3) }; })()`);
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', true); 1`);
      await gsleep(700);
      let es = await eyeSt();
      if (!es.eyeActive || es.eye > 0.01 || Math.abs(es.fov - 30) > 0.01 || es.xi) throw new Error('按住右键应到固定眼位、FOV 30、角色隐藏 ' + JSON.stringify(es));
      if (Math.abs(es.off - 15) > 1.5 || es.fx < 0.9 || es.align > 0 || es.digits) throw new Error('进入时应朝西窗偏约 15°、不显影 ' + JSON.stringify(es));
      await tp(1.2, 3.05, 1.2);
      await gsleep(200);
      es = await eyeSt();
      if (!es.eyeActive || es.eye > 0.01) throw new Error('观察点内挪动站位眼位不变 ' + JSON.stringify(es));
      await aim(0.6);
      s = await st();
      if (s.align > 0 || s.digits) throw new Error('偏开 34° 不应看到数字 ' + JSON.stringify(s));
      await aim(0);
      await gsleep(300);
      s = await st();
      if (s.align < 0.99 || !s.digits || !s.digitsSeen) throw new Error('对准后数字应完全显影 ' + JSON.stringify(s));
      es = await eyeSt();
      if (es.eye > 0.01 || es.off > 0.5) throw new Error('对准时仍在眼位、视线偏差 < 0.5° ' + JSON.stringify(es));
      // 裁定 15：没挂美术白石（art=0）→ 七段贴片回退（art=1 那条测真 GLB）
      // BUG-017：SMOKE_QUERY=art=1 时挂美术白石（贴片关），「显影」看数字石块加亮（上面 st / eyeSt 的 digits 已兼容）
      const wsArt = await evaluate(`__s2.puzzles.whiteStonesArtActive`);
      if (wsArt !== /(^|&)art=1/.test(process.env.SMOKE_QUERY ?? '')) throw new Error('美术白石挂载应跟 art 参数一致 ' + wsArt);
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', false); 1`);
      await gsleep(80);
      es = await eyeSt();
      if (es.eyeActive || !es.xi) throw new Error('松开：退出眼位、角色显示 ' + JSON.stringify(es));
      await gsleep(800);
      es = await eyeSt();
      // 观察点在室内贴着西窗，第三人称相机被墙前拉到头部附近（离眼位可能 < 0.5 m），所以只看 FOV / 朝向恢复
      if (es.eyeActive || Math.abs(es.fov - 55) > 3.5 || es.off < 30) throw new Error('松开后应回第三人称 FOV 55、朝向恢复 ' + JSON.stringify(es));
      out.push(`裁定 16 观察：眼位 (0.95, 4.35, 1.0) / FOV 30 / 角色隐藏 / 进入偏 15° / 挪站位眼位不变 / 松开平滑回第三人称 ✓；${wsArt ? 'art=1 数字石块加亮' : 'art=0 七段贴片回退'} ✓`);
      await tp(-0.6, 3.05, 1.0);
      await gsleep(300);
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', true); 1`);
      await aim(0);
      s = await st();
      await evaluate(`__game.input.setRaw('smoke', 'Mouse2', false); 1`);
      if (s.align > 0 || s.digits) throw new Error('不在观察点上不应看到数字 ' + JSON.stringify(s));
      out.push('观察点：换提示、偏 34° 看不到、对准完全显影 + 风铃、离开观察点看不到 ✓');

      // ---- 拨盘铁门：316 不开，317 开
      await tpStand('dial-gate-s2');
      await gsleep(300);
      await trigDone('dial-gate-s2', `__game.input.context === 'puzzle'`, '拨盘机关模式');
      await gsleep(300);
      for (let i = 0; i < 3; i++) await key('KeyD');
      await key('KeyE');
      await key('KeyD');
      await key('KeyE');
      for (let i = 0; i < 6; i++) await key('KeyD');
      await gsleep(600);
      s = await st();
      if (s.gateOpen || !s.gateCol || JSON.stringify(s.dials) !== '[108,36,216]') throw new Error('316 不应开门 ' + JSON.stringify(s));
      await key('KeyD');
      if (!(await until(`__s2.puzzles.state.gateOpen && __game.input.context === 'explore'`, 3000))) throw new Error('317 应开门并退出机关 ' + JSON.stringify(await st()));
      // BUG-017：等铁门动画转完（游戏时间），不用固定 1.8 s
      if (!(await until(`!__s2.colliderOf.get(__s2.greybox.dialGateLeaf).enabled`, 6000))) throw new Error('铁门开后碰撞应关掉 ' + JSON.stringify(await st()));
      out.push('拨盘：316 不开、317 自动开门 + 退出机关、门扇碰撞关掉 ✓');
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      try { await cdp.goto(''); } catch (e) { throw new Error('回 S1 失败：' + e.message, { cause: e }); }
      return out.join('，');
    },
  },
  {
    name: 'v0.1-017 交互动作 art=1（S2）：读日志 → xi-place-table（1.8 s，第 34 帧风灯上桌）→ 日志；地窖钥匙 xi-pickup-shelf（节点 anim）grab 帧挂到 middle_03_r',
    async run({ evaluate, cdp, sleep }) {
      const clock = () => evaluate(`({ e: __game.time.fixedTick * __game.time.fixedDelta, f: __game.time.frame })`);
      const until = async (expr, ms = 8000) => {
        const c0 = await clock();
        const end = Date.now() + 180000;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(50);
          const c = await clock();
          if (c.e - c0.e > ms / 1000 && c.f - c0.f > 3) return await evaluate(expr);
        }
        return v;
      };
      const trig = (id) => evaluate(`(() => { const s = __s2; const it = s.interaction.get('${id}'); if (!it) return 'no ' + '${id}'; s.interaction.trigger(it); return 'ok'; })()`);
      const tp = (x, y, z) => evaluate(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.body.position.constructor(${x}, ${y}, ${z})); 1 })()`);
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      await cdp.goto('debug=1&scene=s2&art=1', 's2-keeper-house');
      if (!(await until(`!!window.__s2?.puzzles`, 60000))) throw new Error('?scene=s2&art=1 没进 S2');
      if (!(await until(`__game.input.context === 'explore' && !__s2.rig.controller.busy`, ESTAB_MS))) throw new Error('建立镜头后没回到 explore');
      if (!(await evaluate(`!!__s2.rig.animator`))) throw new Error('art=1 下 S2 没有 XiAnimator');
      await tp(-3.9, 3.05, -0.25);
      await until(`false`, 300);
      if ((await trig('journal-s2')) !== 'ok') throw new Error('没有 journal-s2');
      const t0 = (await clock()).e;
      const play = await until(`__s2.puzzles.actions.playing === 'xi-place-table' && __s2.rig.animator.posing === 'xi-place-table'`, 3000);
      if (!play) throw new Error('读日志没播 xi-place-table');
      if (!(await until(`__game.ui.reader.isOpen`, 6000))) throw new Error('日志没打开');
      const dt = (await clock()).e - t0;
      const lp = await evaluate(`__s2.puzzles.lantern.parent?.name`);
      if (lp !== 'desk-lantern-s2-socket') throw new Error('风灯没上书桌 ' + lp);
      // 021 美术风灯 / 灯台：风灯组里只有美术灯（提手 = 原点 → 书桌提手 3.75 + 0.28），发光材质保留；灯台在院墙 socket，风灯 socket = 美术 -socket
      const art21 = await evaluate(`(() => { const L = __s2.puzzles.lantern; const a = L.getObjectByName('prop-lantern-brass'); if (!a) return null; let glow = 0; a.traverse((o) => { if (o.isMesh && o.visible) for (const m of [o.material].flat()) if (m.emissive && m.emissive.getHex() !== 0) glow++; }); const y = L.getWorldPosition(new L.position.constructor()).y; const st = ['east', 'west'].map((k) => { const s = __s2.art.lampStands[k]; const lamp = __s2.puzzles.beam.lamps[k]; if (!s) return null; const w = s.getObjectByName('prop-lantern-stand-s2-socket').getWorldPosition(new L.position.constructor()); return { parent: s.parent?.name, d: w.distanceTo(lamp.socket.getWorldPosition(new L.position.constructor())), gb: lamp.stand.children.some((c) => c.isMesh && c.visible) }; }); let gb = 0; L.traverse((o) => { if (o.isMesh && o.visible) { let p = o; while (p && p !== a) p = p.parent; if (!p) gb++; } }); return { gb, glow, y, st }; })()`);
      if (!art21) throw new Error('art=1 风灯组里没有 prop-lantern-brass');
      if (art21.gb || !art21.glow || Math.abs(art21.y - 4.03) > 0.01) throw new Error('美术风灯不对 ' + JSON.stringify(art21));
      for (const [i, k] of ['east', 'west'].entries()) {
        const st = art21.st[i];
        if (!st || st.parent !== `env-courtyard-wall-s2-lamp-${k}-socket` || st.d > 1e-3 || st.gb) throw new Error(`${k} 灯台不对 ` + JSON.stringify(st));
      }
      if (dt < 1.8 - 0.05) throw new Error(`xi-place-table 1.8 s 没播完就开了日志（${dt.toFixed(2)} s）`);
      if (await evaluate(`__s2.rig.animator.posing`)) throw new Error('动作结束没 clearPose');
      await evaluate(`__game.ui.reader.close(); 1`);
      await until(`__game.input.context === 'explore'`, 3000);
      // 地窖钥匙
      await tp(-1.6, -2.35, 1.6);
      await until(`false`, 300);
      // 美术钥匙（prop-key-lighthouse 优先，回退 prop-key-cellar-s2）：根节点就在架上 socket（无偏移），白盒钥匙隐藏
      const rest = await evaluate(`(() => { const k = __s2.art.cellarKey; if (!k) return null; const s = __s2.art.root.getObjectByName('env-cellar-s2-key-socket'); const p = k.getWorldPosition(new k.position.constructor()); const q = s.getWorldPosition(new k.position.constructor()); return { parent: k.parent?.name, d: p.distanceTo(q), p: p.toArray() }; })()`);
      if (!rest) throw new Error('art=1 没加载美术钥匙 prop-key-lighthouse / prop-key-cellar-s2');
      // 1030c：灯塔钥匙交付后优先入口生效
      if ((await evaluate(`__s2.art.cellarKey.name`)) !== 'prop-key-lighthouse') throw new Error('art=1 钥匙应优先用 prop-key-lighthouse：' + (await evaluate(`__s2.art.cellarKey.name`)));
      if (rest.parent !== 'env-cellar-s2-key-socket' || rest.d > 1e-4) throw new Error('钥匙不在 socket 上 ' + JSON.stringify(rest));
      if ((await trig('cellar-key-s2')) !== 'ok') throw new Error('没有 cellar-key-s2');
      const clip = await until(`__s2.interaction.animState?.clip`, 2000);
      if (clip !== 'xi-pickup-shelf') throw new Error('钥匙应播 xi-pickup-shelf：' + clip);
      if (!(await until(`__s2.puzzles.state.hasKey`, 4000))) throw new Error('grab 帧没拿到钥匙');
      const att = await evaluate(`(() => { const b = __s2.rig.visual.getObjectByName('middle_03_r'); return { kids: b ? b.children.filter((c) => c.visible).map((c) => c.name) : null, t: __s2.puzzles.state.keyAttachT }; })()`);
      if (!att.kids?.length) throw new Error('钥匙没挂到 middle_03_r ' + JSON.stringify(att));
      if (att.t === null || Math.abs(att.t - 22 / 30) > 1 / 30 + 1e-3) throw new Error('钥匙不在 grab 帧生效 ' + JSON.stringify(att));
      const held = await evaluate(`(() => { const k = __s2.art.cellarKey; const p = k.getWorldPosition(new k.position.constructor()); return { parent: k.parent?.name, lod0: k.userData.forceLod0 === true, p: p.toArray() }; })()`);
      if (held.parent !== 'middle_03_r' || !held.lod0) throw new Error('美术钥匙没挂 middle_03_r / 没强制 LOD0 ' + JSON.stringify(held));
      const jump = Math.hypot(held.p[0] - rest.p[0], held.p[1] - rest.p[1], held.p[2] - rest.p[2]);
      if (jump > 0.08) throw new Error(`grab 帧钥匙跳了 ${(jump * 100).toFixed(1)} cm`);
      if (!(await until(`!__s2.rig.controller.locked && !__s2.interaction.animState`, 4000))) throw new Error('xi-pickup-shelf 播完没解锁');
      const hidden = await evaluate(`(() => { const b = __s2.rig.visual.getObjectByName('middle_03_r'); return b.children.filter((c) => c.visible).length; })()`);
      if (hidden) throw new Error('clip 播完钥匙应收起');
      // 室内不淋湿：地窖里有雨也是 0，出到小院 = 1
      const wetIn = await evaluate(`({ rain: !!__s2.rain?.visible, w: __s2.rig.look?.wetTarget ?? null })`);
      if (wetIn.w === null) throw new Error('art=1 没有 look 组件');
      if (wetIn.w !== 0) throw new Error('地窖里不该淋湿 ' + JSON.stringify(wetIn));
      await tp(-10.6, 0.2, 0.75);
      await until(`false`, 300);
      const wetOut = await evaluate(`__s2.rig.look.wetTarget`);
      if (wetIn.rain && wetOut !== 1) throw new Error('小院下雨应淋湿 ' + wetOut);
      return `xi-place-table ${dt.toFixed(2)} s 后开日志、风灯上桌 ✓（021 美术风灯提手 y ${art21.y.toFixed(3)}、发光保留、东西灯台在院墙 socket）；钥匙 xi-pickup-shelf、socket 上 → grab 帧挂 middle_03_r（${att.kids.join('/')}，跳动 ${(jump * 100).toFixed(1)} cm，LOD0）、播完收起解锁 ✓；地窖 wetTarget 0 / 小院 ${wetOut}（雨 ${wetIn.rain ? '开' : '关'}）✓`;
    },
  },
  {
    name: 'v0.1-017 交互动作 art=1（S1 / S3）：S1 推浮台 xi-push-start（按住 E ≤ 0.6 s 浮台开始动）→ push-loop → xi-push-end；S3 敲钟 xi-ring-bell、开阀 xi-valve-hold、拉杆 xi-ignite-lever；021 美术潮汐钟 S1 / S3 敲钟断言',
    async run({ evaluate, cdp, sleep }) {
      const clock = () => evaluate(`({ e: __game.time.fixedTick * __game.time.fixedDelta, f: __game.time.frame })`);
      // 等待按游戏时间（负载高时真实时间不可靠），真实时间封顶 180 s
      const until = async (expr, ms = 8000) => {
        const c0 = await clock();
        const end = Date.now() + 180000;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(50);
          const c = await clock();
          if (c.e - c0.e > ms / 1000 && c.f - c0.f > 3) return await evaluate(expr);
        }
        return v;
      };
      const out = [];
      const key = (down) => evaluate(`__game.input.setRaw('smoke', 'KeyE', ${down}); 1`);
      // 站到交互物站位上，然后按住 E + trigger（approach 走完时 E 仍按着 → hold / push 生效）
      const standAt = (S, ix) => `(() => { const s = ${S}; const sp = ${ix}.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.05)); s.rig.controller.facing = sp.facing; return 1; })()`;

      // 021 美术潮汐钟（S1 / S3）：挂上、白盒隐藏、vertexColors 关、站位 = prop-tide-bell-interact、钟响在 xi-ring-bell 第 30 帧、钟口被推开
      const ringArtBell = async (S, slot, expectStand) => {
        const pre = await evaluate(`(() => { const s = ${S}; const m = s.artSlots.mounted.find((x) => x.id === '${slot}'); if (!m) return { err: 'not-mounted' };
          const ip = m.model.getObjectByName('prop-tide-bell-interact'); ip.updateWorldMatrix(true, false); const a = ip.getWorldPosition(ip.position.clone());
          const sp = s.puzzles.bell.interactable.standPoint(a.clone()).position;
          let vc = 0, meshes = 0; m.model.traverse((o) => { if (o.isMesh) { meshes++; for (const mt of [o.material].flat()) if (mt.vertexColors) vc++; } });
          let gbVis = 0; s.scene.getObjectByName(s.puzzles.bell.id).traverse((o) => { if (o.isMesh && o.visible && !o.userData.artSlot) { let p = o, art = false; while (p) { if (p.userData.artSlot) art = true; p = p.parent; } if (!art) gbVis++; } });
          return { stand: sp.toArray(), artStand: a.toArray(), vc, meshes, gbVis }; })()`);
        if (pre.err) throw new Error(`${S} 美术潮汐钟没挂上`);
        const d = Math.hypot(...pre.stand.map((v, i) => v - pre.artStand[i]));
        if (d > 0.01) throw new Error(`${S} 站位没读 prop-tide-bell-interact ` + JSON.stringify(pre));
        if (expectStand && Math.hypot(...pre.stand.map((v, i) => v - expectStand[i])) > 0.02) throw new Error(`${S} 站位不在 ${expectStand} ` + JSON.stringify(pre));
        if (pre.vc) throw new Error(`${S} 潮汐钟 ${pre.vc} 个材质还开着 vertexColors（COLOR_0 是描边法线）`);
        if (pre.gbVis) throw new Error(`${S} 美术挂上后白盒钟还有 ${pre.gbVis} 个网格可见`);
        await evaluate(`(() => { const s = ${S}; window.__bellRing = null; const off = s.game.events.on('tide:bell', () => { const st = s.interaction.animState; const m = s.artSlots.mounted.find((x) => x.id === '${slot}'); const sw = m.model.getObjectByName('bell-swing'); sw.updateWorldMatrix(true, false);
          const lip = sw.localToWorld(new sw.position.constructor(0, -1, 0)).sub(sw.getWorldPosition(new sw.position.constructor()));
          const b = s.puzzles.bell.interactable.standPoint().position; const c = m.model.getWorldPosition(b.clone()); const away = c.sub(b).setY(0).normalize();
          window.__bellRing = { t: st?.clip === 'xi-ring-bell' ? st.t : null, angle: s.puzzles.bell.angle, lipAway: Math.asin(lip.dot(away)) }; off(); }); return 1; })()`);
        await evaluate(standAt(S, `${S}.puzzles.bell.interactable`));
        await sleep(200);
        await evaluate(`(${S}.interaction.trigger(${S}.puzzles.bell.interactable), 1)`);
        if (!(await until(`!!window.__bellRing`, 4000))) throw new Error(`${S} 敲钟没响 ` + JSON.stringify(await evaluate(`${S}.interaction.animState`)));
        const r = await evaluate(`window.__bellRing`);
        if (r.t === null || Math.abs(r.t * 30 - 30) > 1.01) throw new Error(`${S} 钟响不在 xi-ring-bell 第 30 帧 ` + JSON.stringify(r));
        // tide:bell 在固定步里发，读到的是上一渲染帧的钟角（推到 ring 前 1–2 帧，± 闲置风摆 0.01）
        if (!(r.angle > 0.05 && r.angle < 0.12) || !(r.lipAway > 0.05)) throw new Error(`${S} ring 帧钟没被推开（应接近 0.100 rad，钟口远离站位） ` + JSON.stringify(r));
        if (!(await until(`!${S}.interaction.animState && !${S}.rig.controller.locked`, 4000))) throw new Error(`${S} xi-ring-bell 播完没解锁`);
        return `${S} 美术钟：站位 (${pre.stand.map((v) => v.toFixed(2)).join(', ')}) = prop-tide-bell-interact、vertexColors 关（${pre.meshes} 网格）、白盒隐藏、第 ${(r.t * 30).toFixed(1)} 帧钟响、钟体 ${r.angle.toFixed(3)} rad / 美术钟口推开 ${r.lipAway.toFixed(3)} rad ✓`;
      };

      // ---------------- S1：推浮台
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      await cdp.goto('art=1');
      if (!(await until(`!!window.__s1?.art?.loaded && !!__s1.rig.animator`, 60000))) throw new Error('art=1 没进 S1 / 没有 XiAnimator');
      if (!(await until(`__game.input.context === 'explore' && !__s1.rig.controller.busy`, ESTAB_MS))) throw new Error('S1 建立镜头后没回到 explore');
      out.push(await ringArtBell('__s1', 'prop-tide-bell', [-14.52, 2.4, -6.2]));
      await evaluate(`__s1.tides.fixedUpdate(7), 1`);
      for (const c of ['xi-push-start', 'xi-push-loop', 'xi-push-end']) if (!(await evaluate(`__s1.rig.animator.has('${c}')`))) throw new Error('缺 clip ' + c);
      // 退潮：上面已真敲（xi-ring-bell）+ 快进潮汐（潮汐流程在 013 项）
      if (!(await until(`__s1.puzzles.raft.state === 'grounded' && __s1.puzzles.raftPush.enabled`, 6000))) throw new Error('退潮后浮台没搁浅 / 不能推 ' + (await evaluate(`__s1.puzzles.raft.state`)));
      await evaluate(standAt('__s1', '__s1.puzzles.raftPush'));
      await sleep(200);
      // 页面侧记录：按住 E（trigger）那一刻的游戏时间、浮台第一次 pushMoved 的游戏时间与当时阶段
      await evaluate(`(() => { const g = () => __game.time.fixedTick * __game.time.fixedDelta; const r = (window.__push = { t0: g(), move: null, phase: null, n: 0, ts: [__s1.puzzles.raftPush.pushT] });
        if (!window.__pushOff) window.__pushOff = __game.events.on('interact:pushMoved', ({ id, t }) => { const q = window.__push; if (id !== 'raft-s1' || !q) return; q.n++; q.ts.push(t); if (q.move === null) { q.move = g(); q.phase = window.__s1?.interaction.pushPhase ?? null; } });
        return r.t0; })()`);
      await key(true);
      // t0 与 trigger 在页面同一段同步代码里取（不含 CDP 往返时间）
      await evaluate(`(window.__push.t0 = __game.time.fixedTick * __game.time.fixedDelta, __s1.interaction.trigger(__s1.puzzles.raftPush), 1)`);
      if (!(await until(`__s1.interaction.pushPhase === 'start' && __s1.rig.animator.posing === 'xi-push-start'`, 4000))) {
        await key(false);
        throw new Error('推浮台没先播 xi-push-start ' + JSON.stringify(await evaluate(`({ ph: __s1.interaction.pushPhase, pose: __s1.rig.animator.posing })`)));
      }
      // 制作人拍板：从按住 E 到浮台开始动 ≤ 0.6 s（push-start 后半段与移动重叠），之后平滑进 push-loop
      if (!(await until(`window.__push.move !== null`, 3000))) {
        await key(false);
        throw new Error('push-start 期间浮台没开始动 ' + JSON.stringify(await evaluate(`window.__push`)));
      }
      const pm = await evaluate(`window.__push`);
      const tMove = pm.move - pm.t0;
      if (tMove > 0.6 + 1 / 60 + 1e-6 || pm.phase !== 'start') {
        await key(false);
        throw new Error(`从按住 E 到浮台开始动 ${tMove.toFixed(3)} s（应 ≤ 0.6 s，且在 push-start 内）` + JSON.stringify(pm));
      }
      if (!(await until(`__s1.interaction.pushPhase === 'loop' && __s1.rig.animator.looping === 'xi-push-loop' && !__s1.rig.animator.posing`, 3000))) {
        await key(false);
        throw new Error('xi-push-start 后没进 push-loop ' + JSON.stringify(await evaluate(`({ ph: __s1.interaction.pushPhase, pose: __s1.rig.animator.posing, loop: __s1.rig.animator.looping })`)));
      }
      if (!(await until(`__s1.puzzles.raftPush.pushT > 0.08`, 6000))) {
        await key(false);
        throw new Error('push-loop 中浮台没前进 ' + (await evaluate(`__s1.puzzles.raftPush.pushT`)));
      }
      await key(false);
      // 缓入（batch8 小点）：每个 pushMoved = 一个固定步，逐步速度 = ΔpushT · 轨道长 / fixedDelta；第一步远小于满速、每步加速 ≤ 满速 5 %、末段到满速
      const vs = await evaluate(`(() => { const q = window.__push; const tr = __s1.puzzles.raftPush.track; const len = tr.from.distanceTo(tr.to); const dt = __game.time.fixedDelta; return q.ts.slice(1).map((t, i) => ((t - q.ts[i]) * len) / dt); })()`);
      const vFull = await evaluate(`__s1.puzzles.raftPush.track.speed ?? 0.8`);
      const jumps = vs.slice(1).map((v, i) => v - vs[i]);
      if (!(vs[0] < vFull * 0.1) || Math.max(...jumps) > vFull * 0.05 + 1e-6 || Math.abs(vs.at(-1) - vFull) > 1e-3)
        throw new Error(`推浮台没有缓入：前几步 ${vs.slice(0, 6).map((v) => v.toFixed(3)).join(' / ')}，最大单步加速 ${Math.max(...jumps).toFixed(3)} m/s，末步 ${vs.at(-1)?.toFixed(3)}`);
      out.push(`S1 推浮台缓入：第 1 步 ${vs[0].toFixed(3)} m/s，单步加速 ≤ ${Math.max(...jumps).toFixed(3)} m/s，满速 ${vFull} ✓`);
      if (!(await until(`__s1.interaction.animState?.clip === 'xi-push-end'`, 2000))) throw new Error('松手没播 xi-push-end ' + JSON.stringify(await evaluate(`__s1.interaction.animState`)));
      const pT = await evaluate(`__s1.puzzles.raftPush.pushT`);
      if (!(await until(`!__s1.interaction.animState && !__s1.rig.controller.locked && !__s1.rig.animator.looping`, 4000))) throw new Error('xi-push-end 播完没解锁');
      if (Math.abs((await evaluate(`__s1.puzzles.raftPush.pushT`)) - pT) > 1e-6) throw new Error('push-end 期间浮台不该再动');
      // 021 美术木筏：挂在白盒 raft-s1 根下零变换（推动后跟着走）、白盒网格隐藏、vertexColors 关、推站位 = prop-raft-s1-interact
      const ra = await evaluate(`(() => { const m = __s1.artSlots.mounted.find((x) => x.id === 'prop-raft-s1'); if (!m) return { err: 'not-mounted' }; const root = __s1.scene.getObjectByName('raft-s1');
        const ip = m.model.getObjectByName('prop-raft-s1-interact'); ip.updateWorldMatrix(true, false); const a = ip.getWorldPosition(ip.position.clone()); const sp = __s1.puzzles.raftPush.standPoint(a.clone()).position;
        let vc = 0, gbVis = 0; m.model.traverse((o) => { if (o.isMesh) for (const mt of [o.material].flat()) if (mt.vertexColors) vc++; });
        root.traverse((o) => { if (!o.isMesh || !o.visible) return; let p = o, art = false; while (p) { if (p.userData.artSlot) art = true; p = p.parent; } if (!art) gbVis++; });
        return { parentOk: m.model.parent === root, zero: m.model.position.lengthSq() === 0, standD: sp.distanceTo(a), vc, gbVis, x: root.position.x }; })()`);
      if (ra.err || !ra.parentOk || !ra.zero || ra.standD > 0.01 || ra.vc || ra.gbVis) throw new Error('美术木筏挂法不对 ' + JSON.stringify(ra));
      out.push(`S1 美术木筏：挂 raft-s1 零变换（推到 x ${ra.x.toFixed(2)} 跟着走）、白盒隐藏、vertexColors 关、推站位 = prop-raft-s1-interact ✓`);
      out.push(`S1 推浮台：按住 E ${tMove.toFixed(3)} s 浮台开始动（push-start 内）→ push-loop（推到 ${pT.toFixed(2)}）→ 松手 xi-push-end → 解锁 ✓`);

      // ---------------- S3：敲钟 / 开阀 / 拉杆
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      await cdp.goto('debug=1&scene=s3&art=1', 's3-lighthouse');
      if (!(await until(`!!window.__s3?.puzzles && !!__s3.rig.animator`, 60000))) throw new Error('?scene=s3&art=1 没进 S3 / 没有 XiAnimator');
      if (!(await until(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, ESTAB_MS))) throw new Error('S3 建立镜头后没回到 explore');
      const nodeAnims = await evaluate(`({ bell: __s3.puzzles.bell.interactable.resolveAnim(), lever: __s3.puzzles.leverIx.resolveAnim() })`);
      if (nodeAnims.bell !== 'xi-ring-bell' || nodeAnims.lever !== 'xi-ignite-lever') throw new Error('S3 交互 clip 不对 ' + JSON.stringify(nodeAnims));
      // 1030c 第 3 批：油阀 / 窗口镜 / 点火口 + 拉杆挂上、站位读美术 -interact；塔门 -interact 关门时缓存给 doorStand；白盒透镜球隐藏
      const b3 = await evaluate(`(() => { const s = __s3, P = s.puzzles; const V = s.scene.position.constructor; const wp = (o) => o.getWorldPosition(new V());
        const m = (id) => (s.artSlots?.mounted ?? []).find((x) => x.id === id);
        const find = (root, n) => { let r = null; root.traverse((o) => { if (!r && (o.name === n || o.name.endsWith('-' + n))) r = o; }); return r; };
        const st = (id, node, ix) => { const x = m(id); if (!x) return { id, mounted: false }; const a = find(x.model, node); return { id, parent: x.model.parent?.name, missing: x.missingNodes, d: a ? wp(a).distanceTo(wp(ix.interactPoint)) : -1 }; };
        const door = s.art.door; const di = door && find(door, 'prop-lighthouse-door-s3-interact');
        const vw = m('prop-oil-valve-s3') && find(m('prop-oil-valve-s3').model, 'valve-wheel'); const lv = m('prop-ignition-port-s3') && find(m('prop-ignition-port-s3').model, 'ignite-lever');
        window.__b3rest = { valve: vw?.getWorldQuaternion(vw.quaternion.clone()), lever: lv?.getWorldQuaternion(lv.quaternion.clone()) };
        return { items: [st('prop-oil-valve-s3', 'prop-oil-valve-s3-interact', P.valveIx), st('prop-guide-mirror-window-s3', 'prop-guide-mirror-window-s3-interact', P.mirrorIx.window), st('prop-ignition-port-s3', 'prop-ignition-port-s3-interact', P.leverIx)],
          door: door?.name, doorD: di ? wp(di).distanceTo(wp(P.doorIx.interactPoint)) : -1, lens: s.scene.getObjectByName('ignition-port-s3-lens')?.visible }; })()`);
      for (const it of b3.items) if (it.mounted === false || it.missing.length || it.d < 0 || it.d > 0.001) throw new Error('art=1 第 3 批道具没挂好 / 站位没读美术 ' + JSON.stringify(b3));
      if (b3.door !== 'prop-lighthouse-door-s3' || b3.doorD < 0 || b3.doorD > 0.001 || b3.lens !== false) throw new Error('art=1 塔门 / 点火口透镜不对 ' + JSON.stringify(b3));
      out.push(`art=1 第 3 批：油阀 / 窗口镜 / 点火口挂上（${b3.items.map((x) => x.parent).join('、')}）、站位 = 美术 -interact，塔门 doorStand = 关门时的美术 -interact，白盒透镜球隐藏 ✓`);
      const glowOf = `(() => { const s = __s3, x = s.artSlots.mounted.find((y) => y.id === 'prop-ignition-port-s3'); let g = null; x.model.traverse((o) => { if (o.isMesh && o.material.name === 'mat-prop-ignition-glow') g = o.material; });
        const l = s.scene.getObjectByName('ignition-port-s3-lens').material; return { hex: g.emissive.getHex(), k: g.emissiveIntensity, lhex: l.emissive.getHex(), lk: l.emissiveIntensity, st: s.puzzles.beam.igniter.state }; })()`;
      // 敲钟（use + clip，节点 anim）+ 021 美术钟断言
      out.push(await ringArtBell('__s3', 'prop-tide-bell-s3', null));
      if (!(await evaluate(`__s3.puzzles.bell.rings === 1`))) throw new Error('xi-ring-bell 播到触发帧没敲响');
      await evaluate(`__s3.tides.fixedUpdate(7), 1`);
      if (!(await until(`__s3.puzzles.tide.state === 'low' && !__s3.puzzles.tide.transitioning`, 3000))) throw new Error('敲钟没退潮');
      out.push('S3 敲钟 xi-ring-bell（节点 anim）→ 敲响、解锁 ✓');
      // 开阀（hold + clip：握住段圆环不动，turnStart–turnEnd 同步转，满了生效后播完松手段）
      await evaluate(standAt('__s3', `__s3.interaction.get('oil-valve-s3')`));
      await sleep(200);
      await key(true);
      await evaluate(`(__s3.interaction.trigger(__s3.interaction.get('oil-valve-s3')), 1)`);
      if ((await until(`__s3.interaction.animState?.clip`, 3000)) !== 'xi-valve-hold') {
        await key(false);
        throw new Error('开阀没播 xi-valve-hold ' + JSON.stringify(await evaluate(`__s3.interaction.animState`)));
      }
      if (!(await until(`__s3.rig.animator.posing === 'xi-valve-hold'`, 1000))) {
        await key(false);
        throw new Error('开阀时 animator 没在 xi-valve-hold');
      }
      const opened = await until(`__s3.puzzles.state.valveOpen`, 6000);
      await key(false);
      if (!opened) throw new Error('按住 E 开阀没生效 ' + JSON.stringify(await evaluate(`__s3.interaction.animState`)));
      if (!(await until(`!__s3.interaction.animState && !__s3.rig.controller.locked`, 4000))) throw new Error('xi-valve-hold 松手段播完没解锁');
      out.push('S3 开阀 xi-valve-hold（按住 → 生效 → 松手段播完）✓');
      const vTurn = await evaluate(`(() => { const x = __s3.artSlots.mounted.find((y) => y.id === 'prop-oil-valve-s3'); let w = null; x.model.traverse((o) => { if (!w && o.name.endsWith('valve-wheel')) w = o; }); return (w.getWorldQuaternion(w.quaternion.clone()).angleTo(__b3rest.valve) * 180) / Math.PI; })()`);
      if (Math.abs(vTurn - 90) > 0.5) throw new Error('art=1 开阀后美术手轮应转 90° ' + vTurn);
      out.push(`art=1 开阀美术手轮转 ${vTurn.toFixed(1)}° ✓`);
      // 拉杆：光路直接解开 → 可点灯 → startIgnite（锁输入 → 走位 → xi-ignite-lever 第 34 帧点燃）
      await evaluate(`(() => { const b = __s3.puzzles.beam; b.solve(); for (let i = 0; i < 50; i++) __s3.puzzles.fixedUpdate(0.05); return 1; })()`);
      if (!(await until(`__s3.puzzles.leverIx.enabled && __s3.puzzles.canIgnite()`, 4000))) throw new Error('开阀 + 光路解开后拉杆没开放 ' + (await evaluate(`__s3.puzzles.beam.igniter.state`)));
      // 发光在 update()（渲染帧）里跟状态：高负载 1 帧可达 2 s，固定 sleep 300 ms 会读到还没刷新的 0；按游戏时间等到刷新（≤ 1.5 s 游戏时间）
      await until(`(() => { const g = ${glowOf}; return g.hex !== 0 && g.k > 0; })()`, 1500);
      const gReady = await evaluate(glowOf);
      if (gReady.st !== 'ready' || gReady.hex !== 0xdce6ee || gReady.lhex !== gReady.hex || Math.abs(gReady.k - gReady.lk) > 1e-6 || gReady.k < 0.14) throw new Error('art=1 可点灯时点火口美术发光应跟白盒冷白 ' + JSON.stringify(gReady));
      await evaluate(standAt('__s3', '__s3.puzzles.leverIx'));
      await sleep(200);
      if (!(await evaluate(`__s3.puzzles.startIgnite()`))) throw new Error('startIgnite 没生效');
      if (!(await until(`__s3.rig.animator.posing === 'xi-ignite-lever'`, 6000))) throw new Error('点灯没播 xi-ignite-lever ' + (await evaluate(`__s3.rig.animator.posing`)));
      if (!(await until(`__s3.puzzles.state.ignited`, 4000))) throw new Error('xi-ignite-lever 没在第 34 帧点燃');
      if (!(await until(`!__s3.rig.animator.posing`, 4000))) throw new Error('xi-ignite-lever 播完没 clearPose');
      const rot = await evaluate(`__s3.puzzles.leverSwing.rotation.x * 180 / Math.PI`);
      if (Math.abs(rot + 60) > 0.5) throw new Error('拉杆没转到 −60° ' + rot);
      out.push(`S3 拉杆 xi-ignite-lever → 点燃、拉杆 ${rot.toFixed(1)}° ✓`);
      const gLit = await evaluate(glowOf);
      const lTurn = await evaluate(`(() => { const x = __s3.artSlots.mounted.find((y) => y.id === 'prop-ignition-port-s3'); let w = null; x.model.traverse((o) => { if (!w && o.name.endsWith('ignite-lever')) w = o; }); return (w.getWorldQuaternion(w.quaternion.clone()).angleTo(__b3rest.lever) * 180) / Math.PI; })()`);
      if (gLit.hex !== 0xffb25e || Math.abs(gLit.k - 2) > 1e-6 || Math.abs(lTurn - 60) > 0.5) throw new Error('art=1 点燃后点火口暖光 2.0 / 美术拉杆 60° ' + JSON.stringify({ gLit, lTurn }));
      out.push(`art=1 点火口四态：可点灯冷白 ${gReady.k.toFixed(2)} = 白盒 → 点燃暖 #FFB25E ×2.0；美术拉杆转 ${lTurn.toFixed(1)}° ✓`);
      return out.join('；');
    },
  },
  {
    name: 'v0.1-015 S3 白盒：?scene=s3 桥尾入口 / 世界摆位（塔心 39.73, −122.75，转 135°）/ 海面挪到塔心 / 室内触发体、点灯前无暖光、光路正解到点火口；?art=1 美术 020 七件 + 门扇挂合页',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      const probe = `(() => { const s = __s3; let warm = 0, glow = 0; s.scene.traverse((o) => {
          for (let a = o; a; a = a.parent) if (a.userData?.warmLight) return;
          if ((o.isPointLight || o.isSpotLight || o.isRectAreaLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) warm++;
          if (o.isMesh && o.visible) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) glow++; });
        const p = s.rig.body.position;
        return { name: s.name, entry: s.entryId, pos: p.toArray().map((v) => +v.toFixed(2)), frame: s.frame.position.toArray(), rot: +s.frame.rotation.y.toFixed(4),
          water: s.water ? [s.water.position.x, s.water.position.y, s.water.position.z] : null, indoor: s.cameraFollow.indoorVolumes.length, warm, glow, on: s.lighthouseOn,
          art: s.art.loaded, keys: s.art.root.children.map((c) => c.name), door: !!s.art.door && s.art.door.parent === s.greybox.door, gb: s.greybox.colliders[0].visible,
          ignite: s.puzzles.beam.igniter.state }; })()`;
      await cdp.goto('debug=1&scene=s3', 's3-lighthouse');
      if (!(await until(`!!window.__s3?.rig`, 30000))) throw new Error('?scene=s3 没进 S3');
      let s = await evaluate(probe);
      // 桥尾 spawn-from-s2 (−22.627, 3, −22.627) → 世界
      const want = [39.73 + -22.627 * Math.cos(Math.PI * 0.75) + -22.627 * Math.sin(Math.PI * 0.75), 3, -122.75 + 22.627 * Math.sin(Math.PI * 0.75) + -22.627 * Math.cos(Math.PI * 0.75)];
      if (s.entry !== 'from-s2' || Math.hypot(s.pos[0] - want[0], s.pos[2] - want[2]) > 0.4 || Math.abs(s.pos[1] - 3) > 0.1) throw new Error('S3 入口不对 ' + JSON.stringify({ s, want }));
      if (Math.abs(s.frame[0] - 39.73) > 1e-6 || Math.abs(s.frame[2] + 122.75) > 1e-6 || Math.abs(s.rot - 2.3562) > 1e-3) throw new Error('S3 世界摆位不对 ' + JSON.stringify(s));
      if (!s.water || Math.abs(s.water[0] - 39.73) > 1e-6 || Math.abs(s.water[2] + 122.75) > 1e-6 || s.indoor < 1) throw new Error('S3 海面 / 室内触发体不对 ' + JSON.stringify(s));
      if (s.warm || s.glow || s.on) throw new Error('S3 点灯前不应有环境暖光 / 自发光 ' + JSON.stringify(s));
      out.push(`白盒：桥尾入口 ${s.pos}、塔心 (39.73, −122.75) 转 135°、海面挪到塔心 y ${s.water[1]}、室内触发体 ×${s.indoor}、无暖光 ✓`);
      // 光路：三面镜子转到正解 → 主天光依次过三面镜子停在点火口
      const path = await evaluate(`(() => { const b = __s3.puzzles.beam; b.solve(); b.sky.alwaysOn = true; b.tracer.trace(); const p = b.tracer.paths.find((q) => q.emitter.id === 'sky-s3'); return { mirrors: p.mirrors, rec: p.receiver?.id ?? null }; })()`);
      if (path.rec !== 'ignition-port-s3' || path.mirrors.length !== 3) throw new Error('S3 光路正解没到点火口 ' + JSON.stringify(path));
      await evaluate(`(() => { const b = __s3.puzzles.beam; b.reset(); b.sky.alwaysOn = false; return 1; })()`);
      out.push('光路正解：窗口镜 → 导光镜 1 → 导光镜 2 → 点火口 ✓');
      await cdp.goto('debug=1&scene=s3&art=1', 's3-lighthouse');
      if (!(await until(`!!window.__s3?.rig`, 60000))) throw new Error('art=1 没进 S3');
      s = await evaluate(probe);
      const keys = ['env-lighthouse-ch1-s3', 'env-lighthouse-ch1-interior', 'env-lamp-room-ch1', 'prop-fresnel-lens-ch1', 'env-rock-islet-a', 'env-stone-bridge-s3'];
      if (!s.art || keys.some((k) => !s.keys.includes(k)) || !s.door || s.gb) throw new Error('S3 美术件没加载全 / 白盒没隐藏 ' + JSON.stringify(s));
      if (s.warm || s.glow || s.on) throw new Error('S3 美术接入后点灯前不应有环境暖光 / 自发光 ' + JSON.stringify(s));
      out.push('art=1：020 六件 + 门扇挂合页、白盒隐藏、无暖光 ✓');
      // 1030b 导光镜 a / b 两个文件：都挂上、约定节点齐；初始 / 正解两态美术镜面（位置 + 法线）= 白盒镜面
      const gm = await evaluate(`(() => {
        const s = __s3; const V = s.rig.body.position.constructor; const beam = s.puzzles.beam; const ms = s.artSlots?.mounted ?? []; const r = {};
        const n = (o) => new V(0, 0, 1).transformDirection(o.matrixWorld);
        for (const k of ['a', 'b']) {
          const m = ms.find((x) => x.id === 'prop-guide-mirror-wall-s3-' + k);
          if (!m) { r[k] = null; continue; }
          let plane = null;
          m.model.traverse((o) => { if (!plane && /mirror-plane$/.test(o.name)) plane = o; });
          const rig = beam.mirrors[k]; const st = [];
          for (const solved of [false, true]) {
            if (solved) beam.solve(); else beam.reset();
            s.artSlots.update(); s.scene.updateMatrixWorld(true);
            st.push({ deg: (n(plane).angleTo(n(rig.plane)) * 180) / Math.PI, d: plane.getWorldPosition(new V()).distanceTo(rig.plane.getWorldPosition(new V())) });
          }
          beam.reset();
          r[k] = { st, missing: m.missingNodes, parent: m.model.parent?.name, gbHidden: !rig.plane.visible };
        }
        return r;
      })()`);
      for (const k of ['a', 'b']) {
        const g = gm[k];
        if (!g) throw new Error(`art=1 导光镜 ${k}（prop-guide-mirror-wall-s3-${k}）没挂上 ` + JSON.stringify(gm));
        if (g.missing.length || g.parent !== `guide-mirror-s3-mid-${k}` || !g.gbHidden || g.st.some((x) => x.deg > 0.05 || x.d > 0.005)) throw new Error(`art=1 导光镜 ${k} 不对 ` + JSON.stringify(g));
      }
      out.push(`art=1 导光镜 a / b 两个文件挂白盒组、初始 / 正解镜面 = 白盒（最大 ${Math.max(...['a', 'b'].flatMap((k) => gm[k].st.map((x) => x.deg))).toFixed(3)}°）✓`);
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      try { await cdp.goto(''); } catch (e) { throw new Error('回 S1 失败：' + e.message, { cause: e }); }
      return out.join('，');
    },
  },
  {
    name: 'v0.1-015 S3 谜题 5 流程：涨潮底层送回 / 敲钟退潮 / 开门撤碰撞 / 先调镜后开阀（红光 + 没有油 → 开阀重新计时）/ 光斑上升沿亮 + 共鸣 / 天光常亮 / 提示步骤 / 点灯',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      const until = async (expr, ms = 8000) => {
        const end = Date.now() + ms;
        let v;
        while (Date.now() < end) {
          v = await evaluate(expr);
          if (v) return v;
          await sleep(100);
        }
        return v;
      };
      await cdp.goto('debug=1&scene=s3', 's3-lighthouse');
      if (!(await until(`!!window.__s3?.rig && __s3.game.input.context === 'explore' && __s3.cameraFollow.modeName === 'explore'`, ESTAB_MS))) throw new Error('?scene=s3 没进 S3');
      const put = (x, y, z) => `(() => { const s = __s3; const w = s.frame.localToWorld(s.rig.body.position.clone().set(${x}, ${y}, ${z})); s.rig.body.position.copy(w); s.rig.body.velocity.set(0, 0, 0); return 1; })()`;
      // 机器负载高时游戏时间远慢于真实时间：计时类步骤直接推进谜题 / 潮汐的物理步（每步 0.05 s）
      const ff = (sec) => evaluate(`(() => { for (let i = 0; i < ${Math.round(sec / 0.05)}; i++) __s3.puzzles.fixedUpdate(0.05); return 1; })()`);
      // 等「游戏时间」而不是墙钟：高负载下一帧最多 5 个物理步、帧率掉到个位数，墙钟 3 s 可能只有零点几秒游戏时间
      // （BUG：石桥独白 / 送回黑场没走完就站到拉杆前 → busy + teleport 没有「E 点灯」）。条件满足就返回；
      // 游戏时间走满 gameSec 仍不满足 = 失败（真实负载下墙钟上限 wallMs 兜底，防止卡死）
      const untilG = async (expr, gameSec, wallMs = 120000) => {
        const end = Date.now() + wallMs;
        let t0 = null;
        let v;
        while (Date.now() < end) {
          const r = await evaluate(`(() => { const v = (${expr}); return { v, tick: __game.time.fixedTick, dt: __game.time.fixedDelta }; })()`);
          v = r.v;
          if (v) return v;
          t0 ??= r.tick;
          if ((r.tick - t0) * r.dt >= gameSec) return v;
          await sleep(50);
        }
        return v;
      };
      const waitG = (gameSec) => untilG('false', gameSec);
      const near = (x, y, z, d) => `(() => { const s = __s3; const w = s.frame.localToWorld(s.rig.body.position.clone().set(${x}, ${y}, ${z})); return s.rig.body.position.distanceTo(w) < ${d}; })()`;
      // 石桥中段独白
      await evaluate(put(...[-14.14, 3.05, -14.14]));
      if (!(await untilG(`__s3.puzzles.state.said.has('ch1.s3.bridge.mono_arrive')`, 3))) throw new Error('石桥独白没触发');
      out.push('石桥独白 ✓');
      // 初始涨潮：天光 40 s / 25 s 周期；底层（地面 0.2）→ 送回门外平台
      let st = await evaluate(`(() => { const p = __s3.puzzles; return { tide: p.tide.state, level: p.tide.level, period: p.beam.sky.periodSec, always: p.beam.sky.alwaysOn }; })()`);
      if (st.tide !== 'high' || Math.abs(st.level - 1.6) > 1e-6 || st.period !== 40 || st.always) throw new Error('S3 初始状态不对 ' + JSON.stringify(st));
      await evaluate(put(0.8, 0.4, 1.8));
      if (!(await untilG(near(-4.526, 2.4, -3.677, 0.6), 10))) throw new Error('涨潮时底层没送回门外平台 ' + JSON.stringify(await evaluate(`__s3.rig.body.position.toArray()`)));
      // 送回在黑场中间瞬移，之后还有 0.5 s 保持 + 0.2 s 淡出（controller.busy / mode teleport）；ff 只推谜题不推控制器，
      // 不等它走完，后面 put / stand 到拉杆前时还在 teleport → 交互不出提示（拉杆前没显示「E 点灯」的根因之一）
      if (!(await untilG(`!__s3.rig.controller.busy && __s3.rig.controller.mode.kind === 'free'`, 3))) throw new Error('送回黑场没结束 ' + JSON.stringify(await evaluate(`__s3.rig.controller.mode.kind`)));
      out.push('涨潮底层 → 送回门外平台 ✓');
      // 敲钟 → 退潮（6 s）
      await evaluate(`__s3.game.events.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }), 1`);
      if (!(await evaluate(`__s3.puzzles.bell.rings === 1 && __s3.puzzles.tide.state === 'low'`))) throw new Error('敲钟没生效 ' + JSON.stringify(await evaluate(`({ rings: __s3.puzzles.bell.rings, st: __s3.puzzles.tide.state })`)));
      await evaluate(`__s3.tides.fixedUpdate(7), 1`);
      if (!(await untilG(`__s3.puzzles.tide.state === 'low' && !__s3.puzzles.tide.transitioning`, 3))) throw new Error('敲钟没退潮 ' + JSON.stringify(await evaluate(`({ st: __s3.puzzles.tide.state, lv: __s3.puzzles.tide.level, t: __s3.puzzles.tide.t, ctx: __s3.game.input.context, paused: __s3.game.isPaused, frozen: __s3.game.isFrozen })`)));
      // 开门：1.4 s，撤门扇碰撞
      await evaluate(`__s3.game.events.emit('interact:used', { id: 'door-s3', kind: 'use' }), 1`);
      await ff(1.5);
      if (!(await untilG(`__s3.puzzles.state.doorOpen >= 1`, 3))) throw new Error('门没开');
      const doorCol = await evaluate(`(() => { const s = __s3; const c = s.colliderOf.get(s.greybox.doorLeaf); return c ? c.enabled : null; })()`);
      if (doorCol !== false) throw new Error('开门后门扇碰撞没撤 ' + doorCol);
      out.push('敲钟退潮、开门撤碰撞 ✓');
      // 底层仰视独白
      await evaluate(put(0.6, 0.25, 1.2));
      await waitG(0.4);
      await evaluate(`__s3.cameraFollow.pitch = 0.9, 1`);
      if (!(await untilG(`__s3.puzzles.state.said.has('ch1.s3.stairwell.mono_look_up')`, 3))) throw new Error('仰视独白没触发');
      // 先调镜子、后开阀：天光亮着时转到正解 → 上升沿 3 次（A 亮、B 亮、点火口）+ 点火口红光 + 没有油
      await evaluate(`(() => { const b = __s3.puzzles.beam; b.sky.alwaysOn = true; return 1; })()`);
      await ff(0.2);
      const f0 = await evaluate(`__s3.puzzles.state.flashes`);
      await evaluate(`__s3.puzzles.beam.solve(), 1`);
      await ff(0.1);
      if (!(await untilG(`__s3.puzzles.state.reached === 3`, 3))) throw new Error('正解后光路没到点火口');
      const f1 = await evaluate(`__s3.puzzles.state.flashes`);
      if (f1 - f0 !== 3) throw new Error('光斑上升沿反馈次数不对 ' + (f1 - f0));
      await ff(2.2);
      if (!(await untilG(`__s3.puzzles.beam.igniter.state === 'blocked' && __s3.puzzles.state.noOilSaid > 0`, 3))) throw new Error('未开阀时点火口没进红光 / 没有「没有油。」');
      if (await evaluate(`__s3.puzzles.leverIx.enabled`)) throw new Error('未开阀时拉杆不应可点');
      out.push('先调镜：光斑亮 ×3 + 共鸣、点火口红光 +「没有油。」、拉杆不可点 ✓');
      // 开阀：天光 / 预告光常亮、点火口重新计时（不是立即触发）
      await evaluate(`(() => { const b = __s3.puzzles.beam; b.sky.alwaysOn = false; __s3.game.events.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }); return 1; })()`);
      st = await evaluate(`(() => { const p = __s3.puzzles; return { valve: p.state.valveOpen, sky: p.beam.sky.alwaysOn, prev: p.beam.preview.alwaysOn, ig: p.beam.igniter.state }; })()`);
      if (!st.valve || !st.sky || !st.prev || st.ig === 'activated') throw new Error('开阀后状态不对 ' + JSON.stringify(st));
      await ff(2.2);
      // 015 C：开阀那一刻起连续受光 1.0 s → 可点灯（ready，冷白微光），不会自己点燃
      if (!(await untilG(`__s3.puzzles.beam.igniter.state === 'ready' && __s3.puzzles.leverIx.enabled && __s3.puzzles.state.readyCount >= 1`, 3))) throw new Error('开阀后点火口没进可点灯 / 拉杆没开放 ' + JSON.stringify(await evaluate(`__s3.puzzles.beam.igniter.state`)));
      if (await evaluate(`__s3.puzzles.state.ignited || __s3.puzzles.beam.igniter.activated`)) throw new Error('可点灯不应自动点燃');
      // 可点灯嗡鸣：进入可点灯开始循环（AudioSystem 按名字只一个实例）
      // 只看点火口嗡鸣：?art=1 下塔内环境声（amb-wind-tower / amb-water-in-tower）和导光镜连通的 sfx-beam-hum-loop 也在 loopNames 里，与嗡鸣无关
      const humSt = `(() => { const h = __s3.puzzles.hum, a = __s3.game.audio; return { on: h.on, starts: h.starts, stops: h.stops, loops: a.loopNames.filter((n) => n === 'sfx-ignite-ready-loop'), others: a.loopNames.filter((n) => n !== 'sfx-ignite-ready-loop') }; })()`;
      let hum = await evaluate(humSt);
      if (!hum.on || hum.starts !== 1 || hum.loops.join() !== 'sfx-ignite-ready-loop') throw new Error('进入可点灯应开始嗡鸣循环（一个实例） ' + JSON.stringify(hum));
      const steps = await evaluate(`[...__s3.hints.puzzles.get('p5').doneSteps]`);
      if (['valve', 'window_mirror', 'mid_a', 'mid_b'].some((k) => !steps.includes(k))) throw new Error('提示步骤没全部完成 ' + JSON.stringify(steps));
      // 可点灯 + 提示已解锁：H 只显示 ignite.l3
      await evaluate(`__s3.hints.debugSetTime('p5', 700), 1`);
      const hv = await evaluate(`(() => { const v = __s3.hints.view(); return { step: v.step, ids: v.lines.map((l) => l.textId) }; })()`);
      if (hv.step !== 'override' || hv.ids.join() !== 'ch1.hint.p5.ignite.l3') throw new Error('可点灯时 H 应只显示 ch1.hint.p5.ignite.l3 ' + JSON.stringify(hv));
      out.push('开阀：从开阀起 1.0 s 进可点灯（不自动点燃）、提示四步完成、H 只显示 ignite.l3 ✓');
      // 20 s 提醒：不自动点灯，只脉冲一次
      await ff(20.2);
      st = await evaluate(`(() => { const p = __s3.puzzles; return { rem: p.state.reminders, ig: p.beam.igniter.state, lit: p.state.ignited }; })()`);
      if (st.rem !== 1 || st.ig !== 'ready' || st.lit) throw new Error('20 s 提醒不对 ' + JSON.stringify(st));
      await ff(25);
      if ((await evaluate(`__s3.puzzles.state.reminders`)) !== 1) throw new Error('每次进入可点灯最多提醒一次');
      hum = await evaluate(humSt);
      if (!hum.on || hum.starts !== 1 || hum.stops !== 0 || hum.loops.join() !== 'sfx-ignite-ready-loop') throw new Error('可点灯期间嗡鸣应一直循环、不重开不叠加 ' + JSON.stringify(hum));
      out.push('可点灯 20 s 未按 E：ignition:reminder 一次、不自动点灯；嗡鸣循环 45 s 不断不叠加 ✓');
      // 提示范围：拉杆 1.8 m、±60° 内才出「E 点灯」
      const prompt = `((p) => (p && !p.hidden ? p.textContent : ''))(document.querySelector('.hud-prompt'))`;
      const stand = (dx, yawOff) => `(() => { const s = __s3; const sp = s.puzzles.leverIx.standPoint(s.rig.body.position.clone()); s.rig.body.position.set(sp.position.x + ${dx} * Math.sin(sp.facing), sp.position.y + 0.02, sp.position.z + ${dx} * Math.cos(sp.facing)); s.rig.body.velocity.set(0, 0, 0); s.rig.controller.facing = sp.facing + ${yawOff}; return 1; })()`;
      // 灯室半径有限：往室内（面朝方向）退 3.2 m、回头面向拉杆 = 只测距离
      await evaluate(stand(3.2, Math.PI));
      await waitG(0.5);
      if (/点灯/.test(await evaluate(prompt))) throw new Error('离拉杆 3.2 m 不应显示「E 点灯」');
      await evaluate(stand(0, Math.PI));
      await waitG(0.5);
      if (/点灯/.test(await evaluate(prompt))) throw new Error('背对拉杆不应显示「E 点灯」');
      await evaluate(stand(0, 0));
      if (!(await untilG(`!__s3.rig.controller.busy`, 3))) throw new Error('拉杆前控制器一直 busy ' + JSON.stringify(await evaluate(`__s3.rig.controller.mode.kind`)));
      if (!(await untilG(`/E\\s*点灯/.test(${prompt})`, 3))) throw new Error('拉杆前没显示「E 点灯」：' + (await evaluate(prompt)) + JSON.stringify(await evaluate(`(() => { const s = __s3; const ix = s.puzzles.leverIx; const it = s.interaction ?? s.game.interaction; const f = ix.focus(s.rig.body.position.clone()); return { en: ix.enabled, av: ix.available, ctx: s.game.input.context, pos: s.rig.body.position.toArray(), f: f.toArray(), facing: s.rig.controller.facing, can: it?.canInteract?.(ix), cur: it?.current?.id ?? null, act: it?.actionKind, busy: s.rig.controller.busy, mode: s.rig.controller.mode?.kind, locked: s.rig.controller.locked, paused: s.game.isPaused, frozen: s.game.isFrozen, lp: it?.o?.linkPriority?.() ?? null, ig: s.puzzles.beam.igniter.state }; })()`)));
      if (/操作/.test(await evaluate(prompt))) throw new Error('点灯不应用「E 操作」');
      out.push('「E 点灯」只在拉杆 1.8 m / ±60° 内出现 ✓');
      // BUG-015：可点灯时站在拉杆站位，相机 yaw ±0.6 × pitch 0 / −0.25 / −0.5（21 个视角）都选拉杆，不被透镜 inspect 抢走
      if (await evaluate(`__s3.puzzles.lensIx.enabled`)) throw new Error('可点灯时透镜 inspect 应让位（lensIx.enabled 应为 false）');
      const views = [];
      for (const pitch of [0, -0.25, -0.5])
        for (let k = -3; k <= 3; k++) {
          await evaluate(`(() => { const s = __s3; const sp = s.puzzles.leverIx.standPoint(s.rig.body.position.clone()); s.rig.body.position.set(sp.position.x, sp.position.y + 0.02, sp.position.z); s.rig.body.velocity.set(0, 0, 0); s.rig.controller.facing = sp.facing; s.cameraFollow.yaw = sp.facing + Math.PI + ${k * 0.2}; s.cameraFollow.pitch = ${pitch}; window.__t15 = s.game.time.fixedTick; return 1; })()`);
          await until(`__s3.game.time.fixedTick >= window.__t15 + 3`, 60000);
          views.push(await evaluate(`__s3.interaction.current?.id ?? null`));
        }
      const bad = views.filter((id) => id !== 'ignite-lever-s3');
      if (bad.length) throw new Error(`BUG-015：21 个视角里 ${bad.length} 个没选拉杆 ` + JSON.stringify(views));
      if (!/E\s*点灯/.test(await evaluate(prompt))) throw new Error('BUG-015 扫视角后提示不是「E 点灯」');
      out.push('BUG-015：可点灯时拉杆站位 21 个视角全选拉杆「E 点灯」，透镜让位 ✓');
      // 按 E：锁输入（cutscene）→ 走到 -interact → xi-ignite-lever 第 34 帧（1.133 s）点燃；连按只一次
      // 「1.0 s 内不该点燃」：按 E 由真实游戏循环处理，从按下到下面 ff 之间真实循环还会推进走位 / 动作（高负载下一帧 5 步 = 0.083 s，
      // 几次 evaluate 往返就能吃掉 0.133 s 余量）→ 记下按 E 生效后谜题实际走过的游戏时间（__igT），冻结真实循环，再只用 ff 推到 1.0 s
      await evaluate(`(() => { window.__lit = 0; __s3.game.events.on('lighthouse:ignited', () => window.__lit++); const p = __s3.puzzles; window.__igT = 0; const f = p.fixedUpdate; p.fixedUpdate = (dt) => { if (p.state.igniting && !p.state.ignited) window.__igT += dt; f.call(p, dt); }; return 1; })()`);
      await evaluate(`__s3.game.input.setRaw('smoke', 'KeyE', true); 1`);
      if (!(await untilG(`__s3.puzzles.state.igniting && (window.__unfreeze15 ??= __s3.game.freeze(), true)`, 3))) throw new Error('按 E 没生效');
      await evaluate(`__s3.game.input.setRaw('smoke', 'KeyE', false); 1`);
      const igT0 = await evaluate(`window.__igT`);
      st = await evaluate(`({ ctx: __s3.game.input.context, en: __s3.puzzles.leverIx.enabled, lit: __s3.puzzles.state.ignited })`);
      if (st.ctx !== 'cutscene' || st.en || st.lit) throw new Error('按 E 后应锁输入、禁用拉杆、还没点燃 ' + JSON.stringify(st));
      await evaluate(`__s3.game.events.emit('interact:used', { id: 'ignite-lever-s3', kind: 'use' }), 1`);
      if (igT0 > 0.9) throw new Error('按 E 到冻结之间真实循环已走 ' + igT0.toFixed(3) + ' s，测不了 1.0 s 内');
      await ff(1.0 - igT0);
      if (await evaluate(`__s3.puzzles.state.ignited`)) throw new Error('走位 + 1.0 s 内不该点燃（第 34 帧 = 1.133 s）：已走 ' + (await evaluate(`window.__igT`)).toFixed(3) + ' s');
      hum = await evaluate(humSt);
      if (!hum.on || hum.loops.join() !== 'sfx-ignite-ready-loop') throw new Error('点灯演出中（点燃前）嗡鸣不该停 ' + JSON.stringify(hum));
      await ff(1.2);
      await evaluate(`(window.__unfreeze15?.(), window.__unfreeze15 = undefined, 1)`);
      if (!(await untilG(`__s3.lighthouseOn && __s3.puzzles.state.ignited && !__s3.puzzles.leverIx.enabled && __s3.puzzles.beam.igniter.activated`, 3))) throw new Error('点灯没生效');
      const leverRot = await evaluate(`__s3.puzzles.leverSwing.rotation.x * 180 / Math.PI`);
      if (Math.abs(leverRot + 60) > 0.5) throw new Error('拉杆没转到 −60° ' + leverRot);
      hum = await evaluate(humSt);
      if (hum.on || hum.stops !== 1 || hum.loops.length) throw new Error('点燃后嗡鸣应淡出停止 ' + JSON.stringify(hum));
      await evaluate(`__s3.game.events.emit('interact:used', { id: 'ignite-lever-s3', kind: 'use' }), 1`);
      await ff(0.5);
      if ((await evaluate(`window.__lit`)) !== 1) throw new Error('lighthouse:ignited 应只发一次 ' + (await evaluate(`window.__lit`)));
      out.push('按 E：锁输入 → 走位 → 拉杆逐帧转到 −60° → 第 34 帧点燃，lighthouse:ignited 只一次；嗡鸣点燃前一直在、点燃后停 ✓');
      // 点灯独白 ch1.s3.ignite.mono：ignited 后 0.5 s 起 3.0 s、锁定不可点掉、只一次；0:04 切远景前消失。
      // 035 起时间轴走演出时钟（结尾曲音频时钟 / 无音频时 performance.now），不走游戏时间 → 按 __s3.endingCutscene.t 等；0:04 不再进结束页
      const untilT = async (T, wallMs = 30000) => {
        const end = Date.now() + wallMs;
        while (Date.now() < end) {
          if ((await evaluate(`__s3.endingCutscene?.t ?? -1`)) >= T) return true;
          await sleep(50);
        }
        return false;
      };
      const subNow = `(() => { const c = __s3.game.ui.subtitles.current; return c ? { id: c.id, locked: c.locked } : null; })()`;
      if (!(await untilT(1.0))) throw new Error('演出时钟没走到 1.0 s');
      let sub = await evaluate(subNow);
      if (sub?.id !== 'ch1.s3.ignite.mono' || !sub.locked) throw new Error('点灯后 1.0 s 应显示锁定的点灯独白 ' + JSON.stringify(sub));
      if (await evaluate(`__s3.game.ui.subtitles.track.advance()`)) throw new Error('点灯独白不应能点掉');
      if (!(await untilT(3.6))) throw new Error('演出时钟没走到 3.6 s');
      sub = await evaluate(subNow);
      if (sub?.id === 'ch1.s3.ignite.mono') throw new Error('点灯独白 3.5 s 后应消失');
      if (await evaluate(`__s3.game.scenes.current !== __s3`)) throw new Error('0:04 前不应离开 S3');
      if (!(await evaluate(`__s3.game.narrative.hasSeen('ch1.s3.ignite.mono')`))) throw new Error('点灯独白应记为已看过');
      if (!(await untilT(5.0))) throw new Error('演出时钟没走到 5 s');
      st = await evaluate(`({ cur: __s3.game.scenes.current === __s3, shot: __s3.endingCutscene.shot, cam: __s3.cameraFollow.cutsceneName })`);
      if (!st.cur || st.shot !== 'far-exterior' || st.cam !== 'ch1-ending') throw new Error('035：0:04 后应切塔外远景、仍在 S3（不再进结束页）' + JSON.stringify(st));
      // 推到演出尾：106 s 才进结束页
      await evaluate(`__s3.endingCutscene.seek(${ENDING_CUES.silence - 1.5}), 1`);
      await sleep(300);
      if (await evaluate(`__s3.game.scenes.current !== __s3`)) throw new Error(`035：${ENDING_CUES.silence} s 前不应进结束页`);
      if (!(await untilG(`typeof __s3 === 'undefined' || __s3.game.scenes.current !== __s3`, 8))) throw new Error(`035：演出 ${ENDING_CUES.silence} s 结束后应进章节结束页`);
      out.push('点灯独白 0.5–3.5 s 锁定不可点掉、只一次，0:04 前消失 → 0:04 切塔外远景（不进结束页）→ 106 s 演出结束才进章节结束页 ✓');
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      try { await cdp.goto(''); } catch (e) { throw new Error('回 S1 失败：' + e.message, { cause: e }); }
      return out.join('，');
    },
  },
  {
    name: 'v0.1-021/022 替换入口 art=1：S1 / S2 / S3 表里的白盒节点名都在、未交付道具不发请求（不 404），已交付的（潮汐钟、木筏）挂上',
    async run({ evaluate, cdp, sleep }) {
      const out = [];
      for (const [q, scene, v] of [['s1', 's1-ebb-shore', '__s1'], ['s2', 's2-keeper-house', '__s2'], ['s3', 's3-lighthouse', '__s3']]) {
        await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
        await cdp.goto(`debug=1&scene=${q}&art=1`, scene);
        let ok = false;
        for (let i = 0; i < 600 && !ok; i++) {
          ok = await evaluate(`!!(window.${v} && ${v}.artSlots)`);
          if (!ok) await sleep(100);
        }
        if (!ok) throw new Error(`${q} 没就绪`);
        const r = await evaluate(`(() => { const s = ${v}; const mounted = s.artSlots.mounted.map((m) => m.id); const req = performance.getEntriesByType('resource').map((e) => /models\\/props\\/(prop-(?:tide-bell|raft-s1|mirror-stand|light-lock|white-stones|dial-gate|oil-valve|guide-mirror|ignition-port)[a-z0-9-]*)\\.glb/.exec(e.name)?.[1]).filter((n) => n && !mounted.some((id) => id.startsWith(n))); return { miss: s.artSlotGreyboxMissing, mounted, req }; })()`);
        if (r.miss.length) throw new Error(`${q} 替换表白盒节点名对不上：${r.miss.join('、')}`);
        if (q !== 's2' && !r.mounted.some((id) => id.startsWith('prop-tide-bell'))) throw new Error(`${q} 潮汐钟美术没挂上 ` + JSON.stringify(r));
        if (q === 's1' && !r.mounted.includes('prop-raft-s1')) throw new Error('s1 木筏美术没挂上 ' + JSON.stringify(r));
        // 1030c 重建钟：根 extras.clapperHitRad = 0.0537 生效
        if (q !== 's2') {
          const hr = await evaluate(`${v}.puzzles.bell.clapperHitRad`);
          if (Math.abs(hr - 0.0537) > 1e-9) throw new Error(`${q} 钟锤阈值应读美术根 0.0537，实际 ${hr}`);
          out.push(`${q} 钟锤阈值 ${hr}（美术根）`);
        }
        if (r.req.length) throw new Error(`${q} 请求了没挂上的道具（未交付应不请求）：${r.req.join('、')}`);
        out.push(`${q}：节点齐、挂上 ${r.mounted.length} 件${r.mounted.length ? '（' + r.mounted.join('/') + '）' : ''}、未交付 0 请求`);
      }
      await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
      await cdp.goto('');
      return out.join('；');
    },
  },
];
// 裁定 19（制作人）：观察模式外 317 可读机位按簇判定——Node 跑 sample-317.mjs（不走浏览器，约 8–12 min），
// B 簇（西窗外室外）须 0、A 簇（二层观察点身后，接受）只报数量；脚本退出码 ≠ 0 即失败。SMOKE_ONLY='v0.1-019' 单跑
CHECKS.push({
  name: 'v0.1-019 裁定 19 sample-317：西窗外室外第三人称机位读不出 317（B 簇 = 0），二层 A 簇报数量',
  async run() {
    const { status, text } = await new Promise((res) => {
      const ch = spawn(process.execPath, ['--import', './scripts/register-ts-paths.mjs', 'scripts/sample-317.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
      let text = '';
      ch.stdout.on('data', (d) => (text += d));
      ch.stderr.on('data', (d) => (text += d));
      ch.on('close', (status) => res({ status, text }));
    });
    const m = /SAMPLE317 A=(\d+) B=(\d+)/.exec(text);
    if (/白石组美术不在/.test(text)) return '白石组美术不在（../art），跳过';
    if (status !== 0 || !m) throw new Error(`sample-317 退出码 ${status}：${text.split('\n').filter((l) => /SAMPLE317|✗|Error/.test(l)).join(' / ').slice(0, 600)}`);
    return `A 簇 ${m[1]} 个（接受）、B 簇 ${m[2]} 个 ✓`;
  },
});

// 033 / 036 配乐：主菜单 art=1 → mus-menu 整文件循环（未交互时 context 挂起不报错，第一次点击后真正出声）→ 新游戏进 S1 → 和 mus-s1-ebb-shore 2 s 交叉淡化。
// 用 AnalyserNode 挂在音乐总线上量电平证明在播；等待按 AudioContext 时钟 / 游戏时间（__game.time.elapsed），不按墙钟
/** 懒加载诊断：导航前注入（长任务 / rAF 断档 / 计时器迟到） */
const LAZY_DIAG_INIT = `(() => { const d = (window.__diag = { lt: [], gap: [], late: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.duration >= 1000) d.lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask' }); } catch {}
  let last = 0; const f = (t) => { if (last && t - last >= 1500) d.gap.push([Math.round(last), Math.round(t - last)]); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f);
  let due = performance.now() + 500; setInterval(() => { const n = performance.now(); if (n - due >= 1500) d.late.push([Math.round(due), Math.round(n - due)]); due = n + 500; }, 500); })()`;
/** 失败时：诊断记录 + 场景曲请求前后 2 s 起的全部资源请求（名 / 开始 / 结束 / 字节） */
const LAZY_DIAG_DUMP = `(() => { const d = window.__diag ?? {}; const req = __game.scenes.current?.musicRequestedAt ?? 0;
  const rs = performance.getEntriesByType('resource').filter((e) => e.responseEnd >= req - 2000).map((e) => [e.name.split('/').pop().slice(0, 40), Math.round(e.startTime), Math.round(e.responseEnd), e.encodedBodySize]);
  return { lt: d.lt, gap: d.gap, late: d.late, res: rs.slice(0, 60), nres: rs.length, tr: __game.flow?.lastTransition ?? null }; })()`;

CHECKS.push({
  name: 'v0.1-033 配乐：主菜单 mus-menu 循环 + 首次交互后出声、新游戏进 S1 与 mus-s1-ebb-shore 2 s 交叉淡化、menu 组无 preview',
  async run({ evaluate, cdp, sleep }) {
    const out = [];
    const until = async (expr, ms = 60000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(expr).catch(() => false)) return true;
        await sleep(100);
      }
      return false;
    };
    /** 等游戏时间 / 音频时钟走过 sec 秒（机器负载高时墙钟不可靠） */
    const waitClock = async (clockExpr, sec, ms = 120000) => {
      const t0 = await evaluate(clockExpr);
      if (!(await until(`(${clockExpr}) >= ${t0 + sec}`, ms))) throw new Error(`${clockExpr} 在 ${ms / 1000}s 墙钟内没走过 ${sec}s`);
    };
    const audio = `__game.audio`;
    // 033 改（反馈 2）电平量法：A 整条——解码后的 AudioBuffer 全部声道整条 RMS + 曲目增益 + 音乐总线增益（= 音乐总线输出的整首电平）；
    // B 实采——ScriptProcessor 挂在音乐总线后，按音频时钟采 8 s 的 RMS（旁证；稀疏曲子的短窗口和整条差得多）
    const fullLevel = `(() => { const a = __game.audio; const v = a.music; const b = v.source.buffer; let s = 0, n = 0;
      for (let c = 0; c < b.numberOfChannels; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) s += d[i] * d[i]; n += d.length; }
      const file = 10 * Math.log10(s / n); return { key: v.key, file, track: 20 * Math.log10(a.musicLevel), bus: 20 * Math.log10(a.musicGain.gain.value), out: file + 20 * Math.log10(a.musicLevel) + 20 * Math.log10(a.musicGain.gain.value) }; })()`;
    const liveStart = `(() => { const a = __game.audio; if (!window.__musCap) { const sp = a.context.createScriptProcessor(4096, 2, 2); const z = a.context.createGain(); z.gain.value = 0;
      window.__musCap = { s: 0, n: 0 }; sp.onaudioprocess = (e) => { const c = window.__musCap; for (let ch = 0; ch < e.inputBuffer.numberOfChannels; ch++) { const d = e.inputBuffer.getChannelData(ch); for (let i = 0; i < d.length; i++) c.s += d[i] * d[i]; c.n += d.length; } };
      a.musicGain.connect(sp); sp.connect(z).connect(a.context.destination); } window.__musCap.s = 0; window.__musCap.n = 0; return a.context.currentTime; })()`;
    const liveRead = `(() => { const c = window.__musCap; return c.n ? 10 * Math.log10(c.s / c.n) : -999; })()`;
    const live = async () => {
      await evaluate(liveStart);
      await waitClock(`${audio}.context.currentTime`, 8);
      return evaluate(liveRead);
    };
    // 懒加载超时诊断（033menu 两次 45 s 超时）：主线程长任务 ≥1 s、rAF 断档 ≥1.5 s、计时器迟到 ≥1.5 s，失败时连同同期资源请求一起输出
    await cdp.initScript(LAZY_DIAG_INIT);
    await evaluate(`localStorage.clear(); 1`);
    await cdp.gotoMenu('art=1');
    if (!(await until(`${audio}.musicKey === 'mus-menu'`, 30000))) throw new Error('主菜单没起 mus-menu ' + JSON.stringify(await evaluate(`({ k: ${audio}.musicKey, log: ${audio}.musicLog, has: !!__game.assets.getAudio('mus-menu') })`)));
    const m0 = await evaluate(`({ loop: ${audio}.musicLoop, log: ${audio}.musicLog.slice(), state: ${audio}.context.state, bus: ${audio}.musicGain.gain.value,
      menuAudio: performance.getEntriesByType('resource').filter((e) => /\\/audio\\/music\\//.test(e.name)).map((e) => e.name.split('/').pop()),
      src: (() => { const v = ${audio}.music; return { loop: v.source.loop, ls: v.source.loopStart, le: v.source.loopEnd, dur: v.source.buffer.duration, ch: v.source.buffer.numberOfChannels }; })() })`);
    if (m0.loop !== true || m0.src.ls !== 0 || m0.src.le !== 0) throw new Error('mus-menu 应整文件 loop、不设循环点 ' + JSON.stringify(m0.src));
    if (Math.abs(m0.src.dur - 106.667) > 0.05 || m0.src.ch !== 2) throw new Error('mus-menu 时长 / 声道不对 ' + JSON.stringify(m0.src));
    if (m0.log.length !== 1 || m0.log[0].fade !== 0) throw new Error('主菜单第一首不应淡入 ' + JSON.stringify(m0.log));
    if (m0.menuAudio.some((n) => /preview/.test(n)) || m0.menuAudio.join() !== 'mus-menu.ogg') throw new Error('主菜单阶段只应下载 mus-menu.ogg：' + m0.menuAudio.join());
    out.push(`主菜单 mus-menu（${m0.src.dur.toFixed(2)} s / ${m0.src.ch} 声道，loop=true，循环点 0/0）起播时 context=${m0.log[0].ctxState}，总线 ${(20 * Math.log10(m0.bus)).toFixed(1)} dB`);
    // 第一次用户交互：点画面 → context running → 音乐总线有电平
    await cdp.click(100, 650);
    if (!(await until(`${audio}.context.state === 'running'`, 10000))) throw new Error('点击后 AudioContext 没解锁：' + (await evaluate(`${audio}.context.state`)));
    await waitClock(`${audio}.context.currentTime`, 1.5);
    const fm = await evaluate(fullLevel);
    const lv = await live();
    if (lv < -90) throw new Error('mus-menu 在播但音乐总线没有电平 ' + lv);
    out.push(`首次点击后 context=running；菜单曲电平：整条 ${fm.out.toFixed(2)} dBFS（文件 ${fm.file.toFixed(2)} + 曲目 ${fm.track.toFixed(2)} + 总线 ${fm.bus.toFixed(2)}），实采 8 s ${lv.toFixed(1)} dBFS`);
    // 新游戏 → S1（033 改：S1 曲懒加载——首帧渲染出来后才请求，解码完再和菜单曲 2 s 交叉淡化）
    const r = await evaluate(`(() => { const e = document.querySelector('.main-menu [data-act="new"]'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    await cdp.click(r.x, r.y);
    // 交叉淡化一开始就读（不等别的），淡化中途新曲增益应在 0–1 之间
    if (!(await until(`__game.scenes.current?.name === 's1-ebb-shore' && ${audio}.musicKey === 'mus-s1-ebb-shore'`, 240000))) throw new Error('新游戏进 S1 后没切到 mus-s1-ebb-shore ' + JSON.stringify(await evaluate(`({ s: __game.scenes.current?.name, k: ${audio}.musicKey, log: ${audio}.musicLog, res: __game.scenes.current?.musicLazyResult, ff: __game.scenes.current?.musicFirstFrameAt, req: __game.scenes.current?.musicRequestedAt, now: performance.now(), fail: __game.assets.lazyAudioFailures, rt: performance.getEntriesByType('resource').filter((e) => /mus-s1/.test(e.name)).map((e) => ({ s: Math.round(e.startTime), e: Math.round(e.responseEnd), st: e.responseStatus })), diag: ${LAZY_DIAG_DUMP} })`)));
    const x = await evaluate(`(() => { const l = ${audio}.musicLog.at(-1); const v = ${audio}.music; const sc = __game.scenes.current; const ff = __game.lastFirstFrame;
      const res = performance.getEntriesByType('resource').filter((e) => /mus-s1-ebb-shore\\.ogg/.test(e.name)).map((e) => ({ start: e.startTime, end: e.responseEnd }));
      return { l, now: ${audio}.context.currentTime, loop: v.source.loop, g: v.gain.gain.value, ff, req: sc.musicRequestedAt, ffSeen: sc.musicFirstFrameAt, res, menuStillPlaying: ${audio}.musicLog.filter((e) => e.op === 'stop').length, diag: ${LAZY_DIAG_DUMP} }; })()`);
    if (x.l.op !== 'play' || x.l.from !== 'mus-menu' || x.l.fade !== 2 || !x.loop) throw new Error('进 S1 应从 mus-menu 2 s 交叉淡化 ' + JSON.stringify(x));
    // 首帧证据：S1 首帧 render 时刻 ≤ 发起请求 ≤ 资源请求开始 ≤ 淡入开始（performance.now() 同一时基）
    if (!x.ff || x.ff.scene !== 's1-ebb-shore' || x.ffSeen !== x.ff.at) throw new Error('没有 S1 的 scene:firstFrame 记录 ' + JSON.stringify(x.ff));
    if (x.res.length !== 1) throw new Error('mus-s1-ebb-shore.ogg 应只请求一次 ' + JSON.stringify(x.res));
    if (!(x.req >= x.ff.at && x.res[0].start >= x.ff.at && x.l.wall >= x.res[0].end)) throw new Error('S1 曲应在首帧渲染之后才请求 / 淡入 ' + JSON.stringify(x));
    if (x.menuStillPlaying !== 0) throw new Error('S1 曲到之前菜单曲不应被停 ' + JSON.stringify(x));
    await waitClock(`${audio}.context.currentTime`, Math.max(0, x.l.at + 2.2 - x.now));
    const y = await evaluate(`({ g: ${audio}.music.gain.gain.value, k: ${audio}.musicKey, log: ${audio}.musicLog.length })`);
    if (Math.abs(y.g - 1) > 1e-3) throw new Error('交叉淡化 2 s 后 S1 曲应满音量 ' + JSON.stringify(y));
    // S1 稳定后（交叉淡化完 + 游戏时间 3 s）同一方法量 S1 曲
    await waitClock(`__game.time.elapsed`, 3);
    const fs1 = await evaluate(fullLevel);
    const lv2 = await live();
    if (fs1.key !== 'mus-s1-ebb-shore') throw new Error('S1 稳定后应在播 S1 曲 ' + fs1.key);
    if (Math.abs(fm.out - fs1.out) > 1) throw new Error(`主菜单曲与 S1 曲整条电平差 ${(fm.out - fs1.out).toFixed(2)} dB > 1 dB`);
    if (lv2 < -90) throw new Error('S1 曲在播但音乐总线没有电平');
    // 诊断：下载窗口内同时在下的其他请求 / 主线程长任务（判断慢在哪：资源排队 vs 主线程被占）
    const [ds, de] = [x.res[0].start, x.l.wall];
    const co = x.diag.res.filter((r) => !/mus-s1-ebb-shore/.test(r[0]) && r[1] < x.res[0].end && r[2] > ds);
    const lt = (x.diag.lt ?? []).filter((t) => t[0] + t[1] > ds && t[0] < de);
    out.push(`下载窗口同期其他请求 ${co.length} 个 / ${(co.reduce((a, r) => a + r[3], 0) / 1e6).toFixed(2)} MB；请求→淡入期间主线程长任务(≥1 s) ${lt.length} 个共 ${(lt.reduce((a, t) => a + t[1], 0) / 1000).toFixed(1)} s` + (co.length ? `（${co.slice(0, 8).map((r) => r[0]).join(', ')}）` : ''));
    out.push(
      `进 S1：首帧 render @${x.ff.at.toFixed(0)} ms → 发起请求 @${x.req.toFixed(0)} ms（+${(x.req - x.ff.at).toFixed(0)}）→ 下载 ${x.res[0].start.toFixed(0)}–${x.res[0].end.toFixed(0)} ms → 淡入 @${x.l.wall.toFixed(0)} ms` +
        `；mus-menu → mus-s1-ebb-shore 交叉淡化 ${x.l.fade} s（读数时 ${(x.now - x.l.at).toFixed(2)} s 处新曲增益 ${x.g.toFixed(2)}），2.2 s 后增益 ${y.g.toFixed(2)}；S1 稳定后电平：整条 ${fs1.out.toFixed(2)} dBFS（文件 ${fs1.file.toFixed(2)} + 曲目 ${fs1.track.toFixed(2)} + 总线 ${fs1.bus.toFixed(2)}），实采 8 s ${lv2.toFixed(1)} dBFS；主菜单 − S1 整条差 ${(fm.out - fs1.out).toFixed(2)} dB`,
    );
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto('');
    return out.join('；');
  },
});

// 033 改（制作人 c0d81c9 反馈 1）：S1 曲下载失败（CDP 把 mus-s1-ebb-shore.ogg 路由成 404）→ 菜单曲照常 2 s 淡出、不放音乐、游戏不报错
CHECKS.push({
  name: 'v0.1-033 懒加载失败：S1 曲 404 → 菜单曲 2 s 淡出、不放音乐、不报错',
  async run({ evaluate, cdp, sleep }) {
    const until = async (expr, ms = 60000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(expr).catch(() => false)) return true;
        await sleep(100);
      }
      return false;
    };
    const audio = `__game.audio`;
    await evaluate(`localStorage.clear(); 1`);
    const hits = await cdp.route404('*mus-s1-ebb-shore.ogg*');
    try {
      await cdp.gotoMenu('art=1');
      if (!(await until(`${audio}.musicKey === 'mus-menu'`, 30000))) throw new Error('主菜单没起 mus-menu');
      await cdp.click(100, 650);
      if (!(await until(`${audio}.context.state === 'running'`, 10000))) throw new Error('点击后 AudioContext 没解锁');
      const errBefore = errors.length;
      const r = await evaluate(`(() => { const e = document.querySelector('.main-menu [data-act="new"]'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      await cdp.click(r.x, r.y);
      if (!(await until(`__game.scenes.current?.name === 's1-ebb-shore' && __game.scenes.current.musicLazyResult !== null`, 240000)))
        throw new Error('S1 懒加载没有结果 ' + JSON.stringify(await evaluate(`({ s: __game.scenes.current?.name, k: ${audio}.musicKey, log: ${audio}.musicLog })`)));
      const x = await evaluate(`(() => { const sc = __game.scenes.current; const l = ${audio}.musicLog.at(-1); return { res: sc.musicLazyResult, k: ${audio}.musicKey, l, ff: __game.lastFirstFrame, req: sc.musicRequestedAt, missing: __game.assets.isMissing('mus-s1-ebb-shore'), now: ${audio}.context.currentTime }; })()`);
      if (x.res !== 'missing' || x.k !== null) throw new Error('404 后不应放音乐 ' + JSON.stringify(x));
      if (x.l.op !== 'stop' || x.l.from !== 'mus-menu' || x.l.fade !== 2) throw new Error('404 后菜单曲应 2 s 淡出 ' + JSON.stringify(x.l));
      if (!(x.req >= x.ff.at)) throw new Error('请求应在 S1 首帧之后 ' + JSON.stringify(x));
      if (hits.length !== 1) throw new Error('应只请求一次 mus-s1-ebb-shore.ogg（被路由 404）：' + hits.length);
      // 淡完：菜单曲 source 断开、总线无电平残留；游戏没有 console.error / 未捕获异常（Chrome 自己那条 404 网络日志除外）
      const t0 = x.now;
      if (!(await until(`${audio}.context.currentTime >= ${t0 + 2.3}`, 60000))) throw new Error('音频时钟没走');
      const gameErrors = errors.slice(errBefore).filter((e) => !/^浏览器: Failed to load resource: .*404.*mus-s1-ebb-shore\.ogg/.test(e));
      if (gameErrors.length) throw new Error('404 时游戏报错：' + gameErrors.join(' | '));
      return `S1 首帧后请求 → 404 → musicLazyResult=${x.res}，菜单曲 stop fade ${x.l.fade} s，musicKey=null，isMissing=${x.missing}，无游戏报错`;
    } finally {
      await cdp.unroute();
      await evaluate(`localStorage.clear(); 1`);
      await cdp.goto('');
    }
  },
});

// ---------------------------------------------------------------- 1031 配乐 2：S2 场景曲 / S3 两层 + 爬塔 / 点燃 → 结尾曲
// 证据：__game.audio.musicLog（AudioContext 时钟）+ AnalyserNode 挂在音乐总线 / 上层 GainNode 上按音频时钟采样（getFloatTimeDomainData）。
// 等待一律按 AudioContext 时钟或游戏时间（__game.time.elapsed），不按墙钟。
const music1031 = ({ evaluate, sleep }) => {
  const until = async (expr, ms = 60000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await evaluate(expr).catch(() => false)) return true;
      await sleep(100);
    }
    return false;
  };
  const waitClock = async (clockExpr, sec, ms = 120000) => {
    const t0 = await evaluate(clockExpr);
    if (!(await until(`(${clockExpr}) >= ${t0 + sec}`, ms)))
      throw new Error(`${clockExpr} 在 ${ms / 1000}s 墙钟内没走过 ${sec}s`);
  };
  const ac = `__game.audio.context.currentTime`;
  // AnalyserNode 采样：每 40 ms（墙钟定时器，只决定采样密度）取一帧时域数据累加 RMS / 峰值；窗口长度按音频时钟算
  const anInstall = `(() => { if (window.__an1031) return 1; window.__an1031 = { list: {} };
    window.__an1031.attach = (name, node) => { const a = __game.audio.context; const old = window.__an1031.list[name]; if (old) { clearInterval(old.id); try { old.node.disconnect(old.an); } catch {} }
      const an = a.createAnalyser(); an.fftSize = 2048; node.connect(an); const buf = new Float32Array(an.fftSize); const st = { s: 0, n: 0, peak: 0, frames: 0, t0: a.currentTime, t1: a.currentTime };
      const id = setInterval(() => { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) { const v = buf[i]; st.s += v * v; if (Math.abs(v) > st.peak) st.peak = Math.abs(v); } st.n += buf.length; st.frames++; st.t1 = a.currentTime; }, 40);
      window.__an1031.list[name] = { an, st, id, node }; return 1; };
    window.__an1031.reset = (name) => { const st = window.__an1031.list[name].st; st.s = 0; st.n = 0; st.peak = 0; st.frames = 0; st.t0 = st.t1 = __game.audio.context.currentTime; return 1; };
    window.__an1031.read = (name) => { const st = window.__an1031.list[name].st; return { rms: st.n ? (st.s > 0 ? 10 * Math.log10(st.s / st.n) : -999) : null, peak: st.peak > 0 ? 20 * Math.log10(st.peak) : -999, frames: st.frames, sec: st.t1 - st.t0 }; };
    return 1; })()`;
  const measure = async (name, sec) => {
    await evaluate(`window.__an1031.reset(${JSON.stringify(name)})`);
    await waitClock(ac, sec);
    return evaluate(`window.__an1031.read(${JSON.stringify(name)})`);
  };
  const unlock = async (cdp) => {
    await cdp.click(100, 650);
    if (!(await until(`__game.audio.context.state === 'running'`, 10000)))
      throw new Error("点击后 AudioContext 没解锁");
  };
  // 软件渲染下 S2 / S3 冷启动可能超过 cdp.goto 的 60 s：超时后再按场景名等到 240 s
  const gotoLong = async (cdp, query, scene) => {
    try {
      await cdp.goto(query, scene);
    } catch {
      if (
        !(await until(
          `window.__game?.scenes?.current?.name === ${JSON.stringify(scene)}`,
          240000,
        ))
      )
        throw new Error("换地址后 300 秒内 " + scene + " 没就绪");
    }
  };
  const fmt = (r) =>
    `RMS ${r.rms === null ? "—" : r.rms.toFixed(1)} dBFS / 峰值 ${r.peak.toFixed(1)}（${r.frames} 帧 ${r.sec.toFixed(1)} s）`;
  return { until, waitClock, ac, anInstall, measure, unlock, fmt, gotoLong };
};

CHECKS.push({
  name: "v0.1-1031 配乐 S2：S1 → S2 首帧后懒加载 mus-s2-keeper-house，整文件 loop、和 S1 曲 2 s 交叉淡化、音乐总线有电平",
  async run({ evaluate, cdp, sleep }) {
    const { until, waitClock, ac, anInstall, measure, unlock, fmt } = music1031(
      { evaluate, sleep },
    );
    const out = [];
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto("scene=s1&art=1", "s1-ebb-shore");
    await unlock(cdp);
    if (!(await until(`__game.audio.musicKey === 'mus-s1-ebb-shore'`, 120000)))
      throw new Error(
        "S1 曲没起 " + JSON.stringify(await evaluate(`__game.audio.musicLog`)),
      );
    await waitClock(ac, 2.2);
    await evaluate(
      `(() => { window.__s2ff = null; __game.events.on('scene:firstFrame', (e) => { if (e.scene === 's2-keeper-house') window.__s2ff = e.at; }); void __game.flow.goToLevel('s2'); return 1; })()`,
    );
    if (
      !(await until(
        `__game.scenes.current?.name === 's2-keeper-house' && __game.audio.musicKey === 'mus-s2-keeper-house'`,
        240000,
      ))
    )
      throw new Error(
        "进 S2 后没切到 mus-s2-keeper-house " +
          JSON.stringify(
            await evaluate(
              `({ s: __game.scenes.current?.name, k: __game.audio.musicKey, log: __game.audio.musicLog.slice(-3), res: __game.scenes.current?.musicLazyResult, fail: __game.assets.lazyAudioFailures })`,
            ),
          ),
      );
    const x =
      await evaluate(`(() => { const a = __game.audio; const l = a.musicLog.at(-1); const v = a.music; const sc = __game.scenes.current;
      const res = performance.getEntriesByType('resource').filter((e) => /mus-s2-keeper-house\\.ogg/.test(e.name)).map((e) => ({ start: e.startTime, end: e.responseEnd }));
      return { l, now: a.context.currentTime, loop: v.source.loop, ls: v.source.loopStart, le: v.source.loopEnd, dur: v.source.buffer.duration, len: v.source.buffer.length, sr: v.source.buffer.sampleRate, g: v.gain.gain.value, ff: window.__s2ff, req: sc.musicRequestedAt, res }; })()`);
    if (
      x.l.op !== "play" ||
      x.l.from !== "mus-s1-ebb-shore" ||
      x.l.fade !== 2 ||
      x.l.loop !== true ||
      !x.loop ||
      x.ls !== 0 ||
      x.le !== 0
    )
      throw new Error(
        "S2 曲应整文件 loop、从 S1 曲 2 s 交叉淡化 " + JSON.stringify(x),
      );
    if (Math.abs(x.dur - 151.111) > 0.01)
      throw new Error("S2 曲时长不对 " + x.dur);
    if (
      !x.ff ||
      !(x.req >= x.ff) ||
      x.res.length !== 1 ||
      !(x.res[0].start >= x.ff) ||
      !(x.l.wall >= x.res[0].end)
    )
      throw new Error(
        "S2 曲应在 S2 首帧之后才请求 / 起播 " + JSON.stringify(x),
      );
    out.push(
      `S2 首帧 @${x.ff.toFixed(0)} ms → 请求 @${x.req.toFixed(0)} → 下载 ${x.res[0].start.toFixed(0)}–${x.res[0].end.toFixed(0)} ms → 起播 @${x.l.wall.toFixed(0)} ms；mus-s1-ebb-shore → mus-s2-keeper-house 交叉淡化 ${x.l.fade} s、loop=true 循环点 0/0、${x.dur.toFixed(3)} s（解码后 ${x.len} 样本 @${x.sr} Hz）`,
    );
    await waitClock(ac, Math.max(0, x.l.at + 2.2 - x.now));
    const y = await evaluate(
      `({ g: __game.audio.music.gain.gain.value, log: __game.audio.musicLog.slice(-2).map((e) => [e.op, e.key, e.from, e.fade]) })`,
    );
    if (Math.abs(y.g - 1) > 1e-3)
      throw new Error("交叉淡化 2 s 后 S2 曲应满音量 " + JSON.stringify(y));
    await evaluate(anInstall);
    await evaluate(`window.__an1031.attach('bus', __game.audio.musicGain)`);
    const lv = await measure("bus", 6);
    if (!(lv.rms > -90) || lv.frames < 10)
      throw new Error("S2 曲在播但音乐总线没有电平 " + JSON.stringify(lv));
    out.push(
      `2.2 s 后增益 ${y.g.toFixed(2)}；AnalyserNode 音乐总线 ${fmt(lv)}`,
    );
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto("");
    return out.join("；");
  },
});

CHECKS.push({
  name: "v0.1-1031 配乐 S3 两层 + 爬塔：S2 → S3 两层同一 AudioContext 时刻起播、样本对齐、上层增益随玩家高度 0 → 1（楼梯底 → 灯室）",
  async run({ evaluate, cdp, sleep }) {
    const { until, waitClock, ac, anInstall, measure, unlock, fmt, gotoLong } =
      music1031({ evaluate, sleep });
    const out = [];
    await evaluate(`localStorage.clear(); 1`);
    await gotoLong(cdp, "debug=1&scene=s2&art=1", "s2-keeper-house");
    await unlock(cdp);
    if (
      !(await until(`__game.audio.musicKey === 'mus-s2-keeper-house'`, 120000))
    )
      throw new Error("S2 曲没起");
    await evaluate(
      `(() => { window.__s3ff = null; __game.events.on('scene:firstFrame', (e) => { if (e.scene === 's3-lighthouse') window.__s3ff = e.at; }); void __game.flow.goToLevel('s3'); return 1; })()`,
    );
    if (
      !(await until(
        `__game.scenes.current?.name === 's3-lighthouse' && __game.scenes.current.musicUpperResult !== null`,
        240000,
      ))
    )
      throw new Error(
        "进 S3 两层没结果 " +
          JSON.stringify(
            await evaluate(
              `({ s: __game.scenes.current?.name, k: __game.audio.musicKey, log: __game.audio.musicLog.slice(-3), fail: __game.assets.lazyAudioFailures })`,
            ),
          ),
      );
    const x =
      await evaluate(`(() => { const a = __game.audio; const sc = __game.scenes.current; const v = a.music; const up = v.layers.get('mus-s3-lighthouse-upper');
      const log = a.musicLog.filter((e) => e.key === 'mus-s3-lighthouse');
      const res = performance.getEntriesByType('resource').filter((e) => /mus-s3-lighthouse(-upper)?\\.ogg|mus-ending-ch1\\.ogg/.test(e.name)).map((e) => ({ f: e.name.split('/').pop().split('?')[0], start: e.startTime, end: e.responseEnd }));
      return { base: sc.musicLazyResult, upper: sc.musicUpperResult, key: a.musicKey, startAt: a.musicStartAt, layers: a.musicLayers, log, ff: window.__s3ff, req: sc.musicRequestedAt, res,
        bl: v.source.loop, ul: up?.source.loop, bd: v.source.buffer.duration, ud: up?.source.buffer.duration, blen: v.source.buffer.length, ulen: up?.source.buffer.length, now: a.context.currentTime }; })()`);
    if (
      x.key !== "mus-s3-lighthouse" ||
      x.base !== "play" ||
      !["with-base", "aligned"].includes(x.upper) ||
      x.layers.length !== 1
    )
      throw new Error("S3 两层没起来 " + JSON.stringify(x));
    if (!x.bl || !x.ul || x.blen !== x.ulen || Math.abs(x.bd - 150) > 0.01)
      throw new Error("两层应同为 loop、同长 150 s " + JSON.stringify(x));
    const L = x.layers[0];
    const phase =
      ((((((L.startAt - x.startAt) % x.bd) + x.bd) % x.bd) + x.bd / 2) % x.bd) -
      x.bd / 2;
    if (Math.abs(phase) > 1e-6)
      throw new Error(
        "上层换算的文件 0 s 和底层不同余（没对齐） " +
          JSON.stringify({ L, startAt: x.startAt, phase }),
      );
    if (x.upper === "with-base" && (L.when !== x.startAt || L.offset !== 0))
      throw new Error(
        "两层同时起播应是同一 when、offset 0 " + JSON.stringify(L),
      );
    const play = x.log.find((e) => e.op === "play");
    if (!play || play.from !== "mus-s2-keeper-house" || play.fade !== 2)
      throw new Error("S3 应从 S2 曲 2 s 交叉淡化 " + JSON.stringify(x.log));
    const r = (f) => x.res.find((e) => e.f === f);
    for (const f of [
      "mus-s3-lighthouse.ogg",
      "mus-s3-lighthouse-upper.ogg",
      "mus-ending-ch1.ogg",
    ])
      if (!r(f) || !(r(f).start >= x.ff))
        throw new Error(
          f +
            " 应在 S3 首帧之后才请求 " +
            JSON.stringify(x.res) +
            " ff " +
            x.ff,
        );
    out.push(
      `S3 首帧 @${x.ff.toFixed(0)} ms 后请求底层 ${r("mus-s3-lighthouse.ogg").start.toFixed(0)}–${r("mus-s3-lighthouse.ogg").end.toFixed(0)} / 上层 ${r("mus-s3-lighthouse-upper.ogg").start.toFixed(0)}–${r("mus-s3-lighthouse-upper.ogg").end.toFixed(0)} / 结尾曲预取 ${r("mus-ending-ch1.ogg").start.toFixed(0)}–${r("mus-ending-ch1.ogg").end.toFixed(0)} ms；` +
        `上层 ${x.upper}（底层 start @${x.startAt.toFixed(4)}，上层 when ${L.when.toFixed(4)} offset ${L.offset.toFixed(4)} → 文件 0 s 同余差 ${phase.toExponential(1)} s），两层 loop、各 ${x.blen} 样本；从 S2 曲 2 s 交叉淡化`,
    );
    await waitClock(ac, Math.max(0, play.at + 2.2 - x.now));
    // 爬塔：传送到塔内各高度（S3 局部 → 世界用场景根节点 frame），各等游戏时间 1 s 让增益斜坡走完，读目标 / 实际增益，AnalyserNode 量上层输出
    // S3 进场有建立镜头（控制器 busy、位置被演出接管）：回到 explore 再传送
    if (
      !(await until(
        `__game.input.context === 'explore' && !__s3.rig.controller.busy`,
        ESTAB_MS,
      ))
    )
      throw new Error(`S3 建立镜头后 ${ESTAB_MS / 1000} s 墙钟内没回到 explore（SMOKE_ESTAB_TIMEOUT_MS）`);
    // 进场是涨潮（机房水深 1.4，站楼梯底会被潮水送回桥尾）：冒烟直接退潮
    await evaluate(`__s3.puzzles.tide.set('low', { instant: true }), 1`);
    await evaluate(anInstall);
    await evaluate(
      `window.__an1031.attach('upper', __game.audio.music.layers.get('mus-s3-lighthouse-upper').gain)`,
    );
    await evaluate(`window.__an1031.attach('bus', __game.audio.musicGain)`);
    const stops = [
      ["桥尾（塔外 y 3）", null, 0],
      ["楼梯底", [-2.12, 0.2, 1.325], 0],
      ["门内平台", [-1.768, 2.4, -1.768], 2.2 / 21.8],
      ["平台 A", [-1.915, 10, 1.607], 9.8 / 21.8],
      ["平台 B", [2.462, 16, -0.434], 15.8 / 21.8],
      ["灯室", [-2.462, 22, -0.434], 1],
    ];
    const rows = [];
    for (const [label, p, want] of stops) {
      if (p)
        await evaluate(
          `(() => { const s = __s3; s.interaction.cancel?.(); const w = s.frame.localToWorld(new s.rig.body.position.constructor(${p[0]}, ${p[1] + 0.05}, ${p[2]})); s.rig.body.teleport(w); return 1; })()`,
        );
      await waitClock(`__game.time.elapsed`, 1);
      const lv = await measure("upper", 3);
      const st = await evaluate(
        `(() => { const s = __s3; const l = __game.audio.musicLayers[0]; const w = s.rig.body.position; s.frame.updateMatrixWorld(true); const loc = s.frame.worldToLocal(w.clone()); return { y: loc.y, r: Math.hypot(loc.x, loc.z), target: l.target, gain: l.gain, f: s.musicUpperGain() }; })()`,
      );
      // 角色落地后的脚底高度可能比传送点低几厘米：按实际局部 y 重算期望
      const expect = p ? Math.min(1, Math.max(0, (st.y - 0.2) / 21.8)) : 0;
      if (
        Math.abs(st.target - expect) > 0.01 ||
        Math.abs(st.gain - st.target) > 0.01 ||
        Math.abs(expect - want) > 0.02
      )
        throw new Error(
          `${label} 上层增益不对 ` + JSON.stringify({ st, want, expect }),
        );
      if (want === 0 && lv.rms !== -999 && lv.rms > -100)
        throw new Error(
          `${label} 上层增益 0 时 AnalyserNode 不该有电平 ` +
            JSON.stringify(lv),
        );
      if (want > 0.5 && !(lv.rms > -70))
        throw new Error(`${label} 上层应有电平 ` + JSON.stringify(lv));
      rows.push(
        `${label} y ${st.y.toFixed(2)} r ${st.r.toFixed(2)} → 增益 ${st.gain.toFixed(3)}（f = ${st.f.toFixed(3)}）上层 ${fmt(lv)}`,
      );
    }
    const bus = await measure("bus", 3);
    if (!(bus.rms > -90))
      throw new Error("灯室音乐总线没电平 " + JSON.stringify(bus));
    const after = await evaluate(
      `({ startAt: __game.audio.musicStartAt, layers: __game.audio.musicLayers.map((l) => [l.when, l.offset]), plays: __game.audio.musicLog.filter((e) => e.op === 'play' || e.op === 'layer').length })`,
    );
    if (
      after.startAt !== x.startAt ||
      after.layers[0][0] !== L.when ||
      after.layers[0][1] !== L.offset
    )
      throw new Error("爬塔过程中两层被重启 / seek " + JSON.stringify(after));
    out.push(
      "爬塔：" +
        rows.join("；") +
        `；灯室音乐总线 ${fmt(bus)}；全程两层 start / offset 不变`,
    );
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto("");
    return out.join("；");
  },
});

CHECKS.push({
  name: "v0.1-1031 配乐 S3 点燃 → 结尾曲：ignited 那一帧 start(0)、单次、两层 2 s 淡出；章节结束页接着放；跳过 0.75 s 淡出",
  async run({ evaluate, cdp, sleep }) {
    const { until, waitClock, ac, anInstall, measure, unlock, fmt, gotoLong } =
      music1031({ evaluate, sleep });
    const out = [];
    const enterS3 = async () => {
      await evaluate(`localStorage.clear(); 1`);
      await gotoLong(cdp, "debug=1&scene=s3&art=1", "s3-lighthouse");
      await unlock(cdp);
      if (
        !(await until(
          `__game.audio.musicKey === 'mus-s3-lighthouse' && __game.audio.musicLayers.length === 1 && !!__s3.endingMusic?.buffer`,
          180000,
        ))
      )
        throw new Error(
          "S3 两层 / 结尾曲预取没到 " +
            JSON.stringify(
              await evaluate(
                `({ k: __game.audio.musicKey, l: __game.audio.musicLayers, e: !!__s3.endingMusic?.buffer, fail: __game.assets.lazyAudioFailures })`,
              ),
            ),
        );
      await evaluate(
        `(() => { window.__ig = null; __game.events.on('lighthouse:ignited', () => { window.__ig = { at: __game.audio.context.currentTime, key: __game.audio.musicKey, game: __game.time.elapsed }; }); return 1; })()`,
      );
      await evaluate(anInstall);
      await evaluate(`window.__an1031.attach('bus', __game.audio.musicGain)`);
    };
    // A) 点燃 → 结尾曲同帧起播；结束页接着放结尾曲、结束页上按住 Space 1 s 也能 0.75 s 淡掉（035）
    await enterS3();
    await waitClock(ac, 2.5);
    await evaluate(`__s3.lightTheLamp(); 1`);
    if (
      !(await until(
        `!!window.__ig && __game.audio.musicKey === 'mus-ending-ch1'`,
        10000,
      ))
    )
      throw new Error(
        "点燃后结尾曲没起 " +
          JSON.stringify(
            await evaluate(
              `({ ig: window.__ig, k: __game.audio.musicKey, log: __game.audio.musicLog.slice(-3) })`,
            ),
          ),
      );
    const e = await evaluate(
      `(() => { const a = __game.audio; const l = a.musicLog.at(-1); const v = a.music; return { ig: window.__ig, l, startAt: a.musicStartAt, loop: v.source.loop, dur: v.source.buffer.duration, em: { at: __s3.endingMusic.ignitedAt, res: __s3.endingMusic.result } }; })()`,
    );
    if (
      e.ig.key !== "mus-ending-ch1" ||
      e.l.op !== "play" ||
      e.l.from !== "mus-s3-lighthouse" ||
      e.l.loop !== false ||
      e.loop !== false ||
      e.l.fade !== 0 ||
      e.l.fadeOut !== 2 ||
      e.l.offset
    )
      throw new Error(
        "结尾曲应在 ignited 回调里 loop=false、不淡入、场景曲 2 s 淡出 " +
          JSON.stringify(e),
      );
    if (
      e.l.at !== e.ig.at ||
      e.startAt !== e.ig.at ||
      e.em.at !== e.ig.at ||
      e.em.res !== "play"
    )
      throw new Error("结尾曲起播时刻 ≠ 点燃帧音频时钟 " + JSON.stringify(e));
    // batch25-4：结尾曲文件时长引用 ENDING_CUES.length（原来写死 107）
    if (Math.abs(e.dur - ENDING_CUES.length) > 0.01)
      throw new Error(`结尾曲时长不对 ${e.dur}（应为 ENDING_CUES.length = ${ENDING_CUES.length} s）`);
    out.push(
      `点燃 @音频 ${e.ig.at.toFixed(4)} s（游戏 ${e.ig.game.toFixed(3)} s）→ 结尾曲 start @${e.l.at.toFixed(4)}（差 ${(e.l.at - e.ig.at).toFixed(4)} s）、文件 0 s、loop=false、淡入 ${e.l.fade} s；两层淡出 ${e.l.fadeOut} s`,
    );
    const lv0 = await measure("bus", 3);
    if (!(lv0.rms > -90))
      throw new Error("结尾曲开头音乐总线没电平 " + JSON.stringify(lv0));
    // 035 起演出 106 s（结尾曲静音）才进结束页，测不出「结束页接着放」。所以这里直接调演出结束 / 跳过调的同一个 flow.completeChapter()，
    // 音频时钟上就是点燃后几秒进结束页（= 结尾曲还在放时到了结束页）
    await evaluate(`void __game.flow.completeChapter(), 1`);
    if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 120000)))
      throw new Error("completeChapter 后没进章节结束页");
    await waitClock(ac, 1);
    const ce = await evaluate(
      `({ k: __game.audio.musicKey, pos: __game.audio.musicPosition, el: __game.audio.context.currentTime - window.__ig.at, stops: __game.audio.musicLog.filter((e) => e.op === 'stop' && e.from === 'mus-ending-ch1').length })`,
    );
    if (
      ce.k !== "mus-ending-ch1" ||
      ce.stops ||
      Math.abs(ce.pos - ce.el) > 1e-6
    )
      throw new Error(
        "章节结束页应接着放结尾曲（位置 = 点燃后秒数） " + JSON.stringify(ce),
      );
    await evaluate(`window.__an1031.attach('bus', __game.audio.musicGain)`);
    const lv1 = await measure("bus", 3);
    if (!(lv1.rms > -90))
      throw new Error(
        "结束页上结尾曲没电平 " +
          JSON.stringify({
            lv1,
            d: await evaluate(
              `(() => { const a = __game.audio, v = a.music; return { st: a.context.state, bus: a.musicGain.gain.value, master: a.master?.gain.value, g: v?.gain.gain.value, buf: !!v?.source.buffer, pos: a.musicPosition, lv: a.levels, log: a.musicLog.slice(-4) }; })()`,
            ),
          }),
      );
    // 035：结束页上按住 Space 1 s → 结尾曲 0.75 s 淡出（跳过监听在 UI 层，不在 S3）
    const space = (type) => `window.dispatchEvent(new KeyboardEvent('${type}', { code: 'Space', key: ' ', bubbles: true })), 1`;
    const sk0 = await evaluate(`({ id: __game.ui.skip.id, n: __game.ui.skip.log.length })`);
    if (sk0.id !== "ch1-ending-page")
      throw new Error("结束页上结尾曲在放时应注册跳过 " + JSON.stringify(sk0));
    await evaluate(space("keydown"));
    await sleep(500);
    const ring = await evaluate(`({ p: __game.ui.skip.progress(performance.now()), vis: __game.ui.skipHint.visible, k: __game.audio.musicKey })`);
    if (!(ring.p > 0.2 && ring.p < 1) || !ring.vis || ring.k !== "mus-ending-ch1")
      throw new Error("结束页按住 0.5 s：圆环进度应在 0–1 之间、结尾曲还在 " + JSON.stringify(ring));
    if (!(await until(`__game.audio.musicKey === null`, 5000)))
      throw new Error("结束页按住 Space 1 s 没淡掉结尾曲");
    await evaluate(space("keyup"));
    const pg = await evaluate(`({ l: __game.audio.musicLog.at(-1), log: __game.ui.skip.log.at(-1), scene: __game.scenes.current?.name })`);
    if (pg.l.op !== "stop" || pg.l.from !== "mus-ending-ch1" || pg.l.fade !== 0.75 || pg.log.id !== "ch1-ending-page" || pg.scene !== "chapter-end")
      throw new Error("结束页跳过应 0.75 s 淡出结尾曲、留在结束页 " + JSON.stringify(pg));
    out.push(
      `点燃后 3 s 音乐总线 ${fmt(lv0)}；completeChapter（演出结束 / 跳过调的同一入口）进章节结束页，结尾曲继续（位置 ${ce.pos.toFixed(2)} s = 点燃后 ${ce.el.toFixed(2)} s），结束页上 ${fmt(lv1)}；结束页按住 Space（0.5 s 圆环 ${ring.p.toFixed(2)}）→ 结尾曲 stop fade ${pg.l.fade} s、留在结束页`,
    );
    // B) 重进 S3：点燃 1.5 s 后按住 Space 1 s 跳过演出 → 结尾曲 0.75 s 淡出、黑场 0.75 s → 章节结束页；之后总线静音
    await enterS3();
    await waitClock(ac, 2.5);
    await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
    if (!(await until(`__game.audio.musicKey === 'mus-ending-ch1'`, 10000)))
      throw new Error("第二次点燃结尾曲没起");
    await waitClock(ac, 0.5);
    await evaluate(space("keydown"));
    if (!(await until(`__c035.endedBy === 'skip'`, 5000)))
      throw new Error("演出中按住 Space 1 s 没跳过 " + JSON.stringify(await evaluate(`({ id: __game.ui.skip.id, t: __c035.t })`)));
    await evaluate(space("keyup"));
    const sk = await evaluate(
      `(() => ({ l: __game.audio.musicLog.at(-1), k: __game.audio.musicKey, now: __game.audio.context.currentTime, t: __c035.t, el: __game.audio.context.currentTime - __em035.ignitedAt }))()`,
    );
    if (
      sk.k !== null ||
      sk.l.op !== "stop" ||
      sk.l.from !== "mus-ending-ch1" ||
      sk.l.fade !== 0.75
    )
      throw new Error("跳过应 0.75 s 淡出结尾曲 " + JSON.stringify(sk));
    await waitClock(ac, 0.9);
    const lv2 = await measure("bus", 2);
    if (lv2.rms !== -999 && lv2.rms > -100)
      throw new Error("跳过淡出后音乐总线应静音 " + JSON.stringify(lv2));
    if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 20000)))
      throw new Error("跳过后没进章节结束页");
    out.push(
      `按住 Space 跳过 @演出 ${sk.t.toFixed(2)} s（点燃后 ${sk.el.toFixed(2)} s）→ stop fade ${sk.l.fade} s；0.9 s 后音乐总线 ${fmt(lv2)}；随后到章节结束页`,
    );
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto("");
    return out.join("；");
  },
});

// ---------------------------------------------------------------- v0.1-035 结尾演出
// 每个 cue 触发的那一帧（step 之后）记一份现场：演出 t / 时钟来源 / 结尾曲音频位置 / 镜头 / 字幕 / 汐姿势 / 父亲 / 雾 / 剪影 / 黑场 / 日志第 6 页
const cut035Hook = `(() => {
  const S3 = __s3; const c = S3.endingCutscene; if (!c || c.__hooked) return 0; c.__hooked = true; // BUG-031：钩子里不读全局 __s3（S3 释放后就没了）
  window.__cut035 = { cues: [], frames: 0, end: null, sceneAt: null };
  const step = c.step.bind(c); let n = 0, lastT = -1, lastPrev = -1;
  const audioPos = () => { const a = __game.audio, em = S3.endingMusic; return a.musicKey === 'mus-ending-ch1' && em?.ignitedAt != null ? a.context.currentTime - em.ignitedAt : null; };
  c.step = (t) => { step(t); window.__cut035.frames++; const L = c.player.log; const prevT = lastT; lastPrev = prevT; lastT = t;
    while (n < L.length) { const l = L[n++]; const f = S3.father, an = S3.rig?.animator, sub = __game.ui.subtitles.current;
      window.__cut035.cues.push({ id: l.id, at: l.at, firedAt: +l.firedAt.toFixed(3), prevT: +prevT.toFixed(3), src: l.source, audio: audioPos(), shot: c.shot, cam: S3.cameraFollow.cutsceneName,
        sub: sub?.id ?? null, xi: an?.posing ?? null, fMode: f?.mode ?? null, fT: f ? +f.time.toFixed(3) : null, fVis: f?.visible ?? null,
        fog: +(S3.scene.fog?.density ?? 0).toFixed(5), sil: c.silhouette?.visible ?? null, fade: +__game.ui.fade.opacity.toFixed(3), page6: __game.narrative.outroEntryUnlocked }); } };
  const fin = c.finish.bind(c);
  c.finish = (how) => { if (window.__cut035.end === null) window.__cut035.end = { how, t: +c.t.toFixed(3), prevT: +lastPrev.toFixed(3), src: c.clock.source, wall: performance.now() }; fin(how); };
  __game.events.on('scene:change', () => { if (window.__cut035.sceneAt === null) window.__cut035.sceneAt = { t: c.t, audio: audioPos(), wall: performance.now(), endedBy: c.endedBy }; });
  return 1; })()`;
const cut035Row = (r) => `${r.id} 目标 ${r.at} s / 触发 ${r.firedAt.toFixed(2)} s（上一帧 ${r.prevT.toFixed(2)}，${r.src}${r.audio === null ? '' : `，曲 ${r.audio.toFixed(2)} s`}）镜头 ${r.shot}`;

CHECKS.push({
  name: 'v0.1-035 结尾演出 art=1：点燃 → 按音频时钟逐 cue（远景 / 雾口 / 剪影 / 眺望 / 父亲摸头同帧 / 那边没有亮 / 坐下写 / 日志 / 后拉 / 淡出）→ 106 s 才进结束页',
  async run({ evaluate, cdp, sleep }) {
    const { until, unlock, gotoLong } = music1031({ evaluate, sleep });
    const out = [];
    await evaluate(`localStorage.clear(); 1`);
    await gotoLong(cdp, 'debug=1&scene=s3&art=1', 's3-lighthouse');
    await unlock(cdp);
    if (!(await until(`!!__s3.endingMusic?.buffer && !!__s3.father && !!__s3.rig?.animator`, 180000)))
      throw new Error('结尾曲预取 / 父亲 / 汐没就绪 ' + JSON.stringify(await evaluate(`({ b: !!__s3.endingMusic?.buffer, f: !!__s3.father })`)));
    await evaluate(cut035Hook);
    const w0 = Date.now();
    await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
    if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 200000))) throw new Error('演出 200 s 墙钟内没进结束页 ' + JSON.stringify(await evaluate(`(() => { const c = window.__s3?.endingCutscene ?? window.__c035, a = __game.audio; return { t: c?.t, cues: window.__cut035.cues.map((x) => x.id + ':' + x.src), fr: c?.clock.frames, src: c?.clock.source, key: a.musicKey, ctx: a.context?.state, at: a.audioTime, ig: __s3.endingMusic?.ignitedAt, res: __s3.endingMusic?.result, paused: __game.isPaused, gameFrames: window.__cut035.frames }; })()`)));
    const wall = (Date.now() - w0) / 1000;
    const r = await evaluate(`window.__cut035`);
    const want = ['lens', 'fog_open', 'silhouette', 'gaze', 'father_in', 'father_out', 'no_answer', 'sit_write', 'journal', 'pull_back', 'fade_out'];
    if (r.cues.map((c) => c.id).join() !== want.join()) throw new Error('cue 顺序 / 缺失 ' + r.cues.map((c) => c.id).join());
    const C = Object.fromEntries(r.cues.map((c) => [c.id, c]));
    const bad = [];
    for (const c of r.cues) {
      if (c.src !== 'audio') bad.push(`${c.id} 时钟来源 ${c.src}`);
      // 软件渲染一帧 0.3–2.7 s（机器负载而定）：判据 = 跨过卡点的第一帧触发（上一帧 t < 卡点 ≤ 本帧 t），偏差 < 1 帧；时间对不对另由「和曲子差 ≤ 0.1 s」管
      if (!(c.firedAt >= c.at && c.prevT < c.at)) bad.push(`${c.id} 触发 ${c.firedAt}（上一帧 ${c.prevT}）vs ${c.at}`);
      if (c.audio !== null && Math.abs(c.audio - c.firedAt) > 0.1) bad.push(`${c.id} 和曲子差 ${(c.audio - c.firedAt).toFixed(3)}`);
    }
    if (C.lens.shot !== 'far-exterior' || C.lens.cam !== 'ch1-ending') bad.push('0:04 应切塔外远景 ' + JSON.stringify(C.lens));
    if (C.fog_open.shot !== 'fog-gap') bad.push('0:14 镜头 ' + C.fog_open.shot);
    if (!(C.silhouette.fog < C.fog_open.fog)) bad.push(`雾口：24 s 雾密度 ${C.silhouette.fog} 应低于 14 s ${C.fog_open.fog}`);
    if (C.silhouette.sil === false) bad.push('0:24 剪影应可见');
    if (C.gaze.xi !== 'xi-stand-gaze') bad.push('0:30 汐应 xi-stand-gaze ' + C.gaze.xi);
    if (C.father_in.fMode !== 'hand' || !C.father_in.fVis || C.father_in.xi !== 'xi-stand-gaze' || Math.abs(C.father_in.fT - (C.father_in.firedAt - 36)) > 0.002) bad.push('0:36 父亲 hand-on-head 应同帧起 ' + JSON.stringify(C.father_in));
    if (C.father_out.fMode !== null || C.father_out.fVis) bad.push('父亲应离场 ' + JSON.stringify(C.father_out));
    if (C.no_answer.sub !== 'ch1.outro.no_answer') bad.push('0:50 字幕 ' + C.no_answer.sub);
    if (C.sit_write.xi !== 'xi-sit-write' || C.sit_write.shot !== 'over-shoulder') bad.push('0:58 坐下写 ' + JSON.stringify(C.sit_write));
    if (C.journal.sub !== 'ch1.outro.journal_entry' || !C.journal.page6) bad.push('1:06 日志 ' + JSON.stringify(C.journal));
    if (!/^pull-/.test(C.pull_back.shot)) bad.push('1:14 后拉镜头 ' + C.pull_back.shot);
    if (C.fade_out.fade > 0.05 || !C.fade_out.shot) bad.push('1:35 淡出起点 ' + JSON.stringify(C.fade_out));
    const sa = r.sceneAt;
    // 演出结束 = 跨过 ENDING_CUES.silence（106 s，ending.ts end）的第一帧（BUG-032：原来写死 106.02，结束帧落在 [106, 106.02) 会假失败）；之后 completeChapter 异步切场景（软件渲染下约 1 s 墙钟），只要求墙钟 3 s 内切到
    const fe = r.end, endAt = ENDING_CUES.silence;
    if (!fe || fe.how !== 'end' || !(fe.t >= endAt && fe.prevT < endAt)) bad.push('演出结束时刻 ' + JSON.stringify(fe));
    if (!sa || sa.endedBy !== 'end' || !fe || sa.wall - fe.wall > 3000) bad.push('结束页时刻 ' + JSON.stringify({ sa, fe }));
    if (bad.length) throw new Error(bad.join('；'));
    await sleep(1500);
    const pg = await evaluate(`({ fade: __game.ui.fade.opacity, ctx: __game.input.context, save: JSON.parse(localStorage.getItem('foglight.save.v1') || 'null')?.chapterComplete })`);
    if (pg.fade > 0.05 || !pg.save) throw new Error('结束页应从黑场淡入、存 chapterComplete ' + JSON.stringify(pg));
    out.push(r.cues.map(cut035Row).join('；'));
    out.push(`父亲 hand 起 @${C.father_in.firedAt.toFixed(2)} s 父亲时间 ${C.father_in.fT}、汐 ${C.father_in.xi}；雾 ${C.fog_open.fog} → ${C.silhouette.fog}；演出结束 @${fe.t.toFixed(2)} s（上一帧 ${fe.prevT.toFixed(2)}，${fe.src}）→ ${((sa.wall - fe.wall) / 1000).toFixed(2)} s 后切结束页 @演出 ${sa.t.toFixed(2)} s（曲 ${sa.audio === null ? '—' : sa.audio.toFixed(2)} s）墙钟 ${wall.toFixed(1)} s、${r.frames} 帧；结束页淡入后 fade ${pg.fade.toFixed(2)}`);
    console.log('[035] cues ' + JSON.stringify(r.cues));
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto('');
    return out.join('；');
  },
});

CHECKS.push({
  name: 'v0.1-035 跳过 art=1：演出 20 s 按住 Space 1 s（圆环）→ 结尾曲 0.75 s 淡出 + 0.75 s 黑场 → 结束页（日志第 6 页照样写）',
  async run({ evaluate, cdp, sleep }) {
    const { until, unlock, gotoLong } = music1031({ evaluate, sleep });
    await evaluate(`localStorage.clear(); 1`);
    await gotoLong(cdp, 'debug=1&scene=s3&art=1', 's3-lighthouse');
    await unlock(cdp);
    if (!(await until(`!!__s3.endingMusic?.buffer`, 180000))) throw new Error('结尾曲预取没到');
    await evaluate(cut035Hook);
    await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
    await evaluate(`__s3.endingCutscene.seek(19.5), 1`);
    if (!(await until(`__s3.endingCutscene.t >= 20`, 20000))) throw new Error('演出没走到 20 s');
    const space = (type) => `window.dispatchEvent(new KeyboardEvent('${type}', { code: 'Space', key: ' ', bubbles: true })), 1`;
    const p0 = await evaluate(`({ id: __game.ui.skip.id, t: __s3.endingCutscene.t, wall: performance.now() })`);
    if (p0.id !== 'ch1-ending') throw new Error('演出中应注册跳过 ' + JSON.stringify(p0));
    // 负载高时按住的 1 s 里可能只渲染 1–2 帧，帧采样采不到圆环：改听 SkipHint 显示时派发的 window 事件（按下当刻就显示），
    // 帧数 / 最长帧间隔只作诊断；0.5 s 时的进度直接读控制器
    await evaluate(`(() => { const h = __game.ui.skipHint; const u = h.update.bind(h); const w = window.__hint035 = { shown: false, ev: [], maxP: 0, n: 0, last: performance.now(), gap: 0, count0: h.shownCount }; window.addEventListener('skiphint:shown', (e) => { w.shown = true; w.ev.push(e.detail); }); h.update = (now) => { u(now); w.n++; w.gap = Math.max(w.gap, now - w.last); w.last = now; if (h.visible) w.maxP = Math.max(w.maxP, __game.ui.skip.progress(now)); }; return 1; })()`);
    await evaluate(space('keydown'));
    await sleep(500);
    const mid = await evaluate(`({ p: __game.ui.skip.progress(performance.now()), vis: __game.ui.skip.hintVisible(performance.now()), done: __c035.endedBy })`);
    if (!(mid.p > 0.2 && mid.p < 1) || !mid.vis || mid.done) throw new Error('按住 0.5 s：圆环进度应在 0–1、未跳过 ' + JSON.stringify(mid));
    if (!(await until(`__c035.endedBy === 'skip'`, 5000))) throw new Error('按住 1 s 没跳过');
    const hint = await evaluate(`window.__hint035`);
    if (!hint.shown || !hint.ev.some((d) => d.id === 'ch1-ending')) throw new Error(`按住期间右下角圆环没显示过（事件 ${JSON.stringify(hint.ev)}；这期间 UI 更新 ${hint.n} 帧、最长帧间隔 ${hint.gap.toFixed(0)} ms）`);
    const sk = await evaluate(`({ t: __c035.t, wall: performance.now(), l: __game.audio.musicLog.at(-1), k: __game.audio.musicKey, log: __game.ui.skip.log.at(-1) })`);
    await evaluate(space('keyup'));
    const hold = (sk.log.at - (p0.wall)) / 1000;
    if (sk.l.op !== 'stop' || sk.l.from !== 'mus-ending-ch1' || sk.l.fade !== 0.75 || sk.k !== null) throw new Error('跳过应 0.75 s 淡出结尾曲 ' + JSON.stringify(sk));
    if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 30000))) throw new Error('跳过后没进结束页');
    const r = await evaluate(`window.__cut035`);
    const toPage = (r.sceneAt.wall - sk.log.at) / 1000;
    if (toPage < 0.7) throw new Error('跳过后 0.75 s 黑场没走完就切页 ' + toPage);
    await sleep(1500);
    const pg = await evaluate(`({ fade: __game.ui.fade.opacity, page6: __game.narrative.outroEntryUnlocked, mono: __game.narrative.hasSeen('ch1.s3.ignite.mono'), sub: __game.ui.subtitles.current?.id ?? null })`);
    if (pg.fade > 0.05 || !pg.page6 || !pg.mono || pg.sub) throw new Error('跳过后结束页：应淡入、日志第 6 页写上、无字幕 ' + JSON.stringify(pg));
    const cues = r.cues.map((c) => c.id).join('/');
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto('');
    return `演出 ${p0.t.toFixed(2)} s 按下 Space、0.5 s 圆环进度 ${mid.p.toFixed(2)}（圆环显示事件 ${hint.ev.length} 次、帧采样最大进度 ${hint.maxP.toFixed(2)}、UI ${hint.n} 帧 / 最长间隔 ${hint.gap.toFixed(0)} ms）、${hold.toFixed(2)} s 后跳过（演出 ${sk.t.toFixed(2)} s；已触发 ${cues}）→ 结尾曲 stop fade ${sk.l.fade} s → ${toPage.toFixed(2)} s 后切结束页、淡入后 fade ${pg.fade.toFixed(2)}；日志第 6 页 ${pg.page6}`;
  },
});

CHECKS.push({
  name: 'v0.1-035 后备时钟 art=0：没有结尾曲 → performance.now 后备时钟逐 cue、106 s 进结束页',
  async run({ evaluate, cdp, sleep }) {
    const { until, gotoLong } = music1031({ evaluate, sleep });
    await evaluate(`localStorage.clear(); 1`);
    await gotoLong(cdp, 'debug=1&scene=s3&art=0', 's3-lighthouse');
    if (!(await until(`!!window.__s3?.rig && !!__s3.endingCutscene`, 120000))) throw new Error('S3 art=0 没就绪');
    await evaluate(cut035Hook);
    await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
    const w0 = await evaluate(`performance.now()`);
    if (!(await until(`__s3.endingCutscene.t >= ${ENDING_CUES.fog_open + 1}`, 60000))) throw new Error(`后备时钟没走到 ${ENDING_CUES.fog_open + 1} s ` + (await evaluate(`__s3.endingCutscene.t`)));
    const a = await evaluate(`({ t: __s3.endingCutscene.t, wall: (performance.now() - ${w0}) / 1000, src: __s3.endingCutscene.clock.source, fr: __s3.endingCutscene.clock.frames, k: __game.audio.musicKey })`);
    if (a.src !== 'fallback' || a.fr.audio !== 0 || a.k === 'mus-ending-ch1') throw new Error('art=0 应用后备时钟 ' + JSON.stringify(a));
    // 中段推进：剩下的 cue 按序触发、照样到 106 s 才进结束页
    await evaluate(`__s3.endingCutscene.seek(45), 1`);
    if (!(await until(`__s3.endingCutscene.t >= 47`, 20000))) throw new Error('seek 后没走');
    await evaluate(`__s3.endingCutscene.seek(80), 1`);
    if (!(await until(`__s3.endingCutscene.t >= 81`, 20000))) throw new Error('seek 后没走');
    await evaluate(`__s3.endingCutscene.seek(${ENDING_CUES.silence - 2}), 1`);
    await sleep(300);
    if (await evaluate(`__game.scenes.current?.name === 'chapter-end'`)) throw new Error(`${ENDING_CUES.silence} s 前进了结束页`);
    if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 30000))) throw new Error(`后备时钟到 ${ENDING_CUES.silence} s 没进结束页`);
    const r = await evaluate(`window.__cut035`);
    const want = ['lens', 'fog_open', 'silhouette', 'gaze', 'father_in', 'father_out', 'no_answer', 'sit_write', 'journal', 'pull_back', 'fade_out'];
    if (r.cues.map((c) => c.id).join() !== want.join()) throw new Error('cue 顺序 ' + r.cues.map((c) => c.id).join());
    if (r.cues.some((c) => c.src !== 'fallback')) throw new Error('art=0 cue 时钟来源应全是 fallback');
    const early = r.cues.filter((c) => c.at <= ENDING_CUES.fog_open); // 实时段 = 雾口及以前（原写死 14）
    if (early.some((c) => c.firedAt - c.at > 1.0 || c.firedAt < c.at || c.prevT >= c.at)) throw new Error('实时段 cue 偏差 ' + JSON.stringify(early));
    if (!(r.sceneAt.t >= ENDING_CUES.silence && r.sceneAt.endedBy === 'end')) throw new Error('结束页时刻 ' + JSON.stringify(r.sceneAt));
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto('');
    return `后备时钟：演出 ${a.t.toFixed(2)} s / 墙钟 ${a.wall.toFixed(2)} s（${a.fr.fallback} 帧 fallback、0 帧 audio）；实时段 ${early.map((c) => `${c.id} ${c.at}→${c.firedAt.toFixed(2)}`).join('、')}；seek 后 ${r.cues.length} 个 cue 按序（全部 fallback）；结束页 @演出 ${r.sceneAt.t.toFixed(2)} s`;
  },
});

// ---------------------------------------------------------------- v0.1-035 补测（batch16 制作人 b / c）：结尾曲晚到 / 下载失败
// 每帧记演出时钟（t / 来源 / 曲子位置 = AudioContext.currentTime − ignitedAt / 曲目 key），找后备 → 音频的切换帧
const late035Hook = `(() => {
  const S3 = __s3; const c = S3.endingCutscene; if (!c || c.__lateHooked) return 0; c.__lateHooked = true; // BUG-031：钩子里不读全局 __s3（S3 释放后就没了）
  window.__late035 = { frames: [] };
  const step = c.step.bind(c);
  c.step = (t) => { step(t); const a = __game.audio, em = S3.endingMusic; const F = window.__late035.frames;
    if (F.length < 6000) F.push({ t: +t.toFixed(4), src: c.clock.source, key: a.musicKey, a: em?.ignitedAt != null ? +(a.context.currentTime - em.ignitedAt).toFixed(4) : null, w: Math.round(performance.now()) }); };
  return 1; })()`;
const nodeUntil = async (pred, ms, sleep) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return true;
    await sleep(100);
  }
  return false;
};

CHECKS.push({
  name: 'v0.1-035 结尾曲晚到 art=1：点燃时结尾曲还没下载完 → 后备时钟先走、场景曲照样淡出 → 到了按「点燃后音频时钟秒数」作 offset 补位起播（0.5 s 淡入）→ 演出时钟切到音频，t = 曲子位置',
  async run({ evaluate, cdp, sleep }) {
    const { until, unlock, gotoLong } = music1031({ evaluate, sleep });
    await evaluate(`localStorage.clear(); 1`);
    // 进 S3 首帧后结尾曲预取请求被扣住（CDP Fetch），懒加载超时 45 s（下载 + 解码）：放行要在请求发出后 ~30 s 内
    const rt = await cdp.routeHold('*mus-ending-ch1.ogg*');
    try {
      await gotoLong(cdp, 'debug=1&scene=s3&art=1', 's3-lighthouse');
      await unlock(cdp);
      if (!(await until(`!!__s3.father && !!__s3.rig?.animator && !!__s3.endingCutscene`, 180000))) throw new Error('父亲 / 汐 / 演出没就绪');
      if (!(await nodeUntil(async () => rt.held.length > 0, 60000, sleep))) throw new Error('结尾曲预取请求没发出 / 没被扣住');
      const reqWall = rt.held[0].wall;
      const pre = await evaluate(`({ buf: !!__s3.endingMusic.buffer, res: __s3.endingMusic.result, k: __game.audio.musicKey })`);
      if (pre.buf || pre.res !== null) throw new Error('扣住期间结尾曲不应已到 ' + JSON.stringify(pre));
      await evaluate(cut035Hook);
      await evaluate(late035Hook);
      await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
      const ig = await evaluate(`({ ig: __s3.endingMusic.ignitedAt, l: __game.audio.musicLog.at(-1), k: __game.audio.musicKey, res: __s3.endingMusic.result })`);
      if (ig.ig === null || ig.res !== null) throw new Error('点燃时应记 ignitedAt、结尾曲还没结果 ' + JSON.stringify(ig));
      // 后备时钟先走到 6 s（演出时钟），但请求扣住不超过 30 s 墙钟
      const heldBudget = 30000;
      await nodeUntil(async () => (await evaluate(`__s3.endingCutscene.t`)) >= 6 || Date.now() - reqWall > heldBudget, 120000, sleep);
      const before = await evaluate(`({ t: __s3.endingCutscene.t, src: __s3.endingCutscene.clock.source, fb: __s3.endingCutscene.clock.frames.fallback, au: __s3.endingCutscene.clock.frames.audio, k: __game.audio.musicKey, el: __game.audio.context.currentTime - __s3.endingMusic.ignitedAt })`);
      if (before.src !== 'fallback' || before.au !== 0 || before.k === 'mus-ending-ch1') throw new Error('结尾曲没到时演出应走后备时钟 ' + JSON.stringify(before));
      const relWall = Date.now();
      await cdp.release();
      if (!(await until(`__s3.endingMusic.result !== null`, 60000))) throw new Error('放行后 60 s 结尾曲没结果');
      const st = await evaluate(`(() => { const a = __game.audio, em = __s3.endingMusic; const l = a.musicLog.filter((x) => x.key === 'mus-ending-ch1' && x.op === 'play').at(-1); return { res: em.result, k: a.musicKey, l, ig: em.ignitedAt, startAt: a.musicStartAt, now: a.context.currentTime, fails: __game.assets.lazyAudioFailures.map((f) => f.key + ':' + f.error) }; })()`);
      if (st.res !== 'late' || st.k !== 'mus-ending-ch1' || !st.l) throw new Error('晚到应补位起播（result=late）' + JSON.stringify(st));
      // 补位 offset = 起播时刻 − 点燃时刻（音频时钟）→ 文件 0 s 仍对齐点燃那一刻：startAt = ignitedAt
      // batch17 D3：offset 与起播时刻出自同一次 ctx.currentTime 读数（endingMusic → playMusic opts.at），容差 1e-6 保留
      const off = st.l.offset ?? 0;
      if (Math.abs(off - (st.l.at - st.ig)) > 1e-6) throw new Error(`offset ${off} ≠ 起播 ${st.l.at} − 点燃 ${st.ig}`);
      if (Math.abs(st.startAt - st.ig) > 1e-6) throw new Error(`曲子 0 s 时刻 ${st.startAt} ≠ 点燃 ${st.ig}`);
      if (st.l.fade !== 0.5) throw new Error('补位起播应 0.5 s 淡入 ' + JSON.stringify(st.l));
      // 演出时钟：切到音频后 t = 曲子位置（单调，后备超前时停住等音频追上）
      if (!(await until(`__s3.endingCutscene.clock.source === 'audio' && __s3.endingCutscene.t >= ${off} + 3`, 60000))) throw new Error('补位后演出时钟没切到音频 / 没走');
      const F = await evaluate(`window.__late035.frames`);
      const i = F.findIndex((f) => f.src === 'audio');
      const sw = F[i], pv = F[i - 1];
      const after = F.slice(i);
      const drift = Math.max(...after.map((f) => Math.abs(f.t - f.a)));
      // 后备时钟领先音频时：t 停住（取 max）直到音频追上，之后 t = 曲子位置
      const lead = pv.t - sw.a;
      const caught = after.findIndex((f) => Math.abs(f.t - f.a) < 0.002);
      if (caught < 0) throw new Error('切换后演出 t 一直没和曲子位置对齐 ' + JSON.stringify(after.slice(0, 5)));
      const tail = after.slice(caught);
      const tailDrift = Math.max(...tail.map((f) => Math.abs(f.t - f.a)));
      if (tailDrift > 0.002) throw new Error('对齐后演出 t 和曲子位置差 ' + tailDrift);
      if (after.some((f, k) => k > 0 && f.t < after[k - 1].t)) throw new Error('演出时钟倒退');
      if (lead < 0 && caught !== 0) throw new Error('后备落后音频时应在切换帧直接跳到音频 ' + JSON.stringify({ pv, sw }));
      const cues = await evaluate(`window.__cut035.cues`);
      const audioCues = cues.filter((c) => c.src === 'audio');
      const badCue = audioCues.filter((c) => c.audio === null || Math.abs(c.audio - c.firedAt) > 0.1);
      if (badCue.length) throw new Error('补位后 cue 和曲子差 > 0.1 s ' + JSON.stringify(badCue));
      // 收尾：按住 Space 跳过 → 0.75 s 淡出 → 结束页
      const space = (type) => `window.dispatchEvent(new KeyboardEvent('${type}', { code: 'Space', key: ' ', bubbles: true })), 1`;
      await evaluate(space('keydown'));
      if (!(await until(`__c035.endedBy === 'skip'`, 10000))) throw new Error('按住 Space 没跳过');
      await evaluate(space('keyup'));
      if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 30000))) throw new Error('跳过后没进结束页');
      const held = ((relWall - reqWall) / 1000).toFixed(1);
      console.log('[035-late] switch ' + JSON.stringify({ pv, sw, next: F.slice(i + 1, i + 4), off, ig: st.ig, startAt: st.startAt, l: st.l }));
      return `结尾曲请求扣住 ${held} s 墙钟；点燃 @音频 ${st.ig.toFixed(3)} 时 buffer 未到 → 场景曲 ${ig.l?.op ?? '—'} fade ${ig.l?.fade ?? '—'} s，演出走后备（放行前 t ${before.t.toFixed(2)} s、${before.fb} 帧 fallback / 0 帧 audio、点燃后音频 ${before.el.toFixed(2)} s）→ 放行 → result=late，play offset ${off.toFixed(3)} s = 起播 ${st.l.at.toFixed(3)} − 点燃 ${st.ig.toFixed(3)}，曲子 0 s 时刻 = 点燃（差 ${(st.startAt - st.ig).toExponential(1)}），淡入 ${st.l.fade} s；时钟切换帧：上一帧 t ${pv.t.toFixed(3)}（fallback，曲 ${pv.a?.toFixed(3) ?? '—'}）→ 本帧 t ${sw.t.toFixed(3)}（audio，曲 ${sw.a.toFixed(3)}），后备领先 ${lead.toFixed(3)} s → 第 ${caught} 帧对齐，之后 ${tail.length} 帧 |t − 曲子位置| ≤ ${tailDrift.toFixed(4)} s（切换后最大 ${drift.toFixed(3)}）、不倒退；补位后 ${audioCues.length} 个 cue 按音频触发（${audioCues.map((c) => `${c.id} ${c.firedAt.toFixed(2)}/曲 ${c.audio.toFixed(2)}`).join('、') || '—'}）；之前 ${cues.length - audioCues.length} 个 fallback；按住 Space 跳过 → 结束页`;
    } finally {
      await cdp.unroute();
      await evaluate(`localStorage.clear(); 1`).catch(() => {});
      await cdp.goto('');
    }
  },
});

CHECKS.push({
  name: 'v0.1-035 结尾曲下载失败 art=1：CDP 把 mus-ending-ch1.ogg 路由成 404 → 不放音乐、不报错，演出走后备时钟照常放完 → 结束页',
  async run({ evaluate, cdp, sleep }) {
    const { until, unlock, gotoLong, ac, waitClock } = music1031({ evaluate, sleep });
    await evaluate(`localStorage.clear(); 1`);
    const hits = await cdp.route404('*mus-ending-ch1.ogg*');
    const errBefore = errors.length;
    try {
      await gotoLong(cdp, 'debug=1&scene=s3&art=1', 's3-lighthouse');
      await unlock(cdp);
      if (!(await until(`!!__s3.father && !!__s3.rig?.animator && !!__s3.endingCutscene && __game.assets.isMissing('mus-ending-ch1')`, 180000)))
        throw new Error('S3 没就绪 / 结尾曲没报 missing ' + JSON.stringify(await evaluate(`({ f: !!__s3?.father, m: __game.assets.isMissing('mus-ending-ch1'), fails: __game.assets.lazyAudioFailures })`)));
      await evaluate(cut035Hook);
      await evaluate(late035Hook);
      await evaluate(`(window.__c035 = __s3.endingCutscene, window.__em035 = __s3.endingMusic, __s3.lightTheLamp(), 1)`); // BUG-031：跳过 / 结束后 S3 会释放，演出 / 结尾曲对象先存
      if (!(await until(`__s3.endingMusic.result !== null`, 30000))) throw new Error('点燃后结尾曲没结果');
      const st = await evaluate(`({ res: __s3.endingMusic.result, k: __game.audio.musicKey, l: __game.audio.musicLog.at(-1) })`);
      if (st.res !== 'missing' || st.k === 'mus-ending-ch1') throw new Error('404 后不应放结尾曲 ' + JSON.stringify(st));
      if (!(await until(`__s3.endingCutscene.t >= ${ENDING_CUES.fog_open + 1}`, 120000))) throw new Error(`后备时钟没走到 ${ENDING_CUES.fog_open + 1} s`);
      await waitClock(ac, 0.2);
      const a = await evaluate(`({ t: __s3.endingCutscene.t, src: __s3.endingCutscene.clock.source, fr: __s3.endingCutscene.clock.frames, k: __game.audio.musicKey })`);
      if (a.src !== 'fallback' || a.fr.audio !== 0 || a.k !== null) throw new Error('404 后演出应走后备时钟、没有音乐 ' + JSON.stringify(a));
      for (const s of [45, 80, ENDING_CUES.silence - 2]) {
        await evaluate(`__s3.endingCutscene.seek(${s}), 1`);
        if (s < ENDING_CUES.silence - 2 && !(await until(`__s3.endingCutscene.t >= ${s + 1}`, 30000))) throw new Error('seek 后没走 ' + s);
      }
      if (!(await until(`__game.scenes.current?.name === 'chapter-end'`, 60000))) throw new Error(`后备时钟到 ${ENDING_CUES.silence} s 没进结束页`);
      const r = await evaluate(`window.__cut035`);
      const F = await evaluate(`window.__late035.frames`);
      const want = ['lens', 'fog_open', 'silhouette', 'gaze', 'father_in', 'father_out', 'no_answer', 'sit_write', 'journal', 'pull_back', 'fade_out'];
      if (r.cues.map((c) => c.id).join() !== want.join()) throw new Error('cue 顺序 ' + r.cues.map((c) => c.id).join());
      if (r.cues.some((c) => c.src !== 'fallback')) throw new Error('cue 应全是 fallback');
      if (F.some((f) => f.key === 'mus-ending-ch1' || f.src !== 'fallback')) throw new Error('演出期间放过结尾曲 / 用过音频时钟');
      if (!(r.sceneAt.t >= ENDING_CUES.silence && r.sceneAt.endedBy === 'end')) throw new Error('结束页时刻 ' + JSON.stringify(r.sceneAt));
      if (hits.length !== 1) throw new Error('结尾曲应只请求 1 次（404）：' + hits.length);
      await sleep(1000);
      const pg = await evaluate(`({ fade: __game.ui.fade.opacity, page6: __game.narrative.outroEntryUnlocked, k: __game.audio.musicKey })`);
      if (pg.fade > 0.05 || !pg.page6 || pg.k !== null) throw new Error('结束页 ' + JSON.stringify(pg));
      const gameErrors = errors.slice(errBefore).filter((e) => !/^浏览器: Failed to load resource: .*404.*mus-ending-ch1\.ogg/.test(e) && !/GPU stall due to ReadPixels|WebGL.*performance/i.test(e));
      if (gameErrors.length) throw new Error('404 时游戏报错：' + gameErrors.join(' | '));
      const early = r.cues.filter((c) => c.at <= ENDING_CUES.fog_open); // 实时段 = 雾口及以前（原写死 14）
      return `404 ×${hits.length}（S3 首帧后预取）→ isMissing、点燃后 result=${st.res}、musicKey=${st.k}（场景曲 ${st.l?.op} fade ${st.l?.fade} s）；演出后备时钟 ${a.t.toFixed(2)} s 时 ${a.fr.fallback} 帧 fallback / 0 帧 audio；实时段 ${early.map((c) => `${c.id} ${c.at}→${c.firedAt.toFixed(2)}`).join('、')}；seek 后 ${r.cues.length} 个 cue 全部 fallback、${F.length} 帧没放过结尾曲；结束页 @演出 ${r.sceneAt.t.toFixed(2)} s（endedBy end）、淡入后 fade ${pg.fade.toFixed(2)}、日志第 6 页 ${pg.page6}；除 Chrome 那条 404 网络日志外无报错`;
    } finally {
      await cdp.unroute();
      await evaluate(`localStorage.clear(); 1`).catch(() => {});
      await cdp.goto('');
    }
  },
});

// ---------------------------------------------------------------- M7 存档读档全流程（程序 M7 自查，2026-11-01）
// 主菜单新游戏 → 每个场景中途做出谜题进度 → 刷新（重新打开页面到主菜单）→「继续」→ 回到该场景入口、谜题全部复位（006：只存场景入口）
// → 在读档后的场景里把谜题解完、走出口进下一场景（存档跟上）→ S3 点灯 → 按住 Space 跳过结尾 → 结束页 → 刷新 → 继续回结束页 → 新游戏覆盖确认清档。
// 解谜步骤用各场景单项冒烟同样的捷径（传送 / interact 事件 / 机关按键 / beam.solve），这里只验「读档之后状态对、还能接着通关」。
CHECKS.push({
  name: 'v0.1-M7 完整通关 + 存档读档：主菜单新游戏 → S1 / S2 / S3 中途刷新 → 继续回场景入口且谜题复位 → 读档后解完谜题走出口 → 点灯 → 跳过结尾 → 结束页刷新后继续 → 新游戏清档',
  async run({ evaluate, cdp, sleep }) {
    const out = [];
    // 等待一律按游戏时间（无头软件渲染负载高时帧率很低），墙钟只兜底
    const untilG = async (expr, gameSec = 8, wallMs = 240000) => {
      const end = Date.now() + wallMs;
      let t0 = null;
      let v;
      while (Date.now() < end) {
        const r = await evaluate(`(() => { let v; try { v = (${expr}); } catch { v = false; } return { v, tick: window.__game?.time?.fixedTick ?? 0, dt: window.__game?.time?.fixedDelta ?? 0.0167 }; })()`).catch(() => ({ v: false, tick: 0, dt: 0 }));
        v = r.v;
        if (v) return v;
        t0 ??= r.tick;
        if ((r.tick - t0) * r.dt >= gameSec) return v;
        await sleep(100);
      }
      return v;
    };
    const untilW = async (expr, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (await evaluate(expr).catch(() => false)) return true;
        await sleep(150);
      }
      return false;
    };
    const visible = (sel) => `(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.checkVisibility(); })()`;
    const clickSel = async (sel) => {
      const r = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e || !e.checkVisibility()) return null; const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) throw new Error('看不到 ' + sel);
      await cdp.click(r.x, r.y);
    };
    const save = () => evaluate(`JSON.parse(localStorage.getItem('foglight.save.v1') || 'null')`);
    /** 存档那一刻（进场自动存档）的谜题快照 vs 读档后：__qa.diff 必须为空 */
    const snap = () => evaluate(`({ p: __qa.puzzles(), sv: __qa.saveData() })`);
    const sameAsSaved = async (at, label) => {
      const d = await evaluate(`__qa.diff(${JSON.stringify(at.p)}, __qa.puzzles())`);
      if (d.length) throw new Error(label + ' 读档后谜题状态和存档时不一致：' + d.join('；'));
      const sv2 = await evaluate(`__qa.save()`);
      if (sv2?.sceneId !== at.sv?.sceneId || JSON.stringify(sv2.readDocs) !== JSON.stringify(at.sv.readDocs)) throw new Error(label + ' 读档后存档内容变了 ' + JSON.stringify({ before: at.sv, after: sv2 }));
    };
    // batch25-3：GL 错误断言覆盖所有「进场景」——走出口、刷新后继续、新游戏（含覆盖确认）、S3 点灯 → 结束页、结束页继续
    const glClear = `(() => { const gl = __game.renderer.getContext(); for (let k = 0; k < 16 && gl.getError() !== gl.NO_ERROR; k++); return 1; })()`;
    const glErrs = `(() => { const gl = __game.renderer.getContext(); const e = []; for (let x = gl.getError(), k = 0; x !== gl.NO_ERROR && k < 8; x = gl.getError(), k++) e.push('0x' + x.toString(16)); return e; })()`;
    const glCheck = async (label) => {
      const ge = await evaluate(glErrs);
      if (ge.length) throw new Error(`${label} 期间有 GL 错误 ${ge.join(',')}`);
    };
    const ready = (S) => `!!(window.${S} && ${S}.puzzles && ${S}.rig) && __game.input.context === 'explore' && !__game.isPaused && !__game.flow.transitioning && !${S}.rig.controller.busy`;
    /** 刷新：重新打开游戏地址（不带 autostart → 主菜单），点「继续」，等场景可操作 */
    const refreshContinue = async (scene, S) => {
      await cdp.gotoMenu();
      if (!(await untilW(visible('.main-menu [data-act="continue"]'), 10000))) throw new Error('刷新后主菜单没有「继续」');
      await clickSel('.main-menu [data-act="continue"]');
      if (!(await untilW(`__game.scenes.current?.name === '${scene}'`, LOAD_MS))) throw new Error(`继续没进 ${scene}：` + (await evaluate(`__game.scenes.current?.name`)));
      if (S && !(await untilG(ready(S), 30, ESTAB_MS))) throw new Error(`继续后 ${scene} 没回到可操作`);
      // 刷新 = 新页面新上下文：错误队列从页面加载开始累计，覆盖菜单 + 继续读档进场全程
      await glCheck(`刷新后继续进 ${scene}`);
    };
    /** 走进当前场景出口（「外 → 内」触发：先放到外面一步，等两帧再放进去），等下一个场景可操作 */
    const takeExit = async (nextScene, S) => {
      await evaluate(glClear);
      await evaluate(`(async () => { const s = __game.scenes.current; const ex = s.exits[0]; const c = ex.opts.center.clone();
        s.rig.body.teleport(c.clone().add(s.name === 's1-ebb-shore' ? new c.constructor(2.5, 0.02, 0) : new c.constructor(3, 0.02, 3)));
        for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
        s.rig.body.teleport(c.clone().setY(c.y + 0.02)); return 1; })()`);
      if (!(await untilW(`__game.scenes.current?.name === '${nextScene}'`, LOAD_MS))) throw new Error(`出口没进 ${nextScene}`);
      if (!(await untilG(ready(S), 30, ESTAB_MS))) throw new Error(`${nextScene} 进场后没回到可操作`);
      // BUG-034：换场第一帧反射 pass 在阴影贴图建好前画受阴影物体 → INVALID_OPERATION（Chrome 只打警告，WebKit 记 console.error）
      await glCheck(`走出口进 ${nextScene}`);
    };

    // ======================================================== 新游戏 → S1
    await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
    await cdp.gotoMenu();
    if (await evaluate(visible('.main-menu [data-act="continue"]'))) throw new Error('清档后不该有「继续」');
    await evaluate(glClear);
    await clickSel('.main-menu [data-act="new"]');
    if (!(await untilW(`__game.scenes.current?.name === 's1-ebb-shore'`, LOAD_MS))) throw new Error('新游戏没进 S1');
    if (!(await untilG(ready('__s1'), 30, ESTAB_MS))) throw new Error('S1 开场后没回到可操作');
    await glCheck('主菜单新游戏进 S1');
    let sv = await save();
    if (sv?.sceneId !== 's1' || sv.chapterComplete) throw new Error('新游戏进 S1 应自动存档 s1 ' + JSON.stringify(sv));

    const S1T = `__s1.puzzles.tide`;
    const tp1 = (x, y, z, facing) => evaluate(`(() => { const s = __s1; s.interaction.cancel?.(); s.rig.body.teleport(new s.rig.body.position.constructor(${x}, ${y}, ${z})); ${facing !== undefined ? `s.rig.controller.facing = ${facing};` : ''} return 1; })()`);
    const ring1 = () => evaluate(`__game.events.emit('interact:used', { id: 'tide-bell-s1', kind: 'use' }); 1`);
    const s1st = () => evaluate(`(() => { const s = __s1, p = s.puzzles, b = s.rig.body.position, r = p.raft.object.position; return { tide: p.tide.state, level: +p.tide.level.toFixed(3), raft: p.raft.state, raftX: +r.x.toFixed(2), pushT: p.raftPush.pushT, p1: p.p1Solved, p2: p.p2Solved, gate: s.physics.colliders.find((c) => c.name === 's1-reef-gate-wall')?.enabled, goal: __game.narrative.goal, pos: [b.x, b.y, b.z].map((v) => +v.toFixed(2)), journal: __game.narrative.readDocs.slice() }; })()`);
    const solveP1 = async () => {
      await tp1(-14.45, 2.42, -6.2, -Math.PI / 2);
      await ring1();
      if (!(await untilG(`${S1T}.state === 'low' && !${S1T}.transitioning`, 20))) throw new Error('S1 敲钟没退潮 ' + JSON.stringify(await s1st()));
      await tp1(1.8, 0.14, 3.4);
      if (!(await untilG(`__s1.puzzles.p1Solved`, 6))) throw new Error('S1 小径尽头没解开谜题 1 ' + JSON.stringify(await s1st()));
    };
    const s1Initial = await s1st();
    const s1Saved = await snap();
    // ---- S1 中途：谜题 1 解开 + 读邻居纸条 → 刷新
    await solveP1();
    await tp1(15.05, S1.sandY + 0.1, -1.1, Math.PI);
    const readOk = await evaluate(`(() => { const s = __s1; const it = s.interaction.get?.('s1-neighbor-note') ?? s.interaction.items.find((i) => i.id === 's1-neighbor-note'); if (!it) return false; s.interaction.trigger(it); return true; })()`);
    if (readOk && (await untilG(`__game.ui.reader.isOpen`, 4))) await evaluate(`__game.ui.reader.close(); 1`);
    const midJournal = await evaluate(`__game.narrative.readDocs.slice()`);
    const midSave = await save();
    await refreshContinue('s1-ebb-shore', '__s1');
    await sameAsSaved(s1Saved, 'S1');
    let s = await s1st();
    const d0 = Math.hypot(s.pos[0] - s1Initial.pos[0], s.pos[2] - s1Initial.pos[2]);
    if (s.tide !== 'high' || Math.abs(s.level - 1.6) > 1e-3 || s.p1 || s.p2 || s.raft !== s1Initial.raft || Math.abs(s.raftX - s1Initial.raftX) > 0.05 || s.pushT !== 0 || !s.gate || s.goal !== s1Initial.goal || d0 > 0.6)
      throw new Error('S1 读档后应回入口、谜题复位（涨潮 1.6、谜题 1/2 未解、浮台原位、入口空气墙、初始目标）' + JSON.stringify({ s, s1Initial }));
    if (JSON.stringify(s.journal) !== JSON.stringify((await save()).readDocs)) throw new Error('S1 读档后日志应等于存档 readDocs ' + JSON.stringify({ s, sv: await save() }));
    out.push(`S1 中途（谜题 1 解开${readOk ? ' + 读纸条' : ''}）刷新 → 继续：回入口（偏 ${d0.toFixed(2)} m）、涨潮 1.6、谜题复位、目标 ${s.goal}、日志 ${s.journal.length} 条（中途内存里 ${midJournal.length} 条、存档 ${midSave.readDocs.length} 条）✓`);

    // ---- 读档后解完 S1：谜题 1 → 浮台进石槽 → 涨潮浮起 → 两次跨越到远侧台阶（谜题 2）→ 出口
    await solveP1();
    await evaluate(`(() => { const p = __s1.puzzles; p.raft.object.position.set(-0.9, 0.4, 10.5); p.raft.object.updateMatrixWorld(true); p.raftPush.pushT = 1; p.raftPush.locked = true; return 1; })()`);
    await tp1(-14.45, 2.42, -6.2, -Math.PI / 2);
    await ring1();
    if (!(await untilG(`${S1T}.state === 'high' && !${S1T}.transitioning && __s1.puzzles.raft.state === 'floating'`, 20))) throw new Error('S1 浮台石槽里涨潮没浮起 ' + JSON.stringify(await s1st()));
    const links = s1StepLinks();
    const cross = async (z, facing, label) => {
      await tp1(-0.9, 1.87, z, facing);
      if (!(await untilG(`!!__s1.rig.controller.nearLink`, 6))) throw new Error(label + '：没有跨越点 ' + JSON.stringify(await s1st()));
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
      await sleep(80);
      await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
      if (!(await untilG(`__s1.rig.controller.busy`, 4))) throw new Error(label + '：E 没开始跨越');
      if (!(await untilG(`!__s1.rig.controller.busy`, 15))) throw new Error(label + '：跨越没结束');
    };
    await cross(links[0].start - 0.15, 0, '岸 → 浮台');
    await cross(links[2].start - 0.25, 0, '浮台 → 远侧台阶');
    if (!(await untilG(`__s1.puzzles.p2Solved`, 6))) throw new Error('读档后到远侧台阶没解开谜题 2 ' + JSON.stringify(await s1st()));
    await takeExit('s2-keeper-house', '__s2');
    sv = await save();
    if (sv?.sceneId !== 's2' || sv.chapterComplete) throw new Error('进 S2 应存档 s2 ' + JSON.stringify(sv));
    out.push('读档后 S1 谜题 1 + 2 解开 → 出口 → S2、存档 s2 ✓');

    // ======================================================== S2
    const trig2 = (id) => evaluate(`(() => { const s = __s2; const it = s.interaction.get('${id}'); if (!it) return 'no'; s.interaction.trigger(it); return 'ok'; })()`);
    const tp2 = (x, y, z) => evaluate(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.body.position.constructor(${x}, ${y}, ${z})); return 1; })()`);
    const tpStand2 = (id) => evaluate(`(() => { const s = __s2; const st = s.interaction.get('${id}').standPoint(new s.rig.body.position.constructor()); const p = st.position; s.rig.body.teleport(p.clone().setY(p.y + 0.05)); s.rig.controller.facing = st.facing; return 1; })()`);
    const idle2 = `!__s2.rig.controller.busy && !__s2.interaction.animState`;
    const s2st = () => evaluate(`(() => { const s = __s2, p = s.puzzles, b = s.rig.body.position; return { ...p.state, holding: s.interaction.held.current?.id ?? null, glow: p.windowGlow.visible, A: p.beam.mirrorA.part.angles[0], B: p.beam.mirrorB.part.angles[0], lock: p.beam.lock.state, doorCol: s.colliderOf.get(s.greybox.cellarDoorLeaf).enabled, gateCol: s.colliderOf.get(s.greybox.dialGateLeaf).enabled, goal: __game.narrative.goal, ctx: __game.input.context, pos: [b.x, b.y, b.z].map((v) => +v.toFixed(2)) }; })()`);
    const key2 = async (code) => {
      await evaluate(`__game.input.setRaw('smoke', '${code}', true); 1`);
      await untilG('false', 0.02);
      await evaluate(`__game.input.setRaw('smoke', '${code}', false); 1`);
      await untilG('false', 0.15);
    };
    const s2Initial = await s2st();
    const s2Saved = await snap();
    const s2Journal = async () => {
      await tp2(-3.9, 3.05, -0.25);
      await untilG('false', 0.3);
      if ((await trig2('journal-s2')) !== 'ok') throw new Error('没有 journal-s2');
      if (!(await untilG(`__game.ui.reader.isOpen`, 6))) throw new Error('S2 日志没打开 ' + JSON.stringify(await s2st()));
      await evaluate(`__game.ui.reader.close(); 1`);
      if (!(await untilG(`__s2.puzzles.state.journalRead && __game.narrative.goal === 'ch1.s2.goal.cellar' && ${idle2}`, 6))) throw new Error('S2 读完日志目标应为 cellar ' + JSON.stringify(await s2st()));
    };
    const s2Lock = async () => {
      if ((await trig2('lantern-s2')) !== 'ok') throw new Error('没有 lantern-s2');
      if (!(await untilG(`__s2.interaction.held.current?.id === 'lantern' && ${idle2}`, 8))) throw new Error('S2 没拿起风灯 ' + JSON.stringify(await s2st()));
      await tpStand2('lamp-stand-east-s2');
      await untilG('false', 0.2);
      await trig2('lamp-stand-east-s2');
      if (!(await untilG(`!__s2.interaction.held.current && ${idle2}`, 8))) throw new Error('S2 东灯台没放下风灯 ' + JSON.stringify(await s2st()));
      await tp2(-12.2, 0.05, 2.0);
      await untilG('false', 0.2);
      await trig2('mirror-stand-s2-a');
      if (!(await untilG(`__game.input.context === 'puzzle'`, 4))) throw new Error('S2 没进镜子机关');
      await untilG('false', 1.2);
      await key2('KeyD');
      await key2('KeyD');
      await key2('KeyE');
      for (let i = 0; i < 3; i++) await key2('KeyA');
      await key2('Tab');
      if (!(await untilG(`__s2.puzzles.state.lockOpen && __s2.puzzles.state.doorOpen >= 1`, 8))) throw new Error('S2 光感锁 / 地窖门没开 ' + JSON.stringify(await s2st()));
    };
    // ---- S2 中途：读日志 → 东灯台 + 转镜开锁、地窖门开 → 刷新
    await s2Journal();
    await s2Lock();
    const s2Mid = await evaluate(`__qa.puzzles()`);
    await refreshContinue('s2-keeper-house', '__s2');
    await sameAsSaved(s2Saved, 'S2');
    s = await s2st();
    const d2 = Math.hypot(s.pos[0] - s2Initial.pos[0], s.pos[2] - s2Initial.pos[2]);
    if (s.holding !== 'lantern' || s.glow || s.journalRead || s.lockOpen || s.doorOpen !== 0 || !s.doorCol || s.hasKey || s.gateOpen || !s.gateCol || s.A !== 0 || s.B !== 0 || s.goal !== s2Initial.goal)
      throw new Error('S2 读档后应回入口、谜题复位（拿着风灯、窗不亮、锁 / 地窖门 / 铁门关、镜子 0°、初始目标）' + JSON.stringify({ s, s2Initial }));
    out.push(`S2 中途（日志 + 开锁 + 地窖门）刷新 → 继续：__qa.puzzles() 与进场存档时一致（中途改过 ${(await evaluate(`__qa.diff(${JSON.stringify(s2Saved.p)}, ${JSON.stringify(s2Mid)})`)).length} 项，读档后全部回到存档值）、入口${d2 > 0.6 ? `（默认入口，和从 S1 进来的入口差 ${d2.toFixed(1)} m）` : ''}、拿着风灯、锁 / 门 / 镜子复位、目标 ${s.goal} ✓`);

    // ---- 读档后解完 S2：日志 → 开锁 → 钥匙 → 观察点 317 → 拨盘 317 → 出口
    await s2Journal();
    await s2Lock();
    await tpStand2('cellar-key-s2');
    await untilG('false', 0.3);
    await trig2('cellar-key-s2');
    if (!(await untilG(`__s2.puzzles.state.hasKey && ${idle2}`, 12))) throw new Error('S2 没拿到钥匙 ' + JSON.stringify(await s2st()));
    await tp2(0.95, 3.05, 1.0);
    await untilG('false', 0.4);
    await evaluate(`__game.input.setRaw('smoke', 'Mouse2', true); 1`);
    await untilG('false', 0.7);
    for (let i = 0; i < 4; i++) {
      await evaluate(`(() => { const s = __s2, c = s.camera; const p = c.getWorldPosition(c.position.clone()); const t = p.clone().set(18, 0.2, 1).sub(p).normalize(); s.cameraFollow.yaw = Math.atan2(-t.x, -t.z); s.cameraFollow.pitch = Math.asin(t.y); return 1; })()`);
      await untilG('false', 0.25);
    }
    const seen = await untilG(`__s2.puzzles.state.digitsSeen`, 3);
    await evaluate(`__game.input.setRaw('smoke', 'Mouse2', false); 1`);
    if (!seen) throw new Error('S2 观察点对准后没显影 317 ' + JSON.stringify(await s2st()));
    await untilG('false', 0.8);
    await tpStand2('dial-gate-s2');
    await untilG('false', 0.3);
    await trig2('dial-gate-s2');
    if (!(await untilG(`__game.input.context === 'puzzle' && ${idle2}`, 8))) throw new Error('S2 拨盘没进机关');
    await untilG('false', 0.3);
    for (let i = 0; i < 3; i++) await key2('KeyD');
    await key2('KeyE');
    await key2('KeyD');
    await key2('KeyE');
    for (let i = 0; i < 7; i++) await key2('KeyD');
    if (!(await untilG(`__s2.puzzles.state.gateOpen && __game.input.context === 'explore' && !__s2.colliderOf.get(__s2.greybox.dialGateLeaf).enabled`, 8))) throw new Error('S2 拨盘 317 没开铁门 ' + JSON.stringify(await s2st()));
    await takeExit('s3-lighthouse', '__s3');
    sv = await save();
    if (sv?.sceneId !== 's3' || sv.chapterComplete) throw new Error('进 S3 应存档 s3 ' + JSON.stringify(sv));
    if (!sv.readDocs.includes('ch1.s2.journal.doc')) throw new Error('进 S3 时存档应记下读过父亲日志 ' + JSON.stringify(sv.readDocs));
    out.push('读档后 S2 日志 → 开锁 → 钥匙 → 观察点 317 → 拨盘开门 → 出口 → S3、存档 s3（含父亲日志）✓');

    // ======================================================== S3
    const ff = (sec) => evaluate(`(() => { for (let i = 0; i < ${Math.round(sec / 0.05)}; i++) __s3.puzzles.fixedUpdate(0.05); return 1; })()`);
    const s3st = () => evaluate(`(() => { const s = __s3, p = s.puzzles, b = s.rig.body.position; const c = s.colliderOf.get(s.greybox.doorLeaf); return { tide: p.tide.state, level: +p.tide.level.toFixed(3), rings: p.bell.rings, door: p.state.doorOpen, doorCol: c ? c.enabled : null, valve: p.state.valveOpen, ignited: p.state.ignited, ig: p.beam.igniter.state, lever: p.leverIx.enabled, sky: p.beam.sky.alwaysOn, goal: __game.narrative.goal, pos: [b.x, b.y, b.z].map((v) => +v.toFixed(2)) }; })()`);
    const s3Initial = await s3st();
    const s3Saved = await snap();
    const s3BellDoor = async () => {
      await evaluate(`__game.events.emit('interact:used', { id: 'tide-bell-s3', kind: 'use' }), 1`);
      await evaluate(`__s3.tides.fixedUpdate(7), 1`);
      if (!(await untilG(`__s3.puzzles.tide.state === 'low' && !__s3.puzzles.tide.transitioning`, 4))) throw new Error('S3 敲钟没退潮 ' + JSON.stringify(await s3st()));
      await evaluate(`__game.events.emit('interact:used', { id: 'door-s3', kind: 'use' }), 1`);
      await ff(1.5);
      if (!(await untilG(`__s3.puzzles.state.doorOpen >= 1`, 3))) throw new Error('S3 门没开 ' + JSON.stringify(await s3st()));
    };
    // ---- S3 中途：敲钟退潮 + 开门 + 开阀 → 刷新
    await s3BellDoor();
    await evaluate(`__game.events.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }), 1`);
    if (!(await evaluate(`__s3.puzzles.state.valveOpen`))) throw new Error('S3 开阀没生效');
    await refreshContinue('s3-lighthouse', '__s3');
    await sameAsSaved(s3Saved, 'S3');
    s = await s3st();
    if (s.tide !== s3Initial.tide || Math.abs(s.level - s3Initial.level) > 1e-3 || s.rings !== 0 || s.door !== 0 || s.doorCol !== true || s.valve || s.ignited || s.sky || s.lever || s.goal !== s3Initial.goal)
      throw new Error('S3 读档后应回入口、谜题复位（涨潮、钟未敲、门关 + 碰撞、阀关、天光不常亮、拉杆不可点、初始目标）' + JSON.stringify({ s, s3Initial }));
    out.push(`S3 中途（退潮 + 开门 + 开阀）刷新 → 继续：涨潮 ${s.level}、门 / 阀 / 拉杆复位、目标 ${s.goal} ✓`);

    // ---- 读档后解完 S3：退潮开门 → 光路正解 → 开阀 → 可点灯 → 拉杆前真按 E → 点燃 → 按住 Space 跳过结尾 → 结束页
    await s3BellDoor();
    await evaluate(`__s3.puzzles.beam.solve(), 1`);
    await evaluate(`__game.events.emit('interact:used', { id: 'oil-valve-s3', kind: 'hold' }), 1`);
    await ff(2.2);
    if (!(await untilG(`__s3.puzzles.beam.igniter.state === 'ready' && __s3.puzzles.leverIx.enabled`, 4))) throw new Error('S3 开阀后没进可点灯 ' + JSON.stringify(await s3st()));
    await evaluate(`(() => { const s = __s3; const sp = s.puzzles.leverIx.standPoint(s.rig.body.position.clone()); s.rig.body.position.set(sp.position.x, sp.position.y + 0.02, sp.position.z); s.rig.body.velocity.set(0, 0, 0); s.rig.controller.facing = sp.facing; return 1; })()`);
    if (!(await untilG(`__s3.interaction.current?.id === 'ignite-lever-s3' && !__s3.rig.controller.busy`, 4))) throw new Error('S3 拉杆前没选中拉杆 ' + JSON.stringify(await evaluate(`__s3.interaction.current?.id ?? null`)));
    await evaluate(glClear); // 点灯 → 结尾演出 → 跳过 → 结束页 全程
    await evaluate(`__game.input.setRaw('smoke', 'KeyE', true); 1`);
    const igniting = await untilG(`__s3.puzzles.state.igniting`, 3);
    await evaluate(`__game.input.setRaw('smoke', 'KeyE', false); 1`);
    if (!igniting) throw new Error('S3 按 E 没开始点灯');
    if (!(await untilG(`__s3.puzzles.state.ignited && !!__s3.endingCutscene`, 6))) throw new Error('S3 没点燃 / 没进结尾演出');
    await evaluate(`(window.__cM7 = __s3.endingCutscene, 1)`); // BUG-031 同理：跳过后 S3 释放，只读存下来的演出对象
    if (!(await untilW(`__game.ui.skip.id === 'ch1-ending'`, 60000))) throw new Error('结尾演出没注册跳过 ' + JSON.stringify(await evaluate(`({ id: __game.ui.skip.id, t: __cM7.t })`)));
    const space = (type) => `window.dispatchEvent(new KeyboardEvent('${type}', { code: 'Space', key: ' ', bubbles: true })), 1`;
    await evaluate(space('keydown'));
    const skipped = await untilW(`__cM7.endedBy === 'skip'`, 15000);
    await evaluate(space('keyup'));
    if (!skipped) throw new Error('按住 Space 没跳过结尾 ' + JSON.stringify(await evaluate(`({ t: __cM7.t, by: __cM7.endedBy })`)));
    if (!(await untilW(`__game.scenes.current?.name === 'chapter-end' && ${visible('.chapter-end')}`, 30000))) throw new Error('跳过后没进章节结束页');
    await glCheck('S3 点灯 → 结尾演出 → 跳过 → 结束页');
    sv = await save();
    if (!sv?.chapterComplete || !sv.readDocs.includes('ch1.s2.journal.doc')) throw new Error('结束页存档应 chapterComplete 且保留日志 ' + JSON.stringify(sv));
    const endTime = await evaluate(`document.querySelector('[data-role="playtime"]')?.textContent ?? ''`);
    out.push(`读档后 S3 退潮开门 → 光路 → 开阀 → 可点灯 → 真按 E 点燃 → 按住 Space 跳过结尾 → 结束页（用时 ${endTime.trim()}，存档 chapterComplete）✓`);

    // ---- 结束页刷新 → 继续回结束页；新游戏覆盖确认 → 清档进 S1
    await cdp.gotoMenu();
    if (!(await untilW(visible('.main-menu [data-act="continue"]'), 10000))) throw new Error('通关后刷新主菜单没有「继续」');
    await clickSel('.main-menu [data-act="continue"]');
    if (!(await untilW(`__game.scenes.current?.name === 'chapter-end'`, 20000))) throw new Error('通关存档继续应回结束页');
    await glCheck('刷新后继续进结束页');
    await clickSel('.chapter-end [data-act="to-menu"]');
    if (!(await untilW(`__game.scenes.current?.name === 'menu' && __game.ui.mainMenu.isOpen`, 20000))) throw new Error('结束页没回主菜单');
    await evaluate(glClear);
    await clickSel('.main-menu [data-act="new"]');
    if (!(await untilW(`__game.ui.mainMenu.view === 'confirm'`, 5000))) throw new Error('有存档新游戏没弹覆盖确认');
    await clickSel('.main-menu .confirm-dialog [data-act="ok"], .main-menu .confirm-dialog [data-act="confirm"]');
    if (!(await untilW(`__game.scenes.current?.name === 's1-ebb-shore'`, LOAD_MS))) throw new Error('覆盖确认后没进 S1');
    if (!(await untilG(ready('__s1'), 30, ESTAB_MS))) throw new Error('新游戏 S1 没回到可操作');
    await glCheck('结束页 → 主菜单 → 新游戏覆盖确认进 S1');
    sv = await save();
    if (sv?.sceneId !== 's1' || sv.chapterComplete || sv.readDocs.length || sv.hintsUsed || (await evaluate(`__game.narrative.readDocs.length`))) throw new Error('新游戏应清档（s1、未完成、日志 / 提示清空）' + JSON.stringify(sv));
    s = await s1st();
    if (s.tide !== 'high' || s.p1 || s.p2) throw new Error('新游戏 S1 谜题应是初始状态 ' + JSON.stringify(s));
    out.push('结束页刷新 → 继续回结束页 → 回主菜单 → 新游戏覆盖确认 → 清档进 S1（日志 / 提示 / 完成标记清空）✓');
    out.push('GL 错误 0：新游戏进 S1 ×2、走出口 ×2、刷新继续 ×4（S1 / S2 / S3 / 结束页）、S3 点灯 → 结束页 ✓');

    await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
    await cdp.goto('');
    return out.join('，');
  },
});


// ---------------------------------------------------------------- M7 每个场景里切画质（制作人 M7 用）
// S1 / S2 / S3（art=1，真模型）各切 ultra → high → standard → high → ultra（batch25-3 加 standard → high 这一步）：每次切完等画面走几帧，断言
// ① 没有 GL 错误（切前先清 gl.getError，切后读）② 截图不是黑屏 / 纯色（平均亮度、亮像素占比、颜色数）
// ③ 没丢实体：场景对象没换、所有可交互物 / 出口 / 汐都还挂在场景树上且整条父链可见、可交互物数量不变；网格总数变化只记录（雾片 / 草 / 雨跟档位走）
CHECKS.push({
  name: 'v0.1-M7 切画质：S1 / S2 / S3 每个场景三档来回切（极致 → 高 → 标准 → 高 → 极致），无 GL 错误、不黑屏、不丢实体',
  async run({ evaluate, cdp, sleep }) {
    const out = [];
    const scenes = [
      ['s1', 's1-ebb-shore'],
      ['s2', 's2-keeper-house'],
      ['s3', 's3-lighthouse'],
    ];
    const gameWait = async (sec) => {
      const t0 = await evaluate(`__game.time.fixedTick * __game.time.fixedDelta`);
      const end = Date.now() + 120000;
      while (Date.now() < end) {
        if ((await evaluate(`__game.time.fixedTick * __game.time.fixedDelta`)) - t0 >= sec) return;
        await sleep(150);
      }
    };
    const census = `(() => { const s = __game.scenes.current, root = s.scene;
      const chain = (o) => { if (!o) return 'none'; let c = o; while (c) { if (!c.visible) return 'hidden:' + c.name; if (c === root) return 'ok'; c = c.parent; } return 'detached'; };
      const items = s.interaction.items.filter((i) => i.enabled !== false);
      const bad = items.map((i) => [i.id, chain(i.object)]).filter(([, r]) => r !== 'ok');
      const xi = chain(s.rig.visual);
      let meshes = 0; root.traverse((o) => { if (o.isMesh) meshes++; });
      return { scene: s, name: s.name, items: items.length, bad, xi, exits: (s.exits ?? []).length, meshes };
    })()`;
    for (const [id, name] of scenes) {
      await cdp.goto(`debug=1&scene=${id}&art=1`, name); // ?scene= 直进要 debug=1（GameFlow）
      const end = Date.now() + ESTAB_MS;
      while (Date.now() < end && !(await evaluate(`__game.input.context === 'explore' && !__game.flow.transitioning`))) await sleep(250);
      await gameWait(1);
      await evaluate(`(window.__qScene = __game.scenes.current, 1)`);
      const base = await evaluate(`(() => { const c = ${census}; delete c.scene; return c; })()`);
      if (base.xi !== 'ok') throw new Error(`${id} 切档前汐就不在场景里 / 不可见 ` + JSON.stringify(base)); // 可交互物本来就隐藏的（触发体等）记在 base.bad，切档后要一样
      const rows = [];
      for (const tier of ['ultra', 'high', 'standard', 'high', 'ultra']) {
        await evaluate(`(() => { const gl = __game.renderer.getContext(); while (gl.getError() !== gl.NO_ERROR); return 1; })()`);
        await evaluate(`__game.quality.set('${tier}'); 1`);
        await gameWait(0.6);
        await sleep(300);
        const r = await evaluate(`(() => { const gl = __game.renderer.getContext(); const errs = []; for (let e = gl.getError(), k = 0; e !== gl.NO_ERROR && k < 8; e = gl.getError(), k++) errs.push('0x' + e.toString(16));
          const c = ${census}; const same = c.scene === window.__qScene; delete c.scene; return { ...c, same, tier: __game.quality.tier, errs, lost: __game.renderer.getContext().isContextLost() }; })()`);
        const shot = await cdp.shotStats();
        rows.push({ tier, meshes: r.meshes, mean: +shot.mean.toFixed(1), lit: +shot.lit.toFixed(2), colors: shot.colors });
        if (r.tier !== tier || !r.same) throw new Error(`${id} 切到 ${tier}：档位 ${r.tier}、场景${r.same ? '没换' : '被换了'}`);
        if (r.errs.length || r.lost) throw new Error(`${id} 切到 ${tier} 有 GL 错误 ${r.errs.join(',')}${r.lost ? '，上下文丢失' : ''}`);
        if (shot.mean < 6 || shot.lit < 0.05 || shot.colors < 24) throw new Error(`${id} 切到 ${tier} 画面像黑屏 / 纯色 ` + JSON.stringify(shot));
        if (r.items !== base.items || r.exits !== base.exits || JSON.stringify(r.bad) !== JSON.stringify(base.bad) || r.xi !== 'ok') throw new Error(`${id} 切到 ${tier} 丢了实体 ` + JSON.stringify({ base, r }));
      }
      out.push(`${id}：` + rows.map((x) => `${x.tier} 亮度 ${x.mean} 亮像素 ${x.lit} 色数 ${x.colors} 网格 ${x.meshes}`).join(' → ') + `（可交互物 ${base.items}、出口 ${base.exits} 不变）✓`);
    }
    await evaluate(`__game.quality.set('ultra'); delete window.__qScene; 1`);
    // 存档停在 s3 入口：不清档的话 autostart 会继续进 S3，等不到主场景
    await evaluate(`localStorage.clear(); 1`);
    await cdp.goto('');
    return out.join('；');
  },
});


// BUG-035：手机 / 无精确指针的平板打开时，主菜单首页换成 ui.notice.desktop_only（按钮隐藏）；桌面、触屏笔记本照常。
// 三种设备都只开主菜单（不带 autostart）：桌面原样 / 触屏笔记本（注入 maxTouchPoints=10 + ontouchstart，指针仍是鼠标）/
// 手机（CDP 设备模拟：393×852 DPR 3 mobile + 触摸模拟 + Android UA）。设备判定在页面启动时算一次，所以每种都重新打开页面。
CHECKS.push({
  name: 'v0.1-BUG-035 仅支持电脑提示：桌面 / 触屏笔记本不出提示、手机模拟出提示且不显示菜单按钮',
  async run() {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const state = `(() => {
      const vis = (sel) => { const e = document.querySelector(sel); return !!e && e.checkVisibility(); };
      const n = document.querySelector('.main-desktop-only'); const r = n?.getBoundingClientRect();
      const mm = (q) => matchMedia(q).matches;
      return { scene: __game.scenes.current?.name, cls: document.querySelector('.main-menu').classList.contains('is-desktop-only'),
        notice: vis('.main-desktop-only'), text: n?.textContent ?? null, newg: vis('.main-menu [data-act="new"]'), settings: vis('.main-menu [data-act="settings"]'),
        title: vis('.main-title'), rect: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)] : null,
        vw: innerWidth, vh: innerHeight, scrollW: document.documentElement.scrollWidth, font: n ? getComputedStyle(n).fontFamily.split(',')[0] : null,
        coarse: mm('(pointer: coarse)'), hover: mm('(hover: hover)'), anyFine: mm('(any-pointer: fine)'), touch: navigator.maxTouchPoints, ontouch: 'ontouchstart' in window };
    })()`;
    const out = [];
    const { userAgent } = await send('Browser.getVersion');
    let initId = null;
    try {
      // ---- 1. 桌面
      await cdp.gotoMenu();
      await wait(300);
      let m = await evaluate(state);
      if (m.cls || m.notice || !m.newg || !m.settings) throw new Error('桌面不该出「仅支持电脑」提示、按钮应在 ' + JSON.stringify(m));
      out.push(`桌面：无提示、菜单按钮在 ✓（coarse ${m.coarse} / hover ${m.hover} / 触点 ${m.touch}）`);

      // ---- 2. 触屏笔记本：有触摸能力，但主指针仍是鼠标 / 触控板
      ({ identifier: initId } = await send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get: () => 10, configurable: true }); window.ontouchstart = null;`,
      }, sessionId));
      await cdp.gotoMenu();
      await wait(300);
      m = await evaluate(state);
      if (m.touch !== 10 || !m.ontouch) throw new Error('触屏笔记本模拟没生效 ' + JSON.stringify(m));
      if (m.cls || m.notice || !m.newg) throw new Error('触屏笔记本被误判成手机 ' + JSON.stringify(m));
      out.push(`触屏笔记本（触点 10、ontouchstart、指针 fine）：无提示 ✓`);
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId }, sessionId);
      initId = null;

      // ---- 3. 手机
      await send('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 3, mobile: true }, sessionId);
      await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
      await send('Emulation.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' }, sessionId);
      await cdp.gotoMenu();
      await wait(500);
      m = await evaluate(state);
      if (!m.cls || !m.notice) throw new Error('手机模拟没出「仅支持电脑」提示 ' + JSON.stringify(m));
      if (m.text !== TEXT['ui.notice.desktop_only']) throw new Error(`提示文字应为文本表 ui.notice.desktop_only「${TEXT['ui.notice.desktop_only']}」：` + JSON.stringify(m.text));
      if (m.newg || m.settings) throw new Error('手机上菜单按钮应隐藏 ' + JSON.stringify(m));
      if (!m.title) throw new Error('手机上标题应保留 ' + JSON.stringify(m));
      const [l, t, r, b] = m.rect;
      if (l < 0 || t < 0 || r > m.vw || b > m.vh || m.scrollW > m.vw) throw new Error('提示超出竖屏视口 ' + JSON.stringify(m));
      out.push(`手机（393×852 mobile + 触摸，coarse ${m.coarse} / hover ${m.hover}）：提示「${m.text}」✓、按钮隐藏 ✓、标题在 ✓、提示框 [${m.rect.join(', ')}] 在视口内 ✓（字体 ${m.font}）`);
    } finally {
      if (initId) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: initId }, sessionId).catch(() => {});
      await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId).catch(() => {});
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
      await send('Emulation.setUserAgentOverride', { userAgent }, sessionId).catch(() => {});
    }
    // 回到桌面主场景（后面的项默认在 S1）
    await cdp.goto('');
    return out.join('；');
  },
});

// batch26 ④：全屏状态同步。requestFullscreen 走 CDP userGesture（等同玩家点了按钮）；退出用 document.exitFullscreen()
// 模拟「浏览器吞掉 Esc、页面收不到 keydown」的退出方式（无头 Chrome 里真 Esc 不一定退全屏，退出路径和真机一致的是这个事件）。
// 另用 webkitFullscreenElement + webkitfullscreenchange 走一遍 Safari 前缀路径。
CHECKS.push({
  name: 'v0.1-batch26-④ 全屏同步：fullscreenchange / webkitfullscreenchange 后状态、画布尺寸、设置按钮按下态同步；游玩中被退全屏补一次暂停、菜单里退全屏不动状态',
  async run({ evaluate, sleep }) {
    const gesture = (expression) => send('Runtime.evaluate', { expression, userGesture: true, awaitPromise: true, returnByValue: true }, sessionId);
    const st = () =>
      evaluate(`(() => { const g = __game, c = g.renderer.domElement, b = document.querySelector('.settings-panel [data-act="fullscreen"]');
        return { fs: g.fullscreen, doc: !!document.fullscreenElement, n: g.debugStats.fullscreenChanges, black: g.debugStats.resizeAfterRender, paused: g.isPaused, ctx: g.input.context,
          pauses: window.__b26pauses ?? -1, cw: c.width, ch: c.height, want: [Math.max(1, g.container.clientWidth), Math.max(1, g.container.clientHeight)].map((v) => Math.floor(v * g.renderer.getPixelRatio())),
          btn: b ? { on: b.classList.contains('on'), aria: b.getAttribute('aria-pressed'), text: b.textContent } : null }; })()`);
    const until = async (pred, ms = 5000) => { const end = Date.now() + ms; let s = await st(); while (!pred(s) && Date.now() < end) { await sleep(100); s = await st(); } return s; };
    const out = [];
    if (await evaluate('__game.isPaused')) await evaluate('__game.resume()');
    await evaluate(`(() => { window.__b26pauses = 0; window.__b26off?.(); window.__b26off = __game.events.on('game:pause', () => window.__b26pauses++); })()`);
    let s = await until((x) => x.ctx === 'explore', 20000);
    if (s.ctx !== 'explore' || s.paused) throw new Error('起点应在 S1 explore 且未暂停 ' + JSON.stringify(s));
    const n0 = s.n, black0 = s.black;
    // 1. 游玩中进全屏（未锁定指针）
    await gesture('document.documentElement.requestFullscreen()');
    s = await until((x) => x.fs);
    if (!s.fs || !s.doc || s.n !== n0 + 1) throw new Error('进全屏后 game.fullscreen 没同步 ' + JSON.stringify(s));
    if (s.paused) throw new Error('进全屏不该暂停 ' + JSON.stringify(s));
    s = await until((x) => x.cw === x.want[0] && x.ch === x.want[1]);
    if (s.cw !== s.want[0] || s.ch !== s.want[1]) throw new Error('进全屏后画布尺寸没跟上 ' + JSON.stringify(s));
    out.push(`进全屏：fullscreen=true、画布 ${s.cw}×${s.ch} ✓`);
    // 2. 浏览器退出全屏（页面收不到 Esc keydown）→ 补发一次 Esc → 暂停，只暂停一次
    await evaluate('document.exitFullscreen()');
    s = await until((x) => !x.fs && x.paused);
    if (s.fs || s.doc || !s.paused || s.ctx !== 'menu') throw new Error('游玩中被退全屏后应同步并暂停 ' + JSON.stringify(s));
    await sleep(600);
    s = await st();
    if (s.pauses !== 1 || !s.paused) throw new Error('退全屏应只暂停一次（不闪回）' + JSON.stringify(s));
    s = await until((x) => x.cw === x.want[0] && x.ch === x.want[1]);
    if (s.cw !== s.want[0] || s.ch !== s.want[1]) throw new Error('退全屏后画布尺寸没跟上 ' + JSON.stringify(s));
    out.push(`游玩中退全屏：同步 fullscreen=false、补发 Esc → 暂停 ×1 ✓、画布 ${s.cw}×${s.ch} ✓`);
    // 3. 暂停菜单 → 设置：点真按钮进全屏，按下态跟着变；设置开着时退全屏 → 按钮立刻复原，游戏状态不动
    await evaluate('__game.ui.pause.openSettings()');
    await sleep(300);
    s = await st();
    if (!s.btn || s.btn.on || s.btn.aria !== 'false') throw new Error('设置里全屏按钮初始应为未按下 ' + JSON.stringify(s));
    await gesture(`document.querySelector('.settings-panel [data-act="fullscreen"]').click()`);
    s = await until((x) => x.fs && x.btn?.on);
    if (!s.fs || !s.btn.on || s.btn.aria !== 'true') throw new Error('点全屏按钮后按下态没同步 ' + JSON.stringify(s));
    await evaluate('document.exitFullscreen()');
    await until((x) => !x.fs && !x.btn?.on);
    await sleep(500);
    s = await st();
    if (s.fs || s.btn.on || s.btn.aria !== 'false') throw new Error('设置开着时退全屏，按钮没复原 ' + JSON.stringify(s));
    if (!s.paused || s.pauses !== 1) throw new Error('菜单里退全屏不该改游戏状态 ' + JSON.stringify(s));
    out.push(`设置里：按钮按下态 进 ✓ / 退 ✓（文字「${s.btn.text}」不变），暂停状态不动 ✓`);
    // 4. Safari 前缀：只有 webkitFullscreenElement + webkitfullscreenchange
    await evaluate(`(() => { Object.defineProperty(document, 'webkitFullscreenElement', { get: () => window.__b26wk ?? null, configurable: true });
      window.__b26wk = document.documentElement; document.dispatchEvent(new Event('webkitfullscreenchange')); })()`);
    s = await until((x) => x.fs && x.btn?.on);
    if (!s.fs || !s.btn.on) throw new Error('webkitfullscreenchange 没同步进全屏 ' + JSON.stringify(s));
    // 同一状态重复到达（标准 + 前缀两个事件都发）只算一次
    const nWk = s.n;
    await evaluate(`document.dispatchEvent(new Event('webkitfullscreenchange')); document.dispatchEvent(new Event('fullscreenchange'))`);
    await sleep(200);
    s = await st();
    if (s.n !== nWk) throw new Error('状态没变的重复事件不该再算一次 ' + JSON.stringify(s));
    await evaluate(`(() => { window.__b26wk = null; document.dispatchEvent(new Event('webkitfullscreenchange')); delete document.webkitFullscreenElement; })()`);
    s = await until((x) => !x.fs && !x.btn?.on);
    if (s.fs || s.btn.on) throw new Error('webkitfullscreenchange 没同步退出 ' + JSON.stringify(s));
    out.push('webkit 前缀进 / 出 ✓、重复事件只算一次 ✓');
    s = await st();
    if (s.black !== black0) throw new Error(`全屏切换出现渲染后重设画布（黑帧）${black0} → ${s.black}`);
    await evaluate('__game.ui.pause.closeSettings?.(); window.__b26off?.(); __game.resume()');
    await sleep(300);
    out.push(`fullscreenChanges ${n0} → ${s.n}，渲染后重设画布 0 次 ✓`);
    return out.join('；');
  },
});

// batch26 ⑥：像素比变化（CDP 改 deviceScaleFactor，视口 CSS 尺寸不变 → ResizeObserver 不触发）也要重设画布和后处理渲染目标
CHECKS.push({
  name: 'v0.1-batch26-⑥ DPR 变化：matchMedia(resolution) 触发、视口不变也按新像素比重设画布 / 后处理 RT，变回来再跟一次',
  async run({ evaluate, sleep }) {
    const st = () =>
      evaluate(`(() => { const g = __game, c = g.renderer.domElement, ib = g.postfx?.composer?.inputBuffer;
        return { dpr: devicePixelRatio, n: g.debugStats.dprChanges, black: g.debugStats.resizeAfterRender, pr: g.renderer.getPixelRatio(), want: g.pixelRatio,
          cw: c.width, ch: c.height, css: [g.container.clientWidth, g.container.clientHeight], rt: ib ? [ib.width, ib.height] : null, tier: g.quality.tier }; })()`);
    const until = async (pred, ms = 8000) => { const end = Date.now() + ms; let s = await st(); while (!pred(s) && Date.now() < end) { await sleep(100); s = await st(); } return s; };
    const ok = (s) => Math.abs(s.pr - s.want) < 1e-6 && s.cw === Math.floor(s.css[0] * s.pr) && s.ch === Math.floor(s.css[1] * s.pr);
    const out = [];
    const s0 = await st();
    if (!ok(s0)) throw new Error('起点画布就和像素比不符 ' + JSON.stringify(s0));
    try {
      for (const dsf of [1.5, 1]) {
        const before = await st();
        await send('Emulation.setDeviceMetricsOverride', { width: before.css[0], height: before.css[1], deviceScaleFactor: dsf, mobile: false }, sessionId);
        const s = await until((x) => x.dpr === dsf && x.n > before.n && ok(x));
        if (s.dpr !== dsf) throw new Error(`CDP 改 deviceScaleFactor=${dsf} 没生效 ` + JSON.stringify(s));
        if (s.n <= before.n) throw new Error('DPR 变了但没收到 matchMedia(resolution) 变化 ' + JSON.stringify(s));
        if (!ok(s)) throw new Error('DPR 变了画布没按新像素比重设 ' + JSON.stringify(s));
        if (s.css[0] !== before.css[0] || s.css[1] !== before.css[1]) throw new Error('视口 CSS 尺寸不该变（这项要验证的是不靠 resize）' + JSON.stringify([before.css, s.css]));
        if (s.rt && before.rt && s.pr !== before.pr && s.rt[0] === before.rt[0]) throw new Error('后处理 RT 尺寸没跟着变 ' + JSON.stringify([before.rt, s.rt]));
        out.push(`DPR ${before.dpr} → ${dsf}：回调 ${s.n - before.n} 次，像素比 ${before.pr.toFixed(2)} → ${s.pr.toFixed(2)}（${s.tier}），画布 ${before.cw}×${before.ch} → ${s.cw}×${s.ch}${s.rt ? `，RT ${before.rt.join('×')} → ${s.rt.join('×')}` : ''} ✓`);
      }
    } finally {
      await send('Emulation.clearDeviceMetricsOverride', {}, sessionId).catch(() => {});
    }
    await sleep(500);
    const s = await st();
    if (s.black !== s0.black) throw new Error(`DPR 变化时出现渲染后重设画布（黑帧）${s0.black} → ${s.black}`);
    out.push('渲染后重设画布 0 次 ✓');
    return out.join('；');
  },
});

// batch26 ⑤：无头 QA 本身就是 SwiftShader（软件渲染）——主菜单要出「建议开启硬件加速」提示，但不能挡按钮 / 拦输入（真实 CDP 点击验证）
CHECKS.push({
  name: 'v0.1-batch26-⑤ 软件渲染提示：SwiftShader 下主菜单常驻 ui.notice.software_render、文案与文本表一致、不遮按钮、菜单真实点击可用',
  async run({ evaluate, cdp, sleep }) {
    const out = [];
    await cdp.gotoMenu();
    await sleep(300);
    const st = () =>
      evaluate(`(() => { const n = document.querySelector('.main-render-notice'); const r = n?.getBoundingClientRect();
        const box = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom]; };
        const btns = [...document.querySelectorAll('.main-menu .main-btn')].filter((b) => b.checkVisibility()).map((b) => {
          const [l, t, rr, bb] = box(b); const hit = document.elementFromPoint((l + rr) / 2, (t + bb) / 2);
          return { act: b.dataset.act, box: [l, t, rr, bb].map(Math.round), hitOk: !!hit && (hit === b || b.contains(hit)) }; });
        return { gpu: __game.quality.gpu, sw: __game.quality.softwareRender, view: __game.ui.mainMenu.view, menuOpen: __game.ui.mainMenu.isOpen,
          shown: !!n && n.checkVisibility(), text: n?.textContent ?? null, pe: n ? getComputedStyle(n).pointerEvents : null,
          rect: r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null, vw: innerWidth, vh: innerHeight, btns, focus: document.activeElement === n }; })()`);
    let m = await st();
    if (!m.sw) throw new Error('无头 Chrome 的 GPU 名应判成软件渲染：' + m.gpu);
    if (!m.shown) throw new Error('SwiftShader 下主菜单没显示软件渲染提示 ' + JSON.stringify(m));
    if (m.text !== TEXT['ui.notice.software_render']) throw new Error(`提示文字应为文本表 ui.notice.software_render「${TEXT['ui.notice.software_render']}」：` + JSON.stringify(m.text));
    if (m.pe !== 'none') throw new Error('提示应点击穿透（pointer-events: none）：' + m.pe);
    const [l, t, r, b] = m.rect;
    if (l < 0 || t < 0 || r > m.vw || b > m.vh) throw new Error('提示超出视口 ' + JSON.stringify(m.rect));
    if (m.btns.length < 3) throw new Error('主菜单按钮不全 ' + JSON.stringify(m.btns));
    for (const x of m.btns) {
      const [bl, bt, br, bb] = x.box;
      if (bl < r && br > l && bt < b && bb > t) throw new Error(`提示和按钮「${x.act}」重叠 ` + JSON.stringify([m.rect, x.box]));
      if (!x.hitOk) throw new Error(`按钮「${x.act}」中心点被别的元素挡住`);
    }
    out.push(`GPU「${m.gpu.slice(0, 60)}」判为软件渲染 ✓；提示「${m.text}」✓ 位于 [${m.rect.join(', ')}]，与 ${m.btns.length} 个按钮不重叠、按钮中心可点 ✓、点击穿透 ✓`);
    // 点在提示上的真实点击穿透到下面（不被提示吃掉），然后真实点击「设置」→ 设置打开、提示仍在（主菜单打开期间常驻）
    const hitUnder = await evaluate(`(() => { const r = document.querySelector('.main-render-notice').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 4, (r.top + r.bottom) / 2); return e ? e.className || e.tagName : null; })()`);
    if (/main-render-notice/.test(String(hitUnder))) throw new Error('提示区域命中了提示本身（没穿透）');
    await cdp.click(l + 4, (t + b) / 2);
    await sleep(200);
    const set = m.btns.find((x) => x.act === 'settings');
    await cdp.click((set.box[0] + set.box[2]) / 2, (set.box[1] + set.box[3]) / 2);
    m = await st();
    for (let i = 0; i < 20 && m.view !== 'settings'; i++) { await sleep(100); m = await st(); }
    if (m.view !== 'settings') throw new Error('真实点击「设置」没打开设置 ' + JSON.stringify({ view: m.view }));
    if (!m.shown) throw new Error('设置打开时提示应仍在（主菜单打开期间常驻）');
    const back = await evaluate(`(() => { const b = document.querySelector('.main-menu .settings-panel [data-act="back"]').getBoundingClientRect(); const e = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); return { x: b.x + b.width / 2, y: b.y + b.height / 2, ok: !!e && !!e.closest('[data-act="back"]') }; })()`);
    if (!back.ok) throw new Error('设置里「返回」被挡住');
    await cdp.click(back.x, back.y);
    m = await st();
    for (let i = 0; i < 20 && m.view !== 'home'; i++) { await sleep(100); m = await st(); }
    if (m.view !== 'home' || !m.shown) throw new Error('返回首页后提示应仍在 ' + JSON.stringify({ view: m.view, shown: m.shown }));
    out.push('提示上点击穿透 ✓、真实点击 设置 → 返回 ✓、设置页里提示仍在 ✓');
    // 进游戏后（主菜单关）提示跟着消失
    await cdp.goto('');
    const inGame = await evaluate(`(() => { const n = document.querySelector('.main-render-notice'); return !!n && n.checkVisibility(); })()`);
    if (inGame) throw new Error('进 S1 后提示应随主菜单隐藏');
    out.push('进 S1 后不显示 ✓');
    return out.join('；');
  },
});

// batch26 S3 导光镜键鼠覆盖：原来 015 / 017 里镜子都是直接调 beam.solve() / part.step()，没有走真实按键。
// 这里全部用 CDP Input.dispatchKeyEvent / dispatchMouseEvent（和玩家按键同一路径：浏览器事件 → KeyboardMouseInput → InputManager → PuzzleMode）。
// 只有「站到镜前」用传送（走路另有覆盖），进 / 出机关、转镜、精调、复位都是真实输入。
CHECKS.push({
  name: 'v0.1-batch26-S3 导光镜真实键鼠：E 进窗口镜 → A/D 偏航、W/S 俯仰各一档 15° → Shift 精调 7.5° → 鼠标右移 / 上移按档转 → R 复位 → Tab 退出；再 E 进 → 右键退出',
  async run({ evaluate, cdp, sleep }) {
    const out = [];
    const until = async (expr, ms = 8000) => { const end = Date.now() + ms; let v; while (!(v = await evaluate(expr)) && Date.now() < end) await sleep(100); return v; };
    const kc = { KeyA: ['a', 65], KeyD: ['d', 68], KeyW: ['w', 87], KeyS: ['s', 83], ShiftLeft: ['Shift', 16] };
    const keyEv = (type, code, modifiers = 0) => send('Input.dispatchKeyEvent', { type, code, key: kc[code][0], windowsVirtualKeyCode: kc[code][1], nativeVirtualKeyCode: kc[code][1], modifiers }, sessionId);
    const ANG = `__s3.puzzles.beam.mirrors.window.part.angles`;
    const angles = () => evaluate(`[...${ANG}]`);
    // 按住一个键直到镜子转了一档就松开（连发要再按住 0.35 s 游戏时间，无头低帧率下也只会多出整档，按整档判断）
    const holdStep = async (code, axis, shift = false) => {
      const a0 = await angles();
      if (shift) await keyEv('rawKeyDown', 'ShiftLeft', 8);
      await keyEv('rawKeyDown', code, shift ? 8 : 0);
      const moved = await until(`Math.abs(${ANG}[${axis}] - ${a0[axis]}) > 1e-6`, 15000);
      await keyEv('keyUp', code, shift ? 8 : 0);
      if (shift) await keyEv('keyUp', 'ShiftLeft');
      await sleep(300);
      const a1 = await angles();
      if (!moved) throw new Error(`按住 ${shift ? 'Shift+' : ''}${code} 15 s 镜子没转 ` + JSON.stringify({ a0, a1, ctx: await evaluate('__game.input.context') }));
      return a1.map((v, i) => v - a0[i]);
    };
    const isMult = (d, step) => Math.abs(d) >= step - 1e-6 && Math.abs(d / step - Math.round(d / step)) < 1e-6;
    const ctxState = `({ ctx: __game.input.context, active: __s3.interaction.puzzle.active?.id ?? null, locked: document.pointerLockElement === document.querySelector('canvas'), paused: __game.isPaused })`;

    await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
    await cdp.goto('debug=1&scene=s3', 's3-lighthouse');
    if (!(await until(`!!window.__s3?.puzzles?.beam`, 60000))) throw new Error('?scene=s3 没进 S3');
    if (!(await until(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, ESTAB_MS))) throw new Error('S3 建立镜头后没回到 explore');
    // 进场涨潮（底层机房有水，会被送回桥尾）：直接退潮
    await evaluate(`__s3.puzzles.tide.set('low', { instant: true }), 1`);
    // 真实点击锁定指针（鼠标转镜靠 pointer lock 的 movementX/Y）
    await cdp.click(640, 400);
    if (!(await until(`document.pointerLockElement === document.querySelector('canvas')`, 3000))) throw new Error('点画面没锁定指针');
    const toStand = `(() => { const s = __s3, ix = s.puzzles.mirrorIx.window; s.interaction.cancel(); const sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.05)); s.rig.controller.facing = sp.facing; return 1; })()`;
    const enter = async (label) => {
      let cand = null;
      for (let t = 0; t < 2 && !cand; t++) {
        await evaluate(toStand);
        cand = await until(`__s3.interaction.current === __s3.puzzles.mirrorIx.window`, 8000);
      }
      if (!cand) throw new Error(`${label}：站到窗口镜前交互候选不是它 ` + JSON.stringify(await evaluate(`({ cur: __s3.interaction.current?.id ?? null, en: __s3.puzzles.mirrorIx.window.enabled })`)));
      // 无头低帧率偶发吞键：没进去再补按（最多 3 次）
      let inPuzzle = false;
      for (let t = 0; t < 3 && !inPuzzle; t++) {
        await cdp.key('KeyE', 'e', 69);
        inPuzzle = await until(`__game.input.context === 'puzzle' && __s3.interaction.puzzle.active?.id === 'guide-mirror-s3-window-puzzle'`, 6000);
      }
      if (!inPuzzle) throw new Error(`${label}：真实 E 没进窗口镜机关 ` + JSON.stringify(await evaluate(ctxState)));
    };

    await enter('第一次');
    const a0 = await angles();
    if (a0.some((v) => Math.abs(v) > 1e-6)) throw new Error('窗口镜初始角不是 0 ' + JSON.stringify(a0));
    const dD = await holdStep('KeyD', 0);
    if (!isMult(dD[0], 15) || Math.abs(dD[1]) > 1e-6) throw new Error('D 应只转偏航整档 15° ' + JSON.stringify(dD));
    const dA = await holdStep('KeyA', 0);
    if (!isMult(dA[0], 15) || Math.sign(dA[0]) === Math.sign(dD[0])) throw new Error('A 应反向转偏航 ' + JSON.stringify({ dD, dA }));
    const dW = await holdStep('KeyW', 1);
    if (!isMult(dW[1], 15) || Math.abs(dW[0]) > 1e-6) throw new Error('W 应只转俯仰整档 ' + JSON.stringify(dW));
    const dS = await holdStep('KeyS', 1);
    if (!isMult(dS[1], 15) || Math.sign(dS[1]) === Math.sign(dW[1])) throw new Error('S 应反向转俯仰 ' + JSON.stringify({ dW, dS }));
    out.push(`E 进窗口镜 ✓，D ${dD[0]}° / A ${dA[0]}°（偏航）、W ${dW[1]}° / S ${dS[1]}°（俯仰）✓`);
    const dF = await holdStep('KeyD', 0, true);
    if (!isMult(dF[0], 7.5) || isMult(dF[0], 15)) throw new Error('Shift+D 应是 7.5° 精调档 ' + JSON.stringify(dF));
    out.push(`Shift+D 精调 ${dF[0]}° ✓`);
    // 鼠标：指针锁定下右移 / 上移（右 = 正、上 = 第二轴正），按 mouseStepRad 累计到一档才转
    const sens = await evaluate(`__game.input.lookSensitivity`);
    const m0 = await angles();
    let x = 640, y = 400;
    for (let i = 0; i < 12; i++) { x += 25; await cdp.move(x, y); await sleep(40); }
    await until(`Math.abs(${ANG}[0] - ${m0[0]}) > 1e-6`, 6000);
    for (let i = 0; i < 12; i++) { y -= 25; await cdp.move(x, y); await sleep(40); }
    await until(`Math.abs(${ANG}[1] - ${m0[1]}) > 1e-6`, 6000);
    await sleep(300);
    const m1 = await angles();
    const mx = m1[0] - m0[0];
    const my = m1[1] - m0[1];
    if (!(mx > 0) || !isMult(mx, 15)) throw new Error('鼠标右移应正向转偏航整档 ' + JSON.stringify({ m0, m1, sens }));
    if (!(my > 0) || !isMult(my, 15)) throw new Error('鼠标上移应正向转俯仰整档 ' + JSON.stringify({ m0, m1, sens }));
    out.push(`鼠标右移 300 px 偏航 +${mx}°、上移 300 px 俯仰 +${my}°（灵敏度 ${sens}）✓`);
    // R 复位
    let reset = false;
    for (let t = 0; t < 3 && !reset; t++) {
      await cdp.key('KeyR', 'r', 82);
      reset = await until(`__s3.puzzles.beam.mirrors.window.part.atInitial`, 4000);
    }
    if (!reset) throw new Error('R 没复位 ' + JSON.stringify(await angles()));
    out.push('R 复位 ✓');
    let exited = false;
    for (let t = 0; t < 3 && !exited; t++) {
      await cdp.key('Tab', 'Tab', 9);
      exited = await until(`__game.input.context === 'explore' && !__s3.interaction.puzzle.active`, 4000);
    }
    if (!exited) throw new Error('Tab 没退出机关 ' + JSON.stringify(await evaluate(ctxState)));
    out.push('Tab 退出 ✓');
    // 再进一次，右键退出（指针仍锁定）
    await enter('第二次');
    let rOut = false;
    for (let t = 0; t < 3 && !rOut; t++) {
      await cdp.click(640, 400, 'right');
      rOut = await until(`__game.input.context === 'explore' && !__s3.interaction.puzzle.active`, 4000);
    }
    if (!rOut) throw new Error('右键没退出机关 ' + JSON.stringify(await evaluate(ctxState)));
    out.push('再 E 进 → 右键退出 ✓');
    await evaluate(`document.exitPointerLock(); 1`);
    await sleep(400);
    if (await evaluate('__game.isPaused')) await evaluate('__game.resume()');
    await evaluate(`localStorage.removeItem('foglight.save.v1'); 1`);
    try { await cdp.goto(''); } catch (e) { throw new Error('回 S1 失败：' + e.message, { cause: e }); }
    return out.join('，');
  },
});

const extra = process.env.SMOKE_ONLY ? CHECKS.filter((c) => process.env.SMOKE_ONLY.split('|').some((k) => c.name.includes(k))) : CHECKS;

// ---------------------------------------------------------------- 起服务 + 浏览器
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/?smoke=1&autostart=1${process.env.SMOKE_QUERY ? '&' + process.env.SMOKE_QUERY : ''}`;
const profile = mkdtempSync(join(tmpdir(), 'smoke-chrome-'));
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    '--no-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=1280,720',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] },
);
const wsUrl = await new Promise((res, rej) => {
  let buf = '';
  const t = setTimeout(() => rej(new Error('Chrome 启动超时')), 20000);
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
    if (m) {
      clearTimeout(t);
      res(m[1]);
    }
  });
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let nextId = 1;
const pending = new Map();
const listeners = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) rej(new Error(msg.error.message));
    else res(msg.result);
  } else if (msg.method) for (const l of listeners) l(msg);
});
/** 页面渲染进程崩溃（box 内存紧张时被 OOM killer 杀掉）：挂着的 CDP 请求永远不会回，直接全部失败，不要无限等 */
let crashed = null;
listeners.push((m) => {
  if (m.method !== 'Inspector.targetCrashed' && !(m.method === 'Target.targetCrashed')) return;
  crashed = `页面渲染进程崩溃（${m.method}；多半是 box 内存不足被 OOM 杀掉，环境问题，重跑）`;
  for (const { rej } of pending.values()) rej(new Error(crashed));
  pending.clear();
  // 各项检查里的轮询会把错误吞掉一直等到超时：直接收场退出（退出码 1），由调用方重跑
  console.log(`  ✗ ${crashed}`);
  try {
    chrome.kill('SIGKILL');
  } catch {
    /* 已退出 */
  }
  setTimeout(() => {
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* */
    }
    console.log('冒烟测试失败：页面崩溃');
    process.exit(1);
  }, 1000);
});
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    if (crashed) return rej(new Error(crashed));
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const errors = [];
const warnings = [];
/** route404 期间预期内的 Chrome 网络 404 日志 */
const expectedErrors = [];
/** CDP Fetch 拦截：mode '404' 直接回 404；'hold' 先扣住（模拟慢网 / 资源晚到），release() 放行或 failHeld() 回 404 */
const route = { on: false, hits: [], mode: '404', held: [] };
const fulfill404 = (requestId) =>
  send('Fetch.fulfillRequest', { requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: '' }, sessionId).catch(() => {});
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
  if (m.method === 'Fetch.requestPaused') {
    route.hits.push(m.params.request.url);
    if (route.mode === 'hold') route.held.push({ requestId: m.params.requestId, url: m.params.request.url, wall: Date.now() });
    else void fulfill404(m.params.requestId);
    return;
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    errors.push(`未捕获异常: ${d.exception?.description ?? d.text}`);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    const text = m.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
    if (m.params.type === 'error') errors.push(`console.error: ${text}`);
    else if (m.params.type === 'warning') warnings.push(text);
  } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errors.push(`浏览器: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
  }
});
await send('Runtime.enable', {}, sessionId);
await send('Inspector.enable', {}, sessionId);
await send('Target.setDiscoverTargets', { discover: true });
await send('Log.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// 可信（isTrusted）输入：指针锁定等需要真实用户手势的功能用它测

/** M7：解 CDP 截图（8 位 RGB / RGBA、非隔行 PNG）→ 平均亮度、亮像素（Y > 24）占比、粗量化后的颜色数（黑屏 / 纯色屏判定用） */
function pngStats(buf) {
  let p = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 8 || d[12] !== 0) throw new Error('pngStats 只支持 8 位非隔行'); ct = d[9]; }
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const bpp = ct === 6 ? 4 : ct === 2 ? 3 : 0;
  if (!bpp) throw new Error('pngStats 不支持颜色类型 ' + ct);
  const raw = inflateSync(Buffer.concat(idat)), stride = w * bpp;
  let prev = Buffer.alloc(stride), sum = 0, lit = 0, n = 0;
  const colors = new Set();
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      line[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0)) & 255;
    }
    if (y % 4 === 0)
      for (let x = 0; x < w; x += 4) {
        const o = x * bpp, Y = 0.2126 * line[o] + 0.7152 * line[o + 1] + 0.0722 * line[o + 2];
        sum += Y; n++; if (Y > 24) lit++;
        colors.add((line[o] >> 4) * 256 + (line[o + 1] >> 4) * 16 + (line[o + 2] >> 4));
      }
    prev = line;
  }
  return { w, h, mean: sum / n, lit: lit / n, colors: colors.size };
}

const cdp = {
  /** M7：截当前画面并统计亮度（见 pngStats） */
  async shotStats() {
    const r = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    return pngStats(Buffer.from(r.data, 'base64'));
  },
  async click(x, y, button = 'left') {
    const buttons = { left: 1, right: 2, middle: 4 }[button];
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button, buttons, clickCount: 1 }, sessionId);
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button, buttons: 0, clickCount: 1 }, sessionId);
  },
  async move(x, y) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId);
  },
  /** 刷新页面并等主场景就绪（存档 / 设置的「刷新后仍保留」用） */
  async reload() {
    await send('Page.reload', { ignoreCache: false }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() + LOAD_MS;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === 's1-ebb-shore')`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`刷新后 ${LOAD_MS / 1000} 秒内主场景没有就绪`);
  },
  /** 换 URL 参数重新打开（在 ?smoke=1 基础上追加 query），等场景（默认主场景）就绪 */
  async goto(query, scene = 's1-ebb-shore') {
    await send('Page.navigate', { url: url + (query ? '&' + query : '') }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() + LOAD_MS;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === ${JSON.stringify(scene)})`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`换地址后 ${LOAD_MS / 1000} 秒内 ${scene} 场景没有就绪（SMOKE_LOAD_TIMEOUT_MS）`);
  },
  /** 不带 autostart 打开（默认流程：启动 → 主菜单，v0.1-008），等主菜单就绪 */
  async gotoMenu(query = '') {
    await send('Page.navigate', { url: url.replace('&autostart=1', '') + (query ? '&' + query : '') }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() + LOAD_MS;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === 'menu' && window.__game.ui.mainMenu.isOpen)`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`${LOAD_MS / 1000} 秒内主菜单没有就绪`);
  },
  /** CDP Fetch 把匹配 urlPattern 的请求直接回 404（033 改：懒加载失败路径）；返回命中的 URL 列表。只拦这个页面会话 */
  async route404(urlPattern, mode = '404') {
    route.hits = [];
    route.held = [];
    route.mode = mode;
    route.on = true;
    // Chrome 自己那条 404 网络日志是预期内的（文件名取 pattern 去掉 *）
    const file = urlPattern.replace(/\*/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    expectedErrors.push(new RegExp('^浏览器: Failed to load resource: .*404.*' + file));
    // HTTP 缓存命中时不经过拦截：路由期间关缓存
    await send('Network.enable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send('Fetch.enable', { patterns: [{ urlPattern, requestStage: 'Request' }] }, sessionId);
    return route.hits;
  },
  /** 扣住匹配的请求（不回应），之后 release() 放行 / failHeld() 回 404；返回 route（hits / held） */
  async routeHold(urlPattern) {
    await cdp.route404(urlPattern, 'hold');
    return route;
  },
  async release() {
    const h = route.held.splice(0);
    for (const r of h) await send('Fetch.continueRequest', { requestId: r.requestId }, sessionId).catch(() => {});
    return h;
  },
  async failHeld() {
    const h = route.held.splice(0);
    for (const r of h) await fulfill404(r.requestId);
    return h;
  },
  async unroute() {
    await cdp.release();
    route.mode = '404';
    route.on = false;
    await send('Fetch.disable', {}, sessionId);
    await send('Network.setCacheDisabled', { cacheDisabled: false }, sessionId);
    await send('Network.disable', {}, sessionId);
  },
  /** 之后每次导航都先跑的脚本（诊断用：长任务 / rAF 断档记录） */
  async initScript(source) {
    await send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
  },
  async key(code, key = code, keyCode = 0) {
    const base = { code, key, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }, sessionId);
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }, sessionId);
  },
};

let failed = 0;
const t0 = Date.now();
try {
  // 等主场景
  let ready = false;
  while (Date.now() - t0 < 60000) {
    ready = await evaluate(`Boolean(window.__game?.scenes?.current?.name === 's1-ebb-shore')`).catch(() => false);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!ready) {
    const diag = await evaluate(
      `JSON.stringify({ href: location.href, hasGame: !!window.__game, scene: window.__game?.scenes?.current?.name ?? null, body: document.body.innerText.slice(0, 200) })`,
    ).catch((e) => String(e));
    throw new Error('60 秒内主场景没有就绪：' + diag);
  }
  console.log(`  ✓ 主场景就绪（${((Date.now() - t0) / 1000).toFixed(1)}s）`);

  for (const c of extra) {
    try {
      const out = c.run
        ? await c.run({ evaluate, cdp, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) })
        : await evaluate(`(async () => { const g = window.__game; const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); ${c.code} })()`);
      console.log(`  ✓ ${c.name}${out ? '：' + out : ''}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${c.name}：${e.message.split('\n')[0]}`);
    }
  }
} catch (e) {
  failed++;
  console.log(`  ✗ ${e.message}`);
}

// 预期内的噪音：无 GPU 环境的 WebGL 性能提示
// 以及 DRACO 检查里故意喂无效数据时 worker 打出的解码错误
const realErrors = errors.filter(
  (e) => !/GPU stall due to ReadPixels|GL_CLOSE_PATH_NV|WebGL.*performance|DRACOLoader: Decoding failed: Unsupported geometry type/i.test(e) && !expectedErrors.some((re) => re.test(e)),
);
// P3：EventBus 监听器抛错会 console.error（上面已收），这里再读一次计数兜底（当前页面自加载以来）
// M7：读不到（页面崩了 / CDP 断了 / 没有 __game / 计数不是数）直接判失败，不再当 0 放过
const busRead = await Promise.race([new Promise((r) => setTimeout(() => r({ err: 'timeout 10 s' }), 10000)), evaluate(
  `(() => { const g = window.__game; if (!g) return { err: 'no __game' }; const n = g.events?.listenerErrors; return typeof n === 'number' && Number.isFinite(n) ? { n } : { err: 'listenerErrors = ' + String(n) }; })()`,
).then((v) => v, (e) => ({ err: 'evaluate failed: ' + String(e?.message ?? e).split('\n')[0] }))]);
const busErrors = busRead && typeof busRead.n === 'number' ? busRead.n : 0;
if (!busRead || typeof busRead.n !== 'number') {
  console.log(`  ✗ 读不到 EventBus 监听器抛错计数（${busRead?.err ?? '无返回'}）：页面可能已崩溃或 __game 丢失`);
  failed++;
} else if (busErrors > 0) {
  const recent = await evaluate(`(window.__game.events.recentListenerErrors || []).map((r) => r.type + ': ' + String(r.error?.stack ?? r.error).split('\\n')[0])`).catch(() => []);
  console.log(`  ✗ EventBus 监听器抛错 ${busErrors} 次（最近：${JSON.stringify(recent)}）`);
  failed++;
}
for (const e of realErrors) console.log(`  ✗ ${e}`);
if (warnings.length) console.log(`  （警告 ${warnings.length} 条，首条：${warnings[0]?.slice(0, 120)}）`);
failed += realErrors.length;

ws.close();
chrome.kill('SIGKILL');
await game.close();
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Chrome 可能还占着文件 */
}
console.log(failed ? `冒烟测试失败：${failed} 项` : '冒烟测试通过');
process.exit(failed ? 1 : 0);
