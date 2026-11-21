import { REPO_ROOT } from './paths.mjs';
// batch13 公用：快照 cd22761 + 逐固定步计数（b11env 必须最先求值，b8lib 用 ||= 取快照路径）
import './b16env.mjs';
import { open, sleep } from './b8lib.mjs';
import { EVLOG } from './b8s3.mjs';
export { open, sleep, EVLOG };
export const SH13 = (REPO_ROOT + '/docs/bugs/qa-v0.1-batch16'); export const SH14 = SH13; export const SH15 = SH13; export const SH16 = SH13;
export const counter = (S) => `(() => { const s = ${S}; window.__n = 0; window.__smp = null; const o = s.fixedUpdate.bind(s); s.fixedUpdate = (dt) => { o(dt); window.__n++; if (window.__smp && window.__f) { try { window.__smp.push(window.__f()); } catch (e) { window.__smp.push({ err: String(e) }); } } }; return 1; })()`;
