// 无头 Chrome 冒烟测试：构建产物（dist/）用 vite preview 起服务 → 无头 Chrome 打开 ?smoke=1 →
// 等主场景就绪 → 跑下面的 CHECKS → 汇总控制台错误 / 未捕获异常。任何一项失败退出码 1。
// 用法：npm run build && npm run smoke（需要本机有 Chrome/Chromium；路径可用 CHROME=/path 指定）
// 依赖：只用 Node 内置（child_process、WebSocket），不额外装 puppeteer。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 文本表原文（005 检查对照显示的文字） */
const TEXT = JSON.parse(readFileSync(resolve(root, '../docs/gdd/text-ch1.json'), 'utf8')).strings;
if (!existsSync(join(root, 'dist/index.html'))) {
  console.error('dist/ 不存在，先运行 npm run build');
  process.exit(1);
}
// 构建产物：DRACO 只应有 glTF 专用 wasm 一套（wrapper.js + .wasm），不应有通用版和纯 JS 回退
{
  const { readdirSync } = await import('node:fs');
  const files = readdirSync(join(root, 'dist/static'));
  const draco = files.filter((f) => f.startsWith('draco_'));
  const basis = files.filter((f) => f.startsWith('basis_'));
  const okDraco = draco.length === 2 && draco.some((f) => /^draco_wasm_wrapper-.*\.js$/.test(f)) && draco.some((f) => /^draco_decoder-.*\.wasm$/.test(f));
  const okBasis = basis.length === 2 && basis.some((f) => f.endsWith('.js')) && basis.some((f) => f.endsWith('.wasm'));
  if (!okDraco || !okBasis) {
    console.error(`  ✗ dist 解码器文件不对：${[...draco, ...basis].join(', ')}`);
    process.exit(1);
  }
  console.log(`  ✓ dist 解码器各一套：${[...draco, ...basis].join(', ')}`);
}
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
      const f0 = g.time.frame; await sleep(500);
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
    name: 'v0.1-003 建立镜头：进场 3 s 演出（cutscene 上下文），结束交还 explore',
    code: `
      const until = async (pred, ms = 20000) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
      const cam = g.scenes.current.cameraFollow;
      const first = cam.modeName;
      if (!(await until(() => g.input.context === 'explore' && cam.modeName === 'explore' && !cam.blending))) throw new Error('建立镜头没有结束：' + g.input.context + ' ' + cam.modeName);
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
      if (!s.save || s.save.version !== 1 || s.save.sceneId !== 'main') throw new Error('进场没有自动存档：' + JSON.stringify(s.save));
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
      await evaluate(`(() => { const g = __game; window.__qcam = [];
        g.events.on('quality:changed', (e) => { if (e.source === 'auto') window.__qcam.push(e.previous + '>' + e.tier + ':' + g.scenes.current.cameraFollow.modeName); }); return 1; })()`);
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
      if (drops.length !== 2 || !/:cutscene$/.test(drops[0]) || /:cutscene$/.test(drops[1])) throw new Error('第一轮应在建立镜头内、第二轮在交还之后：' + qcam.join(', '));
      out.push('simulateFps=40：' + seen.join(' → ') + ' ✓（第一轮在建立镜头内、第二轮玩家可操作后 ✓）');
      // 设置界面（暂停菜单）画质项下显示 quality_auto_note
      const note = await evaluate(`(async () => { __game.pause('user'); await new Promise((r) => setTimeout(r, 300));
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
            wantShadow: p.shadowType.mapSize, rain: rain.geometry.drawRange.count / 2, wantRain: p.rainParticles.count,
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
      const b2 = await evaluate(`(async () => { const g = __game; g.pause('user'); await new Promise((r) => setTimeout(r, 200));
        [...document.querySelectorAll('.pause-menu [data-role="quality"] button')].find((b) => b.textContent === '标准').click();
        await new Promise((r) => setTimeout(r, 200));
        const foot = document.querySelector('.pause-menu .menu-foot').textContent;
        const set1 = JSON.parse(localStorage.getItem('foglight.settings.v1'));
        g.settings.resetToDefaults(); await new Promise((r) => setTimeout(r, 200));
        const foot2 = (g.resume(), g.pause('user'), await new Promise((r) => setTimeout(r, 200)), document.querySelector('.pause-menu .menu-foot').textContent);
        g.resume();
        return { foot, foot2, state: g.benchmark.state, set1, set2: JSON.parse(localStorage.getItem('foglight.settings.v1')), tier: g.quality.tier };
      })()`);
      if (b2.state !== 'aborted') throw new Error('检测应被打断 ' + JSON.stringify(b2));
      if (!/^尚未自动检测/.test(b2.foot) || !/^尚未自动检测/.test(b2.foot2)) throw new Error('底栏应显示「尚未自动检测」：' + b2.foot + ' / ' + b2.foot2);
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
      inp.setRaw('smoke', 'KeyD', true);
      await until(() => !ctl.busy, 20000);
      inp.setRaw('smoke', 'KeyD', false);
      const d = body.position.distanceTo(tb.link.end);
      if (d > 0.1) throw new Error('跨越终点偏差 ' + d.toFixed(2));
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
      await g.scenes.change('main');
      await until(() => g.scenes.current && g.scenes.current.name === 'main');
      return '慢走 1.6 / 小跑 3.2 ✓，dev 面板读数 ✓，跨越（' + tb.link.duration.toFixed(2) + ' s）✓，黑场送回 ✓';`,
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
      await g.scenes.change('main');
      await until(() => g.scenes.current && g.scenes.current.name === 'main');
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
        const end = Date.now() + 3000;
        let st = null;
        while (Date.now() < end) {
          st = await evaluate(`({ paused: __game.isPaused, foot: document.querySelector('.pause-menu .menu-foot')?.textContent ?? '', shown: !document.querySelector('.pause-menu').hidden })`);
          if (st.paused && st.shown) break;
          await sleep(100);
        }
        if (!st?.paused || !st.shown) throw new Error('Esc 没打开暂停菜单 ' + JSON.stringify(st));
        if (/undefined|null|NaN/.test(st.foot)) throw new Error('暂停菜单底栏有 undefined：' + st.foot);
        if (detected && !st.foot.includes('自动检测：')) throw new Error('已检测状态底栏不对：' + st.foot);
        // 菜单开着时切档（refresh 再跑一次）
        await evaluate(`(() => { document.querySelector('.pause-menu [data-role="quality"] button:last-child').click(); document.querySelector('.pause-menu [data-role="quality"] button').click(); return 1; })()`);
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
        const p = await until(`(${re}).test(${prompt()}) && ${prompt()}`, 3000);
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
      if (!(await until(usedCount('sample-bell')))) throw new Error('敲钟没触发');
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
      // demo 灯塔（主场景）
      await cdp.goto('');
      if (!(await until(`__game.input.context === 'explore' && !__game.isPaused`, 30000))) throw new Error('主场景开场演出没交还');
      const on0 = await evaluate(`__game.scenes.current.lighthouseOn`);
      await evaluate(`(() => { const s = __game.scenes.current; s.rig.body.teleport(new s.rig.body.position.constructor(11, 2.45, -8.3)); s.rig.controller.facing = Math.PI; return 1; })()`);
      const lp = await until(`/E\\s*操作/.test(${prompt()})`, 10000);
      if (!lp)
        throw new Error(
          '灯塔旁没有「E 操作」提示：' + JSON.stringify(await evaluate(`(() => { const s = __game.scenes.current; const b = s.rig.body.position; const ix = s.interaction; return { pos: [b.x, b.y, b.z], facing: s.rig.controller.facing, ctx: __game.input.context, cand: ix.items.map((i) => [i.id, ix.canInteract(i)]) }; })()`)),
        );
      await tapE();
      if (!(await until(`__game.scenes.current.lighthouseOn !== ${on0}`, 2000))) throw new Error('E 没切换灯塔');
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
      if (!(await until(`__game.input.context === 'explore' && !__game.isPaused`, 30000))) throw new Error('测试场地没进 explore');
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
      const sizes = [];
      for (const sz of ['s', 'l', 'm']) {
        const b = await evaluate(`(() => { const r = document.querySelector('.pause-menu [data-size="${sz}"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
        await cdp.click(b.x, b.y);
        await sleep(100);
        sizes.push(await evaluate(`getComputedStyle(document.querySelector('.subtitle-line')).fontSize + '/' + __game.settings.get('subtitleSize')`));
      }
      if (sizes.join(',') !== '18px/s,28px/l,22px/m') throw new Error('字号切换不对 ' + sizes.join(','));
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
      const toast = await until(`(() => { const t = document.querySelector('.toast-left'); return t && !t.hidden ? t.textContent : ''; })()`, 2000);
      if (toast !== TEXT['ch1.common.journal_updated']) throw new Error('首次阅读没弹「日志已更新」：' + toast);
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
        await until(`__game.ui.reader.page === ${i}`, 2000);
        st = await rd();
        if (st.page !== i || st.body !== journalPages[i]) throw new Error(`D 翻到第 ${i + 1} 页不对 ` + JSON.stringify(st));
      }
      await cdp.key('KeyD', 'd', 68);
      // 等这一下被某一帧消费掉（无头低帧率），再按 A
      await until(`!__game.input.pressed.has('pageNext')`, 2000);
      if ((await rd()).page !== 4) throw new Error('最后一页再按 D 不该再翻');
      await cdp.key('KeyA', 'a', 65);
      if (!(await until(`__game.ui.reader.page === 3`, 2000))) throw new Error('A 没翻回 ' + JSON.stringify(await rd()) + ' ' + JSON.stringify(await evaluate(`({ held: [...__game.input.rawHeld.entries()].filter(([, v]) => v.size).map(([k, v]) => k + ':' + [...v]), pressed: [...__game.input.pressed.keys()] })`)));
      const arrow = await evaluate(`(() => { const r = document.querySelector('.reader-arrow[data-act="next"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
      await cdp.click(arrow.x, arrow.y);
      if (!(await until(`__game.ui.reader.page === 4 && document.querySelector('.reader-page').textContent === '5 / 5'`, 2000))) throw new Error('点箭头没翻页');
      out.push('5 页翻阅（A/D + 箭头）✓，打开时不能移动 ✓，日志已更新 ✓');
      // 右键关闭
      await cdp.click(640, 600, 'right');
      if (!(await until(`!__game.ui.reader.isOpen && __game.input.context === 'explore' && !__game.isFrozen`, 3000))) throw new Error('右键没关阅读界面');
      const toastGone = await until(`document.querySelector('.toast-left').hidden`, 15000);
      if (!toastGone) throw new Error('「日志已更新」没有消失');

      // ---- 6. 再次阅读：不重复添加、不再提示；Esc 暂停 → 继续 → 第一下右键直接关闭
      const upd0 = await evaluate(`__nx.filter(([n]) => n === 'journal:updated').length`);
      await goTo('sample-journal');
      await until(`/E\\s*阅读/.test(${promptText})`, 5000);
      await cdp.key('KeyE', 'e', 69);
      if (!(await until(`__game.ui.reader.isOpen`, 3000))) throw new Error('第二次 E 没打开');
      await sleep(300);
      const upd1 = await evaluate(`__nx.filter(([n]) => n === 'journal:updated').length`);
      const toast2 = await evaluate(`!document.querySelector('.toast-left').hidden`);
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
      for (let i = 1; i <= 5; i++) {
        await cdp.key('KeyD', 'd', 68);
        await until(`__game.ui.reader.page === ${i}`, 2000);
      }
      st = await rd();
      if (st.n !== 6 || st.page !== 5 || st.body !== TEXT['ch1.outro.journal_entry'] || st.idx !== '6 / 6') throw new Error('结尾后第 6 页不对 ' + JSON.stringify(st));
      await cdp.key('Tab', 'Tab', 9);
      if (!(await until(`!__game.ui.reader.isOpen && __game.ui.journal.isOpen && __game.input.context === 'reading'`, 3000))) throw new Error('Tab 关阅读后应回到日志');
      await cdp.key('KeyJ', 'j', 74);
      if (!(await until(`!__game.ui.journal.isOpen && __game.input.context === 'explore' && !__game.isFrozen`, 3000))) throw new Error('J 没关日志');
      out.push('日志分组 / 目标更新 / 第 6 页 ✓');
      // 第二种文档（告示）进「信与纸条」
      await goTo('sample-read');
      await until(`/E\\s*阅读/.test(${promptText})`, 5000);
      await cdp.key('KeyE', 'e', 69);
      await until(`__game.ui.reader.isOpen`, 3000);
      await cdp.key('Tab', 'Tab', 9);
      await until(`!__game.ui.reader.isOpen`, 3000);
      const groups = await evaluate(`__game.narrative.journal.map((e) => e.group + ':' + e.docId).join(',')`);
      if (groups !== 'father:ch1.s2.journal.doc,letters:ch1.s1.notice.doc') throw new Error('日志分组不对 ' + groups);
      out.push('信与纸条分组 ✓');
      return out.join('，');
    },
  },
];
const extra = process.env.SMOKE_ONLY ? CHECKS.filter((c) => c.name.includes(process.env.SMOKE_ONLY)) : CHECKS;

// ---------------------------------------------------------------- 起服务 + 浏览器
const server = await preview({ root, preview: { host: '127.0.0.1', port: 0, strictPort: false, open: false }, logLevel: 'silent' });
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/?smoke=1${process.env.SMOKE_QUERY ? '&' + process.env.SMOKE_QUERY : ''}`;
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
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const errors = [];
const warnings = [];
listeners.push((m) => {
  if (m.sessionId !== sessionId) return;
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
await send('Log.enable', {}, sessionId);
await send('Page.enable', {}, sessionId);
await send('Page.navigate', { url }, sessionId);

const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
};

// 可信（isTrusted）输入：指针锁定等需要真实用户手势的功能用它测
const cdp = {
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
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === 'main')`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('刷新后 60 秒内主场景没有就绪');
  },
  /** 换 URL 参数重新打开（在 ?smoke=1 基础上追加 query），等场景（默认主场景）就绪 */
  async goto(query, scene = 'main') {
    await send('Page.navigate', { url: url + (query ? '&' + query : '') }, sessionId);
    await new Promise((r) => setTimeout(r, 300));
    const end = Date.now() + 60000;
    while (Date.now() < end) {
      if (await evaluate(`Boolean(window.__game?.scenes?.current?.name === ${JSON.stringify(scene)})`).catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('换地址后 60 秒内 ' + scene + ' 场景没有就绪');
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
    ready = await evaluate(`Boolean(window.__game?.scenes?.current?.name === 'main')`).catch(() => false);
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
  (e) => !/GPU stall due to ReadPixels|GL_CLOSE_PATH_NV|WebGL.*performance|DRACOLoader: Decoding failed: Unsupported geometry type/i.test(e),
);
for (const e of realErrors) console.log(`  ✗ ${e}`);
if (warnings.length) console.log(`  （警告 ${warnings.length} 条，首条：${warnings[0]?.slice(0, 120)}）`);
failed += realErrors.length;

ws.close();
chrome.kill('SIGKILL');
await new Promise((r) => server.httpServer.close(r));
try {
  rmSync(profile, { recursive: true, force: true });
} catch {
  /* Chrome 可能还占着文件 */
}
console.log(failed ? `冒烟测试失败：${failed} 项` : '冒烟测试通过');
process.exit(failed ? 1 : 0);
