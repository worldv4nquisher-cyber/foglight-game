import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { ATMOSPHERE_PRESETS } from '@/config/atmosphere';
import { disposeObject3D } from '@/core/dispose';
import { createPlayer, type PlayerRig } from '@/entities/createPlayer';
import { EntityManager } from '@/entities/EntityManager';
import { BaseScene } from '@/scenes/BaseScene';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { Rain, RAIN_SPLASH_KEY, RAIN_STREAK_KEY } from '@/world/Rain';
import { SkyDome, SKY_CLOUDS_KEY } from '@/world/SkyDome';
import { v } from './geometry';
import {
  addHarbourColliders, BOAT_FROM, BOAT_TO, BOARDING, COUNTERWEIGHT, CRANE_CONTROL, GATE_CONTROL, HarbourPuzzles,
  MARKET_DOOR, QUAY_END, QUAY_START, WATCH_POST,
} from './harbour';
import { HARBOUR_ASSETS, HarbourArt, MARKET_LINES, NOTICE_LINES } from './harbourArt';
import { STAGES, VIEWS, type Point } from './layout';
import { buildVillage } from './village';

type Mechanism = 'tide' | 'gate' | 'crane';
const cameras: Record<Mechanism, readonly [Point, Point]> = {
  tide: [[12.5, 7.1, -8.4], [5.25, 1.1, -13.2]],
  gate: [[11.7, 6.05, -8.85], [5.7, 1.35, -14.06]],
  crane: [[13, 14, -21.35], [3.0, 10, -40.0]],
};
const ambient = [
  ['amb-waves-near', 0.28], ['amb-rain-light', 0.22], ['amb-wind-soft', 0.12],
] as const;

export class HarbourScene extends BaseScene {
  readonly name = 'ch2-whitebox-s1';
  override usePostFX = true;
  override atmosphere = {
    ...ATMOSPHERE_PRESETS['overcast-after-rain'],
    rain: { ...ATMOSPHERE_PRESETS['overcast-after-rain'].rain, enabled: true, brightness: 0.54 },
  };
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
  private readonly puzzles = new HarbourPuzzles();
  private readonly follow: CameraFollowSystem;
  private rig!: PlayerRig;
  private readonly shot;
  private readonly crate = addHarbourColliders(this.physics);
  private readonly cam = new THREE.PerspectiveCamera();
  private art!: HarbourArt;
  private rain!: Rain;
  private readonly sky = new SkyDome(180);
  private mechanism: Mechanism | null = null;
  private popContext: (() => void) | null = null;
  private wasSailing = false;
  private leaving = false;
  private readBoard = false;
  private journal: HTMLDialogElement | null = null;
  private ready = false;

  constructor(game: Game, view: string | null) {
    super(game);
    this.shot = view ? VIEWS.s1[view] : undefined;
    this.follow = new CameraFollowSystem(this.camera, game.input, { physics: this.physics, events: game.events });
    this.follow.yaw = 0;
    this.follow.pitch = 0.04;
    this.cleanups.push(() => this.follow.dispose());
  }

  override async enter(): Promise<void> {
    await this.game.assets.loadEntries(HARBOUR_ASSETS);
    this.rig = createPlayer(this.game, this.physics, v(QUAY_START), () => this.follow.yaw);
    this.follow.target = this.rig.entity.object3D;
    const a = this.atmosphere;
    this.scene.background = new THREE.Color(a.fogColor);
    this.scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity * 0.84);
    this.scene.add(new THREE.HemisphereLight(a.hemiSky, a.hemiGround, a.hemiIntensity));
    const sun = new THREE.DirectionalLight(a.sunColor, a.sunIntensity);
    sun.position.set(...a.sunDirection);
    this.scene.add(sun);
    const reflected = new THREE.DirectionalLight(0xd7e2d5, 0.63);
    reflected.position.set(3, 7, 16);
    this.scene.add(reflected);
    const village = buildVillage(this.physics, true);
    this.art = new HarbourArt(this.game.assets, village);
    this.scene.add(village, this.art.root);
    const tex = (key: string) => this.game.assets.has(key) ? this.game.assets.getTexture(key) : null;
    this.sky.setClouds(tex(SKY_CLOUDS_KEY));
    this.sky.applyAtmosphere(a);
    this.scene.add(this.sky);
    this.rain = new Rain(46, 26, tex(RAIN_STREAK_KEY), tex(RAIN_SPLASH_KEY));
    this.rain.applyAtmosphere(a);
    const quality = () => {
      const tier = this.game.quality.tier;
      this.rain.setTier(tier === 'low' ? 'standard' : tier, tier === 'low' ? 1800 : 4500);
    };
    quality();
    this.cleanups.push(this.game.events.on('quality:changed', quality));
    this.scene.add(this.rain);
    this.entities.add(this.rig.entity);
    this.rig.visual.visible = !this.shot;
    this.physics.killY = -4;
    this.physics.onFallOut = () => { void this.recall(); };
    this.puzzles.tides.onRecall = () => this.recall();
    for (const [key, volume] of ambient) {
      const buffer = this.game.assets.getAudio(key);
      if (buffer) this.game.audio.startLoop(key, { buffer, volume });
    }
    this.game.ui.hud.show();
    this.game.ui.hud.setLocation('裂湾村 · 峡口与船骸');
    this.follow.snap();
    this.ready = true;
    this.update(0, 0);
  }

  private recall(): Promise<void> {
    return this.rig.controller.teleportTo(v(this.puzzles.crossed ? QUAY_END : QUAY_START));
  }

  private cue(id: string): void {
    const audio = this.game.assets.getAudio(id);
    if (audio) this.game.audio.playBuffer(audio, 0.65);
  }

  private enterMechanism(id: Mechanism): void {
    const [eye, target] = cameras[id];
    this.mechanism = id;
    this.cam.position.copy(v(eye));
    this.cam.lookAt(v(target));
    this.follow.enterPuzzleView(this.cam, { fov: 55, freeLook: false });
    this.rig.controller.halt();
    this.popContext = this.game.input.pushContext('puzzle');
  }

  private exitMechanism(): void {
    if (!this.mechanism) return;
    this.mechanism = null;
    this.popContext?.();
    this.popContext = null;
    this.game.ui.hud.setPuzzleBar(null);
    this.follow.exitPuzzleView();
  }

  private reset(): void {
    if (this.mechanism === 'crane') this.puzzles.resetCrane();
    else {
      this.puzzles.reset();
      this.rig.controller.unpin();
      void this.rig.controller.teleportTo(v(QUAY_START), { fade: 0 });
      this.exitMechanism();
    }
  }

  private hint(): void {
    const p = this.puzzles;
    const line = !p.gateClosed ? '潮刚开始退时拉下鱼闸，趁内湾的水还没流走。'
      : !p.crossed ? '等外水落稳。浮渡船仍能靠到北鲱号的卸货栈桥。'
      : p.crane === 'unweighted' ? '先扣上码头边的配重。空着配重钩，吊臂会翻。'
      : p.crane !== 'landed' ? '先把鱼箱升过船舷，再回转吊臂，最后落在鱼市上方的断梯口。'
      : '从鱼市门边上楼，踏着鱼箱走上甲板。';
    this.game.ui.hud.toast(line);
  }

  private useMechanism(): void {
    const p = this.puzzles, { input, ui } = this.game;
    let prompt: string;
    if (this.mechanism === 'tide') {
      prompt = p.gateClosed ? '闸已封住内湾' : p.canClose ? '潮正初退 · 去闸杆封闸'
        : p.outer.transitioning || p.inner.transitioning ? '水位在变' : p.outer.state === 'high' ? '等到退潮' : '等下一轮涨潮';
    } else if (this.mechanism === 'gate') {
      prompt = p.canClose ? '拉下闸杆' : p.gateClosed ? '闸已封住内湾' : '退潮初起时才能封闸';
    } else {
      prompt = p.craneMoving ? '吊臂正在运转'
        : { unweighted: '尚未扣上配重', ready: '起吊鱼箱', lifted: '回转吊臂', swung: '下放鱼箱', landed: '鱼箱已落稳' }[p.crane];
    }
    ui.hud.setPrompt(`E\u3000${prompt}`);
    ui.hud.setPuzzleBar('Tab 返回 · R 重置 · H 线索');
    if (input.consumePressed('exitPuzzle')) this.exitMechanism();
    else if (input.consumePressed('resetPuzzle')) this.reset();
    else if (input.consumePressed('hint')) this.hint();
    else if (input.consumePressed('partNext')) {
      if (this.mechanism === 'gate' && p.closeGate()) {
        this.cue('sfx-gate-open');
      } else if (this.mechanism === 'tide' && p.waitForTide()) {
        this.exitMechanism();
      } else if (this.mechanism === 'crane' && p.operateCrane()) {
        this.cue('sfx-valve-turn');
      }
    }
  }

  private showJournal(): void {
    const dialog = document.createElement('dialog');
    dialog.className = 'journal-panel';
    dialog.dataset.ui = '';
    dialog.setAttribute('aria-label', '汐的手记');
    const title = document.createElement('h2');
    title.textContent = '汐的手记 · 裂湾村';
    dialog.append(title);
    const lines = [this.puzzles.crane === 'landed' ? '上北鲱号的甲板，找通往崖壁的路。'
      : this.puzzles.crossed ? '渡到船边了。鱼箱也许能补上断梯那一级。'
      : '到北鲱号的鱼市去看看。外水退得快，内湾有一道闸。'];
    if (this.readBoard) lines.push(...NOTICE_LINES, ...MARKET_LINES.slice(1), '绳头还扎着爸爸惯打的回头结。');
    for (const text of lines) {
      const line = document.createElement('p');
      line.textContent = text;
      dialog.append(line);
    }
    const close = document.createElement('button');
    close.textContent = '合上手记';
    close.onclick = () => dialog.close();
    dialog.append(close);
    this.game.container.append(dialog);
    const pop = this.game.input.pushContext('reading');
    dialog.addEventListener('close', () => { pop(); dialog.remove(); this.journal = null; }, { once: true });
    this.journal = dialog;
    this.rig.controller.halt();
    dialog.showModal();
  }

  private explore(): void {
    const { input, ui } = this.game;
    const p = this.puzzles, pos = this.rig.body.position;
    const near = (point: Point, radius = 1.05) => pos.distanceToSquared(v(point)) < radius * radius;
    const use = (text: string, act: () => void) => {
      ui.hud.setPrompt(`E\u3000${text}`);
      if (input.consumePressed('interact')) act();
    };
    if (input.consumePressed('hint')) this.hint();
    if (!p.crossed && near(WATCH_POST)) use('看潮', () => this.enterMechanism('tide'));
    else if (!p.crossed && near(GATE_CONTROL, 0.92)) use(p.canClose ? '鱼闸 · 潮正初退' : '查看鱼闸', () => this.enterMechanism('gate'));
    else if (!p.crossed && near(BOARDING, 0.83)) use(p.canBoard ? '登浮渡船' : '查看浮渡船', () => {
      if (p.board()) this.cue('sfx-raft-float');
      else this.hint();
    });
    else if (p.crossed && p.crane === 'unweighted' && near(COUNTERWEIGHT, 1.25)) use('扣上配重', () => {
      if (p.setCounterweight()) this.cue('sfx-raft-lock');
    });
    else if (p.crossed && near(CRANE_CONTROL, 1.23)) use('操纵吊臂', () => this.enterMechanism('crane'));
    else if (near(MARKET_DOOR, 1.37)) use('看鱼市门口的通告和黑板', () => {
      this.readBoard = true;
      this.showJournal();
    });
    else if (p.crane === 'landed' && near(STAGES.s1.exit, 1.32)) use('前往镜巷', () => {
      this.leaving = true;
      void this.game.scenes.change('ch2-whitebox-s2');
    });
    else ui.hud.setPrompt(null);
  }

  override fixedUpdate(dt: number): void {
    if (!this.ready || this.shot || this.leaving) return;
    if (this.journal) {
      if (this.game.input.consumePressed('journal') || this.game.input.consumePressed('exitPuzzle')) this.journal.close();
      return;
    }
    const p = this.puzzles;
    if (!p.sailing && !this.wasSailing && !this.rig.controller.busy) {
      if (this.mechanism) this.useMechanism();
      else this.explore();
    }
    p.fixedUpdate(dt);
    this.crate.enabled = p.crane === 'landed';
    if (p.sailing) {
      const t = THREE.MathUtils.smoothstep(p.boatProgress, 0, 1);
      const seat = new THREE.Vector3(9, p.inner.level + 0.18, THREE.MathUtils.lerp(BOAT_FROM, BOAT_TO, t));
      if (this.wasSailing) this.rig.body.teleport(seat);
      else this.rig.controller.pin(seat, 0);
      this.game.ui.hud.setPrompt(null);
    } else if (this.wasSailing) {
      this.rig.controller.unpin();
      void this.rig.controller.teleportTo(v(QUAY_END), { fade: 0 });
      this.cue('sfx-raft-lock');
    }
    this.wasSailing = p.sailing;
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
    p.tides.checkRecall({ position: this.rig.body.position, onGround: this.rig.body.body.onGround, busy: this.rig.controller.busy || p.sailing });
  }

  override update(dt: number, alpha: number): void {
    if (!this.ready) return;
    if (!this.shot && !this.journal && !this.puzzles.sailing && this.game.input.context === 'explore'
      && this.game.input.consumePressed('journal')) this.showJournal();
    this.art.sync(this.puzzles, dt);
    this.entities.update(dt, alpha);
    if (this.shot) {
      this.camera.position.copy(v(this.shot[0]));
      this.camera.lookAt(v(this.shot[1]));
      this.camera.fov = 59;
      this.camera.updateProjectionMatrix();
    } else this.follow.update(dt);
    this.rain.update(dt, this.camera);
    this.sky.update(dt);
    this.sky.follow(this.camera);
  }

  override exit(): void {
    this.ready = false;
    this.journal?.close();
    this.exitMechanism();
    for (const [key] of ambient) this.game.audio.stopLoop(key);
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.hide();
    this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root, { keep: this.game.assets.sharedResources() });
    this.physics.clear();
  }
}
