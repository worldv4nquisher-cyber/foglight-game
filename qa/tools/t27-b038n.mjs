// batch27 BUG-038 回归（snap-18cc26f，期望 repro=false、fixed=true）+ C 重试锁定；原复现脚本 t27-b038.mjs：指针锁定被拒（iframe sandbox 无 allow-pointer-lock / 模拟 pointerlockerror）时，不会回退鼠标拖拽，只能键盘转镜
import { open, sleep, SH13 as SH } from './b27libn.mjs';
import { writeFileSync } from 'node:fs';
const D = `${SH}/hooks`; const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const out = { game: process.env.QA_GAME, runs: {} }; const save = () => writeFileSync(`${D}/t27-b038n.json`, JSON.stringify(out, null, 1));
const { page, ev, url, done } = await open(5783, { width: 1280, height: 720 });
const KC = { KeyD: ['d', 68], KeyE: ['e', 69], Tab: ['Tab', 9] };
const cdpKey = (type, code) => page.send('Input.dispatchKeyEvent', { type, code, key: KC[code][0], windowsVirtualKeyCode: KC[code][1], nativeVirtualKeyCode: KC[code][1] });
const mouse = (type, x, y, buttons) => page.send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? (buttons ? 'left' : 'none') : 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
async function scenario(name, F) {
  const r = { name }; out.runs[name] = r; const until = async (e, ms = 10000) => { const end = Date.now() + ms; let v; while (!(v = await ev(F(e)).catch(() => false)) && Date.now() < end) await sleep(100); return v; };
  const frames = async (n) => { const f0 = await ev(F(`__game.time.frame`)); await until(`__game.time.frame >= ${f0 + n}`, 30000); };
  if (!(await until(`!!window.__s3?.puzzles?.beam`, 300000))) throw new Error(name + ' 没进 S3');
  if (!(await until(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 180000))) throw new Error(name + ' S3 没回 explore');
  await ev(F(`(() => { __s3.puzzles.tide.set('low', { instant: true }); window.__lg = []; document.addEventListener('pointerlockerror', () => __lg.push('pointerlockerror')); document.addEventListener('pointerlockchange', () => __lg.push('pointerlockchange:' + !!document.pointerLockElement));
    const im = __game.input; const o = im.addLook.bind(im); window.__look = { n: 0, sx: 0, sy: 0 }; im.addLook = (x, y) => { __look.n++; __look.sx += x; __look.sy += y; return o(x, y); }; return 1; })()`));
  r.env = await ev(F(`({ supportsPointerLock: 'pointerLockElement' in document, sandbox: window.frameElement?.getAttribute('sandbox') ?? null, inIframe: window !== window.top })`));
  // 1) 探索：点画面（请求锁定）
  await mouse('mouseMoved', 640, 400, 0); await mouse('mousePressed', 640, 400, 1); await mouse('mouseReleased', 640, 400, 0); await sleep(1500);
  r.afterClick = await ev(F(`({ locked: !!document.pointerLockElement, log: [...__lg] })`));
  // 2) 探索：按住左键拖拽 200 px
  const lk0 = await ev(F(`({ ...__look })`)); const cam0 = await ev(F(`(() => { const q = __game.scenes.current.camera.quaternion; return [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5)); })()`));
  await mouse('mousePressed', 640, 400, 1); for (let x = 650; x <= 840; x += 10) { await mouse('mouseMoved', x, 400, 1); await sleep(30); } await mouse('mouseReleased', 840, 400, 0); await frames(6);
  const lk1 = await ev(F(`({ ...__look })`)); const cam1 = await ev(F(`(() => { const q = __game.scenes.current.camera.quaternion; return [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(5)); })()`));
  r.exploreDrag = { lookCalls: lk1.n - lk0.n, lookSumX: +(lk1.sx - lk0.sx).toFixed(4), camBefore: cam0, camAfter: cam1, locked: await ev(F(`!!document.pointerLockElement`)) };
  // 3) 进窗口镜（真实 E），拖拽 200 px → 角度；再键盘 D
  await ev(F(`(() => { const s = __s3, ix = s.puzzles.mirrorIx.window; s.interaction.cancel(); const sp = ix.standPoint(s.rig.body.position.clone()); s.rig.body.teleport(sp.position.clone().setY(sp.position.y + 0.05)); s.rig.controller.facing = sp.facing; return 1; })()`));
  await until(`__s3.interaction.current === __s3.puzzles.mirrorIx.window`, 10000);
  await cdpKey('rawKeyDown', 'KeyE'); await cdpKey('keyUp', 'KeyE');
  r.enteredPuzzle = !!(await until(`__game.input.context === 'puzzle' && !!__s3.interaction.puzzle.active`, 10000)); await frames(3);
  const ANG = `[...__s3.puzzles.beam.mirrors.window.part.angles]`;
  const a0 = await ev(F(ANG)); const l0 = await ev(F(`({ ...__look })`));
  await mouse('mousePressed', 640, 400, 1); for (let x = 650; x <= 840; x += 10) { await mouse('mouseMoved', x, 400, 1); await sleep(30); } for (let y = 390; y >= 250; y -= 10) { await mouse('mouseMoved', 840, y, 1); await sleep(30); } await mouse('mouseReleased', 840, 250, 0); await frames(6);
  const a1 = await ev(F(ANG)); const l1 = await ev(F(`({ ...__look })`));
  r.puzzleDrag = { before: a0, after: a1, lookCalls: l1.n - l0.n, ctx: await ev(F(`__game.input.context`)), locked: await ev(F(`!!document.pointerLockElement`)), log: await ev(F(`[...__lg]`)) };
  await cdpKey('rawKeyDown', 'KeyD'); await cdpKey('keyUp', 'KeyD'); await until(`${ANG}[0] !== ${a1[0]}`, 8000); await frames(3);
  r.puzzleKeyD = { after: await ev(F(ANG)) };
  await page.screenshot(`${D}/b27-bug038n-${name}.png`).catch(() => 0);
  r.repro = !r.afterClick.locked && r.exploreDrag.lookCalls === 0 && r.puzzleDrag.lookCalls === 0 && JSON.stringify(a0) === JSON.stringify(a1) && r.puzzleKeyD.after[0] !== a1[0];
  r.fixed = !r.afterClick.locked && r.exploreDrag.lookCalls > 0 && r.puzzleDrag.lookCalls > 0 && JSON.stringify(a0) !== JSON.stringify(a1) && r.puzzleDrag.ctx === 'puzzle';
  log(name, JSON.stringify(r)); save();
}
try {
  // A. 同源包装页 + <iframe sandbox="allow-scripts allow-same-origin">（不给 allow-pointer-lock）
  await page.goto(url('static/index-BDK1p0Gx.css')); await sleep(1500);
  await ev(`(() => { document.documentElement.innerHTML = '<head><style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:1280px;height:720px;display:block}</style></head><body></body>'; const f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-same-origin'); f.src = ${JSON.stringify(url('?smoke=1&art=0&debug=1&scene=s3'))}; document.body.appendChild(f); return 1; })()`);
  const FI = (e) => `document.querySelector('iframe').contentWindow.eval(${JSON.stringify(e)})`;
  await scenario('iframe-sandbox', FI);
  // B. 顶层页 + 模拟拒绝：requestPointerLock 改成异步发 pointerlockerror 并返回 rejected Promise（与 Chrome 被拒时行为一致）
  await page.goto(url('?smoke=1&art=0&debug=1&scene=s3')); await sleep(3000);
  await page.waitFor(`!!window.__s3?.puzzles?.beam`, 300000, 300);
  await ev(`(() => { Element.prototype.requestPointerLock = function () { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0); return Promise.reject(new DOMException('模拟：锁定被拒', 'NotSupportedError')); }; return 1; })()`);
  await scenario('top-simulated-error', (e) => e);

  // C. 顶层页：先拒（回退拖拽）→ 恢复原生 requestPointerLock → 1.5 s 内再点不重试；隔 >1.5 s 再点重试，锁上后回锁定模式（无按键移动就转视角）
  await page.goto(url('?smoke=1&art=0&debug=1&scene=s3')); await sleep(3000);
  await page.waitFor(`!!window.__s3?.puzzles?.beam && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 300000, 300);
  const rc = { name: 'retry' }; out.runs.retry = rc;
  await ev(`(() => { window.__orig = Element.prototype.requestPointerLock; window.__req = 0; window.__lg = []; document.addEventListener('pointerlockchange', () => __lg.push('change:' + !!document.pointerLockElement)); document.addEventListener('pointerlockerror', () => __lg.push('error'));
    Element.prototype.requestPointerLock = function () { __req++; if (window.__deny) { setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0); return Promise.reject(new DOMException('模拟', 'NotAllowedError')); } return __orig.call(this); }; window.__deny = true;
    const im = __game.input; const o = im.addLook.bind(im); window.__look = { n: 0 }; im.addLook = (x, y) => { __look.n++; return o(x, y); }; return 1; })()`);
  const click = async () => { await mouse('mouseMoved', 640, 400, 0); await mouse('mousePressed', 640, 400, 1); await mouse('mouseReleased', 640, 400, 0); };
  await click(); await sleep(400); rc.denied = await ev(`({ locked: !!document.pointerLockElement, req: __req, lg: [...__lg] })`);
  await ev(`window.__deny = false, 1`); await click(); await sleep(400);
  rc.within1500 = await ev(`({ locked: !!document.pointerLockElement, req: __req })`);
  await sleep(1700); await click(); await sleep(1500);
  rc.after1500 = await ev(`({ locked: !!document.pointerLockElement, req: __req, lg: [...__lg] })`);
  const n0 = await ev(`__look.n`); for (let x = 650; x <= 760; x += 10) { await mouse('mouseMoved', x, 400, 0); await sleep(30); } await sleep(800);
  rc.lockedMoveLook = (await ev(`__look.n`)) - n0;
  rc.ok = !rc.denied.locked && rc.within1500.req === rc.denied.req && rc.after1500.locked && rc.after1500.req === rc.denied.req + 1 && rc.lockedMoveLook > 0;
  log('retry', JSON.stringify(rc)); save();
  out.errors = page.errors.slice(0, 10); save(); log('DONE');
} catch (e) { out.fail = String(e?.message ?? e); out.errors = page.errors.slice(0, 10); save(); log('FAIL', out.fail); }
await done(); process.exit(0);
