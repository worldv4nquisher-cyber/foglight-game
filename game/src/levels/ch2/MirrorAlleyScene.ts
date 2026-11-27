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
import { STAGES, VIEWS, type Point, type Travel } from './layout';
import { MirrorAlleyArt, RELAY_BOARD } from './mirrorAlleyArt';
import { type MirrorRelay, RELAY } from './mirrorRelay';
import { buildVillage } from './village';
import './mirrorAlley.css';

const stage = STAGES.s2;
const RETURN_TO_HARBOUR: Point = [5.8, 11, -42.35];
const ambient = [['amb-waves-near', 0.22], ['amb-wind-soft', 0.25]] as const;
const click = 'sfx-mirror-click', bell = 'sfx-tide-bell-ring';
const assets = manifest.filter(({ key }) => key.startsWith('char-xi') || key.startsWith('tex-xi')
  || key === click || key === bell || ambient.some(([id]) => id === key));
const mirrorNames = () => [t('ch2.s2.mirror.0'), t('ch2.s2.mirror.1'), t('ch2.s2.mirror.2'), t('ch2.s2.mirror.3')] as const;
const cameras: readonly (readonly [Point, Point])[] = [
  [[5, 24, -69], [3.9, 20.35, -58]],
  [[-8, 20, -31], [-5.9, 17.6, -42.6]],
  [[0, 0, 0], [0, 0, 0]],
  [[-7, 27, -48], [-3.9, 24.15, -59.5]],
];

export class MirrorAlleyScene extends BaseScene {
  readonly name: string;
  override savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null;
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
  private readonly follow: CameraFollowSystem;
  private rig!: PlayerRig;
  private readonly art: MirrorAlleyArt;
  private readonly shot;
  private readonly puzzleCamera = new THREE.PerspectiveCamera();
  private adjusting: number | null = null;
  private popContext: (() => void) | null = null;
  private recall: Point;
  private leaving = false;
  private ready = false;

  constructor(
    game: Game,
    view: string | null,
    private readonly spawn: Point,
    private readonly relay: MirrorRelay,
    private readonly travel: Travel,
    sceneName = 'ch2-mirror-alley',
    savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null = { chapterId: 'ch2', sceneId: 'ch2-s2', chapterComplete: false },
  ) {
    super(game);
    this.name = sceneName;
    this.savePoint = view ? null : savePoint;
    this.recall = spawn;
    this.shot = view ? VIEWS.s2[view] : undefined;
    this.follow = new CameraFollowSystem(this.camera, game.input, { physics: this.physics, events: game.events });
    this.follow.yaw = -Math.PI / 2;
    this.follow.pitch = 0.02;
    this.cleanups.push(() => this.follow.dispose());
    this.art = new MirrorAlleyArt(this.physics);
  }

  override async enter(): Promise<void> {
    if (!this.shot) await this.game.assets.loadEntries(assets);
    this.rig = createPlayer(this.game, this.physics, v(this.spawn), () => this.follow.yaw);
    this.follow.target = this.rig.entity.object3D;
    this.scene.background = new THREE.Color(0x9aafb3);
    this.scene.fog = new THREE.FogExp2(0x9aafb3, 0.0094);
    this.scene.add(new THREE.HemisphereLight(0xd3e5e6, 0x877567, 2.05));
    const skylight = new THREE.DirectionalLight(0xffebd4, 2.25);
    skylight.position.set(4, 22, -12);
    this.scene.add(skylight);
    const bounce = new THREE.DirectionalLight(0xaed4db, 0.82);
    bounce.position.set(-9, 3, 8);
    this.scene.add(bounce);
    this.scene.add(buildVillage(this.physics, false, true), this.art.root);
    this.entities.add(this.rig.entity);
    this.rig.visual.visible = !this.shot;
    this.physics.killY = -1.4;
    this.physics.onFallOut = () => { void this.rig.controller.teleportTo(v(this.recall)); };
    this.game.ui.hud.show();
    this.game.ui.hud.el.classList.add('ch2-mirror-hud');
    this.game.ui.hud.setLocation(t('ch2.loc.s2'));
    if (!this.shot) {
      switchMusic(this.game.audio, (k) => this.game.assets.getAudio(k), null);
      for (const [id, volume] of ambient) {
        const buffer = this.game.assets.getAudio(id);
        if (buffer) this.game.audio.startLoop(id, { buffer, volume });
      }
    }
    this.ready = true;
    this.follow.snap();
    this.update(0, 0);
  }

  private hint(): void {
    const path = this.relay.trace();
    const clue = path.received ? t('ch2.s2.hint.done')
      : path.lit === 1 ? t('ch2.s2.hint.m1')
        : path.lit === 2 ? t('ch2.s2.hint.m2')
          : t('ch2.s2.hint.m4');
    this.game.ui.hud.toast(clue);
  }

  private begin(index: number, position: Point): void {
    this.adjusting = index;
    this.recall = position;
    const [eye, target] = cameras[index]!;
    this.puzzleCamera.position.copy(v(eye));
    this.puzzleCamera.lookAt(v(target));
    this.rig.controller.locked = true;
    this.rig.controller.halt();
    this.follow.enterPuzzleView(this.puzzleCamera, { fov: 56, freeLook: false });
    this.popContext = this.game.input.pushContext('puzzle');
  }

  private end(): void {
    if (this.adjusting === null) return;
    this.adjusting = null;
    this.rig.controller.locked = false;
    this.popContext?.();
    this.popContext = null;
    this.follow.exitPuzzleView();
    this.game.ui.hud.setPuzzleBar(null);
  }

  private adjust(index: number): void {
    const { input, ui } = this.game;
    if (input.consumePressed('exitPuzzle')) {
      this.end();
      return;
    }
    const wasSolved = this.relay.trace().received;
    if (input.consumePressed('resetPuzzle')) this.relay.reset();
    else {
      const direction = input.consumePressed('partPrev') ? -1 : input.consumePressed('partNext') ? 1 : null;
      if (direction) {
        this.relay.turn(index, direction);
        const buffer = this.game.assets.getAudio(click);
        if (buffer) this.game.audio.playBuffer(buffer, 0.65);
      }
    }
    if (input.consumePressed('hint')) this.hint();
    const path = this.relay.trace();
    if (!wasSolved && path.received) {
      ui.hud.toast(t('ch2.s2.toast.solved'));
      const buffer = this.game.assets.getAudio(bell);
      if (buffer) this.game.audio.playBuffer(buffer, 0.8);
    }
    const status = path.received ? t('ch2.s2.status.received') : path.lit > index ? t('ch2.s2.status.lit') : t('ch2.s2.status.unlit');
    ui.hud.setPrompt(t('ch2.s2.adjust.prompt', { name: mirrorNames()[index]!, detent: this.relay.detent(index) + 1, status }));
    ui.hud.setPuzzleBar(t('ch2.s2.adjust.bar'));
  }

  private explore(): void {
    const { input, ui } = this.game;
    if (input.consumePressed('hint')) this.hint();
    const pos = this.rig.body.position;
    const near = (p: Point, radius: number) => pos.distanceToSquared(v(p)) < radius * radius;
    const names = mirrorNames();
    for (const [index, mirror] of RELAY.entries()) {
      if (!mirror.control || !near(mirror.control, 1.22)) continue;
      ui.hud.setPrompt(t('ch2.s2.prompt.mirror', { name: names[index]! }));
      if (input.consumePressed('interact')) this.begin(index, mirror.control);
      return;
    }
    if (near(RETURN_TO_HARBOUR, 1.05)) {
      ui.hud.setPrompt(t('ch2.s2.prompt.to_s1'));
      if (input.consumePressed('interact')) {
        this.leaving = true;
        this.travel('s1', STAGES.s1.exit);
      }
    } else if (near(RELAY_BOARD, 1.15)) {
      ui.hud.setPrompt(t('ch2.s2.prompt.board'));
      if (input.consumePressed('interact')) {
        ui.hud.toast(t('ch2.s2.toast.board'));
      }
    } else if (near(stage.exit, 1.8)) {
      const lit = this.relay.trace().received;
      ui.hud.setPrompt(lit ? t('ch2.s2.prompt.to_s3') : t('ch2.s2.prompt.to_s3_locked'));
      if (lit && input.consumePressed('interact')) {
        this.leaving = true;
        this.travel('s3');
      }
    } else ui.hud.setPrompt(null);
  }

  override fixedUpdate(dt: number): void {
    if (!this.ready || this.shot || this.leaving) return;
    if (!this.rig.controller.busy) {
      if (this.adjusting === null) this.explore();
      else this.adjust(this.adjusting);
    }
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
  }

  override update(dt: number, alpha: number): void {
    if (!this.ready) return;
    this.art.sync(this.relay, dt);
    this.entities.update(dt, alpha);
    if (this.shot) {
      this.camera.position.copy(v(this.shot[0]));
      this.camera.lookAt(v(this.shot[1]));
      this.camera.fov = 59;
      this.camera.updateProjectionMatrix();
    } else this.follow.update(dt);
  }

  override exit(): void {
    this.end();
    if (!this.shot) for (const [id] of ambient) this.game.audio.stopLoop(id);
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.el.classList.remove('ch2-mirror-hud');
    this.game.ui.hud.hide();
    if (!this.leaving) this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root, { keep: this.game.assets.sharedResources() });
    this.physics.clear();
    const loaded = new Set(this.game.assets.loadedGroups);
    for (const e of assets) {
      if (e.group !== 'common' && !loaded.has(e.group)) this.game.assets.unload(e.key);
    }
  }
}
