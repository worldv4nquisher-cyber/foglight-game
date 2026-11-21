import { REPO_ROOT } from './paths.mjs';
// batch10 公用：快照 92c7c96 + 逐固定步计数（b10env 必须最先求值，b8lib 用 ||= 取快照路径）
import './b10env.mjs';
import { open, sleep } from './b8lib.mjs';
import { EVLOG } from './b8s3.mjs';
export { open, sleep, EVLOG };
export const SH10 = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch10');
export const counter = (S) => `(() => { const s = ${S}; window.__n = 0; window.__smp = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__smp && window.__f) { try { window.__smp.push(window.__f()); } catch (e) { window.__smp.push({ err: String(e) }); } } }; return 1; })()`;
