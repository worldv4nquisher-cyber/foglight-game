// batch19 ⑥ 冒烟 015 S3 白盒 art=1 段单跑（整条冒烟反复被 OOM 杀）：同一断言，只开一页 ?scene=s3&art=1
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/s015`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5681, { width: 1280, height: 720 });
const evaluate = ev; const out = { checks: [] }; const save = () => writeFileSync(`${D}/t19-015a.json`, JSON.stringify(out, null, 1));
const ok = (name, pass, data) => { out.checks.push({ name, pass, data }); save(); console.log(pass ? 'PASS' : 'FAIL', name, JSON.stringify(data).slice(0, 400)); };
try {
  await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1`));
  await must(`!!window.__s3?.rig && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3');
  await sleep(3000);
        const probe = `(() => { const s = __s3; let warm = 0, glow = 0; s.scene.traverse((o) => {
          for (let a = o; a; a = a.parent) if (a.userData?.warmLight) return;
          if ((o.isPointLight || o.isSpotLight || o.isRectAreaLight) && o.visible && o.intensity > 0 && o.color.r > o.color.b + 0.1) warm++;
          if (o.isMesh && o.visible) for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0) glow++; });
        const p = s.rig.body.position;
        return { name: s.name, entry: s.entryId, pos: p.toArray().map((v) => +v.toFixed(2)), frame: s.frame.position.toArray(), rot: +s.frame.rotation.y.toFixed(4),
          water: s.water ? [s.water.position.x, s.water.position.y, s.water.position.z] : null, indoor: s.cameraFollow.indoorVolumes.length, warm, glow, on: s.lighthouseOn,
          art: s.art.loaded, keys: s.art.root.children.map((c) => c.name), door: !!s.art.door && s.art.door.parent === s.greybox.door, gb: s.greybox.colliders[0].visible,
          ignite: s.puzzles.beam.igniter.state }; })()`;
  const s = await evaluate(probe);
  const want = [39.73 + -22.627 * Math.cos(Math.PI * 0.75) + -22.627 * Math.sin(Math.PI * 0.75), 3, -122.75 + 22.627 * Math.sin(Math.PI * 0.75) + -22.627 * Math.cos(Math.PI * 0.75)];
  ok('入口 from-s2 桥尾', s.entry === 'from-s2' && Math.hypot(s.pos[0] - want[0], s.pos[2] - want[2]) <= 0.4 && Math.abs(s.pos[1] - 3) <= 0.1, { entry: s.entry, pos: s.pos, want });
  ok('世界摆位 / 海面 / 室内触发体', Math.abs(s.frame[0] - 39.73) < 1e-6 && Math.abs(s.frame[2] + 122.75) < 1e-6 && Math.abs(s.rot - 2.3562) < 1e-3 && !!s.water && Math.abs(s.water[0] - 39.73) < 1e-6 && s.indoor >= 1, { frame: s.frame, rot: s.rot, water: s.water, indoor: s.indoor });
  const keys = ['env-lighthouse-ch1-s3', 'env-lighthouse-ch1-interior', 'env-lamp-room-ch1', 'prop-fresnel-lens-ch1', 'env-rock-islet-a', 'env-stone-bridge-s3'];
  ok('art=1 六件 + 门扇挂合页 + 白盒隐藏', s.art && keys.every((k) => s.keys.includes(k)) && s.door && !s.gb, { keys: s.keys, door: s.door, gb: s.gb });
  ok('点灯前无暖光 / 自发光', !s.warm && !s.glow && !s.on, { warm: s.warm, glow: s.glow, on: s.on });
  const path = await evaluate(`(() => { const b = __s3.puzzles.beam; b.solve(); b.sky.alwaysOn = true; b.tracer.trace(); const p = b.tracer.paths.find((q) => q.emitter.id === 'sky-s3'); const r = { mirrors: p.mirrors, rec: p.receiver?.id ?? null }; b.reset(); b.sky.alwaysOn = false; return r; })()`);
  ok('光路正解 3 镜到点火口', path.rec === 'ignition-port-s3' && path.mirrors.length === 3, path);
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
  for (const k of ['a', 'b']) { const g = gm[k]; ok('导光镜 ' + k, !!g && !g.missing.length && g.parent === `guide-mirror-s3-mid-${k}` && g.gbHidden && g.st.every((x) => x.deg <= 0.05 && x.d <= 0.005), g); }
  out.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200));
} finally { save(); await done(); console.log('DONE'); }
