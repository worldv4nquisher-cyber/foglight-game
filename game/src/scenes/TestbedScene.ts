import * as THREE from 'three';
import { BaseScene } from './BaseScene';
import type { Game } from '@/core/Game';
import { getAtmosphere } from '@/config/atmosphere';
import { EntityManager } from '@/entities/EntityManager';
import { Entity } from '@/entities/Entity';
import { TraversalLink } from '@/entities/components/TraversalLink';
import { createPlayer, debugPlayerLine, type PlayerRig } from '@/entities/createPlayer';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem, CameraTrack, collectIndoorVolumes } from '@/systems/CameraFollowSystem';
import { ViewpointTarget } from '@/entities/components/ViewpointTarget';
import { buildTestCourse, type TestCourse } from '@/world/testCourse';
import { InteractionSystem, actorFromRig } from '@/systems/interaction/InteractionSystem';
import { buildInteractionSamples, type InteractionSamples } from '@/world/interactionSamples';
import { circleZone, type HintSystem } from '@/systems/HintSystem';
import { createSceneHints } from './sceneHints';
import { buildTideTestArea, type TideTestArea } from '@/world/tideTestArea';
import { TideSet } from '@/systems/tide/TideController';
import { bindSfxFallback, recallToSafePoint } from '@/systems/tide/tideScene';
import { buildBeamTestArea, type BeamTestArea } from '@/world/beamTestArea';
import { beamDebugEnabled } from '@/config/debug';

/**
 * 角色控制器 / 相机测试场地（v0.1-002、003）：地址栏加 ?scene=testbed 进入（开发服务器 / 测试构建；batch26 起生产构建进不去）。不存档。
 * 30° / 45° 坡、0.25 / 0.4 m 台阶、螺旋楼梯、长墙、可开关闸门（G）、升降台、自动跨越点、强制送回（T）。
 * 相机（003）：东南角带窄门的小屋（室内距离 ≤ 2 m）、西侧测试机关（004 起是 puzzle 交互：E 进机位、右键 / Tab 退出）、
 * 观察点地面标记（站上去看向立柱顶，F4 显示对准度）、C 播放 5 s 测试镜头。
 * 碰撞网格走与美术模型相同的 -collider / -wall 命名约定（addFromModel，注册后隐藏），
 * 这里另外放一份可见的灰盒外观，方便看清楚。
 * 交互（004）：x = 16 一带的「交互走廊」放了八种交互各一例（world/interactionSamples.ts）。
 * 潮汐（011）：起点往南坡道上岸台（world/tideTestArea.ts）：潮汐钟、礁石路、沙洲浮台、刻度柱；Y 键遥控切潮（只在测试场地）。
 */
export class TestbedScene extends BaseScene {
  readonly name = 'testbed';
  override usePostFX = true;
  readonly physics = new PhysicsSystem();
  readonly course: TestCourse;
  rig!: PlayerRig;
  link!: TraversalLink;
  private entities = new EntityManager(this.scene);
  readonly cameraFollow: CameraFollowSystem;
  viewpoint!: ViewpointTarget;
  interaction!: InteractionSystem;
  samples!: InteractionSamples;
  /** 007 测试谜题：test-bell（钟旁，敲钟 = 解开）、test-steps（油阀旁，分步骤：拧开油阀 = 完成第 1 步） */
  hints!: HintSystem;
  /** 011 潮汐区 */
  readonly tides = new TideSet();
  tideArea!: TideTestArea;
  beamArea!: BeamTestArea;
  private tipMat: THREE.MeshBasicMaterial | null = null;
  private liftT = 0;
  private liftBaseY = 0;
  private gateVisual: THREE.Object3D | null = null;
  private liftVisual: THREE.Object3D | null = null;

  constructor(game: Game) {
    super(game);
    this.atmosphere = getAtmosphere();
    this.cameraFollow = new CameraFollowSystem(this.camera, game.input, {
      physics: this.physics,
      events: game.events,
      isRunning: () => this.rig.controller.running,
      autoRecenter: () => game.settings.all.autoRecenter,
    });
    this.course = buildTestCourse(new THREE.MeshStandardMaterial({ color: 0x8a8f90, roughness: 0.9 }));
  }

  override enter(): void {
    const a = this.atmosphere!;
    this.scene.background = new THREE.Color(a.fogColor);
    this.scene.fog = new THREE.Fog(a.fogColor, 30, 90);
    this.scene.add(new THREE.HemisphereLight(0xc8d0d8, 0x3a3f44, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(8, 14, 6);
    this.scene.add(sun);

    // 可见外观：克隆一份碰撞网格（碰撞网格本身注册后会被隐藏）
    const visual = this.course.root.clone(true);
    visual.name = 'test-course-visual';
    visual.traverse((o) => {
      o.name = o.name.replace(/-(collider|wall)/, '-visual');
      if (/-indoor$/.test(o.name)) o.visible = false;
      if (o instanceof THREE.Mesh && /pit-visual|outer-visual/.test(o.name)) {
        // 空气墙画成半透明
        o.material = new THREE.MeshBasicMaterial({ color: 0x6aa0c0, transparent: true, opacity: 0.12, depthWrite: false });
      }
    });
    this.scene.add(this.course.root, visual);
    this.gateVisual = visual.getObjectByName('gate-visual') ?? null;
    this.liftVisual = visual.getObjectByName('lift-visual') ?? null;
    this.physics.addFromModel(this.course.root);
    this.cameraFollow.indoorVolumes = collectIndoorVolumes(this.course.root);
    this.liftBaseY = this.course.lift.position.y;

    const anchors = this.course.anchors;
    this.rig = createPlayer(this.game, this.physics, anchors.spawn, () => this.cameraFollow.yaw);
    this.entities.add(this.rig.entity);
    const linkEntity = new Entity('link-gap');
    this.link = linkEntity.add(
      new TraversalLink({ start: anchors.link.start, end: anchors.link.end, path: [anchors.link.mid], prompt: 'E　跨过沟' }),
    );
    this.entities.add(linkEntity);
    this.rig.controller.links.push(this.link);
    this.physics.onFallOut = () => void this.rig.controller.teleportTo(anchors.spawn);

    this.cameraFollow.target = this.rig.entity.object3D;
    this.cameraFollow.yaw = 0;
    this.cameraFollow.pitch = -0.3;
    this.cameraFollow.recommended = { yaw: 0, pitch: -0.3 };
    this.buildCameraTests();
    this.interaction = new InteractionSystem({
      events: this.game.events,
      input: this.game.input,
      physics: this.physics,
      actor: actorFromRig(this.rig),
      puzzleActor: this.rig.visual,
      camera: this.camera,
      cameraFollow: this.cameraFollow,
      hud: this.game.ui.hud,
      // inspect → 字幕（汐的一句描述，text-ch1 §0.10）；read → 阅读界面（首次阅读写进日志）
      presenters: {
        say: (id) => this.game.ui.subtitles.play([id]),
        read: (id) => this.game.ui.reader.open(id),
      },
      fallbackPrompt: () => this.rig.controller.nearLink?.prompt ?? null,
      linkPriority: () => this.rig?.controller.nearLink?.priority ?? null,
    });
    this.samples = buildInteractionSamples({
      scene: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      events: this.game.events,
      mechanism: anchors.mechanism,
      beep: (f, d) => this.game.audio.beep(f, d, 'sine', 0.04),
    });
    this.tideArea = buildTideTestArea({
      scene: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      events: this.game.events,
      waterColor: a.waterColor,
    });
    this.tides.add(this.tideArea.tide);
    // 光路（012）：起点西南 x −19…−15、z 4…16：风灯灯台 → 镜 A → 镜 B → 光感锁；云缝天光 → 点火口（U 开油阀）
    this.beamArea = buildBeamTestArea({
      scene: this.scene,
      physics: this.physics,
      interaction: this.interaction,
      events: this.game.events,
      debug: beamDebugEnabled,
    });
    this.tides.onRecall = (zone) => recallToSafePoint(this.game, this.rig, zone);
    this.cleanups.push(
      () => this.interaction.dispose(),
      () => this.cameraFollow.dispose(),
      () => this.tideArea.bell.dispose(),
      () => this.beamArea.dispose(),
      bindSfxFallback(this.game.events, this.game.audio, (id) => this.game.assets.getAudio(id)),
    );
    this.buildHintTests();

    const { ui } = this.game;
    ui.hud.show();
    ui.hud.setLocation('测试场地 · 角色控制器');
    ui.hud.setHint(
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Shift</kbd> 小跑　<kbd>E</kbd> 交互 / 跨越（东侧 x = 16 交互走廊）　' +
        '<kbd>G</kbd> 开关闸门　<kbd>T</kbd> 送回起点（黑场）　<kbd>C</kbd> 测试镜头　<kbd>右键</kbd> 观察　<kbd>F4</kbd> 调试读数　' +
        '潮汐区在起点往南坡道上（<kbd>E</kbd> 敲钟，<kbd>Y</kbd> 遥控切潮）　' +
        '光路区在西南（机关台 <kbd>E</kbd> 转镜，<kbd>U</kbd> 开关油阀，点火口 <kbd>E</kbd> 点灯（<kbd>I</kbd> 调试：可点灯时自动点灯），<kbd>O</kbd> 灯台冷暖）',
    );

    // 测试快捷键（只在这个场景）：G 闸门、T 送回
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || this.game.isPaused) return;
      if (e.code === 'KeyG') this.toggleGate();
      else if (e.code === 'KeyT') void this.rig.controller.teleportTo(anchors.spawn);
      else if (e.code === 'KeyY') this.tideArea.bell.ring();
      else if (e.code === 'KeyU') this.beamArea.setOil(!this.beamArea.oilOpen);
      else if (e.code === 'KeyI') this.beamArea.autoIgnite = !this.beamArea.autoIgnite;
      else if (e.code === 'KeyO') {
        const lamp = this.beamArea.lamp;
        this.game.events.emit('beam:setColor', { id: lamp.id, color: lamp.color === 'warm' ? 'coldWhite' : 'warm' });
      }
      else if (e.code === 'KeyC' && this.game.input.context === 'explore') void this.playTestCutscene();
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') {
      Object.assign(window, { __testbed: this });
    }
  }

  /**
   * 007 测试谜题（两块地面圆圈）：
   * - test-bell：钟旁 (15.5, -2) 半径 1.4 m，文案用谜题 1，二级高亮钟；敲钟（interact:used sample-bell）= 解开。
   * - test-steps：油阀旁 (15.5, 1) 半径 1.2 m，文案用谜题 5 的四个步骤；拧开油阀 = 完成 valve，之后二、三级换成 window_mirror。
   */
  private buildHintTests(): void {
    const [hints, unbind] = createSceneHints(this.game, this.interaction, this.scene);
    this.hints = hints;
    hints.add({ id: 'test-bell', zone: circleZone({ x: 15.5, z: -2 }, 1.4), l1: 'ch1.hint.p1.l1', l2: 'ch1.hint.p1.l2', l3: 'ch1.hint.p1.l3', highlight: ['sample-bell'] });
    hints.add({
      id: 'test-steps',
      zone: circleZone({ x: 15.5, z: 1 }, 1.2),
      l1: 'ch1.hint.p5.l1',
      steps: [
        { id: 'valve', l2: 'ch1.hint.p5.valve.l2', l3: 'ch1.hint.p5.valve.l3', highlight: ['sample-valve'] },
        { id: 'window_mirror', l2: 'ch1.hint.p5.window_mirror.l2', l3: 'ch1.hint.p5.window_mirror.l3', highlight: ['sample-stand-b'] },
        { id: 'mid_a', l2: 'ch1.hint.p5.mid_a.l2', l3: 'ch1.hint.p5.mid_a.l3', highlight: ['sample-mechanism'] },
        { id: 'mid_b', l2: 'ch1.hint.p5.mid_b.l2', l3: 'ch1.hint.p5.mid_b.l3', highlight: ['sample-mechanism'] },
      ],
    });
    // 012 光路：机关台前 (−16.5, 5.5) 半径 1.6 m，文案用谜题 3（镜子 + 锁），二级高亮机关台；光感锁触发 = 解开
    hints.add({ id: 'test-beam', zone: circleZone({ x: -16.5, z: 5.5 }, 1.6), l1: 'ch1.hint.p3.l1', l2: 'ch1.hint.p3.l2', l3: 'ch1.hint.p3.l3', highlight: ['beam-console'] });
    const markMat = new THREE.MeshBasicMaterial({ color: 0xd8b070, transparent: true, opacity: 0.35 });
    for (const [x, z, r, name] of [[15.5, -2, 1.4, 'hint-zone-test-bell'], [15.5, 1, 1.2, 'hint-zone-test-steps'], [-16.5, 5.5, 1.6, 'hint-zone-test-beam']] as const) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.05, r, 48), markMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.012, z);
      ring.name = name;
      this.scene.add(ring);
    }
    this.cleanups.push(
      unbind,
      this.game.events.on('interact:used', ({ id }) => {
        if (id === 'sample-bell') hints.solve('test-bell');
        if (id === 'sample-valve') hints.completeStep('test-steps', 'valve');
      }),
      this.game.events.on('receiver:activated', ({ id }) => {
        if (id === 'beam-lock') hints.solve('test-beam');
      }),
    );
  }

  /** 相机测试物：机关底座外观、观察点地面标记与目标立柱 */
  private buildCameraTests(): void {
    const a = this.course.anchors;
    const markMat = new THREE.MeshBasicMaterial({ color: 0xe0c070, transparent: true, opacity: 0.6 });
    const ring = new THREE.Mesh(new THREE.RingGeometry(a.viewpoint.radius - 0.08, a.viewpoint.radius, 48), markMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(a.viewpoint.center).setY(0.01);
    ring.name = 'viewpoint-marker';
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, a.viewpoint.target.y, 12), new THREE.MeshStandardMaterial({ color: 0x9aa0a4 }));
    post.position.set(a.viewpoint.target.x, a.viewpoint.target.y / 2, a.viewpoint.target.z);
    const tipMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.15 });
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), tipMat);
    tip.position.copy(a.viewpoint.target);
    tip.name = 'viewpoint-tip';
    this.scene.add(ring, post, tip);

    const vpEntity = new Entity('viewpoint');
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    this.viewpoint = vpEntity.add(
      new ViewpointTarget({
        center: a.viewpoint.center,
        radius: a.viewpoint.radius,
        target: a.viewpoint.target,
        view: () => ({ position: cam.position, forward: cam.getWorldDirection(fwd) }),
        player: () => this.rig.body.position,
      }),
    );
    this.entities.add(vpEntity);
    // 线索随对准度变清晰（谜题 4 的做法：材质读 alignment）
    this.tipMat = tipMat;
  }

  /** 测试机关（004 起是 puzzle 交互）：直接进入 / 退出，测试用 */
  enterMechanism(): void {
    const it = this.interaction.get('sample-mechanism');
    if (it && this.interaction.actionKind === 'none') this.interaction.trigger(it);
  }

  exitMechanism(): void {
    this.interaction.puzzle.exit();
  }

  /** C：5 s 测试镜头（绕起点半圈），结束 0.8 s 交还 */
  playTestCutscene(): Promise<void> {
    const c = this.rig.body.position.clone();
    const look = c.clone().setY(c.y + 1);
    const keys = [0, 1, 2, 3, 4, 5].map((i) => {
      const ang = (i / 5) * Math.PI;
      return { time: i, position: new THREE.Vector3(c.x + Math.sin(ang) * 6, 3 + i * 0.3, c.z + Math.cos(ang) * 6), lookAt: look };
    });
    return this.cameraFollow.playCutscene(new CameraTrack({ name: 'testbed-orbit', keys, duration: 5 }));
  }

  toggleGate(): boolean {
    const c = this.physics.colliders.find((x) => x.name === 'gate-collider');
    if (!c) return false;
    c.enabled = !c.enabled;
    if (this.gateVisual) this.gateVisual.visible = c.enabled;
    return c.enabled;
  }

  override fixedUpdate(dt: number): void {
    if (!this.rig) return; // enter() 之前（场景切换的那一帧）不跑逻辑
    // 升降台：0 → 1.2 m 往复，周期 6 s
    this.liftT += dt;
    const lift = this.course.lift;
    lift.position.y = this.liftBaseY + (1 - Math.cos((this.liftT / 6) * Math.PI * 2)) * 0.6;
    lift.updateMatrixWorld();
    if (this.liftVisual) this.liftVisual.position.y = lift.position.y;

    // 交互先于角色控制器：有交互候选时 E 归交互，跨越点只在没有候选时生效
    this.interaction.fixedUpdate(dt);
    this.entities.fixedUpdate(dt);
    this.tides.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
    // 光路在物理之后：本步的镜子转角 / 碰撞体开关都已生效
    this.beamArea.fixedUpdate(dt);
    this.tides.checkRecall({ position: this.rig.body.position, onGround: this.rig.body.body.onGround, busy: this.rig.controller.busy });
    this.hints.fixedUpdate(dt, this.rig.body.position);
  }

  override update(dt: number, alpha: number): void {
    if (!this.rig) return;
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    this.interaction.update(dt);
    this.samples.update(dt);
    this.tideArea.update(dt);
    this.beamArea.update(dt);
    // 观察点在相机更新之后再算一次（用本帧相机朝向）
    this.viewpoint.evaluate();
    if (this.tipMat) this.tipMat.opacity = 0.15 + 0.85 * this.viewpoint.alignment;
    if (this.game.ui.debug.visible) {
      this.game.ui.debug.set('角色', debugPlayerLine(this.rig, this.physics));
      this.game.ui.debug.set('相机', this.cameraFollow.debugLine());
      this.game.ui.debug.set('提示', this.hints.debugLine());
      const r = this.tideArea.raft;
      this.game.ui.debug.set('潮汐', `${this.tides.debugLine()} · 浮台 ${r.state}${r.inAnchor ? '（锚位）' : ''}`);
      this.game.ui.debug.set('光路', this.beamArea.tracer.debugLine());
      const v = this.viewpoint;
      this.game.ui.debug.set('观察点', v.inRegion ? `对准度 ${v.alignment.toFixed(2)} · 偏差 ${v.angleDeg.toFixed(1)}°` : '不在观察点');
    }
  }

  override exit(): void {
    this.interaction?.cancel();
    this.game.ui.hud.hide();
    this.game.ui.hud.setPrompt(null);
    this.game.ui.fade.set(0);
  }

  override dispose(): void {
    this.interaction?.cancel();
    this.entities.clear();
    this.physics.clear();
    super.dispose();
  }
}
