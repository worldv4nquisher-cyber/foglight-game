import { sleep } from './cdp.mjs';
import { SHOTS } from './common.mjs';
export async function run({ page, ev, rec, step, T, state }) {
  const lock = async () => {
    if ((await state()).locked) return;
    await sleep(1200);
    await page.click(640, 360);
    await page.waitFor(`document.pointerLockElement === document.querySelector('canvas')`, 3000);
  };
  const doInput = async (inp) => {
    if (inp === 'Mouse0') await page.click(640, 360, 'left');
    else if (inp === 'Mouse2') await page.click(640, 360, 'right');
    else if (inp === 'WheelUp') await page.wheel(640, 360, -100);
    else if (inp === 'WheelDown') await page.wheel(640, 360, 100);
    else if (inp === 'HoldSpace') { await page.keyDown('Space'); await sleep(1600); await page.keyUp('Space'); }
    else await page.tap(inp);
  };
  const fire = async (inp) => {
    await ev(`window.__qaMark = __game.input.recent[0]?.t ?? -1; 1`);
    await doInput(inp);
    await sleep(350);
    return ev(`(() => { const out = []; for (const r of __game.input.recent) { if (r.t === window.__qaMark) break; out.push(r.context + ':' + r.action); } return out.reverse(); })()`);
  };
  const table = {
    explore: [['KeyE', 'interact'], ['Space', 'advance'], ['Mouse0', 'advance'], ['ShiftLeft', 'sprint'], ['Mouse2', 'observe'], ['KeyH', 'hint'], ['KeyJ', 'journal']],
    puzzle: [['KeyE', 'partNext'], ['KeyQ', 'partPrev'], ['WheelDown', 'partNext'], ['WheelUp', 'partPrev'], ['ShiftLeft', 'fineAdjust'], ['KeyR', 'resetPuzzle'], ['KeyH', 'hint'], ['Space', 'advance'], ['Tab', 'exitPuzzle'], ['Mouse2', 'exitPuzzle']],
    reading: [['Space', 'advance'], ['Mouse0', 'advance'], ['Tab', 'exitPuzzle'], ['Mouse2', 'exitPuzzle'], ['KeyE', null]],
    cutscene: [['Space', 'advance'], ['HoldSpace', 'skipHold'], ['KeyE', null]],
    menu: [['KeyE', null], ['Space', null]],
  };
  await step(rec, T, '键位表', async () => {
    const fails = [];
    const okList = [];
    for (const [ctx, rows] of Object.entries(table)) {
      if (ctx !== 'explore') await ev(`window.__qaPop = __game.input.pushContext('${ctx}'); 1`);
      if (ctx === 'explore' || ctx === 'puzzle') await lock();
      for (const [inp, want] of rows) {
        const got = await fire(inp);
        const ok = want === null ? got.length === 0 : got.includes(`${ctx}:${want}`) && !(ctx === 'puzzle' && got.includes('puzzle:interact'));
        (ok ? okList : fails).push(`${ctx}/${inp}→${got.join('+') || '无'}${ok ? '' : `（期望 ${want ?? '无'}）`}`);
      }
      if (ctx !== 'explore') await ev(`window.__qaPop(); 1`);
    }
    rec(T, 'GDD §3 每个按键在对应上下文触发对应 action（真实键鼠事件）', fails.length ? 'FAIL' : 'PASS', (fails.length ? '不符：' + fails.join('；') + '。' : '') + `符合 ${okList.length} 项：` + okList.join('；'));
  });
  await step(rec, T, 'F4 面板', async () => {
    await lock();
    await page.tap('F4');
    await sleep(800);
    await page.tap('KeyE');
    await sleep(800);
    const p = await ev(`(() => { const el = document.querySelector('.debug-panel'); return { shown: !!el && el.style.display !== 'none' && getComputedStyle(el).display !== 'none', text: el ? el.textContent : '' }; })()`);
    await page.screenshot(`${SHOTS}/001-f4-debug-panel.png`);
    rec(T, 'F4 调试面板显示上下文与 action 名（dev 模式）', p.shown && /explore: interact/.test(p.text) && /上下文/.test(p.text) ? 'PASS' : 'FAIL', `shown=${p.shown}；面板片段：${p.text.slice(0, 160).replace(/\n/g, ' | ')}`);
    await page.tap('F4');
  });

  // 测试场地真实机关流程
  await page.goto(page.__url ?? (await ev('location.origin')) + '/?scene=testbed');
  await page.waitFor(`window.__testbed?.rig && __game.scenes.current?.name === 'testbed'`, 90000);
  await page.waitFor(`__game.input.context === 'explore'`, 30000);
  await sleep(1000);
  const tp = (v) => ev(`(() => { const a = __testbed.course.anchors; __testbed.rig.body.teleport(${v}.clone().setY(0.02)); return 1; })()`);
  await step(rec, T, '机关 E/右键/Tab', async () => {
    await tp('a.mechanism.stand');
    await page.waitFor(`/查看机关/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 8000);
    await lock();
    await page.tap('KeyE');
    await page.waitFor(`__game.input.context === 'puzzle'`, 4000);
    const c1 = await ev(`__game.input.context`);
    await sleep(1500);
    await page.screenshot(`${SHOTS}/001-003-puzzle-view.png`);
    await ev(`window.__qaMark = __game.input.recent[0]?.t ?? -1; 1`);
    await page.tap('KeyE'); await sleep(500);
    const afterE = await ev(`({ ctx: __game.input.context, acts: __game.input.recent.filter((r) => r.t > window.__qaMark).map((r) => r.context + ':' + r.action), stack: __game.input.contextStack.join('>') })`);
    await page.click(640, 360, 'right');
    await page.waitFor(`__game.input.context === 'explore'`, 4000);
    const c2 = await ev(`__game.input.context`);
    await sleep(1200);
    await page.tap('KeyE');
    await page.waitFor(`__game.input.context === 'puzzle'`, 4000);
    await sleep(800);
    await page.tap('Tab');
    await page.waitFor(`__game.input.context === 'explore'`, 4000);
    const c3 = await ev(`__game.input.context`);
    const ok = c1 === 'puzzle' && afterE.ctx === 'puzzle' && afterE.acts.includes('puzzle:partNext') && !afterE.acts.some((a) => a.endsWith(':interact')) && afterE.stack === 'explore>puzzle' && c2 === 'explore' && c3 === 'explore';
    rec(T, '机关中按 E 切换部件不触发交互；右键/Tab 退出回 explore（测试场地真实流程）', ok ? 'PASS' : 'FAIL', `E 进入→${c1}；机关内 E→${afterE.acts.join('+')}（栈 ${afterE.stack}）；右键→${c2}；Tab→${c3}`);
  });
  await step(rec, T, '机关中 Esc', async () => {
    await sleep(1200);
    await lock();
    await page.tap('KeyE');
    await page.waitFor(`__game.input.context === 'puzzle'`, 4000);
    await sleep(800);
    await page.tap('Escape');
    await page.waitFor(`__game.isPaused`, 4000);
    const s1 = await state();
    await ev(`document.querySelector('.pause-menu [data-act="resume"]').click(); 1`);
    await sleep(500);
    const s2 = await state();
    // 继续后指针未锁定，直接右键（不先点左键）
    await page.click(640, 360, 'right');
    await sleep(800);
    const s3 = await state();
    rec(T, '机关中 Esc 暂停、继续后回到 puzzle（补充）', s1.paused && s1.ctx === 'menu' && !s2.paused && s2.ctx === 'puzzle' ? 'PASS' : 'FAIL', `Esc→paused=${s1.paused} ctx=${s1.ctx}；继续→ctx=${s2.ctx}`);
    rec(T, '[观察] 暂停继续后指针未锁定时，在机关里直接右键', s3.ctx === 'explore' ? 'PASS' : 'NOTE', `右键后 ctx=${s3.ctx} locked=${s3.locked}（右键只用于重新锁定，未退出机关；Tab 可用）`);
    if (s3.ctx !== 'explore') { await page.tap('Tab'); await sleep(500); }
  });
}
