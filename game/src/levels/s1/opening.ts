import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { PlayerRig } from '@/entities/createPlayer';
import { findArtNode, oarHandleDir, oarlock, rowerSeat, rowingAngles, tieBoatStand, XI_BOAT_NODES, type XiRowingAlign } from '@/entities/xi/boatAlign';
import { XI_CLIP_SPECS, xiClipDuration, xiEventSec } from '@/entities/xi/clips';
import { OPENING_T as T, openingBoatDistance, openingOarSplashTimes } from '@/content/cutscenes/opening';
import { t } from '@/content/text';
import type { CameraKey } from '@/systems/camera/CameraTrack';
import { lookRotation, makePose, smoothstep01 } from '@/systems/camera/CameraTrack';
import { CutsceneClock } from '@/systems/cutscene/CutsceneClock';
import { CutscenePlayer, sampleShots, type Shot, type ShotKey } from '@/systems/cutscene/CutscenePlayer';
import { S1, S3_WORLD_FRAME, v3 } from './layout';

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const ROW = 'xi-row-boat';
const TIE = 'xi-tie-boat';
const PICKUP = 'xi-pickup-table';
const TIED = T.tie + (xiEventSec(TIE, 'tied') ?? xiClipDuration(TIE));
const GRAB = T.pickup + (xiEventSec(PICKUP, 'grab') ?? 0);
const LANTERN_KEY = 'prop-lantern-brass';

type Rowing = XiRowingAlign & { inboardM: number; outboardM: number; bladeLenM: number };

function makeOar(align: Rowing, material: THREE.Material): THREE.Group {
  const { inboardM, outboardM, bladeLenM } = align;
  const root = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, inboardM + outboardM - bladeLenM * 0.5, 8), material);
  shaft.position.y = (inboardM - outboardM + bladeLenM * 0.5) / 2;
  const blade = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material);
  blade.scale.set(0.075, bladeLenM / 2, 0.014);
  blade.position.y = -outboardM + bladeLenM / 2;
  for (const mesh of [shaft, blade]) {
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}

export function makeS1Lantern(game: Game): THREE.Object3D | null {
  if (!game.assets.has(LANTERN_KEY)) return null;
  const lantern = game.assets.getModel(LANTERN_KEY);
  lantern.name = LANTERN_KEY;
  lantern.traverse((o) => {
    if (o.userData.collider === true || /-collider/i.test(o.name) || (o as THREE.Light).isLight) o.visible = false;
  });
  const light = new THREE.PointLight(0xffb060, 1.8, 3.5);
  light.position.y = -0.162;
  lantern.add(light);
  return lantern;
}

export function carryS1Lantern(rig: PlayerRig, lantern: THREE.Object3D | null): void {
  const hand = rig.visual.getObjectByName('hand-item');
  if (!lantern || !hand) return;
  hand.add(lantern);
  lantern.position.set(0, 0, 0);
  lantern.quaternion.identity();
}

interface OpeningOptions {
  game: Game;
  scene: THREE.Scene;
  rig: PlayerRig;
  boat: THREE.Object3D | null;
  pier: THREE.Object3D | undefined;
  lantern: THREE.Object3D | null;
  spawn: THREE.Vector3;
  facing: number;
  establishing: CameraKey[];
}

export class S1Opening {
  readonly camera = new THREE.PerspectiveCamera();
  readonly clock: CutsceneClock;
  readonly player: CutscenePlayer;
  private readonly pose = makePose();
  private readonly shots: Shot[];
  private readonly title = document.createElement('div');
  private readonly oars;
  private readonly outbound = FORWARD.clone().applyAxisAngle(UP, S1.boat.rotationY).negate();
  private readonly yAxis = new THREE.Vector3();
  private readonly berth = v3(S1.boat.position);
  private readonly pos = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private readonly bow;
  private readonly rope;
  private readonly hand;
  private readonly standAt: THREE.Vector3;
  private readonly standYaw: number;
  private readonly lanternAt: THREE.Vector3;
  private readonly pickupAt: THREE.Vector3;
  private readonly walkVec: THREE.Vector3;
  private readonly gazeYaw: number;
  private finished = false;
  private readonly clockListeners: (() => void)[];

  static create(opts: OpeningOptions): S1Opening | null {
    const { boat, pier, rig } = opts;
    if (!boat || !pier || !rig.animator?.has(TIE)) return null;
    const seat = rowerSeat(boat);
    const left = oarlock(boat, 'l'), right = oarlock(boat, 'r');
    const stand = tieBoatStand(pier);
    const bow = findArtNode(boat, XI_BOAT_NODES.bowRing);
    const post = findArtNode(pier, XI_BOAT_NODES.postTop);
    const row = (rig.animator.clips.get(ROW)?.userData.align as { rowing?: Rowing } | undefined)?.rowing;
    if (!seat || !left || !right || !stand || !bow || !post || !row?.yawDegPerFrame?.length || !row.pitchDegPerFrame?.length) return null;
    return new S1Opening(opts, boat, seat, left, right, stand, bow, post, row);
  }

  private constructor(
    private readonly h: OpeningOptions,
    private readonly boat: THREE.Object3D,
    private readonly seat: THREE.Object3D,
    left: THREE.Object3D, right: THREE.Object3D, stand: THREE.Object3D, bow: THREE.Object3D, post: THREE.Object3D,
    private readonly rowing: Rowing,
  ) {
    const { game, scene, rig, lantern } = h;
    this.bow = bow;
    this.hand = rig.visual.getObjectByName('hand_r_socket');
    this.standAt = stand.getWorldPosition(new THREE.Vector3());
    this.standYaw = this.yawOf(stand);
    this.lanternAt = post.getWorldPosition(new THREE.Vector3()).addScaledVector(UP, 0.28);
    this.pickupAt = new THREE.Vector3(0.05, 0, -0.08).applyAxisAngle(UP, this.standYaw).add(this.standAt);
    this.walkVec = h.spawn.clone().sub(this.pickupAt).setY(0);
    this.gazeYaw = Math.atan2(S3_WORLD_FRAME.towerCenter[0] - h.spawn.x, S3_WORLD_FRAME.towerCenter[2] - h.spawn.z);
    const wood = new THREE.MeshStandardMaterial({ color: 0x695240, roughness: 0.73 });
    this.oars = ([['l', left], ['r', right]] as const).map(([side, lock]) => {
      const object = makeOar(rowing, wood);
      object.name = `s1-oar-${side}`;
      const pivot = boat.worldToLocal(lock.getWorldPosition(new THREE.Vector3()));
      const stowed = new THREE.Vector3(side === 'l' ? -0.23 : 0.23, 0.51, 0.72);
      boat.add(object);
      return { side, object, pivot, stowed };
    });
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 8), new THREE.MeshStandardMaterial({ color: 0x73614c, roughness: 1 }));
    this.rope.name = 's1-opening-mooring-line';
    this.rope.visible = false;
    scene.add(this.rope);
    if (lantern) {
      boat.add(lantern);
      lantern.position.set(0, 0.89, 1.31);
    }

    this.shots = this.buildShots(h.establishing);
    this.title.className = 'opening-title';
    this.title.hidden = true;
    this.title.textContent = t('ch1.intro.title_card');
    game.ui.hud.el.before(this.title);
    game.ui.hud.hide();
    game.ui.subtitles.track.setTimeline([{ at: T.subtitle, id: 'ch1.intro.line_home', duration: 4 }]);
    game.ui.fade.set(1);
    rig.controller.pin(h.spawn, h.facing);
    let resuming = false;
    this.clock = new CutsceneClock({ audio: () => null, now: () => performance.now(), paused: () => game.isPaused || document.hidden || resuming });
    this.clockListeners = [
      game.events.on('game:pause', () => this.clock.tick()),
      game.events.on('game:resume', () => {
        resuming = true;
        this.clock.tick();
        resuming = false;
      }),
    ];
    const horn = (): void => game.events.emit('sfx:play', { id: 'amb-foghorn-far', optional: true });
    const splash = (): void => {
      const water = game.assets.getAudio('sfx-splash-cold');
      if (water) game.audio.playBuffer(water, 0.28, 1.45);
    };
    this.player = new CutscenePlayer({
      id: 'ch1-opening', duration: T.end, clock: this.clock,
      cues: [
        { id: 'foghorn', at: 0, run: horn },
        { id: 'foghorn-close', at: T.close, run: horn },
        ...openingOarSplashTimes().map((at, i) => ({ id: `oar-splash-${i}`, at, run: splash })),
        { id: 'benchmark', at: T.benchmark, run: () => { game.benchmark.start(); } },
      ],
      onUpdate: (time) => this.sample(time),
      onFinish: () => this.finish(),
    });
    this.sample(0);
  }

  get moored(): boolean {
    return this.finished || this.clock.t >= TIED;
  }

  update(tideLevel: number): void {
    this.berth.y = Math.max(S1.boat.groundY, tideLevel - S1.boat.belowWater);
    if (this.player.done) this.clock.tick();
    else this.player.update();
  }

  updateRope(): void {
    const time = this.clock.t;
    this.rope.visible = !this.finished && time >= T.tie && time < TIED && !!this.hand;
    if (!this.rope.visible || !this.hand) return;
    this.bow.getWorldPosition(this.pos);
    this.hand.getWorldPosition(this.dir);
    this.rope.position.lerpVectors(this.pos, this.dir, 0.5);
    this.dir.sub(this.pos);
    this.rope.scale.y = this.dir.length();
    this.rope.quaternion.setFromUnitVectors(UP, this.dir.normalize());
  }

  dispose(): void {
    if (!this.finished) {
      const { ui, flow } = this.h.game;
      ui.subtitles.track.endTimeline();
      if (!flow.transitioning) ui.fade.set(0);
    }
    for (const off of this.clockListeners) off();
    this.title.remove();
    this.rope.removeFromParent();
    this.rope.geometry.dispose();
    this.rope.material.dispose();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const { game, rig, lantern, spawn, facing } = this.h;
    this.placeBoat(T.tie);
    this.placeXi(spawn, facing);
    rig.animator?.clearPose();
    rig.controller.unpin();
    carryS1Lantern(rig, lantern);
    this.sampleCamera(T.end);
    this.title.hidden = true;
    this.rope.visible = false;
    game.ui.subtitles.track.endTimeline();
    game.ui.fade.set(0);
  }

  private placeBoat(time: number): void {
    this.boatPosition(time, this.boat.position);
    const rowTime = Math.max(0, Math.min(time, T.stow + 0.3) - T.reveal);
    const { yawDeg, pitchDeg } = rowingAngles(this.rowing, rowTime);
    const stow = smoothstep01((time - T.stow) / (T.glide - T.stow));
    for (const { side, object, pivot, stowed } of this.oars) {
      // The seat faces the stern; the oars are parented to the hull, which faces the bow.
      oarHandleDir(yawDeg, pitchDeg, side, this.dir).applyAxisAngle(UP, Math.PI);
      this.dir.lerp(this.yAxis.set(0, 0, 1), stow).normalize();
      object.position.lerpVectors(pivot, stowed, stow);
      object.quaternion.setFromUnitVectors(UP, this.dir);
    }
  }

  private boatPosition(time: number, out: THREE.Vector3): THREE.Vector3 {
    const distance = openingBoatDistance(time);
    out.copy(this.berth).addScaledVector(this.outbound, distance);
    // Hold off the exposed reef beside the approach; line up with the berth after shipping the oars.
    out.z -= smoothstep01(distance / openingBoatDistance(T.glide));
    return out;
  }

  private yawOf(o: THREE.Object3D): number {
    this.dir.copy(FORWARD).applyQuaternion(o.getWorldQuaternion(this.pose.quaternion));
    return Math.atan2(this.dir.x, this.dir.z);
  }

  private placeXi(p: THREE.Vector3, yaw: number): void {
    this.h.rig.body.teleport(p);
    this.h.rig.controller.facing = yaw;
  }

  private sample(time: number): void {
    const { game, scene, rig, lantern, facing } = this.h;
    const animator = rig.animator!;
    this.placeBoat(time);
    if (time < T.tie) {
      this.placeXi(this.seat.getWorldPosition(this.pos), this.yawOf(this.seat));
      const cycle = xiClipDuration(ROW);
      animator.setPose(ROW, (Math.max(0, Math.min(time, T.stow + 0.3) - T.reveal)) % cycle);
    } else if (time < T.pickup) {
      if (lantern?.parent === this.boat) {
        // The bow insert covers Xi stepping ashore and setting the lantern down to free both hands.
        scene.add(lantern);
        lantern.position.copy(this.lanternAt);
      }
      this.placeXi(this.standAt, this.standYaw);
      if (time < T.tie + xiClipDuration(TIE)) animator.setPose(TIE, time - T.tie);
      else animator.clearPose();
    } else if (time < T.walk) {
      this.placeXi(this.pickupAt, this.standYaw);
      if (lantern) {
        animator.setPose(PICKUP, Math.min(time - T.pickup, xiClipDuration(PICKUP)));
        if (time >= GRAB && lantern.parent === scene) carryS1Lantern(rig, lantern);
      }
    } else {
      if (lantern?.parent === scene) carryS1Lantern(rig, lantern);
      const walk = Math.min(1, (time - T.walk) / (T.gaze - T.walk));
      const walkYaw = Math.atan2(this.walkVec.x, this.walkVec.z);
      const turn = smoothstep01((time - T.gaze) / 1.1);
      const look = walkYaw + Math.atan2(Math.sin(this.gazeYaw - walkYaw), Math.cos(this.gazeYaw - walkYaw)) * turn;
      this.pos.lerpVectors(this.pickupAt, this.h.spawn, walk);
      this.placeXi(this.pos, time >= T.establishing ? facing : look);
      if (walk < 1) {
        const clip = lantern ? 'xi-walk-lantern' : 'xi-walk';
        animator.setPose(clip, (walk * this.walkVec.length() / XI_CLIP_SPECS[clip].strideSpeed) % xiClipDuration(clip));
      } else if (time < T.establishing) {
        animator.setPose('xi-stand-gaze', (time - T.gaze) % xiClipDuration('xi-stand-gaze'));
      } else animator.clearPose();
    }
    this.sampleCamera(time);
    game.ui.fade.set(1 - smoothstep01((time - T.reveal) / 2));
    game.ui.subtitles.track.playAt(time);
    const titleOpacity = THREE.MathUtils.clamp(Math.min(time - T.title, T.title + 4 - time), 0, 1);
    this.title.hidden = titleOpacity <= 0;
    this.title.style.opacity = String(titleOpacity);
  }

  private sampleCamera(time: number): void {
    sampleShots(this.shots, time, this.pose);
    this.camera.position.copy(this.pose.position);
    this.camera.quaternion.copy(this.pose.quaternion);
    this.camera.fov = this.pose.fov;
  }

  private buildShots(establishing: CameraKey[]): Shot[] {
    const key = (eye: number[], at: number[], fov: number): ShotKey => ({
      position: new THREE.Vector3().fromArray(eye), lookAt: new THREE.Vector3().fromArray(at), fov,
    });
    const alongside = (time: number, eye: number[], at: number[], fov: number): ShotKey => {
      const p = this.boatPosition(time, new THREE.Vector3());
      const k = key(eye, at, fov);
      k.position.add(p);
      k.lookAt.add(p);
      return k;
    };
    const [deck, close, end] = establishing as [CameraKey, CameraKey, CameraKey];
    const cameraKey = (k: CameraKey): ShotKey => {
      const at = k.lookAt ?? k.position.clone().add(new THREE.Vector3(0, 0, -1).applyQuaternion(k.quaternion ?? lookRotation(k.position, this.h.spawn)));
      return { position: k.position, lookAt: at, fov: k.fov ?? 55 };
    };
    return [
      { name: 'offshore', start: 0, end: T.close, ease: 'linear',
        from: alongside(T.reveal, [-0.4, 4.35, 9.4], [-0.45, 1.7, -0.8], 47),
        to: alongside(T.close, [-0.3, 3.9, 8], [-0.65, 1.6, -0.3], 46) },
      { name: 'rowing', start: T.close, end: T.berth, ease: 'linear',
        from: alongside(T.close, [2.15, 2.05, -4.15], [-0.25, 0.72, 0], 45),
        to: alongside(T.berth, [1.7, 2.25, -3.8], [-0.45, 0.63, 0], 44) },
      { name: 'arrival', start: T.berth, end: T.docking,
        from: key([7.3, 4.35, -16.25], [4.85, 1.95, -10.95], 47),
        to: key([6.6, 4.1, -15.6], [4.55, 2, -10.95], 46) },
      { name: 'bow', start: T.docking, end: T.tie,
        from: key([3.72, 2.8, -12.4], [4.17, 2, -11.02], 34),
        to: key([3.67, 2.79, -12.38], [4.05, 2, -11.05], 34) },
      { name: 'mooring', start: T.tie, end: T.walk,
        from: key([5.35, 3.55, -14.3], [3.75, 2.6, -11.17], 44),
        to: key([5.1, 3.45, -14.5], [3.53, 2.52, -11.31], 44) },
      { name: 'home', start: T.walk, end: T.establishing,
        from: key([1.1, 3.9, -7.35], [2.9, 3.22, -12.1], 45),
        to: key([0.85, 3.82, -7.6], [2.68, 3.26, -12.2], 44) },
      { name: 'establishing', start: T.establishing, end: T.establishing + close.time, from: cameraKey(deck), to: cameraKey(close) },
      { name: 'handoff', start: T.establishing + close.time, end: T.end, from: cameraKey(close), to: cameraKey(end) },
    ];
  }
}
