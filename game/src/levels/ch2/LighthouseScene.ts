import * as THREE from 'three';
import { manifest } from '@/assets/manifest';
import { t } from '@/content/text';
import type { Game } from '@/core/Game';
import { disposeObject3D } from '@/core/dispose';
import { createPlayer, type PlayerRig } from '@/entities/createPlayer';
import { EntityManager } from '@/entities/EntityManager';
import { BaseScene } from '@/scenes/BaseScene';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { switchMusic } from '@/systems/audio/music';
import { v } from './geometry';
import { CABLE_FROM, CABLE_TO, STAGES, VIEWS, type Point, type Travel } from './layout';
import { LighthouseArt } from './lighthouseArt';
import { BALANCED_LOAD, type CableCar, PRISM_CONTROL, PRISM_DETENTS, type PrismSplitter, WEIGHT_LIMIT, WINCH, type PrismAxis } from './lighthousePuzzles';
import { Ch2Ending } from './ending';
import { buildVillage, TOWER_SHELL } from './village';
import { OcclusionCutaway } from '@/render/occlusionCutaway';

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
  readonly name: string;
  override savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null;
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
  private readonly follow: CameraFollowSystem;
  private readonly shot;
  private readonly art: LighthouseArt;
  private readonly puzzleCamera = new THREE.PerspectiveCamera();
  private readonly carPosition = v(CABLE_FROM);
  private readonly carPhysicsPosition = v(CABLE_FROM);
  private rig!: PlayerRig;
  private cutaway: OcclusionCutaway | null = null;
  private ending!: Ch2Ending;
  private mode: Station | null = null;
  private axis: PrismAxis = 'yaw';
  private popContext: (() => void) | null = null;
  private recall: Point = stage.spawn;
  private ready = false;
  private leaving = false;
  private alive = true;
  private readonly seenHints = new Set<string>();

  constructor(
    game: Game,
    view: string | null,
    private readonly cable: CableCar,
    private readonly prism: PrismSplitter,
    private readonly travel: Travel,
    sceneName = 'ch2-lighthouse',
    savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null = { chapterId: 'ch2', sceneId: 'ch2-s3', chapterComplete: false },
  ) {
    super(game);
    this.name = sceneName;
    this.savePoint = view ? null : savePoint;
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
    this.rig = createPlayer(this.game, this.physics, v(stage.spawn), () => this.follow.moveYaw);
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
    this.game.ui.hud.setLocation(t(stage.titleKey));
    if (!this.shot) {
      switchMusic(this.game.audio, (k) => this.game.assets.getAudio(k), null);
      for (const [id, volume] of ambient) {
        const buffer = this.game.assets.getAudio(id);
        if (buffer) this.game.audio.startLoop(id, { buffer, volume });
      }
    }
    this.ending = new Ch2Ending({
      game: this.game,
      scene: this.scene,
      cameraFollow: this.follow,
      alive: () => this.alive,
      onComplete: () => {
        if (this.savePoint) return this.game.flow.completeChapter2();
        this.game.ui.fade.set(0);
        this.rig.controller.locked = false;
        this.game.ui.hud.show();
        return Promise.resolve();
      },
    });
    this.alive = true;
    this.ready = true;
    this.follow.snap();
    this.update(0, 0);
  }

  private sound(id: string, volume: number): void {
    const buffer = this.game.assets.getAudio(id);
    if (buffer) this.game.audio.playBuffer(buffer, volume);
  }

  private hint(): void {
    const key = this.prism.lit ? 'ch2.s3.hint.lit'
      : this.cable.side === 'stack' ? 'ch2.s3.hint.prism'
        : this.cable.released ? 'ch2.s3.hint.board'
          : 'ch2.s3.hint.winch';
    if (this.savePoint && !this.seenHints.has(key)) {
      this.seenHints.add(key);
      this.game.save.addHintUsed();
      this.game.save.flush();
    }
    this.game.ui.hud.toast(t(key));
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
          ui.hud.toast(t('ch2.s3.toast.brake_released'));
          return;
        }
        ui.hud.toast(t('ch2.s3.toast.brake_locked'));
      }
      const gauge = this.cable.load === BALANCED_LOAD ? t('ch2.s3.gauge.balanced') : this.cable.load < BALANCED_LOAD ? t('ch2.s3.gauge.light') : t('ch2.s3.gauge.heavy');
      ui.hud.setPrompt(t('ch2.s3.winch.prompt', { load: this.cable.load, limit: WEIGHT_LIMIT, gauge }));
      ui.hud.setPuzzleBar(t('ch2.s3.winch.bar'));
    } else {
      if (reset) this.prism.reset();
      else if (direction) this.prism.adjust(this.axis, direction);
      if (advance) this.axis = this.axis === 'yaw' ? 'roll' : 'yaw';
      const [warm, cool] = this.prism.trace();
      const axis = this.axis === 'yaw' ? t('ch2.s3.prism.axis_yaw') : t('ch2.s3.prism.axis_roll');
      ui.hud.setPrompt(this.prism.lit ? t('ch2.s3.prism.prompt_lit') : t('ch2.s3.prism.prompt', {
        axis,
        step: this.prism[this.axis] + 1,
        total: PRISM_DETENTS,
        warm: warm?.aligned ? t('ch2.s3.prism.lit') : t('ch2.s3.prism.dark'),
        cool: cool?.aligned ? t('ch2.s3.prism.lit') : t('ch2.s3.prism.dark'),
      }));
      ui.hud.setPuzzleBar(this.prism.lit ? t('ch2.s3.prism.bar_lit') : t('ch2.s3.prism.bar'));
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
    if (near(stage.spawn, 1.15)) {
      ui.hud.setPrompt(t('ch2.s3.prompt.to_s2'));
      if (input.consumePressed('interact')) {
        this.leaving = true;
        this.travel('s2', STAGES.s2.exit);
      }
    } else if (!this.cable.released && near(WINCH, 1.22)) {
      ui.hud.setPrompt(t('ch2.s3.prompt.winch'));
      if (input.consumePressed('interact')) this.begin('cable');
    } else if (near(dock, 1.38)) {
      ui.hud.setPrompt(this.cable.released ? t('ch2.s3.prompt.board') : t('ch2.s3.prompt.board_locked'));
      if (this.cable.released && this.rig.body.onGround && input.consumePressed('interact') && this.cable.board(this.cable.side)) {
        this.rig.controller.locked = true;
        this.rig.controller.pin(v(dock));
        this.sound(lever, 0.62);
      }
    } else if (near(PRISM_CONTROL, 1.22, 0.62)) {
      ui.hud.setPrompt(this.prism.lit ? t('ch2.s3.prompt.prism_lit') : t('ch2.s3.prompt.prism'));
      if (!this.prism.lit && input.consumePressed('interact')) this.begin('prism');
    } else ui.hud.setPrompt(null);
  }

  private ride(dt: number): void {
    const { body } = this.rig.body;
    body.prevPosition.copy(body.position);
    this.cable.step(dt);
    this.cable.sample(body.position);
    if (this.cable.moving) {
      this.game.ui.hud.setPrompt(t('ch2.s3.prompt.riding'));
      return;
    }
    this.recall = this.cable.landing;
    this.rig.controller.pin(v(this.recall));
    this.rig.controller.unpin();
    this.rig.controller.locked = false;
    this.game.ui.hud.toast(this.cable.side === 'stack' ? t('ch2.s3.toast.arrived_stack') : t('ch2.s3.toast.arrived_cliff'));
  }

  override fixedUpdate(dt: number): void {
    if (!this.ready || this.shot || this.leaving) return;
    if (!this.ending.active) {
      if (this.cable.moving) this.ride(dt);
      else if (!this.rig.controller.busy) {
        if (this.mode) this.adjust(this.mode);
        else this.explore();
      }
      const lit = this.prism.lit;
      this.prism.step(dt);
      if (!lit && this.prism.lit) {
        this.end();
        this.rig.controller.locked = true;
        this.rig.controller.halt();
        this.game.ui.hud.toast(t('ch2.s3.toast.ignited'));
        this.sound(ignite, 0.9);
        this.ending.start();
      }
    }
    this.entities.fixedUpdate(dt);
    this.art.setCarPosition(this.cable.sample(this.carPhysicsPosition));
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
      this.ending.update(dt);
      this.follow.update(dt);
      const exploring = !this.ending.active && this.follow.modeName === 'explore';
      this.art.cutaway.update(this.camera, this.rig.entity.object3D.position, exploring);
      this.cutaway ??= new OcclusionCutaway(this.scene);
      this.cutaway.update(dt, this.camera, this.rig.entity.object3D.position, exploring && !this.follow.eyeActive);
    }
  }

  override exit(): void {
    this.alive = false;
    this.ending?.dispose();
    this.end();
    if (!this.shot) for (const [id] of ambient) this.game.audio.stopLoop(id);
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.hide();
    if (!this.leaving && !this.ending?.endedBy) this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root, { keep: this.game.assets.sharedResources() });
    this.physics.clear();
    const loaded = new Set(this.game.assets.loadedGroups);
    for (const e of assets) {
      if (e.group !== 'common' && !loaded.has(e.group)) this.game.assets.unload(e.key);
    }
  }
}
