// batch12：028 大气运行时读数（art=1，S1；每个预设一次加载，小视口）
import { open, sleep } from './b12lib.mjs';
const T = 'b12-atmo';
const presets = (process.argv[2] ?? 'overcast-dusk,overcast-after-rain,rain-night,after-lit').split(',');
const extra = process.argv[3] ?? '';
const { page, ev, must, url, rec, step, done } = await open(5541, { width: 640, height: 360 });
for (const p of presets) await step(T, p, async () => {
  await page.goto(url(`?smoke=1&debug=1&scene=s1&art=1&quality=ultra&atmo=${p}${extra}`));
  await must(`!!window.__s1?.rig && !!__s1.art && __game.scenes.current?.name === 's1-ebb-shore'`, 400000, 's1');
  await sleep(800);
  if (process.env.WAITG) { const t0 = await ev('__game.time.elapsed'); await must(`__game.time.elapsed >= ${t0 + +process.env.WAITG}`, 600000, 'waitg'); }
  const r = await ev(`(() => { const s = __s1, cam = s.camera, f = s.fog028;
    const walls = f ? f.children.filter(m => /fog028-wall/.test(m.name)) : [];
    const before = walls.map(w => [w.position.x - cam.position.x, w.position.z - cam.position.z].map(v => +v.toFixed(3)));
    return { id: s.atmosphere.id, fog: +s.scene.fog.density.toFixed(5), fogColor: '#' + s.scene.fog.color.getHexString(),
      mid: s.midFogs.map(m => +(+m.density).toFixed(5)), sil: s.farSilhouettes.length, silFog: s.farSilhouettes.map(x => x.fog),
      fogCounts: f?.debugCounts, wallOff: before, wallKeys: walls.slice(0,1).map(w => w.material.customProgramCacheKey()), cardKey: f ? f.children.find(m => /fog028-(island|puff|water)/.test(m.name))?.material.customProgramCacheKey() : null,
      water: s.water ? { detail: !!s.water.uniforms.tWN.value, nScale: s.water.uniforms.uNScale.value, ripK: +s.water.rippleStrength.toFixed(4), ripL2: s.water.uniforms.uRipL2.value } : null,
      rain: s.rain ? { visible: s.rain.visible, mode: s.rain.mode, n: s.rain.dropCount, splash: !!s.rain.splashes, splashAlive: s.rain.splashes ? s.rain.splashes.aliveCount(__game.time.elapsed) : null } : null,
      lut: __game.postfx.activeLut, lens: __game.postfx.lensDroplets, hemi: +s.hemi.intensity.toFixed(3), sun: +s.sun.intensity.toFixed(3) }; })()`);
  // 雾墙跟随：挪相机 30 m，等 3 帧
  const fr = await ev('__game.time.frame');
  await ev(`(() => { __s1.cameraFollow.update = () => {}; __s1.camera.position.x += 30; __s1.camera.position.z -= 20; return 1; })()`);
  await must(`__game.time.frame >= ${fr + 3}`, 120000, 'frames');
  r.wallOffAfterMove = await ev(`__s1.fog028 ? __s1.fog028.children.filter(m => /fog028-wall/.test(m.name)).map(w => [w.position.x - __s1.camera.position.x, w.position.z - __s1.camera.position.z].map(v => +v.toFixed(3))) : null`);
  rec(T, p, 'INFO', r);
});
await done(); console.log('DONE');
