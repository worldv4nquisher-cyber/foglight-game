import type { Game } from './Game';

/** 可玩场景（灰盒阶段只有 main；010 拆成 s1/s2/s3） */
export type PlayScene = 'main' | 'testbed';

/** 存档里的场景 ID → 场景名。010 之前所有可玩场景都是 main（demo 灰盒，存档 sceneId 'main'） */
export function sceneForSave(sceneId: string): PlayScene {
  void sceneId;
  return 'main';
}

/**
 * 界面流程（v0.1-008，GDD §10 流程图）：
 *   启动 / 加载 → 主菜单 → 新游戏（有存档先覆盖确认）/ 继续（读存档场景）/ 设置 / 制作名单
 *   游戏中 Esc → 暂停 → 继续 / 设置 / 回到主菜单（确认「将回到最近的场景开头」）
 *   点亮灯塔 → 结尾演出（035）→ 章节结束页 → 回到主菜单
 * 存档只有场景入口一个点（006），所以「回到主菜单 → 继续」= 回到最近一次进入的场景开头，之后的进度（读过的信等）丢弃。
 *
 * 指针锁定：主菜单、章节结束页、加载期间一直压着 menu 上下文（cursor free），进入可玩场景才放开；
 * 进场后由玩家点一下画面重新锁定（浏览器要求用户手势）。
 */
export class GameFlow {
  /** 加载场景完成后进入的场景 */
  next: PlayScene = 'main';
  private releaseMenu: (() => void) | null = null;
  private off: () => void;

  constructor(private game: Game) {
    this.off = game.events.on('scene:change', ({ to }) => {
      if (to === 'main' || to === 'testbed') this.unholdMenu();
    });
  }

  /** 启动场景加载完：默认进主菜单；?autostart=1（冒烟 / 开发）和 ?scene=testbed 跳过主菜单直接进场 */
  afterBoot(): void {
    const q = new URLSearchParams(location.search);
    if (q.get('scene') === 'testbed') {
      if (!this.game.save.continueGame()) this.game.save.newGame('ch1', 'main');
      this.startLoading('testbed');
    } else if (q.has('autostart')) {
      const data = this.game.save.continueGame();
      if (!data) this.game.save.newGame('ch1', 'main');
      this.startLoading(data ? sceneForSave(data.sceneId) : 'main');
    } else {
      this.holdMenu();
      void this.game.scenes.change('menu');
    }
  }

  /** 主菜单「新游戏」（覆盖确认已由主菜单处理）：清存档 → 加载页 → 首场景 */
  newGame(): void {
    this.game.save.newGame('ch1', 'main');
    this.game.narrative.resetMemory();
    this.startLoading('main');
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
  }

  /** 点亮灯塔、结尾演出放完（035 调用；现在开发期可在控制台 __game.flow.completeChapter()） */
  async completeChapter(): Promise<void> {
    this.holdMenu();
    this.game.resume();
    await this.game.scenes.change('chapter-end');
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
