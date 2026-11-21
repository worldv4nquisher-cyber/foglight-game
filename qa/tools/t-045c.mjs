import { open, sleep, SH } from './b3lib.mjs';
const P = await open(5234);
const { page, ev, must, url, rec, step } = P;
await page.goto(url('?smoke=1'));
await must(`!!window.__game`);
await ev(`localStorage.clear()`);
await page.goto(url('?smoke=1&scene=testbed'));
await must(`window.__game?.scenes.current?.name === 'testbed' && !!window.__testbed`, 120000, 'testbed');
await sleep(3000);
await page.click(640, 400); await sleep(800);
const st = (l) => ev(`({ l: '${l}', j: __game.ui.journal.isOpen, r: __game.ui.reader.isOpen, ctx: __game.input.context, recent: (__game.input.recent || []).slice(0, 3).map(e => e.context + ':' + e.action + '(' + e.code + ')'), frame: __game.time.frame })`);
const out = [];
const J = async () => { await page.tap('KeyJ'); await sleep(1500); };
await J(); out.push(await st('J 打开'));
await page.screenshot(`${SH}/005-journal-open.png`);
await J(); out.push(await st('J tap'));
await page.keyDown('KeyJ'); await sleep(400); await page.keyUp('KeyJ'); await sleep(1500); out.push(await st('J 按住 0.4 s'));
if (await ev(`__game.ui.journal.isOpen`)) { await page.click(640, 400, 'right'); await sleep(1500); out.push(await st('右键 面板中央')); }
if (await ev(`__game.ui.journal.isOpen`)) { await page.click(60, 60, 'right'); await sleep(1500); out.push(await st('右键 左上空白')); }
const hit = await ev(`(() => { const e = document.elementFromPoint(640, 400); return e.className + ' / ' + e.tagName; })()`);
out.push('640,400 命中元素 ' + hit + '；60,60 命中 ' + await ev(`(() => { const e = document.elementFromPoint(60, 60); return e.className + ' / ' + e.tagName; })()`));
if (await ev(`__game.ui.journal.isOpen`)) { await page.tap('Tab'); await sleep(1500); out.push(await st('Tab')); }
// 阅读界面（直接 open）
await ev(`__game.ui.reader.open('ch1.s2.journal.doc')`); await sleep(1500); out.push(await st('reader.open 日志'));
await page.click(640, 400, 'right'); await sleep(1500); out.push(await st('阅读 右键 纸面中央'));
if (await ev(`__game.ui.reader.isOpen`)) { await page.click(60, 60, 'right'); await sleep(1500); out.push(await st('阅读 右键 左上空白')); }
if (await ev(`__game.ui.reader.isOpen`)) { await page.tap('Tab'); await sleep(1500); out.push(await st('阅读 Tab')); }
// 用 E 读告示后右键
const go = (id) => ev(`(() => { const tb = __testbed; const s = tb.samples.stands['${id}']; tb.interaction.cancel(); tb.rig.body.teleport(s.position.clone()); tb.rig.controller.facing = s.facing; return 1; })()`);
await go('sample-journal'); await sleep(1500);
await page.tap('KeyE'); await sleep(1500); out.push(await st('E 读父亲日志'));
await page.click(640, 400, 'right'); await sleep(1500); out.push(await st('右键 纸面中央'));
if (await ev(`__game.ui.reader.isOpen`)) { await page.tap('Tab'); await sleep(1500); out.push(await st('Tab')); }
console.log(out.map(o => JSON.stringify(o)).join('\n'));
console.log('ERRORS', JSON.stringify(page.errors));
await P.done(); process.exit(0);
