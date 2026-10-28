import * as THREE from 'three';
import { BaseScene } from './BaseScene';
import type { Game } from '@/core/Game';
import { getAtmosphere } from '@/config/atmosphere';
import { EntityManager } from '@/entities/EntityManager';
import { Entity } from '@/entities/Entity';
import { TraversalLink } from '@/entities/components/TraversalLink';
import { createPlayer, debugPlayerLine, type PlayerRig } from '@/entities/createPlayer';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { buildTestCourse, type TestCourse } from '@/world/testCourse';

/**
 * 角色控制器测试场地（v0.1-002）：地址栏加 ?scene=testbed 进入。不存档。
 * 30° / 45° 坡、0.25 / 0.4 m 台阶、螺旋楼梯、长墙、可开关闸门（G）、升降台、自动跨越点、强制送回（T）。
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
  private cameraFollow: CameraFollowSystem;
  private liftT = 0;
  private liftBaseY = 0;
  private prompt: string | null = null;
  private gateVisual: THREE.Object3D | null = null;
  private liftVisual: THREE.Object3D | null = null;

  constructor(game: Game) {
    super(game);
    this.atmosphere = getAtmosphere();
    this.cameraFollow = new CameraFollowSystem(this.camera, game.input);
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
      if (o instanceof THREE.Mesh && /pit-visual|outer-visual/.test(o.name)) {
        // 空气墙画成半透明
        o.material = new THREE.MeshBasicMaterial({ color: 0x6aa0c0, transparent: true, opacity: 0.12, depthWrite: false });
      }
    });
    this.scene.add(this.course.root, visual);
    this.gateVisual = visual.getObjectByName('gate-visual') ?? null;
    this.liftVisual = visual.getObjectByName('lift-visual') ?? null;
    this.physics.addFromModel(this.course.root);
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
    this.cameraFollow.pitch = 0.3;

    const { ui } = this.game;
    ui.hud.show();
    ui.hud.setLocation('测试场地 · 角色控制器');
    ui.hud.setHint(
      '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移动　<kbd>Shift</kbd> 小跑　<kbd>E</kbd> 跨越　' +
        '<kbd>G</kbd> 开关闸门　<kbd>T</kbd> 送回起点（黑场）　<kbd>F4</kbd> 速度 / 碰撞耗时',
    );

    // 测试快捷键（只在这个场景）：G 闸门、T 送回
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || this.game.isPaused) return;
      if (e.code === 'KeyG') this.toggleGate();
      else if (e.code === 'KeyT') void this.rig.controller.teleportTo(anchors.spawn);
    };
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) {
      Object.assign(window, { __testbed: this });
    }
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

    const near = this.rig.controller.nearLink;
    const prompt = near ? near.prompt : null;
    if (prompt !== this.prompt) {
      this.prompt = prompt;
      this.game.ui.hud.setPrompt(prompt);
    }
  }

  override update(dt: number, alpha: number): void {
    this.entities.update(dt, alpha);
    this.cameraFollow.update(dt);
    if (this.game.ui.debug.visible) this.game.ui.debug.set('角色', debugPlayerLine(this.rig, this.physics));
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
