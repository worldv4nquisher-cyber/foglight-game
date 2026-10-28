import * as THREE from 'three';
import { EventBus } from './EventBus';
import { Time } from './Time';
import { AssetLoader } from '@/assets/AssetLoader';
import { QualityManager } from '@/config/quality';
import { gameConfig } from '@/config/gameConfig';
import { SceneManager } from '@/scenes/SceneManager';
import { InputManager } from '@/systems/input/InputManager';
import { AudioSystem } from '@/systems/AudioSystem';
import { UIManager } from '@/ui/UIManager';
import { VisibilityWatcher } from '@/platform/visibility';
import { nativeBridge } from '@/platform/native';
import { PostFX } from '@/render/PostFX';

/**
 * 游戏根对象：持有渲染器与各全局服务，驱动主循环。
 *
 * 每帧：input.beginFrame → N 次 fixedUpdate（固定步长，逻辑/物理）
 *       → update（可变步长，相机/动画/UI）→ render → input.endFrame
 */
export class Game {
  readonly container: HTMLElement;
  readonly events = new EventBus();
  readonly time = new Time(gameConfig.fixedDelta);
  readonly renderer: THREE.WebGLRenderer;
  readonly quality: QualityManager;
  readonly input: InputManager;
  readonly assets: AssetLoader;
  readonly audio: AudioSystem;
  readonly ui: UIManager;
  readonly scenes: SceneManager;
  readonly postfx: PostFX;

  private paused = false;
  private running = false;
  private rafId = 0;
  private visibility: VisibilityWatcher;
  private resizeObserver: ResizeObserver;
  private disposers: Array<() => void> = [];

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.container = container;

    // 抗锯齿交给后处理里的 SMAA，渲染器本身不开 MSAA（后处理管线推荐做法）
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
      depth: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.domElement.classList.add('game-canvas');
    container.prepend(this.renderer.domElement);

    this.quality = new QualityManager(this.events, this.renderer);
    this.postfx = new PostFX(this.renderer, this.quality.preset);
    this.applyQuality();

    this.input = new InputManager(this.renderer.domElement, uiRoot, this.events);
    this.assets = new AssetLoader(this.renderer, this.events);
    this.audio = new AudioSystem();
    this.ui = new UIManager(uiRoot, this);
    this.scenes = new SceneManager(this);

    // 窗口/容器尺寸变化
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    const onOrientation = (): void => this.resize();
    window.addEventListener('orientationchange', onOrientation);
    this.disposers.push(() => window.removeEventListener('orientationchange', onOrientation));
    this.resize();

    // 切后台自动暂停
    this.visibility = new VisibilityWatcher((visible) => {
      if (!visible) this.pause('visibility');
    });

    this.disposers.push(
      this.events.on('quality:change', () => {
        this.applyQuality();
        this.postfx.applyQuality(this.quality.preset);
        this.resize();
      }),
      // 场景切换：为使用后处理的场景重建管线，其他场景（启动/加载）直接渲染
      this.events.on('scene:change', () => {
        const s = this.scenes.current;
        if (s?.usePostFX) this.postfx.setScene(s.scene, s.camera, s.atmosphere ?? undefined);
        else this.postfx.setScene(null, null);
      }),
    );

    nativeBridge.onBackButton(() => {
      if (this.paused) this.resume();
      else this.pause('system');
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.time.resetClock();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  pause(reason: 'user' | 'visibility' | 'pointerlock' | 'system' = 'user'): void {
    if (this.paused || !this.scenes.current?.pausable) return;
    this.paused = true;
    this.audio.suspend();
    this.events.emit('game:pause', { reason });
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.time.resetClock();
    this.audio.resume();
    this.events.emit('game:resume');
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause('user');
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const time = this.time;
    this.input.beginFrame();
    if (this.input.consumePressed('pause')) this.togglePause();

    const steps = time.beginFrame(now, this.paused);
    const scene = this.scenes.current;
    if (scene) {
      for (let i = 0; i < steps; i++) {
        scene.fixedUpdate(time.fixedDelta);
      }
      if (!this.paused) scene.update(time.delta, time.alpha);
      if (scene.usePostFX && this.postfx.active) {
        // 色调映射由后处理的 ToneMappingEffect(ACES) 完成，避免重复
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.postfx.render(time.unscaledDelta);
      } else {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.render(scene.scene, scene.camera);
      }
    }
    this.ui.update(time.unscaledDelta);
    this.input.endFrame();
  };

  private applyQuality(): void {
    const p = this.quality.preset;
    const ratio = Math.min(window.devicePixelRatio || 1, p.maxPixelRatio, gameConfig.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.shadowMap.enabled = p.shadows;
    // three r18x：PCFSoftShadowMap 已移除，PCFShadowMap 配合各灯光的 shadow.radius 实现软阴影
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, this.quality.preset.maxPixelRatio, gameConfig.maxPixelRatio);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.postfx.setSize(w, h);
    this.scenes.current?.resize(w, h);
    this.events.emit('viewport:resize', { width: w, height: h, pixelRatio: ratio });
  }

  dispose(): void {
    this.stop();
    this.scenes.dispose();
    this.postfx.dispose();
    this.assets.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.ui.dispose();
    this.visibility.dispose();
    this.resizeObserver.disconnect();
    for (const d of this.disposers) d();
    this.events.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
