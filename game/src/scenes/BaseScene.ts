import * as THREE from 'three';
import type { Game } from '@/core/Game';
import { disposeObject3D } from '@/core/dispose';
import { gameplay } from '@/config/gameplay';
import type { AtmospherePreset } from '@/config/atmosphere';

/**
 * 场景基类：每个场景拥有自己的 THREE.Scene 与相机。
 * 生命周期：constructor → enter()（可异步，加载资源/搭建场景）→ fixedUpdate/update 循环 → exit() → dispose()
 */
export abstract class BaseScene {
  abstract readonly name: string;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** 是否允许暂停（加载界面不允许） */
  pausable = true;
  /** 是否走后处理管线（启动/加载界面不需要） */
  usePostFX = false;
  /** 场景的气氛预设（后处理参数从这里读取） */
  atmosphere: AtmospherePreset | null = null;
  /** 存档点：进入这个场景时自动存档（GDD §11）。null = 不存（启动 / 加载 / 菜单） */
  savePoint: { chapterId: string; sceneId: string; chapterComplete?: boolean } | null = null;
  protected cleanups: Array<() => void> = [];

  constructor(protected game: Game) {
    const { clientWidth: w, clientHeight: h } = game.container;
    this.camera = new THREE.PerspectiveCamera(gameplay.camera.fov, w / Math.max(1, h), 0.1, 500);
  }

  enter(): void | Promise<void> {}
  exit(): void {}
  fixedUpdate(_dt: number): void {}
  update(_dt: number, _alpha: number): void {}

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  /** 释放 GPU 资源与事件监听。资源缓存中的共享对象不会被释放。 */
  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
    disposeObject3D(this.scene, { keep: this.game.assets.sharedResources() });
    this.scene.clear();
  }
}
