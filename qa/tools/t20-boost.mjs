// batch20 ①补：灯束倍率时间线（0–20 s 每 150 ms：shot / boost / uStrength），之后 seek 30 / 跳过后复位
import { open, sleep, SH16 as SH } from './b20lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
const D = `${SH}/beam02`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5685, { width: 960, height: 540 });
const out = { samples: [] }; const save = () => writeFileSync(`${D}/t20-boost.json`, JSON.stringify(out, null, 1));
const log = (...a) => console.log(new Date().toTimeString().slice(0, 8), ...a);
const BS = `(() => { const c = __s3.endingCutscene, b = __s3.puzzles.lamp.beam; return { t: c ? +c.t.toFixed(2) : null, shot: c?.shot ?? null, boost: b.boost, uS: +b.material.uniforms.uStrength.value.toFixed(4), scene: __game.scenes.current?.name }; })()`;
try {
  await page.goto(url(`?smoke=1&debug=1&art=1&scene=s3`));
  await must(`!!window.__s3?.rig?.animator && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 's3');
  for (let i = 0; i < 5; i++) { await page.click(480, 270); await sleep(400); if (await ev(`__game.audio.context?.state === 'running'`)) break; }
  await must(`__game.input.context === 'explore' && !__s3.rig.controller.busy`, 900000, 'explore');
  await must(`!!__s3.endingMusic?.buffer`, 300000, 'music');
  out.pre = await ev(`({ boost: __s3.puzzles.lamp.beam.boost })`);
  await ev(`(() => { localStorage.clear(); __s3.lightTheLamp(); return 1; })()`);
  await must(`__s3.endingCutscene && __s3.endingCutscene.t > 0`, 600000, 'start');
  for (let i = 0; i < 400; i++) { const s = await ev(BS); out.samples.push(s); if (s.t > 18) break; await sleep(150); }
  await ev(`(__s3.endingCutscene.seek(30), 1)`); await sleep(1500); out.at30 = await ev(BS);
  out.skipRet = await ev(`__s3.endingCutscene.skip()`); await sleep(800); out.afterSkip = await ev(BS).catch((e) => String(e));
  const tr = []; let p = null; for (const s of out.samples) { const k = s.shot + '|' + s.boost; if (k !== p) { tr.push(s); p = k; } } out.transitions = tr;
  log('transitions', JSON.stringify(tr)); log('at30', JSON.stringify(out.at30), 'afterSkip', JSON.stringify(out.afterSkip));
  out.errors = page.errors.slice(0, 10).map((e) => String(e).slice(0, 300)); out.nErrors = page.errors.length;
} catch (e) { out.fail = String(e?.message ?? e); log('FAIL', out.fail); } finally { save(); await done(); console.log('DONE'); }
