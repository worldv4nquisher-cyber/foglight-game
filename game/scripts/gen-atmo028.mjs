// v0.1-028：把美术 art/source/atmosphere/atmosphere-028.json 生成 src/config/atmosphere028.ts（去掉 _doc / check 字段）。
// 用法：node scripts/gen-atmo028.mjs；--check 只比对不写（verify-render 调用）。
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, '../art/source/atmosphere/atmosphere-028.json');
const OUT = resolve(root, 'src/config/atmosphere028.ts');

export function strip(o) {
  if (Array.isArray(o)) return o.map(strip);
  if (o && typeof o === 'object') {
    const r = {};
    for (const [k, v] of Object.entries(o)) if (!k.startsWith('_') && k !== 'check') r[k] = strip(v);
    return r;
  }
  return o;
}

export function atmo028FromArt() {
  if (!existsSync(SRC)) return null;
  const P = JSON.parse(readFileSync(SRC, 'utf8'));
  return { version: P.version, textures: strip(P.textures), presets: strip(P.presets), rainTiers: strip(P.rainTiers), fogTiers: strip(P.fogTiers), s1: strip(P.s1), water: strip(P.water), beam: strip(P.beam), glow: strip(P.glow) };
}

function render(data) {
  return `/**
 * v0.1-028 大气参数（美术交付 art/source/atmosphere/atmosphere-028.json 的原样副本，去掉 _doc / check 字段）。
 * 美术改 JSON 后重新生成：node scripts/gen-atmo028.mjs（verify-render 会逐项比对 art 原件，不一致就失败）。
 * 单位：米 / 秒；颜色 sRGB hex；贴图 key = art/textures/<key>.ktx2。说明见 art/source/atmosphere/README-028.md。
 */
export const ATMO028 = ${JSON.stringify(data, null, 2)} as const;

export type Atmo028PresetName = keyof typeof ATMO028.presets;
export type Atmo028Tier = keyof typeof ATMO028.rainTiers;
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = atmo028FromArt();
  if (!data) {
    console.log('没有 ../art/source/atmosphere/atmosphere-028.json，跳过');
    process.exit(0);
  }
  const text = render(data);
  if (process.argv.includes('--check')) {
    const same = readFileSync(OUT, 'utf8') === text;
    console.log(same ? '  ✓ atmosphere028.ts 与美术 JSON 一致' : '  ✗ atmosphere028.ts 与美术 JSON 不一致（node scripts/gen-atmo028.mjs 重新生成）');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  console.log('已生成 ' + OUT);
}
