import { QA_DIR, REPO_ROOT } from './paths.mjs';
import { writeFileSync } from 'node:fs';
export const SHOTS = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch1');
export const HELPER = `
window.__qa = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async until(pred, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (pred()) return true; } catch (e) { /* */ } await new Promise((r) => setTimeout(r, 40)); }
    try { return !!pred(); } catch (e) { return false; }
  },
  el: () => __game.time.elapsed,
  ft: () => __game.time.fixedTick * __game.time.fixedDelta,
  last: () => { const r = __game.input.recent[0]; return r ? r.context + ':' + r.action : null; },
  sample(fn, ms) {
    return new Promise((res) => { const out = []; const end = performance.now() + ms;
      const f = () => { try { out.push(fn()); } catch (e) { out.push({ err: String(e) }); } if (performance.now() < end) requestAnimationFrame(f); else res(out); };
      requestAnimationFrame(f); });
  },
};`;
export function makeRecorder(name) {
  const results = [];
  const rec = (ticket, item, status, detail) => {
    results.push({ ticket, item, status, detail });
    console.log(`[${status}] ${ticket} ${item} :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  };
  const save = () => writeFileSync(`${QA_DIR}/out/${name}.json`, JSON.stringify(results, null, 2));
  return { rec, save, results };
}
export async function step(rec, ticket, item, fn) {
  try { await fn(); } catch (e) { rec(ticket, item, 'ERROR', String(e?.message ?? e).split('\n')[0]); }
}
