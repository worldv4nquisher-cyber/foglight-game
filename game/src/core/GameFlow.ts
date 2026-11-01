import * as THREE from 'three';
import type { Game } from './Game';
import { LEVEL_GROUPS, type AssetGroup } from '@/assets/manifest';
import { autostartQuery, debugEnabled, sceneParam } from '@/config/debug';
import { LEVELS, LEVEL_LIST, levelByScene, levelForSave, type LevelDef, type LevelId, type LevelSceneName } from '@/scenes/levels';

/** 可玩场景：第一章三个场景 + 测试场地 + 沙盒（dev 用的 demo 岛） */
export type PlayScene = LevelSceneName | 'testbed' | 'sandbox';
const PLAY_SCENES: readonly string[] = [...LEVEL_LIST.map((l) => l.scene), 'testbed', 'sandbox'];

/** 存档里的场景 ID → 场景名（010 之前的存档 sceneId 是 'main'，按 S1 读） */
export function sceneForSave(sceneId: string): PlayScene {
  return levelForSave(sceneId).scene;
}

/** 某个可玩场景需要的资源组（common 常驻 + 场景组） */
export function groupsForScene(scene: PlayScene): AssetGroup[] {
  if (scene === 'testbed') return ['common'];
  if (scene === 'sandbox') return ['common', 's1', 'dev'];
  return ['common', levelByScene(scene)!.group];
}

/**
 * 场景切换的时间分配（v0.1-010，GDD §10「离开一个场景时黑场 1.0 s」）：
 * 淡出 0.33 s → 全黑至少 0.3 s（换场景、编译着色器；下一个场景没加载完就等，期间显示细线进度）→ 淡入 0.33 s。
 * 已预加载时总时长 0.96 s（留 40 ms 给帧边界误差，保证 ≤ 1.0 s）；换场景 + 编译超过 0.3 s 时全黑相应变长。
 */
export const TRANSITION = { fadeOut: 0.33, holdMin: 0.3, fadeIn: 0.33 } as const;
export const TRANSITION_TOTAL = TRANSITION.fadeOut + TRANSITION.holdMin + TRANSITION.fadeIn;
/** 全黑后等这么久还没加载完才显示进度线（避免一闪而过） */
const PROGRESS_DELAY = 0.12;

/** 换场景时保留哪些场景组：当前场景 + 它的下一个（其余释放）。线性推进，不会往回走 */
export function groupsToKeep(level: LevelDef): AssetGroup[] {
  const keep: AssetGroup[] = ['common', level.group];
  if (level.next) keep.push(LEVELS[level.next].group);
  return keep;
}

export interface TransitionRecord {
  from: string | null;
  to: LevelSceneName;
  /** 从触发出口到画面完全恢复（ms） */
  ms: number;
  /** 全黑保持了多久（ms） */
  holdMs: number;
  /** 下一个场景是否还没加载完（要等） */
  waitedForLoad: boolean;
  /** 是否显示过细线进度 */
  progressShown: boolean;
  /** 分段耗时（ms）：淡出 / 等加载 / 换场景（构建 + 存档 + 预编译着色器）/ 淡入 */
  phases: { fadeOut: number; load: number; swap: number; fadeIn: number };
  /** 切换期间最长的一帧（ms）：淡入淡出按真实时间推进，每段最多超出一帧 */
  maxFrameMs: number;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 界面流程（v0.1-008，GDD §10 流程图）+ 场景流程（v0.1-010）：
 *   启动（boot + menu 资源）→ 主菜单 → 新游戏（有存档先覆盖确认）/ 继续（读存档场景）/ 设置 / 制作名单
 *   新游戏：加载页（common + s1）→ S1；继续：加载页（common + 存档场景组）→ 存档场景开头
 *   S1 出口 → 黑场 1.0 s → S2 → 黑场 → S3 → 点灯 → 结尾演出（035）→ 章节结束页 → 回到主菜单
 *   游戏中 Esc → 暂停 → 继续 / 设置 / 回到主菜单（确认「将回到最近的场景开头」）
 * 存档只有场景入口一个点（006），在场景切换的黑场里写（SceneManager 切换时 Game 自动存）。
 *
 * 指针锁定：主菜单、章节结束页、加载期间一直压着 menu 上下文（cursor free），进入可玩场景才放开；
 * 进场后由玩家点一下画面重新锁定（浏览器要求用户手势）。场景之间的黑场不压 menu（不打断指针锁定）。
 */
export class GameFlow {
  /** 加载场景完成后进入的场景 */
  next: PlayScene = 's1-ebb-shore';
  /** 正在场景切换（黑场）中 */
  transitioning = false;
  /** 最近一次场景切换的记录（冒烟测试 / 调试） */
  lastTransition: TransitionRecord | null = null;
  /** 从启动到主菜单可操作的时间（ms，performance.now 起点 = 页面导航开始） */
  menuReadyMs: number | null = null;
  /** 启动场景开始加载 boot+menu 的时刻（ms；menuReadyMs − bootStartMs = 纯加载耗时，不含 JS 初始化 / 着色器编译） */
  bootStartMs: number | null = null;
  private entry: string | null = null;
  private maxFrameMs = 0;
  private releaseMenu: (() => void) | null = null;
  private off: () => void;
  private readonly game: Game;

  constructor(game: Game) {
    this.game = game;
    this.off = game.events.on('scene:change', ({ to }) => {
      if (PLAY_SCENES.includes(to)) this.unholdMenu();
    });
  }

  /**
   * 启动场景加载完：默认进主菜单；?autostart=1（冒烟 / 开发）和 ?scene=… 跳过主菜单直接进场。
   * batch26：?scene= 只在开发服务器 / 测试构建里有（sceneParam，生产构建恒为 null）；s1–s3 / sandbox 另要 debugEnabled（dev 或测试构建 + ?debug=1）；
   * ?autostart 同样只在开发服务器 / 测试构建里认（autostartQuery，生产构建恒为 false → 永远进主菜单）
   */
  afterBoot(): void {
    const scene = sceneParam;
    if (scene === 'testbed') {
      if (!this.game.save.continueGame()) this.game.save.newGame('ch1', 's1');
      this.startLoading('testbed');
    } else if (scene === 'sandbox' && debugEnabled) {
      // 沙盒：v0.1 demo 岛（开发服务器或 ?debug=1）；不存档
      this.startLoading('sandbox');
    } else if ((scene === 's1' || scene === 's2' || scene === 's3') && debugEnabled) {
      // 直接进某个场景（开发服务器或 ?debug=1）：进场即在该场景入口存档
      if (!this.game.save.continueGame()) this.game.save.newGame('ch1', scene);
      this.startLoading(LEVELS[scene].scene);
    } else if (autostartQuery) {
      const data = this.game.save.continueGame();
      if (!data) this.game.save.newGame('ch1', 's1');
      this.startLoading(data ? sceneForSave(data.sceneId) : 's1-ebb-shore');
    } else {
      this.holdMenu();
      void this.game.scenes.change('menu').then(() => {
        this.menuReadyMs ??= performance.now();
      });
    }
  }

  /** 主菜单「新游戏」（覆盖确认已由主菜单处理）：清存档 → 加载页（common + s1）→ S1 */
  newGame(): void {
    this.game.save.newGame('ch1', 's1');
    this.game.narrative.resetMemory();
    this.startLoading('s1-ebb-shore');
  }

  /** 主菜单「继续」：章节已完成 → 章节结束页；否则加载存档场景（场景开头）。没有可用存档返回 false */
  continueGame(): boolean {
    const data = this.game.save.continueGame();
    if (!data) return false;
    this.game.narrative.resetMemory();
    if (data.chapterComplete) {
      this.holdMenu();
      void this.game.scenes.change('chapter-end');
    } else {
      this.startLoading(sceneForSave(data.sceneId));
    }
    return true;
  }

  /** 暂停菜单「回到主菜单」/ 章节结束页「回到主菜单」。不额外存档：进度停在最近一次场景入口 */
  async toMenu(): Promise<void> {
    this.holdMenu();
    this.game.resume();
    await this.game.scenes.change('menu');
    this.releaseLevelGroups([]);
  }

  /** 点亮灯塔、结尾演出放完（S3 占位点灯调用；035 接管） */
  async completeChapter(): Promise<void> {
    this.holdMenu();
    this.game.resume();
    await this.game.scenes.change('chapter-end');
    this.releaseLevelGroups([]);
    // 035：结尾演出淡到黑（或跳过的 0.75 s 黑场）后进来 → 结束页从黑场淡入
    const f = this.game.ui.fade.opacity;
    if (f > 0) await this.animateFade(f, 0, TRANSITION.fadeIn);
  }

  /** 进场时取走场景出口带过来的入口 id（LevelScene.enter 调用；一次性） */
  takeEntry(): string | null {
    const e = this.entry;
    this.entry = null;
    return e;
  }

  /** 后台预加载下一个场景的资源组（LevelScene 建立镜头结束后调用） */
  preloadNext(level: LevelDef): void {
    if (!level.next) return;
    const group = LEVELS[level.next].group;
    if (this.game.assets.isGroupLoaded(group)) return;
    void this.game.assets.loadGroup(group).catch((err: unknown) => console.warn('[flow] 预加载失败', group, err));
  }

  /**
   * 去另一个场景（SceneExit 触发）：淡出 → 全黑（没加载完就等、显示细线进度；换场景 → 存档 → 编译着色器）→ 淡入。
   * 切换期间不能暂停、角色停住、出口不再触发。返回在画面完全恢复时 resolve。
   */
  async goToLevel(target: LevelId, entry?: string): Promise<void> {
    if (this.transitioning) return;
    const level = LEVELS[target];
    const { game } = this;
    const fade = game.ui.fade;
    const from = game.scenes.current?.name ?? null;
    this.transitioning = true;
    const t0 = performance.now();
    let progressShown = false;
    try {
      const groups = groupsForScene(level.scene);
      const waitedForLoad = !groups.every((g) => game.assets.isGroupLoaded(g));
      let ratio = 0;
      const loading = game.assets.loadGroups(groups, (r) => {
        ratio = r;
        if (progressShown) fade.setProgress(r);
      });

      this.maxFrameMs = 0;
      await this.animateFade(0, 1, TRANSITION.fadeOut);
      const tBlack = performance.now();
      const showProgress = window.setTimeout(() => {
        if (!groups.every((g) => game.assets.isGroupLoaded(g))) {
          progressShown = true;
          fade.setProgress(ratio);
        }
      }, PROGRESS_DELAY * 1000);
      await loading;
      const tLoaded = performance.now();
      window.clearTimeout(showProgress);
      if (progressShown) fade.setProgress(1);

      this.entry = entry ?? level.defaultEntry;
      await game.scenes.change(level.scene); // scene:change → Game 自动存档（在黑场里）
      this.releaseLevelGroups(groupsToKeep(level));
      await this.compileCurrent();
      // 新场景先在全黑下实画两帧：首帧的剩余着色器编译 / 纹理上传落在黑场里，淡入时不掉帧
      await nextFrame();
      await nextFrame();
      const tSwapped = performance.now();

      const held = performance.now() - tBlack;
      if (held < TRANSITION.holdMin * 1000) await wait(TRANSITION.holdMin * 1000 - held);
      fade.setProgress(null);
      const holdMs = performance.now() - tBlack;
      const tFadeIn = performance.now();
      await this.animateFade(1, 0, TRANSITION.fadeIn);
      const tEnd = performance.now();
      this.lastTransition = {
        from,
        to: level.scene,
        ms: tEnd - t0,
        holdMs,
        waitedForLoad,
        progressShown,
        phases: { fadeOut: tBlack - t0, load: tLoaded - tBlack, swap: tSwapped - tLoaded, fadeIn: tEnd - tFadeIn },
        maxFrameMs: this.maxFrameMs,
      };
    } finally {
      fade.setProgress(null);
      this.transitioning = false;
    }
  }

  /** 释放不在 keep 里的场景资源组（common 常驻） */
  private releaseLevelGroups(keep: readonly AssetGroup[]): void {
    for (const g of [...LEVEL_GROUPS, 'dev'] as const) if (!keep.includes(g)) this.game.assets.unloadGroup(g);
  }

  /** 新场景的着色器提前编译（全黑时做，避免淡入第一帧卡顿）；不支持或出错就跳过 */
  private async compileCurrent(): Promise<void> {
    const s = this.game.scenes.current;
    if (!s) return;
    // 按真正的出图路径编译：走后处理时场景画进 composer 的 RT（线性输出、不做色调映射），直接上屏时是 sRGB + ACES。
    // 之前一律按上屏编译，走后处理的关卡每个材质多编一套永远用不上的变体，还挂在材质上不释放
    // （从菜单进 S1 着色器 77 个 vs 直接进 43 个，JS 堆多 ~3.5 MB，verify-memory 堆检查不过；v0.1-037）。
    // 程序参数在 compileAsync 的同步部分就定了，所以只在调用那一下切 RT / 色调映射，马上还原，不影响之后的帧。
    const r = this.game.renderer;
    const viaPost = s.usePostFX && this.game.postfx.active;
    const prevTarget = r.getRenderTarget();
    const prevTone = r.toneMapping;
    const rt = viaPost ? new THREE.WebGLRenderTarget(1, 1) : null;
    try {
      r.setRenderTarget(rt);
      r.toneMapping = viaPost ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      const p = r.compileAsync(s.scene, s.camera);
      r.setRenderTarget(prevTarget);
      r.toneMapping = prevTone;
      rt?.dispose();
      await Promise.race([p, wait(250)]);
    } catch {
      r.setRenderTarget(prevTarget);
      r.toneMapping = prevTone;
      rt?.dispose();
      /* 编译失败不影响流程，第一帧再编译 */
    }
  }

  /** 黑场渐变（按真实时间，不受暂停 / 时间缩放影响） */
  private animateFade(from: number, to: number, sec: number): Promise<void> {
    const fade = this.game.ui.fade;
    return new Promise((resolve) => {
      const start = performance.now();
      let last = start;
      const step = (): void => {
        const now = performance.now();
        this.maxFrameMs = Math.max(this.maxFrameMs, now - last);
        last = now;
        const k = Math.min(1, (performance.now() - start) / (sec * 1000));
        fade.set(from + (to - from) * k);
        if (k >= 1) resolve();
        else requestAnimationFrame(step);
      };
      step();
    });
  }

  private startLoading(next: PlayScene): void {
    this.next = next;
    this.holdMenu();
    void this.game.scenes.change('loading');
  }

  private holdMenu(): void {
    if (!this.releaseMenu) this.releaseMenu = this.game.input.pushContext('menu');
  }

  private unholdMenu(): void {
    this.releaseMenu?.();
    this.releaseMenu = null;
  }

  /** 菜单上下文是否由流程压着（测试用） */
  get holdingMenu(): boolean {
    return this.releaseMenu !== null;
  }

  dispose(): void {
    this.off();
    this.unholdMenu();
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}
