import './ui/styles.css';
import { Game } from '@/core/Game';
import { BootScene } from '@/scenes/BootScene';
import { LoadingScene } from '@/scenes/LoadingScene';
import { MainScene } from '@/scenes/MainScene';

/** 入口：检测 WebGL2 → 创建 Game → 注册场景 → Boot → Loading → Main */
function showFatal(message: string): void {
  const el = document.createElement('div');
  el.className = 'fatal-error';
  el.innerHTML = `<h2>无法启动游戏</h2><p></p>`;
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
    showFatal('你的浏览器或显卡不支持 WebGL 2。请使用最新版 Chrome / Edge / Firefox / Safari，并开启硬件加速。');
    return;
  }

  const game = new Game(container, uiRoot);
  game.scenes
    .register('boot', (g) => new BootScene(g))
    .register('loading', (g) => new LoadingScene(g))
    .register('main', (g) => new MainScene(g));
  game.start();
  void game.scenes.change('boot');

  // 开发模式（或冒烟测试 ?smoke=1）下暴露到 window，方便控制台调试：__game.quality.set('ultra')
  if (import.meta.env.DEV || new URLSearchParams(location.search).has('smoke')) {
    (window as unknown as { __game: Game }).__game = game;
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
