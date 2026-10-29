// v0.1-007 三级提示校验（纯逻辑，无 DOM）：解锁节奏 180 / 360 / 600 s、离开暂停不清零、解开失效、按步骤取二三级、
// 未解锁显示 locked、hintsUsed 只按新层级计、二级高亮 3 s、hintScale、SaveSystem.flush 写盘。
// 运行：npm run test:hint
import assert from 'node:assert/strict';
import { gameplay } from '@/config/gameplay';
import { t } from '@/content/text';
import { HintSystem, boxZone, circleZone, hintScaleFromUrl } from '@/systems/HintSystem';
import { SAVE_KEY, SaveSystem } from '@/systems/save/SaveSystem';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push([name]);
  } catch (e) {
    results.push([name, e]);
  }
}

const IN = { x: 0, y: 0, z: 0 };
const OUT = { x: 50, y: 0, z: 0 };
const DT = 1 / 60;
/** 按固定步长跑 seconds 秒 */
function run(h, seconds, at = IN) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) h.fixedUpdate(DT, at);
}
function make(extra = {}) {
  const log = { used: [], hl: [], unlock: [] };
  const h = new HintSystem({
    onUsed: (id, lv) => log.used.push(`${id}:${lv}`),
    highlight: (ids, s) => log.hl.push([...ids, s]),
    onUnlock: (id, lv) => log.unlock.push(`${id}:${lv}`),
    ...extra,
  });
  return { h, log };
}
const P1 = { id: 'p1', zone: circleZone({ x: 0, z: 0 }, 3), l1: 'ch1.hint.p1.l1', l2: 'ch1.hint.p1.l2', l3: 'ch1.hint.p1.l3', highlight: ['tide-bell-s1'] };

test('数值进 gameplay.hint：180 / 180 / 240 s，高亮 3 s（GDD §9）', () => {
  assert.deepEqual([gameplay.hint.level1Delay, gameplay.hint.level2Delay, gameplay.hint.level3Delay, gameplay.hint.highlightSeconds], [180, 180, 240, 3]);
  assert.deepEqual(new HintSystem().thresholds, [180, 360, 600]);
});

test('进入区域 3 分钟一级、6 分钟二级、10 分钟三级；解锁只通知一次', () => {
  const { h, log } = make();
  h.add(P1);
  run(h, 179.9);
  assert.equal(h.level('p1'), 0);
  assert.equal(h.iconVisible, false);
  run(h, 0.2);
  assert.equal(h.level('p1'), 1);
  assert.equal(h.iconVisible, true, '一级解锁后图标出现');
  assert.equal(h.iconFresh, true);
  run(h, 180);
  assert.equal(h.level('p1'), 2);
  run(h, 239.8);
  assert.equal(h.level('p1'), 2);
  run(h, 0.3);
  assert.equal(h.level('p1'), 3);
  run(h, 100);
  assert.deepEqual(log.unlock, ['p1:1', 'p1:2', 'p1:3']);
});

test('离开区域计时暂停、不清零，回来接着计；不在区域时当前谜题 = 最近进过的', () => {
  const { h } = make();
  h.add(P1);
  run(h, 100);
  run(h, 500, OUT);
  assert.ok(Math.abs(h.time('p1') - 100) < 0.05, String(h.time('p1')));
  assert.equal(h.level('p1'), 0);
  assert.equal(h.currentId, 'p1', '区域外仍以最近的谜题为当前');
  run(h, 80.1);
  assert.equal(h.level('p1'), 1);
});

test('没进过区域：不计时、没有当前谜题；H 显示三行「再等等，四处看看」', () => {
  const { h, log } = make();
  h.add(P1);
  run(h, 1000, OUT);
  assert.equal(h.time('p1'), 0);
  assert.equal(h.currentId, null);
  const v = h.reveal();
  assert.equal(v.puzzleId, null);
  assert.deepEqual(v.lines.map((l) => l.textId), [null, null, null]);
  assert.equal(t('ch1.hint.locked'), '再等等，四处看看');
  assert.deepEqual(log.used, []);
});

test('H：已解锁层级显示文本、未解锁为 null（locked）；新层级各记一次 hintsUsed，重复打开不再记', () => {
  const { h, log } = make();
  h.add(P1);
  run(h, 10);
  let v = h.reveal();
  assert.deepEqual(v.lines.map((l) => l.textId), [null, null, null], '未解锁时按 H');
  assert.deepEqual(log.used, []);
  run(h, 175);
  v = h.reveal();
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p1.l1', null, null]);
  assert.equal(h.iconFresh, false, '看过后图标不再是「新」');
  h.reveal();
  assert.deepEqual(log.used, ['p1:1']);
  assert.deepEqual(log.hl, [], '一级不高亮');
  run(h, 500);
  v = h.reveal();
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p1.l1', 'ch1.hint.p1.l2', 'ch1.hint.p1.l3']);
  assert.deepEqual(log.used, ['p1:1', 'p1:2', 'p1:3'], '一次打开看到二、三级 = 记两次');
});

test('二级：每次打开 H 都高亮关键物体 3 s', () => {
  const { h, log } = make();
  h.add(P1);
  run(h, 361);
  h.reveal();
  h.reveal();
  assert.deepEqual(log.hl, [['tide-bell-s1', 3], ['tide-bell-s1', 3]]);
});

test('解开谜题：图标消失、H 不再显示该谜题、计时停止', () => {
  const { h, log } = make();
  h.add(P1);
  run(h, 200);
  assert.equal(h.iconVisible, true);
  h.solve('p1');
  assert.equal(h.isSolved('p1'), true);
  run(h, 1000);
  assert.equal(h.iconVisible, false);
  assert.equal(h.currentId, null);
  assert.equal(h.reveal().puzzleId, null);
  assert.deepEqual(log.used, []);
});

test('分步骤（谜题 5）：二、三级取第一个未完成的步骤；高亮也跟着换；换步骤不重复记次数', () => {
  const { h, log } = make();
  let tideHigh = true;
  h.add({
    id: 'p5',
    zone: boxZone({ x: -5, y: -1, z: -5 }, { x: 5, y: 30, z: 5 }),
    l1: 'ch1.hint.p5.l1',
    steps: [
      { id: 'valve', l2: 'ch1.hint.p5.valve.l2', l3: 'ch1.hint.p5.valve.l3', highlight: () => (tideHigh ? ['tide-bell-s3', 'oil-valve-s3'] : ['oil-valve-s3']) },
      { id: 'window_mirror', l2: 'ch1.hint.p5.window_mirror.l2', l3: 'ch1.hint.p5.window_mirror.l3', highlight: ['guide-mirror-s3-window'] },
      { id: 'mid_a', l2: 'ch1.hint.p5.mid_a.l2', l3: 'ch1.hint.p5.mid_a.l3', highlight: ['guide-mirror-s3-mid-a'] },
      { id: 'mid_b', l2: 'ch1.hint.p5.mid_b.l2', l3: 'ch1.hint.p5.mid_b.l3', highlight: ['guide-mirror-s3-mid-b', 'ignition-port-s3'] },
    ],
  });
  run(h, 601);
  let v = h.reveal();
  assert.equal(v.step, 'valve');
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p5.l1', 'ch1.hint.p5.valve.l2', 'ch1.hint.p5.valve.l3']);
  tideHigh = false;
  h.reveal();
  assert.deepEqual(log.hl.slice(0, 2), [['tide-bell-s3', 'oil-valve-s3', 3], ['oil-valve-s3', 3]], '涨潮时钟 + 油阀，退潮只亮油阀');
  h.completeStep('p5', 'valve');
  v = h.reveal();
  assert.equal(v.step, 'window_mirror');
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p5.l1', 'ch1.hint.p5.window_mirror.l2', 'ch1.hint.p5.window_mirror.l3']);
  assert.deepEqual(log.hl.at(-1), ['guide-mirror-s3-window', 3]);
  h.completeStep('p5', 'mid_a'); // 乱序完成：仍取第一个未完成的
  assert.equal(h.view().step, 'window_mirror');
  h.completeStep('p5', 'window_mirror');
  assert.equal(h.view().step, 'mid_b');
  assert.deepEqual(log.used, ['p5:1', 'p5:2', 'p5:3']);
});

test('015 C stepTimed：谜题 5 二、三级按当前步骤计时（一级解锁后才走，换步骤清零回一级）', () => {
  const { h, log } = make();
  h.add({
    id: 'p5',
    zone: circleZone({ x: 0, z: 0 }, 5),
    l1: 'ch1.hint.p5.l1',
    stepTimed: true,
    steps: [
      { id: 'valve', l2: 'ch1.hint.p5.valve.l2', l3: 'ch1.hint.p5.valve.l3', highlight: ['oil-valve-s3'] },
      { id: 'window_mirror', l2: 'ch1.hint.p5.window_mirror.l2', l3: 'ch1.hint.p5.window_mirror.l3', highlight: ['guide-mirror-s3-window'] },
    ],
  });
  run(h, 180.1);
  assert.equal(h.level('p5'), 1);
  assert.ok(h.stepTime('p5') < 0.2, '一级解锁前步骤计时不走');
  run(h, 180);
  assert.equal(h.level('p5'), 2);
  run(h, 240);
  assert.equal(h.level('p5'), 3);
  h.reveal();
  assert.deepEqual(log.used, ['p5:1', 'p5:2', 'p5:3']);
  h.completeStep('p5', 'valve');
  assert.equal(h.level('p5'), 1, '换步骤回一级');
  assert.equal(h.stepTime('p5'), 0);
  assert.equal(h.iconFresh, false, '一级已看过');
  let v = h.reveal();
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p5.l1', null, null]);
  run(h, 179.8);
  assert.equal(h.level('p5'), 1);
  run(h, 0.3);
  assert.equal(h.level('p5'), 2, '新步骤 180 s 后二级');
  assert.equal(h.iconFresh, true, '新步骤的新层级 = 新');
  v = h.reveal();
  assert.equal(v.step, 'window_mirror');
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p5.l1', 'ch1.hint.p5.window_mirror.l2', null]);
  assert.deepEqual(log.hl.at(-1), ['guide-mirror-s3-window', 3]);
  // 离开区域暂停
  run(h, 500, OUT);
  assert.equal(h.level('p5'), 2);
});

test('015 C override（可点灯）：提示已解锁时按 H 只显示 ch1.hint.p5.ignite.l3、不高亮；未解锁仍 locked；退出后回原步骤', () => {
  const { h, log } = make();
  let ready = false;
  h.add({
    id: 'p5',
    zone: circleZone({ x: 0, z: 0 }, 5),
    l1: 'ch1.hint.p5.l1',
    stepTimed: true,
    override: () => (ready ? 'ch1.hint.p5.ignite.l3' : null),
    steps: [{ id: 'mid_b', l2: 'ch1.hint.p5.mid_b.l2', l3: 'ch1.hint.p5.mid_b.l3', highlight: ['ignition-port-s3'] }],
  });
  ready = true;
  run(h, 10);
  assert.deepEqual(h.reveal().lines.map((l) => l.textId), [null, null, null], '提示未解锁前不显示');
  run(h, 600);
  assert.equal(h.level('p5'), 3);
  const hl0 = log.hl.length;
  const v = h.reveal();
  assert.equal(v.step, 'override');
  assert.deepEqual(v.lines.map((l) => l.textId), ['ch1.hint.p5.ignite.l3']);
  assert.equal(log.hl.length, hl0, '不高亮');
  assert.ok(t('ch1.hint.p5.ignite.l3').length > 0);
  ready = false;
  const v2 = h.reveal();
  assert.equal(v2.step, 'mid_b');
  assert.deepEqual(v2.lines.map((l) => l.textId), ['ch1.hint.p5.l1', 'ch1.hint.p5.mid_b.l2', 'ch1.hint.p5.mid_b.l3']);
  assert.deepEqual(log.hl.at(-1), ['ignition-port-s3', 3]);
});

test('两道谜题：在哪个区域就显示哪个；没进过的不计时', () => {
  const { h } = make();
  h.add(P1);
  h.add({ id: 'p2', zone: circleZone({ x: 20, z: 0 }, 3), l1: 'ch1.hint.p2.l1', l2: 'ch1.hint.p2.l2', l3: 'ch1.hint.p2.l3' });
  run(h, 50);
  run(h, 30, { x: 20, y: 0, z: 0 });
  assert.equal(h.currentId, 'p2');
  run(h, 1, OUT);
  assert.equal(h.currentId, 'p2', '最近进的是 p2');
  run(h, 1);
  assert.equal(h.currentId, 'p1');
  assert.ok(Math.abs(h.time('p1') - 51) < 0.05 && Math.abs(h.time('p2') - 30) < 0.05);
});

test('?hintScale=0.05 把计时缩到 5%（只在开发 / 调试 / 冒烟时生效）', () => {
  assert.equal(hintScaleFromUrl('?hintScale=0.05', true), 0.05);
  assert.equal(hintScaleFromUrl('?hintScale=0.05', false), 1, '正式版忽略');
  assert.equal(hintScaleFromUrl('?hintScale=abc', true), 1);
  assert.equal(hintScaleFromUrl('?hintScale=5', true), 1);
  const { h } = make({ scale: 0.05 });
  h.add(P1);
  assert.deepEqual(h.thresholds.map((x) => Math.round(x * 100) / 100), [9, 18, 30]);
  run(h, 9.05);
  assert.equal(h.level('p1'), 1);
  run(h, 21);
  assert.equal(h.level('p1'), 3);
});

test('配置错误：重复 id、没步骤也没 l2/l3 → 报错', () => {
  const h = new HintSystem();
  h.add(P1);
  assert.throws(() => h.add(P1));
  assert.throws(() => h.add({ id: 'x', zone: () => true, l1: 'ch1.hint.p1.l1' }));
});

test('hintsUsed 写存档：addHintUsed + flush 立刻落盘，不改存档点、不弹「已保存」', () => {
  const map = new Map();
  const st = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const s = new SaveSystem(st, () => 1000);
  s.newGame('ch1', 's1');
  assert.equal(s.flush(), false, '还没有存档时不写');
  s.save({ chapterId: 'ch1', sceneId: 's2' });
  let toasts = 0;
  s.onSaved = () => toasts++;
  s.addHintUsed();
  s.addHintUsed();
  assert.equal(s.flush(), true);
  const data = JSON.parse(st.getItem(SAVE_KEY));
  assert.equal(data.hintsUsed, 2);
  assert.equal(data.sceneId, 's2');
  assert.equal(toasts, 0);
  assert.equal(s.hintsUsed, 2);
  const again = new SaveSystem(st);
  assert.equal(again.continueGame()?.hintsUsed, 2, '刷新后读到');
});

let failed = 0;
for (const [name, e] of results) {
  console.log(`${e ? '✗' : '✓'} ${name}`);
  if (e) {
    failed++;
    console.log(`   ${e.stack}`);
  }
}
console.log(failed ? `\n提示系统校验失败：${failed} 项` : `\n提示系统校验通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
