import * as THREE from 'three';
import { manifest } from '@/assets/manifest';
import type { Game } from '@/core/Game';
import { disposeObject3D } from '@/core/dispose';
import { createPlayer, type PlayerRig } from '@/entities/createPlayer';
import { EntityManager } from '@/entities/EntityManager';
import { BaseScene } from '@/scenes/BaseScene';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { v } from './geometry';
import { CABLE_FROM, CABLE_TO, STAGES, VIEWS, type Point } from './layout';
import { LighthouseArt } from './lighthouseArt';
import { BALANCED_LOAD, CableCar, PRISM_CONTROL, PRISM_DETENTS, PrismSplitter, WEIGHT_LIMIT, WINCH, type PrismAxis } from './lighthousePuzzles';
import { buildVillage, TOWER_SHELL } from './village';

const stage = STAGES.s3;
const ambient = [['amb-wind-soft', 0.31], ['amb-waves-near', 0.2]] as const;
const click = 'sfx-mirror-click', lever = 'sfx-ignite-lever', ignite = 'sfx-ignite';
const assets = manifest.filter(({ key }) => key.startsWith('char-xi') || key.startsWith('tex-xi')
  || key === click || key === lever || key === ignite || ambient.some(([id]) => id === key));
const CAMERAS = {
  cable: [[-21.06, 41.2, -1.62], [-21.13, 40.03, -5.67]],
  prism: [[-4, 34.1, 32.74], [-4, 33.38, 35.52]],
} as const satisfies Record<string, readonly [Point, Point]>;

type Station = keyof typeof CAMERAS;

export class LighthouseScene extends BaseScene {
  readonly name = 'ch2-whitebox-s3';
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
  private readonly cable = new CableCar();
  private readonly prism = new PrismSplitter();
  private readonly follow: CameraFollowSystem;
  private readonly shot;
  private readonly art: LighthouseArt;
  private readonly puzzleCamera = new THREE.PerspectiveCamera();
  private readonly carPosition = v(CABLE_FROM);
  private rig!: PlayerRig;
  private mode: Station | null = null;
  private axis: PrismAxis = 'yaw';
  private popContext: (() => void) | null = null;
  private recall: Point = stage.spawn;
  private ready = false;

  constructor(game: Game, view: string | null) {
    super(game);
    this.shot = view ? VIEWS.s3[view] : undefined;
    this.follow = new CameraFollowSystem(this.camera, game.input, { physics: this.physics, events: game.events });
    this.follow.yaw = Math.PI;
    this.follow.pitch = 0.08;
    this.follow.targetFramingWeight = (point) => LighthouseArt.inTower(point) ? 1 : 0;
    this.cleanups.push(() => this.follow.dispose());
    this.art = new LighthouseArt(this.physics);
  }

  override async enter(): Promise<void> {
    if (!this.shot) await this.game.assets.loadEntries(assets);
    this.rig = createPlayer(this.game, this.physics, v(stage.spawn), () => this.follow.yaw);
    this.follow.target = this.rig.entity.object3D;
    this.scene.background = new THREE.Color(0x9aaab3);
    this.scene.fog = new THREE.FogExp2(0x9aaab3, 0.0088);
    this.scene.add(new THREE.HemisphereLight(0xc6ddf2, 0x807567, 1.83));
    const evening = new THREE.DirectionalLight(0xffdcaa, 2.25);
    evening.position.set(-16, 28, 26);
    const village = buildVillage(this.physics, false, false, true);
    const shell = village.getObjectByName(TOWER_SHELL);
    if (shell) this.art.cutaway.attach(shell, true);
    this.scene.add(evening, village, this.art.root);
    this.entities.add(this.rig.entity);
    this.rig.visual.visible = !this.shot;
    this.physics.killY = -1.4;
    this.physics.onFallOut = () => { void this.rig.controller.teleportTo(v(this.recall)); };
    this.game.ui.hud.show();
    this.game.ui.hud.setLocation(`裂湾村 · ${stage.title}`);
    if (!this.shot) for (const [id, volume] of ambient) {
      const buffer = this.game.assets.getAudio(id);
      if (buffer) this.game.audio.startLoop(id, { buffer, volume });
    }
    this.ready = true;
    this.follow.snap();
    this.update(0, 0);
  }

  private sound(id: string, volume: number): void {
    const buffer = this.game.assets.getAudio(id);
    if (buffer) this.game.audio.playBuffer(buffer, volume);
  }

  private hint(): void {
    this.game.ui.hud.toast(this.prism.lit ? '灯已经亮了。可以上外廊看雾里的海面。'
      : this.cable.side === 'stack' ? '白光经棱镜分成冷暖两束。先把两束转向灯杯，再翻框对准杯口。'
        : this.cable.released ? '闸已松开。到站台红色缆车旁登车。'
          : '在绞盘站增减铁坨。指针居中才可以松闸。');
  }

  private begin(station: Station): void {
    this.mode = station;
    const [eye, target] = CAMERAS[station];
    this.puzzleCamera.position.copy(v(eye));
    this.puzzleCamera.lookAt(v(target));
    this.rig.controller.locked = true;
    this.rig.controller.halt();
    this.follow.enterPuzzleView(this.puzzleCamera, { fov: 58, freeLook: false });
    this.popContext = this.game.input.pushContext('puzzle');
  }

  private end(): void {
    if (!this.mode) return;
    this.mode = null;
    this.rig.controller.locked = false;
    this.popContext?.();
    this.popContext = null;
    this.follow.exitPuzzleView();
    this.game.ui.hud.setPuzzleBar(null);
  }

  private adjust(station: Station): void {
    const { input, ui } = this.game;
    if (input.consumePressed('exitPuzzle')) {
      this.end();
      return;
    }
    const direction = input.consumePressed('partPrev') ? -1 : input.consumePressed('partNext') ? 1 : null;
    const advance = input.consumePressed('advance');
    const reset = input.consumePressed('resetPuzzle');
    if (station === 'cable') {
      if (reset) this.cable.reset();
      else if (direction) this.cable.adjust(direction);
      if (advance) {
        if (this.cable.release()) {
          this.sound(lever, 0.8);
          this.end();
          ui.hud.toast('制动闸已松开 · 到红色缆车旁登车');
          return;
        }
        ui.hud.toast('配重未平 · 制动闸锁住了');
      }
      const gauge = this.cable.load === BALANCED_LOAD ? '指针居中' : this.cable.load < BALANCED_LOAD ? '配重偏轻' : '配重偏重';
      ui.hud.setPrompt(`绞盘制动 · 铁坨 ${this.cable.load} / ${WEIGHT_LIMIT} · ${gauge}`);
      ui.hud.setPuzzleBar('Q / E 增减配重 · 空格 试闸 · Tab 返回 · R 重置 · H 线索');
    } else {
      if (reset) this.prism.reset();
      else if (direction) this.prism.adjust(this.axis, direction);
      if (advance) this.axis = this.axis === 'yaw' ? 'roll' : 'yaw';
      const [warm, cool] = this.prism.trace();
      const ang = this.axis === 'yaw' ? '转盘' : '翻框';
      ui.hud.setPrompt(this.prism.lit ? '灯已点亮' : `棱镜${ang} · ${this.prism[this.axis] + 1} / ${PRISM_DETENTS} · 暖杯${warm?.aligned ? '亮' : '暗'} / 冷杯${cool?.aligned ? '亮' : '暗'}`);
      ui.hud.setPuzzleBar(this.prism.lit ? 'Tab 返回外廊' : 'Q / E 调节 · 空格 切换轴 · Tab 返回 · R 重置 · H 线索');
    }
    if (direction) this.sound(click, 0.65);
    if (input.consumePressed('hint')) this.hint();
  }

  private explore(): void {
    const { input, ui } = this.game;
    if (input.consumePressed('hint')) this.hint();
    const pos = this.rig.body.position;
    const near = (p: Point, radius: number, height = 0.52) => Math.abs(pos.y - p[1]) < height
      && Math.hypot(pos.x - p[0], pos.z - p[2]) < radius;
    const dock = this.cable.side === 'cliff' ? CABLE_FROM : CABLE_TO;
    if (!this.cable.released && near(WINCH, 1.22)) {
      ui.hud.setPrompt('E\u3000操作绞盘配重');
      if (input.consumePressed('interact')) this.begin('cable');
    } else if (near(dock, 1.38)) {
      ui.hud.setPrompt(this.cable.released ? 'E\u3000登上缆车' : '缆车停闸 · 先去绞盘站配重');
      if (this.cable.released && this.rig.body.onGround && input.consumePressed('interact') && this.cable.board(this.cable.side)) {
        this.rig.controller.locked = true;
        this.rig.controller.pin(v(dock));
        this.sound(lever, 0.62);
      }
    } else if (near(PRISM_CONTROL, 1.22, 0.62)) {
      ui.hud.setPrompt(this.prism.lit ? '灯室 · 灯已点亮' : 'E\u3000调节半盏灯的棱镜');
      if (!this.prism.lit && input.consumePressed('interact')) this.begin('prism');
    } else ui.hud.setPrompt(null);
  }

  private ride(dt: number): void {
    const { body } = this.rig.body;
    body.prevPosition.copy(body.position);
    this.cable.step(dt);
    this.cable.sample(body.position);
    if (this.cable.moving) {
      this.game.ui.hud.setPrompt('沿缆索横渡海峡…');
      return;
    }
    this.recall = this.cable.side === 'stack' ? CABLE_TO : CABLE_FROM;
    this.rig.controller.unpin();
    this.rig.controller.locked = false;
    this.game.ui.hud.toast(this.cable.side === 'stack' ? '已到礁柱 · 进塔门，沿坡道上灯室' : '已返回崖顶');
  }

  override fixedUpdate(dt: number): void {
    if (!this.ready || this.shot) return;
    if (this.cable.moving) this.ride(dt);
    else if (!this.rig.controller.busy) {
      if (this.mode) this.adjust(this.mode);
      else this.explore();
    }
    const lit = this.prism.lit;
    this.prism.step(dt);
    if (!lit && this.prism.lit) {
      this.game.ui.hud.toast('两道光合入灯芯 · 礁柱灯塔已亮');
      this.sound(ignite, 0.9);
    }
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
  }

  override update(dt: number, alpha: number): void {
    if (!this.ready) return;
    this.entities.update(dt, alpha);
    if (this.cable.moving) this.carPosition.copy(this.rig.entity.object3D.position);
    else this.cable.sample(this.carPosition);
    this.art.sync(this.cable, this.prism, this.carPosition);
    if (this.shot) {
      this.camera.position.copy(v(this.shot[0]));
      this.camera.lookAt(v(this.shot[1]));
      this.camera.fov = 59;
      this.camera.updateProjectionMatrix();
    } else {
      this.follow.update(dt);
      this.art.cutaway.update(this.camera, this.rig.entity.object3D.position, this.follow.modeName === 'explore');
    }
  }

  override exit(): void {
    this.end();
    if (!this.shot) for (const [id] of ambient) this.game.audio.stopLoop(id);
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.hide();
    this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root, { keep: this.game.assets.sharedResources() });
    this.physics.clear();
  }
}
