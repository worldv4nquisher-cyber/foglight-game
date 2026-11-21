import { REPO_ROOT } from './paths.mjs';
// 启动 vite dev / preview（使用 game/node_modules 里的 vite，不改源码）
// batch27 起：生产 dist 不读任何 URL 参数（?autostart / art / quality / debug / scene …），也没有 __qa / __game 钩子。
// 因此 startPreview 默认改为起「测试构建」（游戏仓 scripts/lib/test-server.mjs 的 startGameServer，vite build --mode smoke 到 /tmp/foglight-smoke-dist-*，关闭时删）。
// 真要测生产包（不带钩子、参数无效）时设 QA_PROD=1，或调用 startProdPreview。旧快照没有 test-server.mjs 时退回生产 preview 并打印提示。
import { existsSync } from 'node:fs';
const GAME = process.env.QA_GAME || '/tmp/qa-snap/game';
const vite = await import((process.env.QA_VITE || (REPO_ROOT + '/game/node_modules')) + '/vite/dist/node/index.js');
export async function startDev(port = 5199) {
  const server = await vite.createServer({ root: GAME, configFile: GAME + '/vite.config.ts', server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  await server.listen();
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
export async function startProdPreview(port = 5198) {
  const server = await vite.preview({ root: GAME, configFile: GAME + '/vite.config.ts', preview: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
  return { url: `http://127.0.0.1:${port}`, kind: 'prod', close: () => new Promise((r) => server.httpServer.close(r)) };
}
export async function startSmokePreview(port = 5198) {
  const lib = GAME + '/scripts/lib/test-server.mjs';
  if (!existsSync(lib)) { console.log('[server.mjs] 快照里没有 test-server.mjs，退回生产 preview'); return startProdPreview(port); }
  const { startGameServer } = await import(lib);
  const g = await startGameServer(GAME, { port });
  return { url: `http://127.0.0.1:${g.port}`, kind: g.kind, dir: g.dir, close: () => g.close() };
}
export async function startPreview(port = 5198) {
  return process.env.QA_PROD === '1' ? startProdPreview(port) : startSmokePreview(port);
}
