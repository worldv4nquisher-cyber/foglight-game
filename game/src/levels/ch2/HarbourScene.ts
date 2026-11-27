import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { t } from '@/content/text';
import { ATMOSPHERE_PRESETS } from '@/config/atmosphere';
import { disposeObject3D } from '@/core/dispose';
import { createPlayer, type PlayerRig } from '@/entities/createPlayer';
import { EntityManager } from '@/entities/EntityManager';
import { BaseScene } from '@/scenes/BaseScene';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { switchMusic } from '@/systems/audio/music';
import { Rain, RAIN_SPLASH_KEY, RAIN_STREAK_KEY } from '@/world/Rain';
import { SkyDome, SKY_CLOUDS_KEY } from '@/world/SkyDome';
import { v } from './geometry';
import {
  addHarbourColliders, BOAT_FROM, BOAT_TO, BOARDING, COUNTERWEIGHT, CRANE_CONTROL, GATE_CONTROL, type HarbourPuzzles,
  MARKET_DOOR, QUAY_END, QUAY_START, WATCH_POST,
} from './harbour';
import { HARBOUR_ASSETS, HarbourArt, MARKET_LINES, NOTICE_LINES } from './harbourArt';
import { STAGES, VIEWS, type Point, type Travel } from './layout';
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
  readonly name: string;
  override savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null;
  override usePostFX = true;
  override atmosphere = {
    ...ATMOSPHERE_PRESETS['overcast-after-rain'],
    rain: { ...ATMOSPHERE_PRESETS['overcast-after-rain'].rain, enabled: true, brightness: 0.54 },
  };
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
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
  private journal: HTMLDialogElement | null = null;
  private ready = false;

  constructor(
    game: Game,
    view: string | null,
    private readonly spawn: Point,
    private readonly puzzles: HarbourPuzzles,
    private readonly travel: Travel,
    sceneName = 'ch2-harbour',
    savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null = { chapterId: 'ch2', sceneId: 'ch2-s1', chapterComplete: false },
  ) {
    super(game);
    this.name = sceneName;
    this.savePoint = view ? null : savePoint;
    this.shot = view ? VIEWS.s1[view] : undefined;
    this.follow = new CameraFollowSystem(this.camera, game.input, { physics: this.physics, events: game.events });
    this.follow.yaw = 0;
    this.follow.pitch = 0.04;
    this.cleanups.push(() => this.follow.dispose());
  }

  override async enter(): Promise<void> {
    await this.game.assets.loadEntries(HARBOUR_ASSETS);
    this.rig = createPlayer(this.game, this.physics, v(this.spawn), () => this.follow.yaw);
    this.follow.target = this.rig.entity.object3D;
    const a = this.atmosphere;
    this.scene.background = new THREE.Color(a.fogColor);
    this.scene.fog = new THREE.FogExp2(a.fogColor, a.fogDensity * 0.84);
    this.scene.add(new THREE.HemisphereLight(0xc0d2dc, 0x8a938c, a.hemiIntensity * 1.25));
    const sun = new THREE.DirectionalLight(a.sunColor, a.sunIntensity);
    sun.position.set(...a.sunDirection);
    this.scene.add(sun);
    const reflected = new THREE.DirectionalLight(0xd7e5e5, 1.05);
    reflected.position.set(10, 9, 16);
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
    if (!this.shot) switchMusic(this.game.audio, (k) => this.game.assets.getAudio(k), null);
    for (const [key, volume] of ambient) {
      const buffer = this.game.assets.getAudio(key);
      if (buffer) this.game.audio.startLoop(key, { buffer, volume });
    }
    this.game.ui.hud.show();
    this.game.ui.hud.setLocation(t('ch2.loc.s1'));
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
    this.rig.controller.locked = true;
    this.rig.controller.halt();
    this.popContext = this.game.input.pushContext('puzzle');
  }

  private exitMechanism(): void {
    if (!this.mechanism) return;
    this.mechanism = null;
    this.rig.controller.locked = false;
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
    const line = !p.gateClosed ? t('ch2.s1.hint.gate')
      : !p.crossed ? t('ch2.s1.hint.cross')
      : p.crane === 'unweighted' ? t('ch2.s1.hint.weight')
      : p.crane !== 'landed' ? t('ch2.s1.hint.crane')
      : t('ch2.s1.hint.deck');
    this.game.ui.hud.toast(line);
  }

  private useMechanism(): void {
    const p = this.puzzles, { input, ui } = this.game;
    let prompt: string;
    if (this.mechanism === 'tide') {
      prompt = p.gateClosed ? t('ch2.s1.mech.sealed') : p.canClose ? t('ch2.s1.mech.ebbing')
        : p.outer.transitioning || p.inner.transitioning ? t('ch2.s1.mech.changing') : p.outer.state === 'high' ? t('ch2.s1.mech.wait_ebb') : t('ch2.s1.mech.wait_flood');
    } else if (this.mechanism === 'gate') {
      prompt = p.canClose ? t('ch2.s1.mech.pull_gate') : p.gateClosed ? t('ch2.s1.mech.sealed') : t('ch2.s1.mech.gate_when_ebbing');
    } else {
      prompt = p.craneMoving ? t('ch2.s1.mech.crane_moving')
        : {
            unweighted: t('ch2.s1.mech.crane_unweighted'),
            ready: t('ch2.s1.mech.crane_ready'),
            lifted: t('ch2.s1.mech.crane_lifted'),
            swung: t('ch2.s1.mech.crane_swung'),
            landed: t('ch2.s1.mech.crane_landed'),
          }[p.crane];
    }
    ui.hud.setPrompt(`E\u3000${prompt}`);
    ui.hud.setPuzzleBar(t('ch2.s1.mech.bar'));
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
    dialog.style.color = 'var(--ui-text)';
    dialog.dataset.ui = '';
    dialog.setAttribute('aria-label', t('ch2.s1.journal.aria'));
    const title = document.createElement('h2');
    title.className = 'journal-title';
    title.textContent = t('ch2.s1.journal.title');
    dialog.append(title);
    const lines = [this.puzzles.crane === 'landed' ? t('ch2.s1.journal.goal_landed')
      : this.puzzles.crossed ? t('ch2.s1.journal.goal_crossed')
      : t('ch2.s1.journal.goal_start')];
    if (this.puzzles.boardRead) lines.push(...NOTICE_LINES, ...MARKET_LINES.slice(1), t('ch2.s1.journal.knot'));
    for (const text of lines) {
      const line = document.createElement('p');
      line.textContent = text;
      dialog.append(line);
    }
    const close = document.createElement('button');
    close.className = 'menu-btn';
    close.textContent = t('ch2.s1.journal.close');
    close.onclick = () => dialog.close();
    dialog.append(close);
    this.game.container.append(dialog);
    const pop = this.game.input.pushContext('reading');
    const offPause = this.game.events.on('game:pause', () => dialog.close());
    dialog.addEventListener('close', () => {
      offPause();
      pop();
      dialog.remove();
      this.journal = null;
    }, { once: true });
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
    if (!p.crossed && near(WATCH_POST)) use(t('ch2.s1.prompt.watch'), () => this.enterMechanism('tide'));
    else if (!p.crossed && near(GATE_CONTROL, 0.92)) use(p.canClose ? t('ch2.s1.prompt.gate_ready') : t('ch2.s1.prompt.gate'), () => this.enterMechanism('gate'));
    else if (!p.crossed && near(BOARDING, 0.83)) use(p.canBoard ? t('ch2.s1.prompt.board') : t('ch2.s1.prompt.boat'), () => {
      if (p.board()) this.cue('sfx-raft-float');
      else this.hint();
    });
    else if (p.crossed && p.crane === 'unweighted' && near(COUNTERWEIGHT, 1.25)) use(t('ch2.s1.prompt.weight'), () => {
      if (p.setCounterweight()) this.cue('sfx-raft-lock');
    });
    else if (p.crossed && near(CRANE_CONTROL, 1.23)) use(t('ch2.s1.prompt.crane'), () => this.enterMechanism('crane'));
    else if (near(MARKET_DOOR, 1.37)) use(t('ch2.s1.prompt.market'), () => {
      p.boardRead = true;
      this.showJournal();
    });
    else if (p.crane === 'landed' && near(STAGES.s1.exit, 1.32)) use(t('ch2.s1.prompt.to_s2'), () => {
      this.leaving = true;
      this.travel('s2');
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
    this.art.updateRockLod(this.camera);
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
    if (!this.leaving) this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root, { keep: this.game.assets.sharedResources() });
    this.physics.clear();
    const loaded = new Set(this.game.assets.loadedGroups);
    for (const e of HARBOUR_ASSETS) {
      if (e.group !== 'common' && (!loaded.has(e.group) || e.key === 'ch2-s1-quay-wood' || e.key === 'ch2-s1-cliff-rock')) {
        this.game.assets.unload(e.key);
      }
    }
  }
}
