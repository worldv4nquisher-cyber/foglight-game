// batch26：structuredClone 全局 polyfill 在 index.html 的内联脚本里（早于所有模块，含 three / vendor 分包）；
// 这里第一个 import 再兜一次（index.html 被改坏 / 嵌到别的页面时），有了就不装
import '@/platform/polyfills';
import './ui/styles.css';
import { Game } from '@/core/Game';
import { t } from '@/content/text';
import { BootScene } from '@/scenes/BootScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { SandboxScene } from '@/scenes/S1EbbShoreScene';
import { S1Scene } from '@/levels/s1/S1Scene';
import { S2Scene } from '@/levels/s2/S2Scene';
import { S3Scene } from '@/levels/s3/S3Scene';
import { ChapterEndScene, MenuScene } from '@/scenes/MenuScene';
import { TestbedScene } from '@/scenes/TestbedScene';
import { installPerfSpot } from '@/debug/perfSpot';
import { installQaHooks } from '@/debug/qaHooks';
import { testParam } from '@/config/debug';

/** 入口：检测 WebGL2 → 创建 Game → 注册场景 → Boot → 主菜单 →（新游戏 / 继续）Loading → S1 → S2 → S3（流程见 core/GameFlow） */
function showFatal(message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.innerHTML = '<h2></h2><p></p>';
  el.querySelector('h2')!.textContent = t('ui.fatal.title');
  el.querySelector('p')!.textContent = message;
  document.body.appendChild(el);
}

function hasWebGL2(): boolean {
  try {
    return Boolean(document.createElement('canvas').getContext('webgl2'));
  } catch {
    return false;
  }
}

function bootstrap(): void {
  const container = document.getElementById('app');
  const uiRoot = document.getElementById('ui-root');
  if (!container || !uiRoot) throw new Error('缺少 #app / #ui-root 容器');
  if (!hasWebGL2()) {
    showFatal(t('ui.fatal.webgl2'));
    return;
  }

  const game = new Game(container, uiRoot);
  game.scenes
    .register('boot', (g) => new BootScene(g))
    .register('loading', (g) => new LoadingScene(g))
    .register('menu', (g) => new MenuScene(g))
    .register('chapter-end', (g) => new ChapterEndScene(g))
    // 第一章三个场景（v0.1-010）：S1 → S2 → S3，出口触发黑场切换（GameFlow.goToLevel）
    .register('s1-ebb-shore', (g) => new S1Scene(g))
    .register('s2-keeper-house', (g) => new S2Scene(g))
    .register('s3-lighthouse', (g) => new S3Scene(g))
    // 沙盒（v0.1 demo 岛：?scene=sandbox，开发服务器，或测试构建加 ?debug=1；batch26 起生产构建进不去）
    .register('sandbox', (g) => new SandboxScene(g))
    .register('testbed', (g) => new TestbedScene(g));
  game.start();
  if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') {
    const whitebox = testParam('ch2-whitebox');
    if (whitebox === 's1' || whitebox === 's2' || whitebox === 's3') {
      const view = testParam('view');
      void import('@/levels/ch2/WhiteboxScene')
        .then(({ openWhitebox }) => openWhitebox(game, whitebox, view))
        .catch((err: unknown) => showFatal(err instanceof Error ? err.message : String(err)));
    } else {
      void game.scenes.change('boot');
    }
  } else {
    void game.scenes.change('boot');
  }

  // 开发服务器或测试构建（vite build --mode smoke）下暴露到 window，方便控制台调试：__game.quality.set('ultra')。
  // batch25：条件全是构建期常量，生产构建（mode production）整段连同 qaHooks / perfSpot 模块被摇树删掉，线上加 ?smoke=1 也没有这些钩子
  if (import.meta.env.DEV || import.meta.env.MODE === 'smoke') {
    (window as unknown as { __game: Game }).__game = game;
    installQaHooks(game); // M7：__qa.puzzles() / save() / saveData() / diff() / scene()
    installPerfSpot(game); // 037：__perfSpot('<机位 id>') 钉相机到预算机位（真 GPU 实测）
  }

  // Vite HMR：模块热替换时释放旧实例，避免重复渲染器 / 监听器
  import.meta.hot?.dispose(() => game.dispose());
}

try {
  bootstrap();
} catch (err) {
  console.error(err);
  showFatal(err instanceof Error ? err.message : String(err));
}
