// batch11 S3 art=1：导光镜 a/b 美术镜面法线 vs 白盒，ψ 差 ≤ 0.005°（atan2(|n1×n2|, n1·n2)，避开 float32 下 acos 精度）
import { open, sleep, SH11, EVLOG, counter } from './b11lib.mjs';
const T = 'b11-guide';
const { page, ev, must, url, rec, step, done } = await open(5571);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s3&art=1'));
await must(`!!window.__s3?.puzzles && __game.input.context === 'explore'`, 400000, 'S3');
await step(T, '量', async () => {
  const r = await ev(`(() => { const s = __s3, V = s.rig.body.position.constructor, beam = s.puzzles.beam, ms = s.artSlots.mounted; const out = {};
    const n = (o) => new V(0, 0, 1).transformDirection(o.matrixWorld);
    const ang = (a, b) => Math.atan2(a.clone().cross(b).length(), a.dot(b)) * 180 / Math.PI;
    for (const k of ['a', 'b']) { const m = ms.find(x => x.id === 'prop-guide-mirror-wall-s3-' + k); if (!m) { out[k] = null; continue; }
      let plane = null; m.model.traverse(o => { if (!plane && /mirror-plane$/.test(o.name)) plane = o; });
      const rig = beam.mirrors[k], part = rig.part; const samples = [];
      const meas = (lab) => { s.artSlots.update(); s.scene.updateMatrixWorld(true); samples.push({ lab, deg: +ang(n(plane), n(rig.plane)).toFixed(6), d: +plane.getWorldPosition(new V()).distanceTo(rig.plane.getWorldPosition(new V())).toFixed(5) }); };
      beam.reset(); meas('reset'); beam.solve(); meas('solve');
      const ax = part?.angles?.length ?? 0;
      if (part?.setAngle) for (let a = 0; a < Math.max(1, ax); a++) for (let d = 0; d < 360; d += 15) { try { part.setAngle(a, d); meas('ax' + a + '@' + d); } catch (e) { samples.push({ lab: 'err ' + e.message }); break; } }
      beam.reset();
      out[k] = { parent: m.model.parent?.name, missing: m.missingNodes, n: samples.length, maxDeg: Math.max(...samples.filter(x => x.deg != null).map(x => x.deg)), maxD: Math.max(...samples.filter(x => x.d != null).map(x => x.d)), solve: samples.find(x => x.lab === 'solve'), reset: samples[0], errs: samples.filter(x => x.lab.startsWith('err')), angleList: part?.angles }; }
    return out; })()`);
  const ok = ['a', 'b'].every(k => r[k] && r[k].maxDeg <= 0.005 && !r[k].missing?.length);
  rec(T, '导光镜 a / b：美术镜面法线与白盒差 ≤ 0.005°（reset / solve / 各档 15° 扫描）', ok ? 'PASS' : 'FAIL', r);
});
rec(T, '页面错误', page.errors.length ? 'FAIL' : 'PASS', page.errors);
await done(); console.log('DONE');
