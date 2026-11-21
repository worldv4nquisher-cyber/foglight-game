import { open, sleep } from './b4lib.mjs';
const P = await open(5254); const { page, ev, url } = P;
await page.addInit(`(() => { let g; window.__ev = []; Object.defineProperty(window, '__game', { configurable: true, get: () => g, set: (v) => { g = v; } }); })();`);
await page.goto(url('?smoke=1'));
for (let i = 0; i < 12; i++) { await sleep(5000); console.log(i, JSON.stringify(await ev(`({ g: !!window.__game, sc: window.__game?.scenes?.current?.name, mm: document.querySelector('.main-menu')?.hidden, ls: document.querySelector('.loading-screen')?.hidden, err: document.querySelector('.fatal, .fatal-error')?.innerText })`)), JSON.stringify(page.errors).slice(0, 300)); }
await P.done(); process.exit(0);
