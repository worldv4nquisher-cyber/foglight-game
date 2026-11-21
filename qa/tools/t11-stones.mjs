// batch11 S2 白石 / 观察模式（裁定 15–17），art=1，真鼠标右键 + 鼠标移动
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const { page, ev, must, url, rec, step, done } = await open(5501);
const T = 'b11-stones';
await page.addInit(EVLOG);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
await ev(counter('__s2'));
const waitN = async (k) => { const n0 = await ev('window.__n'); await must(`window.__n >= ${n0 + k}`, 900000, 'ticks ' + k); };
const ST = `(() => { const s = __s2, P = s.puzzles, cf = s.cameraFollow, cam = s.camera; cam.updateMatrixWorld(); const p = cam.getWorldPosition(cam.position.clone()), f = cam.getWorldDirection(cam.position.clone());
  const aim = P.whiteStonesAim(); let ang = null; if (aim) { const d = aim.target.clone().sub(aim.eye).normalize(); ang = Math.acos(Math.min(1, Math.max(-1, d.dot(f)))) * 180 / Math.PI; }
  let segVis = false; s.scene.traverse((o) => { if (o.material === P.digitsMaterial && o.visible) { let q = o, v = true; while (q) { v = v && q.visible; q = q.parent; } segVis = segVis || v; } });
  return { pos: [p.x, p.y, p.z].map(v => +v.toFixed(3)), fov: +cam.fov.toFixed(2), observing: cf.observing, eyeActive: cf.eyeActive, blending: cf.blending, yaw: +cf.yaw.toFixed(4), pitch: +cf.pitch.toFixed(4), xiVis: s.rig.visual.visible,
    ang: ang === null ? null : +ang.toFixed(3), align: +P.viewpoint.alignment.toFixed(3), artActive: P.whiteStonesArtActive, segVis, segOpacity: +P.digitsMaterial.opacity.toFixed(3), aimEye: aim && [aim.eye.x, aim.eye.y, aim.eye.z].map(v => +v.toFixed(3)), aimFov: aim?.fov,
    prompt: P.viewpointPrompt(), seen: P.state?.digitsSeen ?? null, lock: document.pointerLockElement === document.querySelector('canvas') }; })()`;
const glowSt = `(() => { const s = __s2; const m = s.artSlots?.mounted?.find(x => /white-stones/.test(x.id)); const mats = new Map(); m?.model.traverse(o => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach(mm => { if (mm.emissive && (mm.emissive.r + mm.emissive.g + mm.emissive.b) > 0.001 && mm.emissiveIntensity > 0.001) mats.set(mm.name + '@' + o.name.replace(/-?\\d+$/, ''), +mm.emissiveIntensity.toFixed(3)); }); }); return { mounted: m?.id ?? null, glowing: [...mats.entries()] }; })()`;
const evs = () => ev(`window.__ev.filter(e => /wind-chime|mono_digits/.test(JSON.stringify(e))).map(e => ({ n: e.n, id: e.e?.id ?? e.e?.textId ?? e.e?.key ?? null, ft: e.ft }))`);

let base;
await step(T, '美术白石挂上、七段贴片关', async () => {
  base = await ev(ST); const g = await ev(glowSt);
  rec(T, 'art=1：白石美术挂上（whiteStonesArtActive）、七段贴片不可见、眼位读 GLB', base.artActive && !base.segVis && g.mounted ? 'PASS' : 'FAIL', { ...base, ...g });
});
await step(T, '按住右键进入观察', async () => {
  await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(0.95, 3.05, 1.0)); s.rig.body.velocity.set(0,0,0); return 1; })()`);
  await waitN(40);
  const cx = 640, cy = 360;
  await page.click(cx, cy, 'left'); await sleep(500);
  await page.mouse('mousePressed', cx, cy, 'right');
  await waitN(90);
  const a = await ev(ST);
  const okEye = Math.hypot(a.pos[0] - 0.95, a.pos[1] - 4.35, a.pos[2] - 1.0) <= 0.02;
  rec(T, '按住右键：固定第一人称眼位 (0.95, 4.35, 1.0)、FOV 30、角色隐藏', a.eyeActive && okEye && Math.abs(a.fov - 30) < 0.05 && !a.xiVis ? 'PASS' : 'FAIL', a);
  rec(T, '进入时视线朝西窗但不直接对准（偏差 > 6°）', a.ang > 6 ? 'PASS' : 'FAIL', { ang: a.ang, align: a.align, pointerLock: a.lock });
  // 换个站位（观察点区域内另一点）再进：眼位不随站位变
  await page.mouse('mouseReleased', cx, cy, 'right'); await waitN(90);
  await ev(`(() => { const s = __s2; s.rig.body.teleport(new s.rig.body.position.constructor(0.95 + 0.3, 3.05, 1.0 - 0.2)); s.rig.body.velocity.set(0,0,0); return 1; })()`);
  await waitN(40);
  await page.mouse('mousePressed', cx, cy, 'right'); await waitN(90);
  const b = await ev(ST);
  rec(T, '站位换到观察点区域内另一点 (+0.3, −0.2)：眼位不变', b.eyeActive && Math.hypot(b.pos[0] - 0.95, b.pos[1] - 4.35, b.pos[2] - 1.0) <= 0.02 ? 'PASS' : 'FAIL', b);
});
const fade = [];
await step(T, '鼠标转动 → 渐显 12° / 完成 ≤6°', async () => {
  // 先量灵敏度：鼠标右移 40 px
  const y0 = (await ev(ST)).yaw; let x = 640;
  for (let i = 0; i < 4; i++) { x += 10; await page.mouse('mouseMoved', x, 360, 'right'); await sleep(60); }
  await waitN(10);
  const y1 = (await ev(ST)).yaw;
  const mouseRot = Math.abs(y1 - y0) > 1e-4;
  rec(T, '观察中鼠标仍能转视线（真 mouseMoved）', mouseRot ? 'PASS' : 'FAIL', { yaw0: y0, yaw1: y1, dPerPx: (y1 - y0) / 40 });
  // 逐步逼近：每步算一下偏差，用鼠标移动往目标方向转（转不动就改直接设 yaw / pitch，并记明）
  const useMouse = mouseRot; const k = mouseRot ? (y1 - y0) / 40 : null;
  for (let it = 0; it < 80; it++) {
    const s = await ev(`(() => { const s = __s2, P = s.puzzles, cf = s.cameraFollow; const aim = P.whiteStonesAim(); const d = aim.target.clone().sub(aim.eye).normalize(); return { ty: Math.atan2(-d.x, -d.z), tp: Math.asin(d.y), yaw: cf.yaw, pitch: cf.pitch }; })()`);
    let dy = s.ty - s.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    const dp = s.tp - s.pitch;
    const stepRad = 0.75 * Math.PI / 180;
    const sy = Math.max(-stepRad, Math.min(stepRad, dy)), sp = Math.max(-stepRad, Math.min(stepRad, dp));
    if (useMouse) { const px = Math.round(sy / k), py = Math.round(-sp / Math.abs(k)); x += px; await page.mouse('mouseMoved', x, 360 + py, 'right'); }
    else await ev(`(__s2.cameraFollow.yaw += ${sy}, __s2.cameraFollow.pitch += ${sp}, 1)`);
    await waitN(4);
    const r = await ev(ST); const g = await ev(glowSt);
    fade.push({ ang: r.ang, align: r.align, glow: g.glowing });
    if (r.ang < 3.5) break;
  }
  const pts = fade.map(f => [f.ang, f.align]);
  const bad = fade.filter(f => (f.ang >= 12.05 && f.align > 0) || (f.ang <= 5.95 && f.align < 1) || (f.ang > 6.05 && f.ang < 11.95 && Math.abs(f.align - (1 - (f.ang - 6) / 6)) > 0.03));
  rec(T, '对准度：≥12° 为 0、12°→6° 线性、≤6° 为 1（量到字组中心）', bad.length === 0 && fade.some(f => f.ang > 12) && fade.some(f => f.ang < 6) ? 'PASS' : 'FAIL', { bad: bad.slice(0, 5), samples: pts.filter((_, i) => i % 3 === 0) });
  const glowBad = fade.filter(f => { const vals = f.glow.map(x => x[1]); return vals.some(v => Math.abs(v - 0.35 * f.align) > 0.01); });
  const names = [...new Set(fade.flatMap(f => f.glow.map(x => x[0])))];
  rec(T, '只有数字石块加亮（mat-prop-white-stones-digit-s2，强度 0.35 × 对准度）', glowBad.length === 0 && names.length > 0 && names.every(n => n.startsWith('mat-prop-white-stones-digit-s2')) ? 'PASS' : 'FAIL', { names, glowBad: glowBad.slice(0, 3) });
  const r = await ev(ST);
  rec(T, '对准时七段贴片仍关（画面只有白石一组 317）', !r.segVis ? 'PASS' : 'FAIL', { segVis: r.segVis, segOpacity: r.segOpacity });
  await waitN(120);
  await page.screenshot(`${SH11}/stones-observe-aligned.png`);
});
await step(T, '风铃 + 独白一次', async () => {
  await waitN(200);
  const e = await evs();
  const chime = e.filter(x => /wind-chime/.test(JSON.stringify(x))), mono = e.filter(x => /mono_digits/.test(JSON.stringify(x)));
  rec(T, '对准完成：sfx-wind-chime 1 次 + 「三，一，七。」(ch1.s2.white_stones.mono_digits) 1 次', chime.length >= 1 && mono.length >= 1 ? 'PASS' : 'FAIL', { e });
  globalThis.__e1 = e.length;
});
await step(T, '松开右键恢复第三人称', async () => {
  await page.mouse('mouseReleased', 640, 360, 'right');
  await waitN(120);
  const r = await ev(ST);
  const d = Math.hypot(r.pos[0] - 0.95, r.pos[1] - 4.35, r.pos[2] - 1.0);
  rec(T, '松开右键：退出固定眼位、角色显示、FOV 回 55', !r.eyeActive && !r.observing && r.xiVis && Math.abs(r.fov - 55) < 1 && d > 0.3 ? 'PASS' : 'FAIL', { ...r, distFromEye: +d.toFixed(3) });
  await page.screenshot(`${SH11}/stones-after-release.png`);
  // 再进一次对准：风铃 / 独白不重复
  await page.mouse('mousePressed', 640, 360, 'right'); await waitN(90);
  for (let it = 0; it < 60; it++) {
    const s = await ev(`(() => { const s = __s2, P = s.puzzles, cf = s.cameraFollow; const aim = P.whiteStonesAim(); const d = aim.target.clone().sub(aim.eye).normalize(); return { ty: Math.atan2(-d.x, -d.z), tp: Math.asin(d.y), yaw: cf.yaw, pitch: cf.pitch }; })()`);
    let dy = s.ty - s.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
    await ev(`(__s2.cameraFollow.yaw += ${Math.max(-0.03, Math.min(0.03, dy))}, __s2.cameraFollow.pitch += ${Math.max(-0.03, Math.min(0.03, s.tp - s.pitch))}, 1)`);
    await waitN(3); if ((await ev(ST)).ang < 3.5) break;
  }
  await waitN(200);
  const e = await evs();
  rec(T, '第二次对准：风铃 / 独白不再触发', e.length === globalThis.__e1 ? 'PASS' : 'FAIL', { before: globalThis.__e1, after: e.length, e });
  await page.mouse('mouseReleased', 640, 360, 'right'); await waitN(60);
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
