// 文本表导入（v0.1-004 / 005）：docs/gdd/text-ch1.json → src/content/text/zh-CN.ts（生成文件，不要手改）。
// 同时扫描 src/**/*.ts 里用到的文本 ID 字面量（'ch1.…' / 'ui.…'），报告 JSON 里没有的 ID（必须为 0）。
//
// 用法：
//   node scripts/import-text.mjs           生成 zh-CN.ts 并检查
//   node scripts/import-text.mjs --check   只检查：生成结果与仓库里的 zh-CN.ts 一致、缺失 ID = 0（npm run test 用）
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const jsonPath = resolve(root, '../docs/gdd/text-ch1.json');
const outPath = join(root, 'src/content/text/zh-CN.ts');
const checkOnly = process.argv.includes('--check');

const json = JSON.parse(readFileSync(jsonPath, 'utf8'));
const strings = json.strings;
const entries = json.entries;

/** text-ch1.md §0：「只一次」写在 trigger / note 里 */
const ONCE = /只一次|只触发一次|仅一次/;

export function generate() {
  const meta = {};
  for (const e of entries) {
    meta[e.id] = { type: e.type, speaker: e.speaker, ...(ONCE.test(`${e.trigger ?? ''} ${e.note ?? ''}`) ? { once: true } : {}) };
  }
  const ids = Object.keys(strings).sort();
  const lines = [];
  lines.push('// 自动生成：node scripts/import-text.mjs（来源 docs/gdd/text-ch1.json），不要手改。');
  lines.push(`// 章节 ${json.meta.chapter} · ${json.meta.locale} · v${json.meta.version} · ${ids.length} 条`);
  lines.push('');
  lines.push('export const TEXT_ZH_CN = {');
  for (const id of ids) lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(strings[id])},`);
  lines.push('} as const;');
  lines.push('');
  lines.push("export type TextType = 'subtitle' | 'title' | 'monologue' | 'inspect' | 'goal' | 'journal' | 'doc' | 'hint' | 'prompt' | 'ui';");
  lines.push("export type TextSpeaker = 'xi' | 'father' | 'none' | 'system';");
  lines.push('export interface TextMeta {');
  lines.push('  type: TextType;');
  lines.push('  speaker: TextSpeaker;');
  lines.push('  /** 「只一次」：播过记进存档 seenLines，不再播 */');
  lines.push('  once?: true;');
  lines.push('}');
  lines.push('');
  lines.push('export const TEXT_META: Record<keyof typeof TEXT_ZH_CN, TextMeta> = {');
  for (const id of ids) lines.push(`  ${JSON.stringify(id)}: ${JSON.stringify(meta[id] ?? { type: 'ui', speaker: 'none' })},`);
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

/** 源码中引用的文本 ID（字符串字面量 'ch1.xxx' / 'ui.xxx'），返回 [id, 文件][] */
export function scanIds(dir = join(root, 'src')) {
  const found = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(f) && p !== outPath) {
        const src = readFileSync(p, 'utf8');
        for (const m of src.matchAll(/['"`]((?:ch1|ui)\.[a-z0-9_]+(?:\.[a-z0-9_]+)+)['"`]/g)) found.push([m[1], relative(root, p)]);
      }
    }
  };
  walk(dir);
  return found;
}

export function missingIds() {
  return scanIds().filter(([id]) => !(id in strings));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const out = generate();
  let fail = 0;
  if (checkOnly) {
    const cur = existsSync(outPath) ? readFileSync(outPath, 'utf8') : '';
    if (cur !== out) {
      console.log('✗ src/content/text/zh-CN.ts 与 docs/gdd/text-ch1.json 不一致：运行 node scripts/import-text.mjs 重新生成');
      fail++;
    } else console.log(`✓ zh-CN.ts 与 text-ch1.json 一致（${Object.keys(strings).length} 条）`);
  } else {
    writeFileSync(outPath, out);
    console.log(`已生成 ${relative(root, outPath)}（${Object.keys(strings).length} 条）`);
  }
  const missing = missingIds();
  const used = new Set(scanIds().map(([id]) => id));
  if (missing.length) {
    fail++;
    console.log(`✗ 代码里用到但 JSON 没有的文本 ID：${missing.length} 个`);
    for (const [id, f] of missing) console.log(`    ${id}  （${f}）`);
  } else console.log(`✓ 代码里用到的文本 ID ${used.size} 个，缺失 0 个`);
  process.exit(fail ? 1 : 0);
}
