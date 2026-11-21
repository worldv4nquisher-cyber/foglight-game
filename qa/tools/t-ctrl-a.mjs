export async function run({ page, ev, rec, step, T, SHOTS, sleep }) {
  const H = (codes, sec) => ev(`__ctl.hold(${JSON.stringify(codes)}, ${sec})`);
  const tp = (x, y, z) => ev(`__ctl.tp(${x}, ${y}, ${z})`);
  await step(rec, T, '速度', async () => {
    await tp(5, 0.02, 4);
    const w = await H(['KeyA'], 2.5);
    const seg = (arr, t0, t1) => { const a = arr.find((s) => s.t >= t0), b = [...arr].reverse().find((s) => s.t <= t1); return Math.hypot(b.x - a.x, b.z - a.z) / (b.t - a.t); };
    const vw = seg(w, 0.5, 2.5);
    const r = await H(['KeyA', 'ShiftLeft'], 2.5);
    const vr = seg(r, 0.5, 2.5);
    const ok = Math.abs(vw - 1.6) <= 0.08 && Math.abs(vr - 3.2) <= 0.16;
    rec(T, '慢走 1.6 m/s、小跑 3.2 m/s（±5%，按位移/固定步长时间计算）', ok ? 'PASS' : 'FAIL', `慢走 ${vw.toFixed(3)} m/s，小跑 ${vr.toFixed(3)} m/s`);
  });
  await step(rec, T, '坡', async () => {
    await tp(-10, 0.02, -5.5);
    const a = await H(['KeyS'], 5);
    const max30 = Math.max(...a.map((s) => s.y));
    await tp(-6, 0.02, -5.5);
    const b = await H(['KeyS'], 5);
    const max45 = Math.max(...b.map((s) => s.y));
    await page.screenshot(`${SHOTS}/002-ramp45-blocked.png`);
    rec(T, '30° 坡能走上去', max30 > 2.2 ? 'PASS' : 'FAIL', `5s 后最高 y=${max30.toFixed(2)}（坡顶 2.31）`);
    rec(T, '45° 坡走不上去', max45 < 0.6 ? 'PASS' : 'FAIL', `5s 后最高 y=${max45.toFixed(2)}`);
  });
  await step(rec, T, '台阶', async () => {
    await tp(-2, 0.02, -4.2);
    const a = await H(['KeyS'], 2.5);
    const ya = Math.max(...a.map((s) => s.y)); const onTop = a.filter((s) => s.y > 0.2); const yEnd = a[a.length - 1].y;
    await tp(1, 0.02, -4.2);
    const b = await H(['KeyS'], 2.5);
    const yb = Math.max(...b.map((s) => s.y)), zb = Math.max(...b.map((s) => s.z));
    rec(T, '0.25 m 台阶自动迈上', Math.abs(ya - 0.25) < 0.03 ? 'PASS' : 'FAIL', `最高 y=${ya.toFixed(3)}（台阶面 0.25），在台阶上 z 范围 ${onTop.length ? onTop[0].z.toFixed(2) + '→' + onTop[onTop.length-1].z.toFixed(2) : '无'}（台阶 z -3→-1），结束 y=${yEnd.toFixed(3)}（走过台阶后落回地面）`);
    rec(T, '0.4 m 台阶挡住', yb < 0.05 && zb < -3.2 ? 'PASS' : 'FAIL', `最高 y=${yb.toFixed(3)}，最远 z=${zb.toFixed(2)}（台阶前沿 z=-3.0）`);
  });
  await step(rec, T, '螺旋楼梯', async () => {
    const cx = 9, cz = -7, R = 1.5;
    const a0 = -25 * Math.PI / 180;
    await tp(cx + R * Math.cos(a0), 0.02, cz + R * Math.sin(a0));
    const res = await ev(`(async () => {
      const tb = __testbed, cam = tb.cameraFollow, inp = __game.input;
      inp.setRaw('qa', 'KeyW', true);
      const t0 = __qa.ft(); const out = [];
      await new Promise((res) => {
        const f = () => {
          const p = tb.rig.body.position;
          const a = Math.atan2(p.z - (${cz}), p.x - (${cx}));
          const ta = a + 0.45;
          const dx = (${cx}) + ${R} * Math.cos(ta) - p.x, dz = (${cz}) + ${R} * Math.sin(ta) - p.z;
          cam.yaw = Math.atan2(-dx, -dz);
          out.push({ t: __qa.ft() - t0, y: p.y, x: p.x, z: p.z, r: Math.hypot(p.x - (${cx}), p.z - (${cz})) });
          if (p.y < 3.95 && __qa.ft() - t0 < 25) requestAnimationFrame(f); else res();
        };
        requestAnimationFrame(f);
      });
      inp.setRaw('qa', 'KeyW', false);
      return out;
    })()`);
    const top = Math.max(...res.map((s) => s.y));
    let maxDrop = 0, stuck = 0, run = 0, peak = -1;
    for (let i = 1; i < res.length; i++) {
      peak = Math.max(peak, res[i - 1].y);
      maxDrop = Math.max(maxDrop, peak - res[i].y);
      const d = Math.hypot(res[i].x - res[i - 1].x, res[i].z - res[i - 1].z), dt = res[i].t - res[i - 1].t;
      if (dt > 0 && d / dt < 0.4) { run += dt; stuck = Math.max(stuck, run); } else run = 0;
    }
    const dur = res[res.length - 1].t;
    await page.screenshot(`${SHOTS}/002-spiral-top.png`);
    const ok = top >= 3.9 && maxDrop < 0.08 && stuck < 0.3;
    rec(T, '螺旋楼梯（半径 2.5、每级 0.2 m）连续走上去不卡顿不抖动', ok ? 'PASS' : 'FAIL', `用时 ${dur.toFixed(1)} s（固定步长时间）到达 y=${top.toFixed(2)}（顶 4.0）；最大回落 ${maxDrop.toFixed(3)} m；最长低速（<0.4 m/s）段 ${stuck.toFixed(2)} s；采样 ${res.length} 帧`);
  });
  await step(rec, T, '贴墙滑动', async () => {
    await tp(-9, 0.02, -12);
    const a = await H(['KeyW', 'KeyD'], 4);
    const zmin = Math.min(...a.map((s) => s.z));
    const touch = a.filter((s) => s.z < -13.5);
    const last = touch[touch.length - 1], first = touch[0];
    const vx = touch.length > 2 ? (last.x - first.x) / (last.t - first.t) : 0;
    await page.screenshot(`${SHOTS}/002-wall-slide.png`);
    const ok = zmin >= -13.8 + 0.25 - 0.02 && vx > 0.5;
    rec(T, '贴墙行走不穿模、不卡死，贴墙滑动顺畅', ok ? 'PASS' : 'FAIL', `斜向（W+D）顶墙 4 s：最小 z=${zmin.toFixed(3)}（墙面 -13.80，胶囊半径 0.25 → 下限 -13.55）；贴墙段沿墙速度 ${vx.toFixed(2)} m/s（斜向 1.6 的沿墙分量约 1.13）`);
  });
  await step(rec, T, '闸门', async () => {
    const en = () => ev(`__testbed.physics.colliders.find((c) => c.name === 'gate-collider').enabled`);
    await tp(-2, 0.02, 10);
    const e0 = await en();
    const a = await H(['KeyW'], 2.5);
    const zA = Math.min(...a.map((s) => s.z));
    await page.tap('KeyG');
    await sleep(400);
    const e1 = await en();
    const b = await H(['KeyW'], 3);
    const zB = Math.min(...b.map((s) => s.z));
    await page.screenshot(`${SHOTS}/002-gate-open-passed.png`);
    await page.tap('KeyG');
    await sleep(400);
    const e2 = await en();
    const c = await H(['KeyS'], 3);
    const zC = Math.max(...c.map((s) => s.z));
    const ok = e0 && zA > 8.15 + 0.2 && !e1 && zB < 7 && e2 && zC < 7.85 - 0.2;
    rec(T, '运行时关闭/开启动态碰撞体，立即能/不能通过（G 键）', ok ? 'PASS' : 'FAIL', `关闭状态 enabled=${e0} 最近 z=${zA.toFixed(2)}（门在 z=8）；按 G 后 enabled=${e1} 走到 z=${zB.toFixed(2)}；再按 G enabled=${e2} 回头最远 z=${zC.toFixed(2)}`);
  });
  await step(rec, T, '自动跨越', async () => {
    await tp(10, 0.82, 4.4);
    await page.waitFor(`/跨过/.test(document.querySelector('.hud-prompt')?.textContent ?? '')`, 5000);
    const r = await ev(`(async () => {
      const tb = __testbed, ctl = tb.rig.controller, inp = __game.input;
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' })); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE' }));
      await __qa.until(() => ctl.busy, 3000);
      const startT = __qa.ft(); const started = ctl.busy;
      inp.setRaw('qa', 'KeyA', true); inp.setRaw('qa', 'KeyS', true);
      let maxDx = 0;
      await __qa.until(() => { maxDx = Math.max(maxDx, Math.abs(tb.rig.body.position.x - 10)); return !ctl.busy; }, 20000);
      inp.setRaw('qa', 'KeyA', false); inp.setRaw('qa', 'KeyS', false);
      const dur = __qa.ft() - startT;
      return { started, dur, maxDx, d: tb.rig.body.position.distanceTo(tb.link.end), linkDur: tb.link.duration };
    })()`);
    const ok = r.started && r.dur >= 0.95 && r.dur <= 2.1 && r.maxDx < 0.05 && r.d < 0.1;
    rec(T, 'TraversalLink：起点按 E，1–2 s 平滑到终点，期间不接受移动输入', ok ? 'PASS' : 'FAIL', `开始=${r.started}；实测 ${r.dur.toFixed(2)} s（配置 ${r.linkDur.toFixed(2)} s，固定步长时间，误差约 1 帧）；期间按住 A+S，横向最大偏离 ${r.maxDx.toFixed(3)} m；终点偏差 ${r.d.toFixed(3)} m`);
  });
  await step(rec, T, '黑场送回', async () => {
    await tp(-4, 0.02, -2);
    await page.tap('KeyT');
    const s = await ev(`__qa.sample(() => ({ o: __game.ui.fade.opacity, now: performance.now(), el: __game.time.elapsed, ft: __qa.ft(), y: __testbed.rig.body.position.y, x: __testbed.rig.body.position.x, z: __testbed.rig.body.position.z, busy: __testbed.rig.controller.busy }), 6000)`);
    const black = s.filter((q) => q.o >= 0.99);
    const any = s.filter((q) => q.o > 0.01);
    const blackFt = black.length ? black[black.length - 1].ft - black[0].ft : 0;
    const totalFt = any.length ? any[any.length - 1].ft - any[0].ft : 0;
    const totalEl = any.length ? any[any.length - 1].el - any[0].el : 0;
    const miny = Math.min(...s.map((q) => q.y));
    const end = s[s.length - 1];
    const spawnD = Math.hypot(end.x - 0, end.z - 4);
    const vis = black.filter((q) => Math.abs(q.x - (-4)) > 0.01 && Math.hypot(q.x, q.z - 4) > 0.05);
    const ok = black.length > 0 && spawnD < 0.05 && miny > -0.05 && end.o === 0;
    rec(T, 'teleportTo（T）有黑场，不穿模不掉落，送回出生点', ok ? 'PASS' : 'FAIL', `出现全黑=${black.length > 0}；全黑段 ≈${blackFt.toFixed(2)} s、从开始变暗到完全退黑 ≈${totalFt.toFixed(2)} s（固定步长时间，${totalEl.toFixed(2)} s 游戏时间；采样精度约 1 帧 0.08 s）；过程中最低 y=${miny.toFixed(3)}；结束离出生点 ${spawnD.toFixed(3)} m，黑场透明度 ${end.o}`);
    rec(T, '黑场时长 0.5 s（参考）', 'INFO', `配置 gameplay.teleport.fadeSec=0.5；实测见上（低帧率下只能粗测）`);
  });
  await step(rec, T, 'F4 读数', async () => {
    await page.tap('F4');
    await tp(0, 0.02, 4);
    await ev(`__game.input.setRaw('qa', 'KeyA', true); 1`);
    await sleep(2500);
    const txt = await ev(`document.querySelector('.debug-panel').textContent`);
    await page.screenshot(`${SHOTS}/002-f4-speed-collision.png`);
    await ev(`__game.input.setRaw('qa', 'KeyA', false); 1`);
    await page.tap('F4');
    const sp = /速度 ?([0-9.]+) ?m\/s/.exec(txt), col = /碰撞 ?([0-9.]+) ?ms/.exec(txt);
    rec(T, '开发模式 HUD 显示速度与碰撞耗时（F4）', sp && col ? 'PASS' : 'FAIL', `面板角色行：${(txt.split('\n').find((l) => /角色/.test(l)) ?? txt.slice(-200)).trim()}`);
    rec(T, '碰撞计算每帧 ≤ 0.5 ms（参考值，非 1440p 极致档实机，不判定）', 'INFO', col ? `本机（软件渲染、无 GPU）面板读数 碰撞 ${col[1]} ms` : '未读到');
  });
}
