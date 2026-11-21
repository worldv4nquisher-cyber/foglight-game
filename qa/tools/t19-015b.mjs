import { QA_DIR } from './paths.mjs';
// batch19 ⑥ 冒烟「v0.1-015 S3 谜题 5 流程」单跑：从 snapshot smoke-browser.mjs 原样取 run() 函数体执行（cdp.goto 适配到单页；最后回 S1 一步省掉）。ART=1 时页面加 art=1
import { open, sleep, SH16 as SH } from './b19lib.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
const src = readFileSync((QA_DIR + '/snap-8453b99/game/scripts/smoke-browser.mjs'), 'utf8').split('\n');
const s0 = src.findIndex((l) => l.includes("name: 'v0.1-015 S3 谜题 5 流程"));
const r0 = s0 + 1; if (!/async run\(\{ evaluate, cdp, sleep \}\) \{$/.test(src[r0].trim())) throw new Error('run 行不对 ' + src[r0]);
let r1 = r0 + 1; while (src[r1] !== '    },') r1++;
const body = src.slice(r0 + 1, r1).join('\n');
const D = `${SH}/s015`; mkdirSync(D, { recursive: true });
const { page, ev, must, url, done } = await open(5682, { width: 1280, height: 720 });
const ART = process.env.ART === '1';
const cdp = { async goto(q, scene) {
  if (q === '') { console.log('skip goto("") 回 S1（省内存）'); return; }
  await page.goto(url(`?smoke=1&${q}${ART ? '&art=1' : ''}`));
  await must(`__game.scenes.current?.name === '${scene}' && __game.assets.loadStats.length > 0 && __game.assets.loadStats.every((x) => x.done)`, 900000, 'scene ' + scene);
} };
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const fn = new AsyncFunction('evaluate', 'cdp', 'sleep', 'ESTAB_MS', body);
const res = { ART, lines: [r0 + 1, r1 + 1] };
try { res.result = await fn(ev, cdp, sleep, 600000); res.pass = true; console.log('PASS', res.result); }
catch (e) { res.pass = false; res.error = String(e?.message ?? e); console.log('FAIL', res.error); }
finally { res.errors = page.errors.slice(0, 8).map((e) => String(e).slice(0, 200)); writeFileSync(`${D}/t19-015b${ART ? '-art1' : ''}.json`, JSON.stringify(res, null, 1)); await done(); console.log('DONE'); }
