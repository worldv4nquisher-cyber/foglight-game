import { open, sleep, SH12 } from './b12lib.mjs';
const sizes = [[1280, 720], [1920, 1080], [2560, 1440]];
let port = 5561;
for (const [w, h] of sizes) {
  const { page, ev, must, url, rec, step, done } = await open(port++, { width: w, height: h });
  const T = `b12-compat-${w}x${h}`;
  await step(T, '菜单 + S1 art=1', async () => {
    await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
    await page.goto(url('?smoke=1&debug=1&autostart=1&art=1'));
    const t0 = Date.now();
    await must(`!!(window.__s1 && __s1.art?.loaded) && __game.input.context === 'explore'`, 600000, 'S1');
    const info = await ev(`(() => { const r = __game.renderer?.renderer ?? __game.renderer; const gl = r?.getContext?.(); const c = document.querySelector('canvas');
      return { webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext, canvas: c && [c.width, c.height, c.clientWidth, c.clientHeight], dpr: devicePixelRatio,
        ktx2: !!(gl && (gl.getExtension('WEBGL_compressed_texture_astc') || gl.getExtension('WEBGL_compressed_texture_etc') || gl.getExtension('WEBGL_compressed_texture_s3tc') || gl.getExtension('EXT_texture_compression_bptc'))),
        ua: navigator.userAgent.match(/Chrome\\/[\\d.]+/)?.[0], hud: !!document.querySelector('.hud-prompt, .hud') }; })()`);
    await sleep(3000);
    await page.screenshot(`${SH12}/compat-${w}x${h}.png`);
    const errs = page.errors;
    rec(T, 'S1 art=1 进入可玩、WebGL2、画布铺满、无页面错误', info.webgl2 && info.canvas && info.canvas[2] === w && info.canvas[3] === h && !errs.length ? 'PASS' : 'FAIL', { ...info, wallSec: (Date.now() - t0) / 1000, errs });
  });
  await done();
}
console.log('DONE');
