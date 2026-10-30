// 由 art/source/env/s1-layout.json 的 instances 生成 src/levels/s1/rocks.ts（v0.1-018 打磨起改为脚本生成）。
// 用法：node scripts/gen-s1-rocks.mjs [--check]；--check 只比对，不一致时退出码 1。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const layoutPath = resolve(here, '../../art/source/env/s1-layout.json');
const outPath = resolve(here, '../src/levels/s1/rocks.ts');
const layout = JSON.parse(readFileSync(layoutPath, 'utf8'));
const inst = layout.instances;

const ROCKS = new Set(['a', 'b', 'c', 'd', 'e', 'f']);
const ROLES = new Set(['reef-path', 'dressing', 'dressing-hightide']);
const num = (v) => String(+v.toFixed(4));
const vec = (a) => `[${a.map(num).join(', ')}]`;

const lines = inst.map((r, i) => {
  if (!ROCKS.has(r.rock)) throw new Error(`instance ${i}: unknown rock ${r.rock}`);
  if (!ROLES.has(r.role)) throw new Error(`instance ${i}: unknown role ${r.role}`);
  const s = r.scale;
  const uniform = Array.isArray(s) && s[0] === s[1] && s[1] === s[2];
  // reef-path 沿用原写法：等比时写标量
  const scale = r.role === 'reef-path' && uniform ? num(s[0]) : Array.isArray(s) ? vec(s) : num(s);
  let line = `  { rock: '${r.rock}', role: '${r.role}', translation: ${vec(r.translation)}, rotationY: ${num(r.rotationY)}, scale: ${scale}`;
  if (r.topY !== undefined) line += `, topY: ${num(r.topY)}`;
  return line + ' },';
});

const out = `// 由 art/source/env/s1-layout.json（018 美术布局）的 instances 生成：node scripts/gen-s1-rocks.mjs（不要手改）。
// ${inst.length} 个礁石实例：reef-path（谜题 1 礁石小径，退潮可走；碰撞由 layout.ts 的白盒路面负责）/ dressing / dressing-hightide（涨潮线以下，按全湿处理）。
// 改摆放：改 s1-layout.json 后重跑脚本；白盒（layout.ts）与这里冲突时以白盒为准。挡人的礁石碰撞在 layout.ts 里单独定（018 打磨：S1_FOREGROUND_ROCK_COLLIDERS）。
import type { InstancePlacement } from '@/render/instancedLod';

export type RockId = 'a' | 'b' | 'c' | 'd' | 'e' | 'f';
export interface RockInstance extends InstancePlacement {
  rock: RockId;
  role: 'reef-path' | 'dressing' | 'dressing-hightide';
  topY?: number;
}

export const S1_ROCKS: readonly RockInstance[] = [
${lines.join('\n')}
];
`;

if (process.argv.includes('--check')) {
  const cur = readFileSync(outPath, 'utf8');
  if (cur !== out) { console.error('rocks.ts 与 s1-layout.json 不一致，请运行 node scripts/gen-s1-rocks.mjs'); process.exit(1); }
  console.log(`rocks.ts 与 s1-layout.json 一致（${inst.length} 个实例）`);
} else {
  writeFileSync(outPath, out);
  console.log(`写入 ${outPath}：${inst.length} 个实例`);
}
