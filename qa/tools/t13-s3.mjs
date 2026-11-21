// batch13 ③④ S3：塔门角光照贴图倍率 + 三面导光镜高亮；argv[2]=rain → 只读雨夜倍率（s1,s2,s3）
import { open, sleep, EVLOG, SH13, counter } from './b13lib.mjs';
import { writeFileSync } from 'node:fs';
const T = 'b13-s3';
const mode = process.argv[2] ?? 'main';
const { page, ev, must, url, rec, step, done } = await open(5571 + (mode === 'rain' ? 1 : 0), { width: 960, height: 540 });
await page.addInit(EVLOG);
const out = {};
const ticks = async (n) => { const f0 = await ev('__game.time.fixedTick'); await page.waitFor(`__game.time.fixedTick >= ${f0 + n}`, 120000, 50); };
const lms = (sc) => ev(`${sc}.lightmaps.map(h => ({ root: h.root.name, scale: +h.scale.toFixed(4), lmI0: +h.materials[0].lightMapIntensity.toFixed(4), base: h.extras.lightMapIntensity }))`);
if (mode === 'rain') {
  for (const sc of ['s1', 's2', 's3']) await step(T, sc, async () => {
    for (const atmo of ['rain-night', 'overcast-dusk']) {
      await page.goto(url(`?smoke=1&debug=1&scene=${sc}&art=1&quality=standard&atmo=${atmo}`));
      await must(`!!window.__${sc}?.rig && !!__${sc}.art && __game.input.context === 'explore'`, 400000, sc);
      await ticks(10);
      const r = { hemi: await ev(`+__${sc}.hemi.intensity.toFixed(4)`), atmoName: await ev(`__${sc}.atmosphere?.name ?? __${sc}.atmosphere?.id ?? null`), lm: await lms('__' + sc) };
      out[sc + ':' + atmo] = r;
      rec(T, `${sc} ${atmo}`, 'INFO', r);
    }
  });
  writeFileSync(`${SH13}/rain-night.json`, JSON.stringify(out, null, 1));
  await done(); console.log('DONE'); process.exit(0);
}
await step(T, 'load', async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s3&art=1&quality=standard`));
  await must(`!!window.__s3?.rig && !!__s3.art && __game.input.context === 'explore' && !__s3.rig.controller.busy`, 400000, 's3');
  out.lm0 = await lms('__s3');
  rec(T, 'S3 光照贴图（门关）', 'INFO', out.lm0);
});
const HL = `(() => { const s = __s3; const h = s.interaction.highlighter; const ks = h.keys(); return { mhl: s.puzzles.mirrorHighlighted, keys: ks, shells: ks.map(k => h.active.get(k)?.shells.length), en: Object.fromEntries(['window','a','b'].map(k => [k, s.puzzles.mirrorIx[k].enabled])), cur: s.interaction.current?.id ?? null, pos: s.rig.body.position.toArray().map(v => +v.toFixed(2)) }; })()`;
await step(T, 'door', async () => {
  out.hlOutside = await ev(HL);
  await ev(counter('__s3'));
  await ev(`window.__f = () => { const s = __s3; const g = n => s.lightmaps.find(h => (h.root.userData.name ?? h.root.name) === n)?.scale; return [__game.time.fixedTick, +s.puzzles.state.doorOpen.toFixed(5), g('env-lighthouse-ch1-interior'), g('env-lamp-room-ch1'), g('env-lighthouse-ch1')]; }; window.__smp = []; 1`);
  await ev(`window.__fr = []; (() => { const g = (window.__frg = (window.__frg ?? 0) + 1); const r = () => { if (window.__frg !== g) return; const s = __s3; const h = s.lightmaps.find(h => (h.root.userData.name ?? h.root.name) === 'env-lighthouse-ch1-interior'); window.__fr.push([__game.time.fixedTick, +s.puzzles.state.doorOpen.toFixed(5), +h.scale.toFixed(5)]); if (window.__fr.length < 4000) requestAnimationFrame(r); }; requestAnimationFrame(r); })(); 1`);
  await ticks(5);
  await ev(`__game.events.emit('interact:used', { id: __s3.puzzles.doorIx.id, kind: 'use' }); 1`);
  await page.waitFor(`__s3.puzzles.state.doorOpen >= 1`, 180000, 100);
  await ticks(20);
  const tk = (await ev('window.__smp')).filter(Array.isArray), fr = await ev('window.__fr'); await ev('window.__smp = null; window.__frg++; 1');
  const f = (u) => { u = Math.min(1, Math.max(0, u)); const s = u * u * (3 - 2 * u); return 0.6 + 0.4 * s; };
  let maxTick = 0; for (let i = 1; i < tk.length; i++) maxTick = Math.max(maxTick, Math.abs(f(tk[i][1]) - f(tk[i - 1][1])));
  let maxFrame = 0, mft = 0, mis = 0; for (let i = 1; i < fr.length; i++) { const d = Math.abs(fr[i][2] - fr[i - 1][2]); if (d > maxFrame) { maxFrame = d; mft = fr[i][0] - fr[i - 1][0]; } }
  for (const r of fr) mis = Math.max(mis, Math.abs(r[2] - f(r[1])));
  out.door = { ticks: tk.length, start: tk[0], end: tk[tk.length - 1], openTicks: tk.filter(r => r[1] > 0 && r[1] < 1).length, maxTickStepExpected: +maxTick.toFixed(5), frames: fr.length, maxFrameStep: +maxFrame.toFixed(5), ticksInThatFrame: mft, maxMismatchVsFormula: +mis.toFixed(5), monotonic: fr.every((r, i) => i === 0 || r[2] >= fr[i - 1][2] - 1e-6), lampEqInterior: tk.every(r => r[2] === r[3]), exteriorConst: [...new Set(tk.map(r => r[4]))] };
  out.doorTicks = tk;
  rec(T, 'S3 塔门开：塔内光照贴图倍率', 'INFO', { ...out.door });
});
await step(T, 'mirrors', async () => {
  const res = [];
  for (const k of ['window', 'a', 'b']) {
    await ev(`(() => { const s = __s3; const it = s.interaction.get(s.puzzles.mirrorIx['${k}'].id); const st = it.standPoint(new s.rig.body.position.constructor()); s.rig.body.teleport(st.position.clone().setY(st.position.y + 0.05)); s.rig.controller.facing = st.facing; return 1; })()`);
    await ticks(40);
    const r = { at: k, ...(await ev(HL)) };
    res.push(r);
    await sleep(400); await page.screenshot(`${SH13}/mirror-hl-${k}.png`);
  }
  out.mirrors = res;
  rec(T, '三面导光镜站位高亮', 'INFO', res);
});
writeFileSync(`${SH13}/s3-door-mirror.json`, JSON.stringify(out, null, 1));
await done(); console.log('DONE');
