// batch25：手动测（M8 实机清单 perf-checklist.md、QA 控制台调 __game / __qa / __perfSpot）用的本地服务。
// 生产 dist 不再含这些钩子，这里临时建一份测试构建（--mode smoke）到 /tmp，在 http://127.0.0.1:4173/ 起 vite preview；
// Ctrl+C 退出时删掉临时构建。PORT=… 改端口；SMOKE_DIST=已建好的测试构建 则直接复用、不删。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGameServer } from './lib/test-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const g = await startGameServer(root, { port: Number(process.env.PORT ?? 4173) });
console.log(`测试构建已起：http://127.0.0.1:${g.port}/?smoke=1&art=1（${g.dir}）。Ctrl+C 退出并删除临时构建`);
