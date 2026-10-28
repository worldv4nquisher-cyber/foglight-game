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

/**
 * 角色控制器 / 相机测试场地（v0.1-002、003）：地址栏加 ?scene=testbed 进入。不存档。
 * 30° / 45° 坡、0.25 / 0.4 m 台阶、螺旋楼梯、长墙、可开关闸门（G）、升降台、自动跨越点、强制送回（T）。
 * 相机（003）：东南角带窄门的小屋（室内距离 ≤ 2 m）、西侧测试机关（E 进机位、右键 / Tab 退出）、
 * 观察点地面标记（站上去看向立柱顶，F4 显示对准度）、C 播放 5 s 测试镜头。
 * 碰撞网格走与美术模型相同的 -collider / -wall 命名约定（addFromModel，注册后隐藏），
 * 这里另外放一份可见的灰盒外观，方便看清楚。
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
  private popPuzzle: (() => void) | null = null;
  private tipMat: THREE.MeshBasicMaterial | null = null;
  private liftT = 0;
  private liftBaseY = 0;
  private prompt: string | null = null;
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
    this.cleanups.push(
      () => this.exitMechanism(),
      () => this.cameraFollow.dispose(),
    );
    this.buildCameraTests();

    const { ui } = this.game;
    ui.hud.show();
    ui.hud.setLocation('测试场地 · 角色控制器');
    ui.hud.setHint(
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Shift</kbd> 小跑　<kbd>E</kbd> 跨越　' +
        '<kbd>G</kbd> 开关闸门　<kbd>T</kbd> 送回起点（黑场）　<kbd>C</kbd> 测试镜头　<kbd>右键</kbd> 观察　<kbd>F4</kbd> 调试读数',
    );

    // 测试快捷键（只在这个场景）：G 闸门、T 送回
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || this.game.isPaused) return;
      if (e.code === 'KeyG') this.toggleGate();
      else if (e.code === 'KeyT') void this.rig.controller.teleportTo(anchors.spawn);
      else if (e.code === 'KeyC' && this.game.input.context === 'explore') void this.playTestCutscene();
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) {
      Object.assign(window, { __testbed: this });
    }
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

  /** 进入 / 退出测试机关（v0.1-003：E 进入，右键或 Tab 退出） */
  enterMechanism(): void {
    if (this.popPuzzle) return;
    this.popPuzzle = this.game.input.pushContext('puzzle');
    this.rig.controller.locked = true;
    this.cameraFollow.enterPuzzleView(this.course.anchors.mechanism.cam);
  }

  exitMechanism(): void {
    if (!this.popPuzzle) return;
    this.popPuzzle();
    this.popPuzzle = null;
    this.rig.controller.locked = false;
    this.cameraFollow.exitPuzzleView();
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

  private updateMechanism(): void {
    const input = this.game.input;
    if (this.popPuzzle) {
      if (input.consumePressed('exitPuzzle')) this.exitMechanism();
      return;
    }
    const near = this.rig.body.position.distanceTo(this.course.anchors.mechanism.stand) < 1;
    if (near && input.context === 'explore' && input.consumePressed('interact')) this.enterMechanism();
  }

  toggleGate(): boolean {
    const c = this.physics.colliders.find((x) => x.name === 'gate-collider');
    if (!c) return false;
    c.enabled = !c.enabled;
    if (this.gateVisual) this.gateVisual.visible = c.enabled;
    return c.enabled;
  }

  override fixedUpdate(dt: number): void {
    // 升降台：0 → 1.2 m 往复，周期 6 s
    this.liftT += dt;
    const lift = this.course.lift;
    lift.position.y = this.liftBaseY + (1 - Math.cos((this.liftT / 6) * Math.PI * 2)) * 0.6;
    lift.updateMatrixWorld();
    if (this.liftVisual) this.liftVisual.position.y = lift.position.y;

    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();

    this.updateMechanism();
    const near = this.rig.controller.nearLink;
    const nearMech = !this.popPuzzle && this.rig.body.position.distanceTo(this.course.anchors.mechanism.stand) < 1;
    const prompt = near ? near.prompt : nearMech ? 'E　查看机关' : this.popPuzzle ? '右键 / Tab　离开机关' : null;
    if (prompt !== this.prompt) {
      this.prompt = prompt;
      this.game.ui.hud.setPrompt(prompt);
    }
  }

  override update(dt: number, alpha: number): void {
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    // 观察点在相机更新之后再算一次（用本帧相机朝向）
    this.viewpoint.evaluate();
    if (this.tipMat) this.tipMat.opacity = 0.15 + 0.85 * this.viewpoint.alignment;
    if (this.game.ui.debug.visible) {
      this.game.ui.debug.set('角色', debugPlayerLine(this.rig, this.physics));
      this.game.ui.debug.set('相机', this.cameraFollow.debugLine());
      const v = this.viewpoint;
      this.game.ui.debug.set('观察点', v.inRegion ? `对准度 ${v.alignment.toFixed(2)} · 偏差 ${v.angleDeg.toFixed(1)}°` : '不在观察点');
    }
  }

  override exit(): void {
    this.game.ui.hud.hide();
    this.game.ui.hud.setPrompt(null);
    this.game.ui.fade.set(0);
  }

  override dispose(): void {
    this.entities.clear();
    this.physics.clear();
    super.dispose();
  }
}
