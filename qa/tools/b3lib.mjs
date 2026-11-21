import { QA_DIR, REPO_ROOT } from './paths.mjs';
// batch3 公用：预览服务 + 页面辅助（真实鼠标点击 DOM 元素）
import { launch, sleep } from './cdp.mjs';
import { HELPER } from './common.mjs';
import { writeFileSync } from 'node:fs';
export { sleep };
export const SH = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch3');
process.env.QA_GAME ||= (QA_DIR + '/snap-95fc1da/game');
process.env.QA_VITE ||= (QA_DIR + '/snap-95fc1da/game/node_modules');
const { startPreview, startDev } = await import('./server.mjs');
export async function open(port, { dev = false, width = 1280, height = 720 } = {}) {
  const srv = dev ? await startDev(port) : await startPreview(port);
  const { page, close } = await launch({ width, height });
  await page.addInit(HELPER);
  const ev = (e) => page.evaluate(e);
  const must = async (expr, ms = 60000, what = expr) => { if (!(await page.waitFor(expr, ms, 200))) throw new Error('等待超时：' + what); };
  const rect = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); const vis = !!(e.offsetParent || e.getClientRects().length) && !e.closest('[hidden]'); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, vis, text: e.textContent }; })()`);
  const clickSel = async (sel, button = 'left') => { const r = await rect(sel); if (!r || !r.vis || !r.w) throw new Error('元素不可点：' + sel + ' ' + JSON.stringify(r)); await page.click(r.x, r.y, button); return r; };
  const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; })()`);
  const url = (q = '') => srv.url + '/' + q;
  const results = [];
  const rec = (ticket, item, status, detail) => { results.push({ ticket, item, status, detail }); console.log(`[${status}] ${ticket} ${item} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); };
  const step = async (ticket, item, fn) => { try { await fn(); } catch (e) { rec(ticket, item, 'ERROR', String(e?.message ?? e).split('\n')[0]); } };
  const save = (name) => writeFileSync(`${QA_DIR}/out/${name}.json`, JSON.stringify({ results, errors: page.errors }, null, 1));
  const done = async () => { close(); await srv.close(); };
  return { page, ev, must, rect, clickSel, visible, url, rec, step, save, done, srv };
}
