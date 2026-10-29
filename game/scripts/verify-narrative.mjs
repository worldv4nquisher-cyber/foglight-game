// v0.1-005 字幕 / 阅读 / 日志校验（纯逻辑，无 DOM）：字幕时长与推进、只一次、演出时间轴、说话人字色、
// 已读文档与日志（首次 / 不重复 / 存档）、当前目标、父亲日志 5 页 + 结尾第 6 页、文本表全部 ID 可加载、阅读上下文键位。
// 运行：node --import ./scripts/register-ts-paths.mjs scripts/verify-narrative.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardcodedCjk, hardcodedStory, missingIds } from './import-text.mjs';
import { keyHintHtml } from '@/ui/keyHint';
import { EventBus } from '@/core/EventBus';
import { InputManager } from '@/systems/input/InputManager';
import { actionsForCode, CONTEXTS } from '@/systems/input/actions';
import { SaveSystem } from '@/systems/save/SaveSystem';
import { NarrativeState, docTitleId, isJournalDoc, FATHER_JOURNAL_ID, OUTRO_JOURNAL_ENTRY_ID } from '@/systems/NarrativeState';
import { SubtitleTrack, subtitleDuration, SPEAKER_COLORS, SUBTITLE_SIZES } from '@/ui/Subtitles';
import { t, textMeta, textPages, isTextId } from '@/content/text';

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  }
}

class MemStorage {
  map = new Map();
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}

const json = JSON.parse(readFileSync(new URL('../../docs/gdd/text-ch1.json', import.meta.url), 'utf8'));
const DT = 1 / 60;
/** 按帧推进直到当前行变化，返回经过的时间 */
function runUntilChange(track, max = 20) {
  const id = track.current?.id;
  let el = 0;
  while (track.current?.id === id && el < max) {
    track.update(DT);
    el += DT;
  }
  return el;
}

// ---------------------------------------------------------------- 字幕

test('时长：10 字 → 2.0 s，30 字 → 3.6 s，最短 2.0 s，空白不计', () => {
  assert.equal(subtitleDuration('一二三四五六七八九十'), 2.0);
  assert.equal(subtitleDuration('一二三四五六七八九十'.repeat(3)), 3.6);
  assert.equal(subtitleDuration('它还在响。'), 2.0);
  assert.equal(subtitleDuration('一二三 四五\n六七八九十'.repeat(3)), 3.6);
  assert.equal(subtitleDuration('一'.repeat(20)), 2.4);
});

test('play(ids)：每行按自己的时长（max(2.0, 字数×0.12)）到时自动切到下一行，播完清空', () => {
  // 文本表里找一条 10 字和一条 30 字的独白 / 查看；没有就用时长函数直接验（上一条已验）
  const tr = new SubtitleTrack();
  const ids = Object.keys(json.strings).filter((id) => isTextId(id) && ['monologue', 'inspect'].includes(textMeta(id).type));
  const a = ids[0];
  const b = ids[1];
  assert.equal(tr.play([a, b]), 2);
  assert.equal(tr.current.id, a);
  const da = runUntilChange(tr);
  assert.ok(Math.abs(da - subtitleDuration(t(a))) <= DT + 1e-6, `第一行 ${da.toFixed(3)} s`);
  assert.equal(tr.current.id, b);
  runUntilChange(tr);
  assert.equal(tr.current, null);
});

test('10 字的表内行 2.0 s、30 字的行 3.6 s 后自动切换（按帧推进，误差 ≤ 1 帧）', () => {
  const ev = new EventBus();
  const shown = [];
  ev.on('subtitle:hide', (p) => shown.push([p.id, p.shown, p.reason]));
  const tr = new SubtitleTrack(null, ev);
  const ten = 'ch1.s2.cups.inspect';
  assert.equal([...t(ten).replace(/\s/g, '')].length, 10);
  tr.play([ten]);
  runUntilChange(tr);
  tr.playText('一二三四五六七八九十'.repeat(3));
  assert.equal(tr.current.duration, 3.6);
  runUntilChange(tr);
  assert.equal(shown.length, 2);
  assert.equal(shown[0][0], ten);
  assert.ok(Math.abs(shown[0][1] - 2.0) <= DT + 1e-6, String(shown[0][1]));
  assert.ok(Math.abs(shown[1][1] - 3.6) <= DT + 1e-6, String(shown[1][1]));
  assert.deepEqual(shown.map((s) => s[2]), ['timeout', 'timeout']);
});

test('左键 / Space 立即推进；锁定的演出字幕不响应', () => {
  const tr = new SubtitleTrack();
  tr.play(['ch1.s1.boat.inspect', 'ch1.s1.tide_pillar.inspect']);
  tr.update(0.3);
  assert.equal(tr.advance(), true);
  assert.equal(tr.current.id, 'ch1.s1.tide_pillar.inspect');
  assert.equal(tr.time, 0);
  assert.equal(tr.advance(), true);
  assert.equal(tr.current, null);
  assert.equal(tr.advance(), false);
  tr.setTimeline([{ at: 1, id: 'ch1.intro.line_home', duration: 4 }]);
  tr.playAt(1.5);
  assert.equal(tr.current.locked, true);
  assert.equal(tr.advance(), false);
  assert.equal(tr.current.id, 'ch1.intro.line_home');
});

test('同一时刻只一条：新 play 顶掉旧的；暂停（dt = 0）时不走时', () => {
  const tr = new SubtitleTrack();
  const hides = [];
  tr.onHide = (l, r) => hides.push(r);
  tr.play(['ch1.s1.boat.inspect']);
  tr.play(['ch1.s1.tide_pillar.inspect']);
  assert.deepEqual(hides, ['replaced']);
  for (let i = 0; i < 600; i++) tr.update(0);
  assert.equal(tr.current.id, 'ch1.s1.tide_pillar.inspect');
});

test('只一次：显示时记进 seenLines（存档），再 play 跳过；非只一次的照常', () => {
  const save = new SaveSystem(new MemStorage());
  save.newGame('ch1', 's1');
  const n = new NarrativeState(new EventBus(), save);
  const tr = new SubtitleTrack(n);
  const once = 'ch1.s1.tide_bell.mono_seen';
  assert.equal(textMeta(once).once, true);
  assert.equal(tr.play([once]), 1);
  assert.equal(save.hasSeenLine(once), true);
  tr.clear();
  assert.equal(tr.play([once]), 0);
  assert.equal(tr.current, null);
  assert.equal(textMeta('ch1.s1.boat.inspect').once, undefined);
  tr.play(['ch1.s1.boat.inspect']);
  tr.clear();
  assert.equal(tr.play(['ch1.s1.boat.inspect']), 1);
  // 存档写盘再读回：仍跳过
  save.save({ chapterId: 'ch1', sceneId: 's1' });
  const s2 = new SaveSystem(save['storage']);
  s2.continueGame();
  assert.equal(new SubtitleTrack(new NarrativeState(null, s2)).play([once]), 0);
});

test('演出时间轴：playAt(time) 与镜头时间同步（跳转 / 倒退按时间重算），演出期间屏蔽独白', () => {
  const tr = new SubtitleTrack();
  tr.setTimeline([
    { at: 46, id: 'ch1.intro.line_home', duration: 4 },
    { at: 52, id: 'ch1.intro.title_card', duration: 4 },
  ]);
  assert.equal(tr.playAt(10), null);
  assert.equal(tr.playAt(46.2).id, 'ch1.intro.line_home');
  assert.ok(Math.abs(tr.time - 0.2) < 1e-9);
  assert.equal(tr.play(['ch1.s1.boat.inspect']), 0);
  assert.equal(tr.playAt(50.5), null);
  assert.equal(tr.playAt(53).id, 'ch1.intro.title_card');
  assert.equal(tr.playAt(47).id, 'ch1.intro.line_home');
  tr.update(10);
  assert.equal(tr.current.id, 'ch1.intro.line_home', '演出字幕不走自己的计时');
  tr.endTimeline();
  assert.equal(tr.current, null);
  assert.equal(tr.play(['ch1.s1.boat.inspect']), 1);
});

test('说话人字色（汐 #E4E8EA / 父亲 #8B959D）、字号三档递增', () => {
  assert.equal(SPEAKER_COLORS.xi, '#E4E8EA');
  assert.equal(SPEAKER_COLORS.father, '#8B959D');
  assert.equal(textMeta('ch1.s1.boat.inspect').speaker, 'xi');
  assert.equal(textMeta('ch1.s1.goal.find_bell').speaker, 'father');
  assert.ok(SUBTITLE_SIZES.s < SUBTITLE_SIZES.m && SUBTITLE_SIZES.m < SUBTITLE_SIZES.l);
});

// ---------------------------------------------------------------- 已读 / 日志

test('首次阅读写进日志并发 journal:updated；再次阅读不重复', () => {
  const ev = new EventBus();
  const got = [];
  ev.on('journal:updated', (p) => got.push(p.docId));
  const n = new NarrativeState(ev, null);
  assert.equal(n.markRead('ch1.s1.notice.doc'), true);
  assert.equal(n.markRead('ch1.s1.notice.doc'), false);
  assert.equal(n.markRead(FATHER_JOURNAL_ID), true);
  assert.deepEqual(got, ['ch1.s1.notice.doc', FATHER_JOURNAL_ID]);
  assert.deepEqual(
    n.journal.map((e) => [e.docId, e.group, e.title]),
    [
      ['ch1.s1.notice.doc', 'letters', 'ui.doc_title.notice'],
      [FATHER_JOURNAL_ID, 'father', 'ui.doc_title.journal'],
    ],
  );
  assert.equal(n.markRead('ch1.s1.boat.inspect'), false, '不是文档的 ID 不进日志');
});

test('已读文档交给存档：写盘 / 读回顺序不变；没有进度时只在内存', () => {
  const save = new SaveSystem(new MemStorage());
  const n0 = new NarrativeState(null, save);
  n0.markRead('ch1.s1.notice.doc');
  assert.equal(save.hasReadDoc('ch1.s1.notice.doc'), false, '没有进度：不写存档');
  save.newGame('ch1', 's1');
  const n = new NarrativeState(null, save);
  n.markRead(FATHER_JOURNAL_ID);
  n.markRead('ch1.s1.notice.doc');
  save.save({ chapterId: 'ch1', sceneId: 's1' });
  const s2 = new SaveSystem(save['storage']);
  assert.deepEqual(s2.lastSave.readDocs, [FATHER_JOURNAL_ID, 'ch1.s1.notice.doc']);
  s2.continueGame();
  const n2 = new NarrativeState(null, s2);
  assert.deepEqual(n2.readDocs, [FATHER_JOURNAL_ID, 'ch1.s1.notice.doc']);
  assert.equal(n2.markRead(FATHER_JOURNAL_ID), false);
});

test('文档都有标题和分组：doc → 信与纸条，journal → 父亲的日志', () => {
  const docs = json.entries.filter((e) => e.type === 'doc' || e.type === 'journal').map((e) => e.id);
  assert.ok(docs.length >= 8);
  for (const id of docs) {
    assert.ok(isJournalDoc(id), id);
    assert.ok(docTitleId(id), `${id} 缺 ui.doc_title.*`);
  }
});

test('父亲日志 5 页可翻；结尾演出后第 6 页 = ch1.outro.journal_entry（进存档）', () => {
  const save = new SaveSystem(new MemStorage());
  save.newGame('ch1', 's1');
  const n = new NarrativeState(new EventBus(), save);
  assert.equal(n.docPages(FATHER_JOURNAL_ID).length, 5);
  assert.equal(textPages(FATHER_JOURNAL_ID).length, 5);
  n.unlockOutroEntry();
  const pages = n.docPages(FATHER_JOURNAL_ID);
  assert.equal(pages.length, 6);
  assert.equal(pages[5], t(OUTRO_JOURNAL_ENTRY_ID));
  assert.equal(textPages(FATHER_JOURNAL_ID).length, 5, '文本表本身不被改');
  assert.equal(save.hasSeenLine(OUTRO_JOURNAL_ENTRY_ID), true);
  assert.equal(n.docPages('ch1.s1.notice.doc').length, 1);
});

test('当前目标可由代码更新（goal:changed），只接受 goal 类文本', () => {
  const ev = new EventBus();
  const got = [];
  ev.on('goal:changed', (p) => got.push(p.goal));
  const n = new NarrativeState(ev);
  n.setGoal('ch1.s1.goal.find_bell');
  n.setGoal('ch1.s1.goal.find_bell');
  n.setGoal('ch1.s1.goal.reef_path');
  assert.deepEqual(got, ['ch1.s1.goal.find_bell', 'ch1.s1.goal.reef_path']);
  assert.equal(n.goal, 'ch1.s1.goal.reef_path');
  assert.throws(() => n.setGoal('ch1.s1.boat.inspect'));
});

// ---------------------------------------------------------------- 文本表 / 键位

test('text-ch1.json 全部 ID 可加载（t / textMeta / textPages）', () => {
  const ids = Object.keys(json.strings);
  assert.equal(ids.length, json.meta.count ?? ids.length);
  for (const id of ids) {
    assert.ok(isTextId(id), id);
    const v = json.strings[id];
    assert.equal(t(id), Array.isArray(v) ? v.join('\n\n') : v);
    assert.ok(textMeta(id), id);
    assert.equal(textPages(id).length, Array.isArray(v) ? v.length : 1);
  }
});

test('阅读上下文：A/D、←/→ 翻页，右键 / Tab 关闭，J 关日志，没有移动轴，显示光标', () => {
  assert.deepEqual(actionsForCode('reading', 'KeyA'), ['pagePrev']);
  assert.deepEqual(actionsForCode('reading', 'ArrowRight'), ['pageNext']);
  assert.deepEqual(actionsForCode('reading', 'Mouse2'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('reading', 'Tab'), ['exitPuzzle']);
  assert.deepEqual(actionsForCode('reading', 'KeyJ'), ['journal']);
  assert.deepEqual(actionsForCode('explore', 'KeyJ'), ['journal']);
  assert.equal(CONTEXTS.reading.axes, false);
  assert.equal(CONTEXTS.reading.cursor, 'free');
  // 打开阅读（压 reading）时 WASD 不产生移动
  let now = 0;
  const input = new InputManager(new EventBus(), () => now);
  const pop = input.pushContext('reading');
  input.setRaw('kb', 'KeyW', true);
  input.beginFrame();
  assert.deepEqual(input.getMove(), { x: 0, y: 0 });
  input.endFrame();
  input.setRaw('kb', 'KeyD', true);
  input.beginFrame();
  assert.equal(input.consumePressed('pageNext'), true);
  input.endFrame();
  pop();
  assert.equal(input.context, 'explore');
});

test('暂停→继续后阅读界面里的第一下右键直接关闭（reading 是自由光标，不走锁定点击）', () => {
  const ev = new EventBus();
  let now = 0;
  const input = new InputManager(ev, () => now);
  input.pushContext('reading');
  ev.emit('game:pause', { reason: 'user' });
  assert.equal(input.context, 'menu');
  ev.emit('game:resume');
  assert.equal(input.context, 'reading');
  assert.equal(input.cursorMode, 'free');
  input.setRaw('mouse', 'Mouse2', true);
  input.beginFrame();
  assert.equal(input.consumePressed('exitPuzzle'), true);
});

test('import-text 检查：代码引用的缺失 ID = 0；硬编码剧情中文检查能抓到（反例）且 src 里为 0', () => {
  assert.deepEqual(missingIds(), []);
  assert.deepEqual(hardcodedStory(), []);
  const dir = mkdtempSync(join(tmpdir(), 'story-'));
  try {
    writeFileSync(join(dir, 'bad.ts'), `const s = '${t('ch1.s2.journal.mono_after')}';`);
    writeFileSync(join(dir, 'ok.ts'), "const s = t('ch1.s2.journal.mono_after');");
    const found = hardcodedStory(dir);
    assert.ok(found.length >= 1 && found.every(([, id, f]) => id === 'ch1.s2.journal.mono_after' && /bad\.ts$/.test(f)), JSON.stringify(found));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// BUG-005：src 里写死的玩家可见中文 = 0；反例（字面量 / 模板 / 地名）能抓到，日志 / 报错 / 调试 / 注释 / GLSL 注释放行
{
  const name = 'BUG-005 硬编码中文检查：src 为 0，反例能抓到，日志 / 报错 / 调试面板 / 注释 / text-ok 放行';
  const dir = mkdtempSync(join(tmpdir(), 'cjk-'));
  try {
    assert.deepEqual(await hardcodedCjk(), []);
    writeFileSync(
      join(dir, 'bad.ts'),
      [
        "hud.setLocation('雾岬 · 第一座灯塔');",
        "const a = `<kbd>E</kbd> 互动`;",
        'const b = `${x} 秒后`;',
      ].join('\n'),
    );
    writeFileSync(
      join(dir, 'ok.ts'),
      [
        '// 注释里写 守灯人小屋 没关系',
        "/* 块注释 落潮滩 */ console.warn('[x] 加载失败', 1);",
        "throw new Error('缺少容器');",
        "ui.debug.set('相机', 'x');",
        "function debugLine() { return '速度'; }",
        "const shader = `// 着色器注释 中文\nvoid main() {}`;",
        "// text-ok: F3 调试\nconst c = '三角面';",
        "const d = t('ch1.s1.location.title');",
      ].join('\n'),
    );
    const found = await hardcodedCjk(dir);
    const bad = found.filter(([w]) => /bad\.ts/.test(w));
    assert.equal(bad.length, 3, JSON.stringify(found));
    assert.equal(found.length, 3, '放行的写法被误报：' + JSON.stringify(found));
    results.push(['ok', name]);
  } catch (e) {
    results.push(['FAIL', name, e]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('BUG-005 操作提示从文本表生成：按键框 + 说明，转义', () => {
  assert.equal(keyHintHtml('W A S D 移动　Esc 暂停'), '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Esc</kbd> 暂停');
  assert.equal(keyHintHtml('点击画面 锁定鼠标转视角'), '<kbd>点击画面</kbd> 锁定鼠标转视角');
  assert.equal(keyHintHtml('<b> 坏'), '<kbd>&lt;b&gt;</kbd> 坏');
  const html = keyHintHtml(t('ui.hud.controls'));
  assert.ok((html.match(/<kbd>/g) ?? []).length >= 9, html);
  for (const id of ['ch1.s1.location.title', 'ch1.s2.location.title', 'ch1.s3.location.title']) assert.ok(isTextId(id) && t(id).length >= 3, id);
  assert.deepEqual([t('ch1.s1.location.title'), t('ch1.s2.location.title'), t('ch1.s3.location.title')], ['落潮滩', '守灯人小屋', '初望灯塔']);
});

// ---------------------------------------------------------------- 汇总

let failed = 0;
for (const [status, name, err] of results) {
  console.log(`${status === 'ok' ? '✓' : '✗'} ${name}`);
  if (err) {
    failed++;
    console.log(`  ${err.stack ?? err}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} 通过`);
if (failed) process.exit(1);
