// 场景流程校验（v0.1-010，npm run test:flow）：资源分组、场景链、存档 → 场景、出口触发、入口 / 出口节点收集、
// 黑场切换的时间分配（已预加载 1.0 s；没加载完显示进度、等加载完才换场景）、离开场景释放资源组。
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { manifest, ASSET_GROUPS, LEVEL_GROUPS, entriesForGroup } from '@/assets/manifest';
import { LEVELS, LEVEL_LIST, levelForSave, levelByScene } from '@/scenes/levels';
import { GameFlow, sceneForSave, groupsForScene, groupsToKeep, TRANSITION, TRANSITION_TOTAL } from '@/core/GameFlow';
import { SceneExit, collectSceneMarkers } from '@/entities/components/SceneExit';

const results = [];
async function test(name, fn) {
  try {
    await fn();
    results.push([name]);
  } catch (e) {
    results.push([name, e]);
  }
}

await test('资源清单：分组只用 boot / menu / common / s1–s3，key 唯一，字体在 menu 组', () => {
  const keys = new Set();
  for (const e of manifest) {
    assert.ok(ASSET_GROUPS.includes(e.group), `${e.key} 的分组 ${e.group} 不认识`);
    assert.ok(!keys.has(e.key), `key 重复：${e.key}`);
    keys.add(e.key);
    assert.ok(!e.url.startsWith('/'), `${e.key} url 不能以 / 开头`);
    if (e.type === 'font') {
      assert.equal(e.group, 'menu', '字体要随主菜单加载');
      assert.ok(e.family, '字体要有 family');
      assert.match(e.url, /\.woff2$/);
    }
  }
  assert.ok(entriesForGroup('menu').some((e) => e.type === 'font'));
  for (const k of ['char-xi', 'char-xi-anims', 'tex-xi-ramp', 'tex-xi-sdf-face']) assert.equal(manifest.find((e) => e.key === k)?.group, 'common', `主角 ${k} 常驻 common`);
  assert.deepEqual([...LEVEL_GROUPS], ['s1', 's2', 's3', 'ch2-s1', 'ch2-s2', 'ch2-s3']);
});

await test('场景链：第一章 S1 → S2 → S3 与第二章 ch2-s1 → ch2-s2 → ch2-s3，场景名 / 资源组一一对应', () => {
  assert.deepEqual(LEVEL_LIST.map((l) => l.scene), [
    's1-ebb-shore',
    's2-keeper-house',
    's3-lighthouse',
    'ch2-harbour',
    'ch2-mirror-alley',
    'ch2-lighthouse',
  ]);
  assert.equal(LEVELS.s1.next, 's2');
  assert.equal(LEVELS.s2.next, 's3');
  assert.equal(LEVELS.s3.next, null);
  assert.equal(LEVELS['ch2-s1'].next, 'ch2-s2');
  assert.equal(LEVELS['ch2-s2'].next, 'ch2-s3');
  assert.equal(LEVELS['ch2-s3'].next, null);
  for (const l of LEVEL_LIST) {
    assert.equal(l.group, l.id);
    assert.equal(levelByScene(l.scene), l);
  }
});

await test('存档 → 场景：s1–s3 与 ch2-s1–ch2-s3；旧存档 main 和认不出的 ID 回到 S1', () => {
  assert.equal(sceneForSave('s1'), 's1-ebb-shore');
  assert.equal(sceneForSave('s2'), 's2-keeper-house');
  assert.equal(sceneForSave('s3'), 's3-lighthouse');
  assert.equal(sceneForSave('ch2-s1'), 'ch2-harbour');
  assert.equal(sceneForSave('ch2-s2'), 'ch2-mirror-alley');
  assert.equal(sceneForSave('ch2-s3'), 'ch2-lighthouse');
  assert.equal(sceneForSave('main'), 's1-ebb-shore', '010 之前的存档');
  assert.equal(sceneForSave('???'), 's1-ebb-shore');
  assert.equal(levelForSave('s2').group, 's2');
  assert.equal(levelForSave('ch2-s2').group, 'ch2-s2');
});

await test('加载分组：新游戏 common + s1；继续 S2 / ch2-s1；换场景保留当前 + 下一个', () => {
  assert.deepEqual(groupsForScene('s1-ebb-shore'), ['common', 's1']);
  assert.deepEqual(groupsForScene('s2-keeper-house'), ['common', 's2']);
  assert.deepEqual(groupsForScene('ch2-harbour'), ['common', 'ch2-s1']);
  assert.deepEqual(groupsForScene('ch2-mirror-alley'), ['common', 'ch2-s2']);
  assert.deepEqual(groupsForScene('ch2-lighthouse'), ['common', 'ch2-s3']);
  assert.deepEqual(groupsForScene('testbed'), ['common']);
  // 037：沙盒 LOD 测试模型在 dev 组，正式 S1 不下载
  assert.deepEqual(groupsForScene('sandbox'), ['common', 's1', 'dev']);
  assert.ok(!entriesForGroup('s1').some((e) => e.url.includes('/test-')), 's1 组不该有测试模型');
  assert.deepEqual(groupsToKeep(LEVELS.s2), ['common', 's2', 's3']);
  assert.deepEqual(groupsToKeep(LEVELS.s3), ['common', 's3']);
  assert.deepEqual(groupsToKeep(LEVELS['ch2-s1']), ['common', 'ch2-s1', 'ch2-s2']);
  assert.deepEqual(groupsToKeep(LEVELS['ch2-s3']), ['common', 'ch2-s3']);
});

await test('黑场时间分配：淡出 + 最短全黑 + 淡入 ≤ 1.0 s', () => {
  assert.ok(TRANSITION_TOTAL <= 1.0 && TRANSITION_TOTAL >= 0.9, `${TRANSITION_TOTAL}`);
  assert.ok(TRANSITION.holdMin > 0);
});

await test('SceneExit：走进去触发一次；出生在里面不触发；走出再走进再触发；disabled 不触发', () => {
  const pos = new THREE.Vector3(0, 0, 0);
  const fired = [];
  const exit = new SceneExit({ target: 's2', entry: 'from-s1', center: new THREE.Vector3(0, 0, 0), radius: 1, player: () => pos, onEnter: (e) => fired.push(e.target) });
  exit.fixedUpdate(1 / 60);
  exit.fixedUpdate(1 / 60);
  assert.equal(fired.length, 0, '出生在触发体里');
  pos.set(3, 0, 0);
  exit.fixedUpdate(1 / 60);
  pos.set(0.5, 0, 0.5);
  exit.fixedUpdate(1 / 60);
  exit.fixedUpdate(1 / 60);
  assert.deepEqual(fired, ['s2']);
  assert.equal(exit.entry, 'from-s1');
  pos.set(5, 0, 0);
  exit.fixedUpdate(1 / 60);
  exit.enabled = false;
  pos.set(0, 0, 0);
  exit.fixedUpdate(1 / 60);
  assert.equal(fired.length, 1);
  const boxExit = new SceneExit({ target: 's3', box: new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 3, 1)), player: () => pos, onEnter: () => {} });
  assert.ok(boxExit.contains(new THREE.Vector3(0.5, 0, 0.5)));
  assert.ok(!boxExit.contains(new THREE.Vector3(0.5, 5, 0.5)));
});

await test('模型命名：-spawn-<id> 入口点（含朝向）、-exit-<s1|s2|s3> 出口（隐藏）', () => {
  const root = new THREE.Group();
  const sp = new THREE.Object3D();
  sp.name = 's2-house-spawn-from-s1.001';
  sp.position.set(2, 0, 3);
  sp.rotation.y = Math.PI; // +Z 转到 -Z：看向 -Z = 相机 yaw 0
  root.add(sp);
  const ex = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
  ex.name = 's2-house-exit-s3';
  ex.position.set(10, 1, 0);
  ex.userData.entry = 'from-s2';
  root.add(ex);
  root.position.x = 1;
  const m = collectSceneMarkers(root);
  const s = m.spawns.get('from-s1');
  assert.ok(s, '入口点');
  assert.ok(s.position.distanceTo(new THREE.Vector3(3, 0, 3)) < 1e-6);
  assert.ok(Math.abs(Math.atan2(Math.sin(s.yaw), Math.cos(s.yaw))) < 1e-6, `yaw ${s.yaw}`);
  assert.equal(m.exits.length, 1);
  assert.equal(m.exits[0].target, 's3');
  assert.equal(m.exits[0].entry, 'from-s2');
  assert.ok(m.exits[0].box.containsPoint(new THREE.Vector3(11, 1, 0)));
  assert.equal(ex.visible, false);
});

// ---------------------------------------------------------------- 黑场切换（假 Game）

function fakeGame({ loadMs = 0, loaded = [] } = {}) {
  const log = [];
  const loadedGroups = new Set(loaded);
  const fade = {
    opacity: 0,
    progressShown: [],
    set(v) {
      this.opacity = v;
    },
    setProgress(r) {
      if (r !== null) this.progressShown.push(r);
    },
  };
  const game = {
    log,
    ui: { fade },
    scenes: {
      current: { name: 's1-ebb-shore', scene: {}, camera: {} },
      async change(name) {
        log.push(['change', name, fade.opacity, [...loadedGroups]]);
        this.current = { name, scene: {}, camera: {}, usePostFX: true };
      },
    },
    renderer: {
      target: null,
      toneMapping: THREE.ACESFilmicToneMapping,
      compiled: [],
      getRenderTarget() {
        return this.target;
      },
      setRenderTarget(t) {
        this.target = t;
      },
      async compileAsync() {
        this.compiled.push({ toTarget: this.target !== null, toneMapping: this.toneMapping });
      },
    },
    postfx: { active: true },
    events: { on: () => () => {} },
    input: { pushContext: () => () => {} },
    assets: {
      isGroupLoaded: (g) => loadedGroups.has(g),
      get loadedGroups() {
        return [...loadedGroups];
      },
      async loadGroups(groups, onProgress) {
        const t0 = Date.now();
        if (groups.every((g) => loadedGroups.has(g))) {
          onProgress?.(1);
          return;
        }
        while (Date.now() - t0 < loadMs) {
          onProgress?.((Date.now() - t0) / loadMs);
          await new Promise((r) => setTimeout(r, 30));
        }
        for (const g of groups) loadedGroups.add(g);
        onProgress?.(1);
      },
      unloadGroup(g) {
        log.push(['unload', g]);
        loadedGroups.delete(g);
      },
    },
  };
  return game;
}
globalThis.window ??= globalThis;
globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 16);

await test('切换（已预加载）：总时长 ≤ 1.0 s、全黑时换场景、不显示进度、释放上一个场景的组', async () => {
  const game = fakeGame({ loaded: ['common', 's1', 's2'] });
  const flow = new GameFlow(game);
  const p = flow.goToLevel('s2');
  assert.equal(flow.transitioning, true);
  await flow.goToLevel('s3'); // 切换中再触发：忽略
  await p;
  const rec = flow.lastTransition;
  assert.ok(rec, '有记录');
  assert.ok(rec.ms >= TRANSITION_TOTAL * 1000 - 10 && rec.ms <= 1000, `总时长 ${rec.ms.toFixed(0)} ms`);
  assert.equal(rec.waitedForLoad, false);
  assert.equal(rec.progressShown, false);
  const change = game.log.find((l) => l[0] === 'change');
  assert.deepEqual(change.slice(0, 3), ['change', 's2-keeper-house', 1], '在全黑时换场景');
  assert.equal(game.log.filter((l) => l[0] === 'change').length, 1, '重复触发被忽略');
  assert.ok(game.log.some((l) => l[0] === 'unload' && l[1] === 's1'), '释放 s1');
  assert.ok(!game.log.some((l) => l[0] === 'unload' && (l[1] === 's2' || l[1] === 's3')), '保留 s2 / s3');
  assert.equal(flow.transitioning, false);
  assert.equal(game.ui.fade.opacity, 0, '画面恢复');
  assert.equal(flow.takeEntry(), 'from-s1', '默认入口');
  // 走后处理的关卡按「画进 RT、不做色调映射」预编译（和真实出图一致，不多编上屏变体），编完还原
  assert.deepEqual(game.renderer.compiled, [{ toTarget: true, toneMapping: THREE.NoToneMapping }], '按后处理路径预编译');
  assert.equal(game.renderer.target, null, '渲染目标还原');
  assert.equal(game.renderer.toneMapping, THREE.ACESFilmicToneMapping, '色调映射还原');
  assert.equal(flow.takeEntry(), null, '入口只取一次');
});

await test('切换（没加载完）：黑场里显示细线进度，加载完才换场景', async () => {
  const game = fakeGame({ loaded: ['common', 's2'], loadMs: 900 });
  game.scenes.current = { name: 's2-keeper-house', scene: {}, camera: {} };
  const flow = new GameFlow(game);
  await flow.goToLevel('s3', 'from-s2');
  const rec = flow.lastTransition;
  assert.equal(rec.waitedForLoad, true);
  assert.equal(rec.progressShown, true);
  assert.ok(game.ui.fade.progressShown.length >= 3, `进度更新 ${game.ui.fade.progressShown.length} 次`);
  const change = game.log.find((l) => l[0] === 'change');
  assert.ok(change[3].includes('s3'), '换场景时 s3 已加载');
  assert.ok(rec.ms > 1000, `${rec.ms}`);
  assert.ok(game.log.some((l) => l[0] === 'unload' && l[1] === 's2'), '释放 s2');
});

let failed = 0;
for (const [name, err] of results) {
  if (err) {
    failed++;
    console.log(`✗ ${name}\n   ${err.stack ?? err.message}`);
  } else console.log(`✓ ${name}`);
}
console.log(failed ? `\n${failed} 项失败` : `\n场景流程校验全部通过（${results.length} 项）`);
process.exit(failed ? 1 : 0);
