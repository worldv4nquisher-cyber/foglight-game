import * as THREE from 'three';
import type { Game } from '@/core/Game';
import type { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { CameraTrack, makePose } from '@/systems/camera/CameraTrack';
import { CutsceneClock } from '@/systems/cutscene/CutsceneClock';
import { CutscenePlayer, sampleShots, shotAt, type CutsceneEnd, type Shot, type ShotKey } from '@/systems/cutscene/CutscenePlayer';
import { ENDING_MUSIC, ENDING_SKIP_FADE_SEC } from '@/systems/audio/endingMusic';
import {
  CH2_ENDING_CUE_LIST,
  CH2_ENDING_ID,
  CH2_ENDING_SUBTITLES,
  CH2_ENDING_T,
  CH2_FOG_OPEN_K,
  ch2DistantGlowAt,
  ch2FadeAt,
  ch2FogOpenAt,
  ch2RelayProgressAt,
} from '@/content/cutscenes/ch2Ending';
import { disposeObject3D } from '@/core/dispose';
import { v } from './geometry';
import { MirrorRelay, RECEIVER, RELAY } from './mirrorRelay';

const UP = new THREE.Vector3(0, 1, 0);
const DISTANT_TOWER = new THREE.Vector3(16, 0, 148);

export interface Ch2EndingHost {
  game: Game;
  scene: THREE.Scene;
  cameraFollow: CameraFollowSystem;
  alive(): boolean;
  onComplete(): Promise<void>;
}

interface RelaySegment {
  group: THREE.Group;
  coreMat: THREE.MeshBasicMaterial;
  haloMat: THREE.MeshBasicMaterial;
}

export class Ch2Ending {
  readonly clock: CutsceneClock;
  readonly player: CutscenePlayer;
  readonly shots: Shot[];
  readonly cam = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
  private readonly propsRoot = new THREE.Group();
  private readonly segments: RelaySegment[] = [];
  private readonly mirrorNodes: Array<{ mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight }> = [];
  private readonly receiverNode: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight };
  private readonly distantBeacon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly distantHalo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly distantBeam: THREE.Group;
  private readonly pose = makePose();
  private fogBase = 0.0088;
  private started = false;
  private skipFade: { from: number; t0: number } | null = null;
  private finishing = false;
  private offs: Array<() => void> = [];
  endedBy: CutsceneEnd | null = null;

  constructor(private readonly h: Ch2EndingHost) {
    const { game } = h;
    this.clock = new CutsceneClock({
      audio: () => null,
      now: () => performance.now(),
      paused: () => game.isPaused,
    });
    const cues = CH2_ENDING_CUE_LIST.map(([id, at]) => ({ id, at, run: () => this.onCue(id) }));
    this.player = new CutscenePlayer({
      id: CH2_ENDING_ID,
      duration: CH2_ENDING_T.end,
      cues,
      clock: this.clock,
      onUpdate: (t) => this.step(t),
      onFinish: (how) => this.finish(how),
    });
    this.cam.name = 'ch2-ending-cam';
    this.shots = this.buildShots();
    this.propsRoot.name = 'ch2-ending-props';
    this.propsRoot.visible = false;

    const { receiverNode, distantBeacon, distantHalo, distantBeam } = this.buildProps();
    this.receiverNode = receiverNode;
    this.distantBeacon = distantBeacon;
    this.distantHalo = distantHalo;
    this.distantBeam = distantBeam;

    h.scene.add(this.cam, this.propsRoot);
  }

  get active(): boolean {
    return (this.started && !this.player.done) || this.skipFade !== null;
  }

  get t(): number {
    return this.player.t;
  }

  get shot(): string | null {
    return this.player.t >= CH2_ENDING_T.towerOut ? (shotAt(this.shots, this.player.t)?.name ?? null) : null;
  }

  start(): void {
    if (this.started || this.finishing) return;
    this.started = true;
    const { game, scene } = this.h;
    this.fogBase = scene.fog instanceof THREE.FogExp2 ? scene.fog.density : 0.0088;
    this.propsRoot.visible = true;
    game.ui.hud.setPrompt(null);
    game.ui.hud.setPuzzleBar(null);
    game.ui.hud.hide();
    game.ui.subtitles.track.setTimeline(CH2_ENDING_SUBTITLES);
    this.startMusic();
    this.offs.push(
      game.ui.skip.register(
        {
          id: CH2_ENDING_ID,
          active: () => this.started && !this.player.done && !this.finishing,
          onSkip: () => this.player.skip(),
        },
        performance.now(),
      ),
    );
    this.player.update();
  }

  update(dt: number): void {
    if (this.skipFade) {
      const k = Math.min(1, (performance.now() - this.skipFade.t0) / (ENDING_SKIP_FADE_SEC * 1000));
      this.h.game.ui.fade.set(this.skipFade.from + (1 - this.skipFade.from) * k);
      if (k >= 1) {
        this.skipFade = null;
        void this.complete();
      }
      return;
    }
    if (!this.started || this.player.done) return;
    this.distantBeam.rotation.y += dt * 0.28;
    this.player.update();
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.skipFade = null;
    this.h.game.ui.subtitles.track.clear();
    this.h.cameraFollow.stopCutscene();
    this.cam.removeFromParent();
    this.propsRoot.removeFromParent();
    disposeObject3D(this.propsRoot);
    if (!this.h.game.assets.loadedGroups.includes('s3')) {
      this.h.game.assets.unload(ENDING_MUSIC);
    }
  }

  private startMusic(): void {
    const { audio, assets } = this.h.game;
    void assets.loadAudio(ENDING_MUSIC).then((buf) => {
      if (!buf || !this.h.alive() || this.finishing) return;
      audio.playMusic(buf, { key: ENDING_MUSIC, loop: false, fadeIn: 0.4, crossfade: 0.4 });
    });
  }

  private onCue(id: (typeof CH2_ENDING_CUE_LIST)[number][0]): void {
    if (id === 'tower_out') {
      const { cameraFollow } = this.h;
      this.applyCamera(CH2_ENDING_T.towerOut);
      void cameraFollow.playCutscene(
        new CameraTrack({
          name: CH2_ENDING_ID,
          node: this.cam,
          duration: CH2_ENDING_T.end + 10,
          skippable: false,
          ease: false,
          clock: () => this.player.t,
        }),
      );
    }
  }

  private step(t: number): void {
    const { scene, game } = this.h;
    game.ui.subtitles.track.playAt(t);

    if (scene.fog instanceof THREE.FogExp2) {
      const k = ch2FogOpenAt(t);
      scene.fog.density = this.fogBase * (1 + (CH2_FOG_OPEN_K - 1) * k);
    }

    const relay = ch2RelayProgressAt(t);
    const totalSegs = this.segments.length;
    for (let i = 0; i < totalSegs; i++) {
      const seg = this.segments[i]!;
      const local = THREE.MathUtils.clamp(relay * totalSegs - i, 0, 1);
      seg.group.visible = local > 0.01;
      seg.coreMat.opacity = 0.85 * local;
      seg.haloMat.opacity = 0.24 * local;
    }
    for (let i = 0; i < this.mirrorNodes.length; i++) {
      const node = this.mirrorNodes[i]!;
      const local = THREE.MathUtils.clamp(relay * totalSegs - i, 0, 1);
      node.mesh.visible = local > 0.01;
      node.mesh.material.opacity = 0.9 * local;
      node.light.intensity = 14 * local;
    }
    const rec = THREE.MathUtils.clamp(relay * totalSegs - (totalSegs - 1), 0, 1);
    this.receiverNode.mesh.visible = rec > 0.01;
    this.receiverNode.mesh.material.opacity = 0.95 * rec;
    this.receiverNode.light.intensity = 22 * rec;

    const distant = ch2DistantGlowAt(t);
    const pulse = 0.92 + Math.sin(t * 2.1) * 0.08;
    this.distantBeacon.material.opacity = distant * pulse;
    this.distantHalo.material.opacity = distant * 0.35 * pulse;
    this.distantBeam.visible = distant > 0.05;

    if (t >= CH2_ENDING_T.towerOut) this.applyCamera(t);

    const fade = ch2FadeAt(t);
    if (fade > 0) game.ui.fade.set(fade);
  }

  private applyCamera(t: number): void {
    sampleShots(this.shots, t, this.pose);
    this.cam.position.copy(this.pose.position);
    this.cam.quaternion.copy(this.pose.quaternion);
    this.cam.fov = this.pose.fov;
    this.cam.updateProjectionMatrix();
  }

  private finish(how: CutsceneEnd): void {
    if (this.finishing) return;
    this.finishing = true;
    this.endedBy = how;
    for (const off of this.offs.splice(0)) off();
    const { game } = this.h;
    if (how === 'skip') {
      game.events.emit('cutscene:skip', { id: CH2_ENDING_ID });
      if (game.audio.musicKey === ENDING_MUSIC) game.audio.stopMusic(ENDING_SKIP_FADE_SEC);
      game.ui.subtitles.track.clear();
      this.skipFade = { from: game.ui.fade.opacity, t0: performance.now() };
      return;
    }
    game.ui.fade.set(1);
    void this.complete();
  }

  private async complete(): Promise<void> {
    const { game, cameraFollow } = this.h;
    game.ui.subtitles.track.clear();
    cameraFollow.stopCutscene();
    if (!this.h.alive()) return;
    await this.h.onComplete();
  }

  private buildShots(): Shot[] {
    const k = (pos: [number, number, number], look: [number, number, number], fov: number): ShotKey => ({
      position: new THREE.Vector3(...pos),
      lookAt: new THREE.Vector3(...look),
      fov,
    });
    return [
      {
        name: 'tower-out',
        start: CH2_ENDING_T.towerOut,
        end: CH2_ENDING_T.gorgeRelay,
        from: k([10, 36.5, 48], [-4, 33.4, 35], 46),
        to: k([16, 39, 55], [-4, 32.8, 30], 48),
        ease: 'linear',
      },
      {
        name: 'gorge-relay',
        start: CH2_ENDING_T.gorgeRelay,
        end: CH2_ENDING_T.distantAnswer,
        from: k([2, 29, -28], [1, 19, -58], 52),
        to: k([-3, 25, -62], [11, 25, -83], 50),
        ease: 'linear',
      },
      {
        name: 'distant-answer',
        start: CH2_ENDING_T.distantAnswer,
        end: CH2_ENDING_T.pullBack,
        from: k([-12, 35.2, 31], [16, 20, 148], 40),
        to: k([-16, 36.5, 25], [16, 21, 148], 38),
        ease: 'out',
      },
      {
        name: 'pull-back',
        start: CH2_ENDING_T.pullBack,
        end: CH2_ENDING_T.end,
        from: k([28, 52, 62], [-4, 24, -10], 54),
        to: k([40, 64, 78], [-4, 22, -16], 56),
        ease: 'out',
      },
    ];
  }

  private buildProps(): {
    receiverNode: { mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight };
    distantBeacon: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    distantHalo: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
    distantBeam: THREE.Group;
  } {
    const solved = new MirrorRelay(true).trace();
    const coreGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 8, 1, true);
    const haloGeo = new THREE.CylinderGeometry(0.32, 0.48, 1, 10, 1, true);
    for (let i = 0; i < solved.points.length - 1; i++) {
      const a = solved.points[i]!;
      const b = solved.points[i + 1]!;
      const delta = b.clone().sub(a);
      const coreMat = new THREE.MeshBasicMaterial({
        color: 0xffe4a8, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffc872, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(coreGeo, coreMat), new THREE.Mesh(haloGeo, haloMat));
      group.position.copy(a).addScaledVector(delta, 0.5);
      group.scale.y = delta.length();
      group.quaternion.setFromUnitVectors(UP, delta.normalize());
      group.visible = false;
      this.segments.push({ group, coreMat, haloMat });
      this.propsRoot.add(group);
    }

    const nodeGeo = new THREE.SphereGeometry(0.52, 12, 8);
    for (const mirror of RELAY) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd98e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(nodeGeo, mat);
      mesh.position.copy(v(mirror.center));
      mesh.visible = false;
      const light = new THREE.PointLight(0xffcb78, 0, 18);
      light.position.copy(mesh.position);
      this.mirrorNodes.push({ mesh, light });
      this.propsRoot.add(mesh, light);
    }

    const recMat = new THREE.MeshBasicMaterial({
      color: 0xffd47a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const recMesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 10), recMat);
    recMesh.position.copy(v(RECEIVER));
    recMesh.visible = false;
    const recLight = new THREE.PointLight(0xffc366, 0, 26);
    recLight.position.copy(recMesh.position);
    this.propsRoot.add(recMesh, recLight);

    // 远处归岸岛灯塔（第一章点亮的那座）
    const distantGroup = new THREE.Group();
    distantGroup.position.copy(DISTANT_TOWER);
    const silMat = new THREE.MeshBasicMaterial({ color: 0x263238 });
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(7, 11, 8, 10), silMat);
    rock.position.y = 3;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 2.0, 16, 12), silMat);
    shaft.position.y = 14;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 2.1, 12), silMat);
    cap.position.y = 24.1;
    const distantBeacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.95, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffc675, transparent: true, opacity: 0, fog: false }),
    );
    distantBeacon.position.y = 22.6;
    const distantHalo = new THREE.Mesh(
      new THREE.SphereGeometry(3.2, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xffb964, transparent: true, opacity: 0, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    distantHalo.position.y = 22.6;

    const distantBeam = new THREE.Group();
    distantBeam.position.y = 22.6;
    distantBeam.visible = false;
    const coneGeo = new THREE.ConeGeometry(4.5, 42, 16, 1, true);
    coneGeo.translate(0, -21, 0);
    coneGeo.rotateZ(Math.PI / 2);
    const coneMat = new THREE.MeshBasicMaterial({
      color: 0xffbe6b, transparent: true, opacity: 0.16, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const b1 = new THREE.Mesh(coneGeo, coneMat);
    const b2 = new THREE.Mesh(coneGeo, coneMat);
    b2.rotation.y = Math.PI;
    distantBeam.add(b1, b2);

    distantGroup.add(rock, shaft, cap, distantBeacon, distantHalo, distantBeam);
    this.propsRoot.add(distantGroup);

    return {
      receiverNode: { mesh: recMesh, light: recLight },
      distantBeacon,
      distantHalo,
      distantBeam,
    };
  }
}
