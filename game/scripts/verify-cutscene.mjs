// v0.1-035 演出系统自检（node，无浏览器）：演出时钟（音频 / 后备 / 暂停 / 单调 / 晚到补位 / seek）、
// cue 顺序与触发时刻、跳过流程、演出结束才进结束页、镜头分段、结尾时间轴 ↔ 结尾曲 CUES
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CutsceneClock, CLOCK_MAX_STEP } from '@/systems/cutscene/CutsceneClock';
import { CutscenePlayer, shotAt, sampleShots } from '@/systems/cutscene/CutscenePlayer';
import { SkipController, SKIP_HOLD_SEC, SKIP_HINT_DELAY, SKIP_HINT_SHOW } from '@/systems/cutscene/SkipController';
import { ENDING_CUES, ENDING_SKIP_FADE_SEC } from '@/systems/audio/endingMusic';
import {
  ENDING_T,
  ENDING_CUE_LIST,
  ENDING_SUBTITLES,
  GAZE_LOOP_SEC,
  fadeAt,
  fogOpenAt,
  silhouetteAt,
  fatherOpacityAt,
  xiPoseAt,
  glassReflectionAt,
  GLASS_REFLECTION_OFF,
  BEAM_BOOST_02,
  beamBoostAt,
  OVER_SHOULDER,
  overShoulderKeys,
} from '@/content/cutscenes/ending';
import { LampBeam, LAMP_BEAM } from '@/render/lampBeam';
import { makeGhost, GHOST_RENDER_ORDER } from '@/render/ghost';
import { makeSpecularGate, SPECULAR_GATE_GLSL } from '@/render/specularGate';
import { ShaderLib } from 'three';
import { OUTRO_CUT_SEC, IGNITE_MONO_DELAY, IGNITE_MONO_SEC } from '@/levels/s3/puzzles';
import { t as text } from '@/content/text';
import { OPENING_T, openingBoatDistance } from '@/content/cutscenes/opening';
import { CameraFollowSystem, CameraTrack } from '@/systems/CameraFollowSystem';
import { InputManager } from '@/systems/input/InputManager';

const out = [];
const near = (a, b, tol, tag) => assert.ok(Math.abs(a - b) <= tol, `${tag}：${a} ≠ ${b}（±${tol}）`);

{
  const { reveal, glide, tie, establishing, end } = OPENING_T;
  assert.equal(openingBoatDistance(0), openingBoatDistance(reveal));
  for (let t = reveal; t < tie; t += 1 / 30) {
    assert.ok(openingBoatDistance(t) > openingBoatDistance(t + 1 / 30), '船接近码头时不能倒退');
  }
  near(openingBoatDistance(glide - 0.001), openingBoatDistance(glide + 0.001), 0.003, '停桨时船位连续');
  assert.equal(openingBoatDistance(tie), 0);
  assert.equal(openingBoatDistance(end), 0);
  assert.equal(end - establishing, 3);
  out.push('开场：划船 → 滑行 → 停在系泊点，最后 3 s 建立镜头 ✓');
}

{
  const input = new InputManager();
  const camera = new CameraFollowSystem(new THREE.PerspectiveCamera(), input);
  const track = new CameraTrack({ duration: 0.1, node: new THREE.Object3D() });
  const events = [];
  const finished = camera.playEstablishing(track, () => events.push(input.context));
  void finished.then(() => events.push('blended'));
  camera.update(0.1);
  assert.deepEqual(events, ['cutscene']);
  assert.equal(input.context, 'explore');
  assert.equal(camera.blending, true);
  camera.update(1);
  await finished;
  assert.deepEqual(events, ['cutscene', 'blended']);
  const interrupted = camera.playEstablishing(track, () => events.push('interrupted'));
  camera.dispose();
  await interrupted;
  assert.deepEqual(events, ['cutscene', 'blended']);
  out.push('开场：相机过渡前、输入交还前完成存档；主动中断不存档 ✓');
}

/** 可控时钟源 */
function fakeSource() {
  const s = { nowMs: 1000, audioT: null, isPaused: false };
  return {
    s,
    src: { audio: () => s.audioT, now: () => s.nowMs, paused: () => s.isPaused },
  };
}

// ---- 1. 音频时钟：t 跟音频走，不跟 now
{
  const { s, src } = fakeSource();
  const c = new CutsceneClock(src);
  s.audioT = 0;
  c.tick();
  assert.equal(c.source, 'audio');
  // 帧率很低（now 只走 50 ms）但音频走了 0.5 s → t = 0.5
  s.nowMs += 50;
  s.audioT = 0.5;
  near(c.tick(), 0.5, 1e-9, '音频时钟：t 跟音频');
  // now 跳很大（切后台），音频只走 0.1 → t 仍跟音频
  s.nowMs += 10000;
  s.audioT = 0.6;
  near(c.tick(), 0.6, 1e-9, '音频时钟：不跟 now');
  // 音频抖动倒退 → 单调不倒退
  s.audioT = 0.58;
  near(c.tick(), 0.6, 1e-9, '音频时钟：单调');
  assert.ok(c.frames.audio === 4 && c.frames.fallback === 0);
  out.push('音频时钟 ✓');
}

// ---- 2. 后备时钟（无音频）：performance.now 增量；暂停不走；单步上限
{
  const { s, src } = fakeSource();
  const c = new CutsceneClock(src);
  for (let i = 0; i < 60; i++) {
    s.nowMs += 1000 / 60;
    c.tick();
  }
  assert.equal(c.source, 'fallback');
  near(c.t, 1.0, 1e-6, '后备时钟 60 帧 = 1 s');
  s.isPaused = true;
  s.nowMs += 5000;
  c.tick();
  near(c.t, 1.0, 1e-6, '暂停时后备时钟不走');
  s.isPaused = false;
  s.nowMs += 5000; // 切后台回来
  c.tick();
  near(c.t, 1.0 + CLOCK_MAX_STEP, 1e-6, '后备时钟单步上限');
  out.push('后备时钟 ✓');
}

// ---- 3. 后备 → 音频（结尾曲晚到补位）：音频落后时停住等、超前时跟上
{
  const { s, src } = fakeSource();
  const c = new CutsceneClock(src);
  for (let i = 0; i < 120; i++) {
    s.nowMs += 1000 / 60;
    c.tick();
  }
  near(c.t, 2, 1e-6, '后备 2 s');
  s.audioT = 1.5; // 补位起播的音频比后备慢
  s.nowMs += 16;
  near(c.tick(), 2, 1e-6, '音频落后 → 不倒退');
  assert.equal(c.source, 'audio');
  s.audioT = 2.4;
  near(c.tick(), 2.4, 1e-6, '音频超前 → 跟上');
  // 音频又没了（context 挂起）→ 后备接着走
  s.audioT = null;
  s.nowMs += 100;
  near(c.tick(), 2.5, 1e-6, '音频丢失 → 后备接续');
  out.push('时钟来源切换 ✓');
}

// ---- 4. seek：音频源加偏移
{
  const { s, src } = fakeSource();
  const c = new CutsceneClock(src);
  s.audioT = 1;
  c.tick();
  c.seek(10);
  near(c.t, 10, 1e-9, 'seek');
  s.audioT = 1.5;
  near(c.tick(), 10.5, 1e-9, 'seek 后音频偏移');
  c.seek(5);
  near(c.t, 10.5, 1e-9, 'seek 不倒退');
  out.push('seek ✓');
}

// ---- 5. 播放器：cue 按顺序、按时钟触发；一帧跨多个照样按序；结束一次
function makePlayer(src, extra = {}) {
  const fired = [];
  const finishes = [];
  const p = new CutscenePlayer({
    id: 'test',
    duration: ENDING_T.end,
    clock: new CutsceneClock(src),
    cues: ENDING_CUE_LIST.map(([id, at]) => ({ id, at, run: () => fired.push(id) })),
    onFinish: (how, t) => finishes.push({ how, t }),
    ...extra,
  });
  return { p, fired, finishes };
}
{
  const { s, src } = fakeSource();
  const { p, fired, finishes } = makePlayer(src);
  // 用音频时钟走完整段，60 fps
  s.audioT = 0;
  while (!p.done) {
    s.nowMs += 1000 / 60;
    s.audioT += 1 / 60;
    p.update();
  }
  assert.deepEqual(fired, ENDING_CUE_LIST.map(([id]) => id), 'cue 顺序');
  for (const l of p.log) {
    assert.ok(l.firedAt >= l.at && l.firedAt - l.at < 1 / 60 + 1e-6, `${l.id} 触发 ${l.firedAt} vs ${l.at}`);
    assert.equal(l.source, 'audio');
  }
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].how, 'end');
  assert.ok(finishes[0].t >= ENDING_T.end && finishes[0].t < ENDING_T.end + 0.02, '演出 106 s 结束');
  // 结束后不再触发
  p.update();
  assert.equal(finishes.length, 1);
  assert.equal(p.skip(), false, '结束后跳过无效');
  out.push(`播放器：${fired.length} 个 cue 按音频时钟触发（误差 < 1 帧），106 s 结束一次 ✓`);
}
{
  // 掉帧：后备时钟一帧 0.25 s（上限），音频为 null；一帧跨过多个 cue 也按序
  const { s, src } = fakeSource();
  const { p, fired } = makePlayer(src);
  p.clock.seek(29.9);
  s.nowMs += 250;
  p.update();
  s.nowMs += 250;
  p.update();
  assert.deepEqual(fired, ['lens', 'fog_open', 'silhouette', 'gaze']);
  assert.ok(p.log.every((l) => l.source === 'fallback'));
  out.push('后备时钟一帧跨多个 cue 按序 ✓');
}

// ---- 6. 跳过：只结束一次；跳过后不再触发 cue；结束页在终态之后
{
  const { s, src } = fakeSource();
  const { p, fired, finishes } = makePlayer(src);
  s.audioT = 0;
  for (let i = 0; i < 60 * 20; i++) {
    s.nowMs += 1000 / 60;
    s.audioT += 1 / 60;
    p.update();
  }
  assert.equal(p.skip(), true);
  assert.equal(p.skip(), false);
  assert.equal(finishes.length, 1);
  assert.equal(finishes[0].how, 'skip');
  const n = fired.length;
  s.audioT += 50;
  p.update();
  assert.equal(fired.length, n, '跳过后不再触发 cue');
  out.push('播放器跳过 ✓');
}

// ---- 7. 结束页时序模型：演出过程中绝不进结束页，结束（106 s）/ 跳过（+0.75 s 淡出）后才进
{
  function run(skipAt) {
    const { s, src } = fakeSource();
    let endPageAt = null;
    let skipFadeLeft = -1;
    let t = 0;
    const { p } = makePlayer(src, {
      onFinish: (how) => {
        if (how === 'end') endPageAt = t;
        else skipFadeLeft = ENDING_SKIP_FADE_SEC;
      },
    });
    s.audioT = 0;
    for (let i = 0; i < 60 * 120 && endPageAt === null; i++) {
      s.nowMs += 1000 / 60;
      s.audioT += 1 / 60;
      t = s.audioT;
      if (skipFadeLeft >= 0) {
        skipFadeLeft -= 1 / 60;
        if (skipFadeLeft <= 0) endPageAt = t;
        continue;
      }
      if (skipAt !== null && t >= skipAt && !p.done) p.skip();
      else p.update();
    }
    return endPageAt;
  }
  const full = run(null);
  assert.ok(full >= ENDING_T.end && full < ENDING_T.end + 0.05, `完整演出 ${full} s 进结束页`);
  assert.ok(full > OUTRO_CUT_SEC + 100, '不再 0:04 切结束页');
  const sk = run(10);
  near(sk, 10 + ENDING_SKIP_FADE_SEC, 0.04, '跳过 → 0.75 s 淡出 → 结束页');
  out.push(`结束页时序：完整 ${full.toFixed(2)} s / 10 s 跳过 → ${sk.toFixed(2)} s ✓`);
}

// ---- 8. SkipController：按住 1 s 触发、松开清零、提示时机、被挡清零、外部进度只显示
{
  const sc = new SkipController();
  let skipped = 0;
  const off = sc.register({ id: 'a', onSkip: () => skipped++ }, 0);
  // 提示：开始 1 s 内按键不出
  sc.anyKey(500);
  assert.equal(sc.hintVisible(600), false);
  sc.anyKey(SKIP_HINT_DELAY * 1000 + 10);
  assert.equal(sc.hintVisible(SKIP_HINT_DELAY * 1000 + 20), true);
  assert.equal(sc.hintVisible(SKIP_HINT_DELAY * 1000 + 10 + SKIP_HINT_SHOW * 1000 + 1), false);
  // 按 0.9 s 松开 → 不触发
  sc.press(5000);
  sc.update(5900);
  near(sc.progress(5900), 0.9, 1e-9, '圆环进度');
  sc.release();
  assert.equal(sc.update(6500), null);
  assert.equal(sc.progress(6500), 0);
  // 暂停中按住 → 清零
  sc.press(7000);
  sc.update(7500, true);
  sc.press(7600); // 键盘重复
  assert.equal(sc.update(8100), null, '被挡后重新计');
  sc.release();
  // 按住 1 s 触发一次，目标自动注销
  sc.press(9000);
  sc.press(9500); // 键盘重复不重新计时
  assert.equal(sc.update(9000 + SKIP_HOLD_SEC * 1000), 'a');
  assert.equal(skipped, 1);
  assert.equal(sc.id, null);
  assert.equal(sc.update(12000), null);
  assert.equal(skipped, 1);
  off(); // 已注销，不出错
  // 后注册顶掉前一个；旧注销函数不影响新的
  const offB = sc.register({ id: 'b', onSkip: () => {} }, 0);
  const offC = sc.register({ id: 'c', onSkip: () => {} }, 0);
  offB();
  assert.equal(sc.id, 'c');
  offC();
  assert.equal(sc.id, null);
  // 外部进度（建立镜头 skipHold）：只借圆环，不触发；active=false 不显示
  let ext = 0.4;
  let act = true;
  sc.register({ id: 'establishing', progress: () => ext, active: () => act }, 0);
  sc.press(0);
  assert.equal(sc.update(5000), null);
  near(sc.progress(5000), 0.4, 1e-9, '外部进度');
  act = false;
  assert.equal(sc.progress(5000), 0);
  assert.equal(sc.hintVisible(5000), false);
  ext = 0;
  out.push('跳过控制（按住 1 s / 松开 / 被挡 / 提示 / 外部进度）✓');
}

// ---- 9. 结尾时间轴 ↔ 结尾曲 CUES（producer 卡点表）
{
  const want = { lens: 4, fog_open: 14, silhouette: 24, gaze: 30, no_answer: 50, sit_write: 58, journal: 66, pull_back: 74, fade_out: 95 };
  const list = Object.fromEntries(ENDING_CUE_LIST);
  for (const [k, v] of Object.entries(want)) {
    assert.equal(list[k], v, `cue ${k}`);
    assert.equal(ENDING_CUES[k], v, `ENDING_CUES ${k}`);
  }
  assert.equal(ENDING_T.end, ENDING_CUES.silence);
  assert.equal(ENDING_T.end, 106);
  assert.equal(ENDING_T.lens, OUTRO_CUT_SEC);
  assert.ok(IGNITE_MONO_DELAY + IGNITE_MONO_SEC <= ENDING_T.lens, '点灯独白在 0:04 前消失');
  // 字幕
  const subs = Object.fromEntries(ENDING_SUBTITLES.map((c) => [c.id, c]));
  assert.equal(subs['ch1.outro.no_answer'].at, 50);
  assert.equal(subs['ch1.outro.journal_entry'].at, 66);
  assert.equal(text('ch1.outro.no_answer'), '那边没有亮。');
  assert.ok(text('ch1.outro.journal_entry').length > 0);
  for (const c of ENDING_SUBTITLES) assert.ok(c.at + c.duration <= ENDING_T.fadeOut, `${c.id} 在淡出前结束`);
  // 父亲 = 汐眺望第 2 循环第 0 帧，同帧起
  assert.equal(ENDING_T.fatherIn, ENDING_T.gaze + GAZE_LOOP_SEC);
  const xp = xiPoseAt(ENDING_T.fatherIn);
  assert.equal(xp.clip, 'xi-stand-gaze');
  near(xp.time, 0, 1e-9, '父亲入场时汐 gaze 第 0 帧');
  assert.ok(ENDING_T.fatherOut < ENDING_T.noAnswer, '父亲在「那边没有亮。」前离场');
  assert.equal(fatherOpacityAt(ENDING_T.fatherIn - 0.01), 0);
  assert.ok(fatherOpacityAt(ENDING_T.fatherIn + 2) > 0.5);
  assert.equal(fatherOpacityAt(ENDING_T.fatherOut), 0);
  assert.equal(xiPoseAt(ENDING_T.sitWrite).clip, 'xi-sit-write');
  assert.equal(xiPoseAt(10), null);
  // 渐变
  assert.equal(fogOpenAt(13.9), 0);
  assert.equal(fogOpenAt(30), 1);
  assert.equal(silhouetteAt(23.9), 0);
  assert.equal(silhouetteAt(29), 1);
  assert.equal(fadeAt(94.9), 0);
  assert.equal(fadeAt(ENDING_T.black), 1);
  out.push('结尾时间轴 ↔ CUES（4/14/24/30/50/58/66/74/95/106）✓');
}

// ---- 10. 镜头分段：硬切、段内连续
{
  const k = (x, z) => ({ position: new THREE.Vector3(x, 0, z), lookAt: new THREE.Vector3(x, 0, z - 1), fov: 50 });
  const shots = [
    { name: 'a', start: 4, end: 14, from: k(0, 0), to: k(10, 0), ease: 'linear' },
    { name: 'b', start: 14, end: 24, from: k(100, 0), to: k(100, 10) },
  ];
  const pose = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), fov: 0 };
  assert.equal(shotAt(shots, 2).name, 'a');
  assert.equal(shotAt(shots, 13.99).name, 'a');
  assert.equal(shotAt(shots, 14).name, 'b');
  sampleShots(shots, 9, pose);
  near(pose.position.x, 5, 1e-9, '段内线性');
  sampleShots(shots, 14, pose);
  near(pose.position.x, 100, 1e-9, '14 s 硬切');
  sampleShots(shots, 30, pose);
  near(pose.position.z, 10, 1e-9, '最后一段停在 end');
  out.push('镜头分段 ✓');
}


// ---- 11. 裁定 25 ③ 父亲幽灵：半透明 + 深度预写
{
  const bones = [new THREE.Bone(), new THREE.Bone()];
  bones[0].add(bones[1]);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const n = geo.attributes.position.count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4));
  const skinned = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ name: 'cloak' }));
  skinned.add(bones[0]);
  skinned.bind(new THREE.Skeleton(bones));
  const plain = new THREE.Mesh(geo, [new THREE.MeshStandardMaterial({ name: 'a' }), new THREE.MeshStandardMaterial({ name: 'b' })]);
  const root = new THREE.Group();
  root.add(skinned, plain);
  const shared = skinned.material;
  const g = makeGhost(root, 0);
  assert.equal(g.prepasses.length, 2, '每个网格一个深度预写');
  assert.equal(g.materials.length, 3);
  assert.notEqual(skinned.material, shared, '克隆，不改共享材质');
  for (const m of g.materials) assert.ok(m.transparent && !m.depthWrite && m.depthFunc === THREE.LessEqualDepth && m.colorWrite);
  const pre = g.prepasses[0];
  assert.ok(pre.isSkinnedMesh && pre.skeleton === skinned.skeleton && pre.parent === skinned, '预写跟同一副骨骼、挂在原网格下');
  assert.ok(pre.bindMatrix.equals(skinned.bindMatrix));
  for (const p of g.prepasses) for (const m of [p.material].flat()) assert.ok(m.transparent && m.depthWrite && !m.colorWrite, '预写只写深度');
  assert.ok(pre.renderOrder === GHOST_RENDER_ORDER && skinned.renderOrder === GHOST_RENDER_ORDER + 1, '透明队列里预写先画');
  assert.ok(!skinned.castShadow);
  assert.ok(g.prepasses.every((p) => !p.visible), '不透明度 0：预写关');
  g.setOpacity(0.55);
  assert.ok(g.materials.every((m) => m.opacity === 0.55) && g.prepasses.every((p) => p.visible), '淡入：预写开');
  g.setOpacity(fatherOpacityAt(ENDING_T.fatherOut - 0.05));
  assert.ok(g.opacity > 0 && g.prepasses.every((p) => p.visible), '淡出途中预写仍开（内层不透出）');
  g.setOpacity(0);
  assert.ok(g.prepasses.every((p) => !p.visible), '淡出到 0：预写关');
  g.prepassEnabled = false;
  g.setOpacity(0.55);
  assert.ok(g.prepasses.every((p) => !p.visible), 'prepassEnabled=false（对比用）');
  // 再调一次不会给预写网格再挂预写
  assert.equal(makeGhost(root, 0).prepasses.length, 2);
  out.push('父亲幽灵深度预写（同骨骼子网格、colorWrite=false、renderOrder 先后、淡入淡出开关）✓');
}

// ---- 12b. 1031 制作人裁定：镜头 02（far-exterior，lens → fog_open）灯束加强，倍率开关落在两个剪辑点，段内恒定
{
  assert.deepEqual([...BEAM_BOOST_02.range], [ENDING_T.lens, ENDING_T.fogOpen]);
  assert.ok(BEAM_BOOST_02.k > 1 && BEAM_BOOST_02.k <= 3, '适度加强（不抢剪影）');
  assert.equal(beamBoostAt(ENDING_T.lens - 0.001), 1, '点灯后玩家镜头不变');
  for (const t of [ENDING_T.lens, 6, 9.5, ENDING_T.fogOpen - 0.001]) assert.equal(beamBoostAt(t), BEAM_BOOST_02.k, `t=${t} 段内恒定`);
  for (const t of [ENDING_T.fogOpen, ENDING_T.silhouette + 1, 36, 51.2, 91]) assert.equal(beamBoostAt(t), 1, `t=${t} 别的镜头不变`);
  const b = new LampBeam(0xffb25e, { glow: new THREE.Texture() });
  b.setOn(true);
  b.update(10);
  const glow0 = b.glow.material.uniforms.uIntensity.value;
  b.setBoost(BEAM_BOOST_02.k);
  b.update(0.016);
  assert.ok(Math.abs(b.material.uniforms.uStrength.value - LAMP_BEAM.strength * BEAM_BOOST_02.k) < 1e-9);
  assert.equal(b.glow.material.uniforms.uIntensity.value, glow0, '辉光不跟倍率走（07 不变）');
  b.setBoost(1);
  assert.equal(b.material.uniforms.uStrength.value, LAMP_BEAM.strength);
  out.push(`镜头 02 灯束 ×${BEAM_BOOST_02.k}（${ENDING_T.lens}–${ENDING_T.fogOpen} s，切点开关，辉光不变）✓`);
}

// ---- 12. 裁定 25 ② 04 镜头关灯室玻璃反射
{
  assert.deepEqual([...GLASS_REFLECTION_OFF], [ENDING_T.regaze, ENDING_T.sitWrite]);
  assert.ok(GLASS_REFLECTION_OFF[0] <= ENDING_T.noAnswer && ENDING_T.noAnswer + 3 <= GLASS_REFLECTION_OFF[1], '「那边没有亮。」整句在关的区间里');
  assert.equal(glassReflectionAt(ENDING_T.regaze - 0.001), 1);
  assert.equal(glassReflectionAt(ENDING_T.regaze), 0);
  assert.equal(glassReflectionAt(51.2), 0);
  assert.equal(glassReflectionAt(ENDING_T.sitWrite), 1);
  assert.equal(glassReflectionAt(ENDING_T.gaze + 1), 1, '30 s 眺望镜头不受影响');
  // 开关落在镜头切点（regaze 段的起止 = 42 / 58，见 levels/s3/ending.ts buildShots）
  const glass = new THREE.MeshStandardMaterial({ name: 'mat-env-lighthouse-weather' });
  const stone = new THREE.MeshStandardMaterial({ name: 'mat-env-lighthouse-ch1-wall' });
  const root = new THREE.Group();
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), [stone, glass]), new THREE.Mesh(new THREE.BoxGeometry(), glass));
  const gate = makeSpecularGate(root, /^mat-env-lighthouse-weather/);
  assert.deepEqual(gate.materials, [glass], '只挂玻璃材质（去重）');
  const shader = { uniforms: {}, vertexShader: '', fragmentShader: ShaderLib.physical.fragmentShader };
  glass.onBeforeCompile(shader, null);
  assert.ok(shader.fragmentShader.includes(SPECULAR_GATE_GLSL) && shader.uniforms.uSpecGate === gate.uniform, '镜面乘开关');
  assert.ok(shader.fragmentShader.indexOf('uSpecGate;') < shader.fragmentShader.indexOf('totalSpecular'));
  assert.ok(glass.customProgramCacheKey().includes('specgate'));
  gate.value = 0;
  assert.equal(shader.uniforms.uSpecGate.value, 0, 'uniform 开关不重新编译');
  assert.equal(makeSpecularGate(null, /x/).materials.length, 0, 'art=0 没有玻璃');
  out.push('04 镜头关玻璃反射（42–58 s = regaze 段，镜面 uniform 开关）✓');
}

{
  // 裁定 25 程序 P2：05 过肩机位只跟日志节点 + 坐写站位走（平移 / 绕 Y 旋转不变），不含世界坐标
  const j = [1.2, 22.68, -0.4], sit = [0.7, 22.0, -0.1];
  const a = overShoulderKeys(j, sit);
  const rel = (p) => [p[0] - j[0], p[1] - j[1], p[2] - j[2]];
  const f = a.basis.f, r = a.basis.r;
  const dec = (p) => { const d = rel(p); return { back: -(d[0] * f[0] + d[2] * f[2]), side: d[0] * r[0] + d[2] * r[2], up: d[1] }; };
  const near = (x, y, m) => assert.ok(Math.abs(x - y) < 1e-9, m + ' ' + x + ' vs ' + y);
  for (const k of ['from', 'to']) {
    const d = dec(a[k].position);
    near(d.back, OVER_SHOULDER[k].back, k + '.back');
    near(d.side, OVER_SHOULDER[k].side, k + '.side');
    near(d.up, OVER_SHOULDER[k].up, k + '.up');
    assert.equal(a[k].fov, OVER_SHOULDER[k].fov);
  }
  near(dec(a.from.lookAt).up, OVER_SHOULDER.look.up, 'look.up');
  // 整套桌椅平移 + 绕 Y 转 90°：机位跟着转
  const rot = (p) => [-(p[2]) + 5, p[1] + 0.3, p[0] - 2];
  const b = overShoulderKeys(rot(j), rot(sit));
  for (const k of ['from', 'to']) rot(a[k].position).forEach((x, i) => near(b[k].position[i], x, k + ' 平移旋转不变 #' + i));
  near(Math.hypot(...a.basis.f), 1, 'f 单位');
  out.push('05 过肩机位相对日志 socket + 坐写站位（平移 / 旋转不变，参数可逆读回）✓');
}

console.log(`verify-cutscene：\n  ${out.join('\n  ')}`);
