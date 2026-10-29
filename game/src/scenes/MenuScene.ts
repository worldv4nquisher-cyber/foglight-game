import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { Rain } from '@/world/Rain';
import { BaseScene } from './BaseScene';

/** 主菜单背景的雨丝数量（远少于游戏内，主菜单要轻） */
const MENU_RAIN_DROPS = 4000;

/** 软边雾贴片纹理（canvas 生成，不占资源包） */
function fogTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 菜单背景场景（v0.1-008，GDD §10）：雨中灯塔远景——灯塔剪影 + 雾墙贴片 + 雨粒子，缓慢推镜。
 * 全部程序生成（不加载任何文件），远低于主菜单包 15 MB 预算；不走后处理，不存档，不可暂停。
 * Esc（menu 上下文里由 Game 发 ui:back）只用来从设置 / 制作名单 / 确认弹窗返回。
 */
export class MenuScene extends BaseScene {
  readonly name: string = 'menu';
  override pausable = false;
  /** 章节结束页复用同一背景，灯是亮着的 */
  protected lit = false;
  private rain = new Rain(40, 24);
  private fogs: THREE.Mesh[] = [];
  private beam = new THREE.Group();
  private lamp!: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private time = 0;
  private fogTex = fogTexture();

  constructor(game: Game) {
    super(game);
    this.camera.fov = 42;
    this.camera.far = 300;
    this.camera.updateProjectionMatrix();
  }

  override enter(): void {
    const fogColor = 0x1d252c;
    this.scene.background = new THREE.Color(fogColor);
    this.scene.fog = new THREE.FogExp2(fogColor, 0.022);
    this.buildLighthouse();
    this.buildSea();
    this.buildFog();
    this.rain.setCount(MENU_RAIN_DROPS);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    this.placeCamera(0);
    this.showUi();
    this.cleanups.push(
      this.game.events.on('ui:back', () => this.onBack()),
      () => this.fogTex.dispose(),
    );
  }

  protected showUi(): void {
    this.game.ui.hud.hide();
    this.game.ui.mainMenu.show();
  }

  protected onBack(): void {
    this.game.ui.mainMenu.back();
  }

  override exit(): void {
    this.game.ui.mainMenu.hide();
  }

  override update(dt: number): void {
    this.time += dt;
    this.placeCamera(this.time);
    this.beam.rotation.y += dt * 0.3;
    if (this.lit) this.lamp.material.color.setScalar(1).multiplyScalar(0.92 + Math.sin(this.time * 1.7) * 0.06);
    for (const [i, f] of this.fogs.entries()) {
      f.position.x += Math.sin(this.time * 0.05 + i) * dt * 0.3 + dt * 0.4;
      if (f.position.x > 60) f.position.x = -60;
      f.lookAt(this.camera.position.x, f.position.y, this.camera.position.z);
    }
    this.rain.update(dt, this.camera);
  }

  /** 缓慢推镜：约 60 s 从远处推近一段，然后往复 */
  private placeCamera(t: number): void {
    const k = 0.5 - 0.5 * Math.cos((t / 60) * Math.PI);
    this.camera.position.set(-6 + k * 2, 3.2 + k * 0.4, 34 - k * 8);
    this.camera.lookAt(4, 6.5, -6);
  }

  private buildLighthouse(): void {
    const sil = new THREE.MeshBasicMaterial({ color: 0x0c1014 });
    const g = new THREE.Group();
    g.position.set(6, 0, -8);
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(7, 10, 3, 10), sil);
    rock.position.y = 0.5;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.5, 11, 16), sil);
    tower.position.y = 7.5;
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.25, 16), sil);
    gallery.position.y = 13.1;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.4, 16), sil);
    cap.position.y = 14.9;
    this.lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 16, 12),
      new THREE.MeshBasicMaterial({ color: this.lit ? 0xffb066 : 0x2a2f33, fog: false }),
    );
    this.lamp.position.y = 13.8;
    g.add(rock, tower, gallery, cap, this.lamp);
    // 光束（只在亮灯时显示）：加色混合的长锥，绕塔缓慢旋转
    if (this.lit) {
      const beamMat = new THREE.MeshBasicMaterial({
        color: 0xffb066,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
      });
      const geo = new THREE.ConeGeometry(3.5, 40, 20, 1, true);
      geo.translate(0, -20, 0);
      geo.rotateZ(Math.PI / 2);
      const b1 = new THREE.Mesh(geo, beamMat);
      const b2 = new THREE.Mesh(geo, beamMat);
      b2.rotation.y = Math.PI;
      this.beam.add(b1, b2);
      this.beam.position.y = 13.8;
      g.add(this.beam);
    }
    this.scene.add(g);
  }

  private buildSea(): void {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x141b21 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.2;
    this.scene.add(sea);
  }

  private buildFog(): void {
    const mat = new THREE.MeshBasicMaterial({ map: this.fogTex, color: 0x6d7a84, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 14), mat);
      m.position.set(-60 + i * 15, 2 + (i % 3) * 2.5, -4 + (i % 4) * 6);
      this.fogs.push(m);
      this.scene.add(m);
    }
  }
}

/**
 * 章节结束页场景（v0.1-008）：同一个雨中灯塔背景，灯已点亮；叠 ChapterEnd 页。
 * 存档点：进入时写 chapterComplete（GDD §11：点灯进入章节结束页时存档），之后「继续」回到这一页。
 */
export class ChapterEndScene extends MenuScene {
  override readonly name = 'chapter-end';
  protected override lit = true;
  override savePoint = { chapterId: 'ch1', sceneId: 'end', chapterComplete: true };

  protected override showUi(): void {
    this.game.ui.hud.hide();
    const s = this.game.save.lastSave;
    this.game.ui.chapterEnd.show({ playTimeSec: s?.playTimeSec ?? this.game.save.playTimeSec, hintsUsed: s?.hintsUsed ?? 0 });
  }

  protected override onBack(): void {}

  override exit(): void {
    this.game.ui.chapterEnd.hide();
  }
}
