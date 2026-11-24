import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { disposeObject3D } from '@/core/dispose';
import { createPlayer, type PlayerRig } from '@/entities/createPlayer';
import { EntityManager } from '@/entities/EntityManager';
import { TraversalLink } from '@/entities/components/TraversalLink';
import { BaseScene } from '@/scenes/BaseScene';
import { CameraFollowSystem } from '@/systems/CameraFollowSystem';
import { PhysicsSystem } from '@/systems/PhysicsSystem';
import { v } from './geometry';
import { CABLE_FROM, CABLE_TO, STAGES, VIEWS, type Point, type Stage } from './layout';
import { buildVillage } from './village';

const LABELS: Record<Stage, ReadonlyArray<readonly [string, Point, number]>> = {
  s1: [
    ['北鲱号', [-8, 13, -21], 5],
    ['鱼闸 · 占位', [2.6, 2.4, -10], 3.7],
    ['吊鱼箱 · 占位', [8, 4, -23.9], 3.7],
    ['船舱鱼市', [4.8, 8.1, -34.5], 3.2],
  ],
  s2: [
    ['甲板广场', [1, 13.3, -51], 4],
    ['镜巷传光 · 占位', [-13.2, 17.3, -55], 4.7],
    ['熏鱼房', [4.1, 14.9, -66], 3.4],
  ],
  s3: [
    ['苇婶家', [-20, 42.1, -15], 3.7],
    ['缆车配重 · 占位', [-21, 42.1, -9], 4.4],
    ['半盏灯 · 棱镜占位', [-4, 34.7, 35], 2.8],
  ],
};

function sign(text: string, position: Point, width: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#202c33';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#a9bbbc';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
  ctx.fillStyle = '#f1e8d5';
  ctx.font = 'bold 55px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2, canvas.width - 22);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map, toneMapped: false }));
  sprite.position.copy(v(position));
  sprite.scale.set(width, width * 0.1875, 1);
  return sprite;
}

function nameFor(stage: Stage): string {
  return `ch2-whitebox-${stage}`;
}

class WhiteboxScene extends BaseScene {
  readonly name: string;
  private readonly physics = new PhysicsSystem();
  private readonly entities = new EntityManager(this.scene);
  private readonly follow: CameraFollowSystem;
  private readonly rig: PlayerRig;
  private readonly shot;
  private leaving = false;

  constructor(game: Game, private stage: Stage, view: string | null) {
    super(game);
    this.name = nameFor(stage);
    this.shot = view ? VIEWS[stage][view] : undefined;
    const spawn = v(STAGES[stage].spawn);
    this.follow = new CameraFollowSystem(this.camera, game.input, {
      physics: this.physics,
      events: game.events,
    });
    this.rig = createPlayer(game, this.physics, spawn.clone().add(new THREE.Vector3(0, 0.1, 0)), () => this.follow.yaw);
    this.follow.target = this.rig.entity.object3D;
    const heading = v(STAGES[stage].look).sub(spawn);
    this.follow.yaw = Math.atan2(-heading.x, -heading.z);
    this.follow.pitch = Math.atan2(heading.y - 1.35, Math.hypot(heading.x, heading.z));
    this.cleanups.push(() => this.follow.dispose());
  }

  override enter(): void {
    this.scene.background = new THREE.Color(0xa7b8bf);
    this.scene.fog = new THREE.Fog(0xa7b8bf, 36, 230);
    this.scene.add(new THREE.HemisphereLight(0xdae6ed, 0x776c60, 2.0));
    const sky = new THREE.DirectionalLight(0xe7eced, 2.0);
    sky.position.set(-12, 25, 14);
    this.scene.add(sky);
    this.scene.add(buildVillage(this.physics));
    this.entities.add(this.rig.entity);
    if (this.shot) this.rig.visual.visible = false;
    for (const [text, p, width] of LABELS[this.stage]) this.scene.add(sign(text, p, width));
    this.physics.killY = -1.4;
    this.physics.onFallOut = () => void this.rig.controller.teleportTo(v(STAGES[this.stage].spawn));
    if (this.stage === 's3') {
      for (const [start, end] of [[CABLE_FROM, CABLE_TO], [CABLE_TO, CABLE_FROM]] as const) {
        this.rig.controller.links.push(new TraversalLink({
          start: v(start), end: v(end), radius: 1.5, walkInto: false, prompt: 'E　缆车跨越（白盒）',
        }));
      }
    }
    this.game.ui.hud.show();
    this.game.ui.hud.setLocation(`裂湾村白盒 · ${STAGES[this.stage].title}`);
    this.follow.snap();
    this.positionCamera(0);
  }

  override fixedUpdate(dt: number): void {
    if (this.shot || this.leaving) return;
    const stage = STAGES[this.stage];
    const atExit = 'exit' in stage && this.rig.body.position.distanceTo(v(stage.exit)) < 1.8;
    this.game.ui.hud.setPrompt(atExit && 'next' in stage
      ? `E\u3000前往${STAGES[stage.next].title}` : this.rig.controller.nearLink?.prompt ?? null);
    if (atExit && 'next' in stage && this.game.input.consumePressed('interact')) {
      this.leaving = true;
      void this.game.scenes.change(nameFor(stage.next));
      return;
    }
    this.entities.fixedUpdate(dt);
    this.physics.step(dt);
    this.rig.body.afterPhysics();
  }

  override update(dt: number, alpha: number): void {
    this.entities.update(dt, alpha);
    this.positionCamera(dt);
  }

  override exit(): void {
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.hide();
    this.game.ui.fade.set(0);
    for (const root of this.entities.clear()) disposeObject3D(root);
    this.physics.clear();
  }

  private positionCamera(dt: number): void {
    if (!this.shot) {
      this.follow.update(dt);
      return;
    }
    this.camera.position.copy(v(this.shot[0]));
    this.camera.lookAt(v(this.shot[1]));
    this.camera.fov = 59;
    this.camera.updateProjectionMatrix();
  }
}

export async function openWhitebox(game: Game, stage: Stage, view: string | null): Promise<void> {
  for (const id of ['s1', 's2', 's3'] as const) {
    game.scenes.register(nameFor(id), (g) => new WhiteboxScene(g, id, id === stage ? view : null));
  }
  await game.scenes.change(nameFor(stage));
}
