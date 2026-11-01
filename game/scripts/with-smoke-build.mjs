// batch25：建一份测试构建（vite build --mode smoke，带 __game / __qa 钩子）到 /tmp，设 SMOKE_DIST 跑给定命令，跑完删掉。
// 用法：node scripts/with-smoke-build.mjs "npm run verify:budget && npm run verify:load"
// check:release 用它让 verify:budget / load / memory 共用一份测试构建（只建一次）；生产 dist/ 不动。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildSmoke } from './lib/test-server.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cmd = process.argv.slice(2).join(' ');
if (!cmd) {
  console.error('用法：node scripts/with-smoke-build.mjs "<命令>"');
  process.exit(2);
}
const dir = mkdtempSync(join(tmpdir(), 'foglight-smoke-dist-'));
const clean = () => rmSync(dir, { recursive: true, force: true });
let child = null;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])
  process.on(sig, () => {
    child?.kill(sig);
    clean();
    process.exit(143);
  });
let code = 1;
try {
  await buildSmoke(root, dir);
  code = await new Promise((res) => {
    child = spawn(cmd, { cwd: root, shell: true, stdio: 'inherit', env: { ...process.env, SMOKE_DIST: dir } });
    child.on('exit', (c, s) => res(c ?? (s ? 1 : 0)));
  });
} catch (e) {
  console.error(e);
} finally {
  clean();
}
process.exit(code);
