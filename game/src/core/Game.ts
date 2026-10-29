import * as THREE from 'three';
import { EventBus } from './EventBus';
import { Time } from './Time';
import { AssetLoader } from '@/assets/AssetLoader';
import { QualityManager } from '@/config/quality';
import { gameConfig } from '@/config/gameConfig';
import { SceneManager } from '@/scenes/SceneManager';
import { InputManager } from '@/systems/input/InputManager';
import { KeyboardMouseInput } from '@/systems/input/KeyboardMouseInput';
import { AudioSystem } from '@/systems/AudioSystem';
import { SaveSystem } from '@/systems/save/SaveSystem';
import { Settings } from '@/systems/save/Settings';
import { UIManager } from '@/ui/UIManager';
import { VisibilityWatcher } from '@/platform/visibility';
import { nativeBridge } from '@/platform/native';
import { PostFX } from '@/render/PostFX';
import { QualityBenchmark, parseSimulateFps } from '@/systems/QualityBenchmark';
import { NarrativeState } from '@/systems/NarrativeState';

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
  /** 玩家设置（foglight.settings.v1），新游戏不清除 */
  readonly settings = new Settings();
  /** 存档（foglight.save.v1） */
  readonly save = new SaveSystem();
  /** 已读文档 / 只一次字幕 / 当前目标（005；有进度时读写存档） */
  readonly narrative: NarrativeState;
  readonly quality: QualityManager;
  /** 首次启动的 3 秒画质自动检测（第一次进入 S1 时由场景调用 start()） */
  readonly benchmark: QualityBenchmark;
  /** 调试计数（smoke 读取）：resizeAfterRender = 在本帧渲染之后重设画布的次数（会出现一帧黑屏，应为 0） */
  readonly debugStats = { resizeAfterRender: 0 };
  private pendingResize = false;
  private renderedThisTick = false;
  readonly input: InputManager;
  readonly assets: AssetLoader;
  readonly audio: AudioSystem;
  readonly ui: UIManager;
  readonly scenes: SceneManager;
  readonly postfx: PostFX;

  private paused = false;
  /** 冻结计数（阅读界面 / 日志打开时 > 0）：游戏逻辑不跑，UI 照常 */
  private freezeCount = 0;
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

    // F3 性能面板要整帧（含后处理各 pass）的 draw call / 三角面：每帧开头手动清零
    this.renderer.info.autoReset = false;

    this.narrative = new NarrativeState(this.events, this.save);
    this.quality = new QualityManager(this.events, this.renderer, this.settings);
    this.benchmark = new QualityBenchmark(this.quality, this.settings, this.events, {
      simulateFps: parseSimulateFps(location.search),
    });
    this.postfx = new PostFX(this.renderer, this.quality.preset);
    this.applyQuality();

    this.input = new InputManager(this.events);
    // 桌面专做（GDD §15）：只注册键鼠；TouchInput 保留代码但默认不注册
    const kbm = new KeyboardMouseInput(this.renderer.domElement, this.input);
    this.input.attach(kbm);
    this.input.onContextChange = (cur) => kbm.onContextChange(cur);
    this.assets = new AssetLoader(this.renderer, this.events);
    this.audio = new AudioSystem();
    this.applySettings();
    this.disposers.push(this.settings.onChange(() => this.applySettings()));
    this.ui = new UIManager(uiRoot, this);
    this.scenes = new SceneManager(this);

    // 窗口/容器尺寸变化
    // ResizeObserver 回调在本帧渲染之后才跑：只标记，下一帧渲染前再改画布（否则窗口缩放时闪一帧黑）
    this.resizeObserver = new ResizeObserver(() => (this.pendingResize = true));
    this.resizeObserver.observe(container);
    const onOrientation = (): void => {
      this.pendingResize = true;
    };
    window.addEventListener('orientationchange', onOrientation);
    this.disposers.push(() => window.removeEventListener('orientationchange', onOrientation));
    this.resize();

    // 切后台自动暂停
    this.visibility = new VisibilityWatcher((visible) => {
      if (!visible) this.pause('visibility');
    });

    this.disposers.push(
      // 运行时切档（不重载场景）：像素比 / 阴影 / 后处理参数，resize 重建渲染目标；场景自己重建阴影贴图、雨量、LOD 距离
      this.events.on('quality:changed', ({ tier, previous, source }) => {
        const t0 = performance.now();
        // 像素比没变就不 resize：重设画布尺寸会清掉绘图缓冲、重建全部渲染目标（切档卡顿的大头）
        const ratioChanged = Math.abs(this.renderer.getPixelRatio() - this.pixelRatio) > 1e-6;
        // 不在这里 setPixelRatio / resize：重设画布尺寸会清空绘图缓冲，如果发生在本帧渲染之后、合成之前就是一帧可见黑屏。
        // 推迟到下一帧 tick 开头（渲染之前）统一做（009 制作人裁定：切档不能有可见黑帧）
        this.applyQuality(false);
        this.postfx.applyQuality(this.quality.preset);
        if (ratioChanged) this.pendingResize = true;
        if (import.meta.env.DEV) console.info(`[quality] ${previous} → ${tier}（${source}），${(performance.now() - t0).toFixed(1)} ms`);
      }),
      // 场景切换：为使用后处理的场景重建管线，其他场景（启动/加载）直接渲染
      this.events.on('scene:change', () => {
        const s = this.scenes.current;
        // 自动存档：进入带存档点的场景（GDD §11：进入 S1 / 每个新场景 / 章节结束页）
        if (s?.savePoint) this.save.save(s.savePoint);
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

  /** 阅读界面 / 日志打开中：游戏逻辑暂停（fixedUpdate、scene.update、游玩计时都不跑），渲染和 UI 照常 */
  get isFrozen(): boolean {
    return this.freezeCount > 0;
  }

  /** 冻结游戏逻辑，返回只解这一层的函数（可嵌套：日志里再打开阅读界面） */
  freeze(): () => void {
    this.freezeCount++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.freezeCount = Math.max(0, this.freezeCount - 1);
      if (this.freezeCount === 0) this.time.resetClock();
    };
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
    this.renderer.info.reset();
    // 画质切档的画布重建放在渲染之前（见 quality:changed）
    if (this.pendingResize) {
      this.pendingResize = false;
      this.resize();
    }
    // 画质检测放在渲染之前：它触发的切档在本帧渲染前生效，不会留下被清空的画布
    this.benchmark.update(now, this.paused || document.hidden);
    this.input.beginFrame();
    if (this.input.consumePressed('pause')) this.togglePause();

    const halted = this.paused || this.freezeCount > 0;
    const steps = time.beginFrame(now, halted);
    const scene = this.scenes.current;
    if (scene) {
      for (let i = 0; i < steps; i++) {
        scene.fixedUpdate(time.fixedDelta);
      }
      if (!halted) {
        scene.update(time.delta, time.alpha);
        if (scene.savePoint) this.save.tick(time.delta);
      }
      if (scene.usePostFX && this.postfx.active) {
        // 色调映射由后处理的 ToneMappingEffect(ACES) 完成，避免重复
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.postfx.render(time.unscaledDelta);
      } else {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.render(scene.scene, scene.camera);
      }
    }
    this.renderedThisTick = true;
    this.ui.update(time.unscaledDelta);
    this.input.endFrame();
    this.renderedThisTick = false;
  };

  /** 把设置应用到各系统（启动时一次 + 每次设置变化，立即生效） */
  private applySettings(): void {
    const s = this.settings;
    this.input.setLookSensitivity(s.get('mouseSensitivity'));
    this.input.setInvertY(s.get('invertY'));
    this.audio.setVolumes({
      master: s.get('masterVolume') / 100,
      music: s.get('musicVolume') / 100,
      sfx: s.get('sfxVolume') / 100,
    });
  }

  /** 渲染像素比 = min(设备像素比, 档位上限, 全局上限) × renderScale（标准档 0.8） */
  get pixelRatio(): number {
    const p = this.quality.preset;
    return Math.min(window.devicePixelRatio || 1, p.maxPixelRatio, gameConfig.maxPixelRatio) * p.renderScale;
  }

  private applyQuality(setRatio = true): void {
    // setPixelRatio 内部会 setSize（重建绘图缓冲），没变就不调；运行时切档由 tick 开头的 resize 统一设置
    if (setRatio && Math.abs(this.renderer.getPixelRatio() - this.pixelRatio) > 1e-6) this.renderer.setPixelRatio(this.pixelRatio);
    // 三档都有阴影（style-guide §8 shadowType 全是 CSM）；CSM / PCSS 在 023 做，现在是单张平行光阴影
    this.renderer.shadowMap.enabled = true;
    // three r18x：PCFSoftShadowMap 已移除，PCFShadowMap 配合各灯光的 shadow.radius 实现软阴影
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize(): void {
    // 渲染之后、本帧结束之前重设画布 = 可见黑帧（smoke 检查这个计数为 0）
    if (this.renderedThisTick) this.debugStats.resizeAfterRender++;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    const ratio = this.pixelRatio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.postfx.setSize(w, h);
    this.scenes.current?.resize(w, h);
    this.events.emit('viewport:resize', { width: w, height: h, pixelRatio: ratio });
  }

  dispose(): void {
    this.stop();
    this.scenes.dispose();
    this.benchmark.dispose();
    this.quality.dispose();
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
