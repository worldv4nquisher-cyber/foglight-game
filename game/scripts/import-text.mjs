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

/** 剧情类文本（不含 UI / 提示词这些短词）：代码里不能出现它们的原文片段 */
const STORY_TYPES = new Set(['subtitle', 'title', 'monologue', 'inspect', 'goal', 'journal', 'doc', 'hint']);
const CJK = /[\u3400-\u9fff]/g;

/** 剧情文本拆成短句（按标点 / 换行），保留 ≥ 4 个汉字的片段 */
export function storyFragments() {
  const out = new Map();
  for (const e of entries) {
    if (!STORY_TYPES.has(e.type)) continue;
    const v = strings[e.id];
    const text = Array.isArray(v) ? v.join('\n') : String(v ?? '');
    for (const frag of text.split(/[\s，。、！？；：「」『』（）…—·,.!?;:"'()]+/)) {
      if ((frag.match(CJK) ?? []).length >= 4) out.set(frag, e.id);
    }
  }
  return out;
}

/**
 * 代码里硬编码的剧情中文（任务单 005 验收「grep 检查」）：扫 src 下的 .ts / .css（文本表目录除外）和 index.html，
 * 出现任何剧情文本片段（≥ 4 个汉字的短句）就报出来。返回 [片段, 来源 ID, 文件][]
 */
export function hardcodedStory(dir = join(root, 'src')) {
  const frags = storyFragments();
  const textDir = dirname(outPath);
  const found = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (p === textDir) continue;
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|css|html)$/.test(f)) {
        // 注释里提到地名 / 文案没关系（BUG-005 起地名进了文本表，注释里常会写「S2 守灯人小屋」）
        const src = readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
        for (const [frag, id] of frags) if (src.includes(frag)) found.push([frag, id, relative(root, p)]);
      }
    }
  };
  walk(dir);
  for (const extra of ['index.html']) {
    const p = join(root, extra);
    if (!existsSync(p)) continue;
    const src = readFileSync(p, 'utf8');
    for (const [frag, id] of frags) if (src.includes(frag)) found.push([frag, id, extra]);
  }
  return found;
}

/**
 * BUG-005：文本表之外的玩家可见中文。用 TypeScript 语法树扫 src 下全部 .ts（文本表目录除外）的字符串 / 模板字面量，
 * 含汉字就报出来（注释不算）。允许的例外——都是开发者看的、玩家正式流程里看不到的：
 *   - console.*(…) 的参数、new Error(…) / throw 的消息
 *   - F4 调试面板 `*.debug.set(…)` 的参数；名字以 debug 开头的函数 / 方法体（debugLine、debugPlayerLine）
 *   - DEV_ONLY 里整份文件（测试场地、调试面板等，附原因）
 *   - 字面量所在行或上一行写了 `text-ok: 原因`（F3 详细面板这类混在玩家文件里的调试行）
 * 另外检查 src 下 .css 的 content 字符串、index.html（<title> 必须等于 ui.title；<noscript> 无法走文本表，放行）。
 * 返回 [文件:行, 字面量][]
 */
export const DEV_ONLY = {
  'src/scenes/TestbedScene.ts': '测试场地（?scene=testbed，正式版要 debug）',
  'src/ui/DebugPanel.ts': 'F4 调试面板（仅 dev / ?debug=1）',
  'src/config/atmosphere.ts': '氛围预设内部名，只在代码里区分预设',
  'src/assets/vertexColors.ts': '资源检查结果，只进控制台日志',
};
const HAN = /[\u3400-\u9fff]/;

export async function hardcodedCjk(dir = join(root, 'src')) {
  const ts = (await import('typescript')).default;
  const textDir = dirname(outPath);
  const found = [];
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (p === textDir) continue;
      if (statSync(p).isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(dir);
  for (const p of files) {
    const rel = relative(root, p).split('\\').join('/');
    if (rel in DEV_ONLY) continue;
    const src = readFileSync(p, 'utf8');
    if (p.endsWith('.css')) {
      for (const m of src.matchAll(/content\s*:\s*(['"])(.*?)\1/g)) if (HAN.test(m[2])) found.push([`${rel}:${src.slice(0, m.index).split('\n').length}`, m[2]]);
      continue;
    }
    if (!p.endsWith('.ts')) continue;
    const lines = src.split('\n');
    const sf = ts.createSourceFile(p, src, ts.ScriptTarget.Latest, true);
    const allowed = (node) => {
      for (let n = node.parent; n; n = n.parent) {
        if (ts.isCallExpression(n)) {
          const callee = n.expression.getText(sf);
          if (/^console\.\w+$/.test(callee) || /(^|\.)debug\.set$/.test(callee)) return true;
        }
        if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && /(^|\.)\w*Error$/.test(n.expression.getText(sf))) return true;
        if (ts.isThrowStatement(n)) return true;
        if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessorDeclaration(n)) && n.name && /^debug/.test(n.name.getText(sf))) return true;
      }
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
      return /text-ok/.test(lines[line] ?? '') || /text-ok/.test(lines[line - 1] ?? '');
    };
    const visit = (node) => {
      const isLit =
        ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node);
      // 着色器源码里的 GLSL 注释不算
      const body = isLit ? node.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '') : '';
      if (isLit && HAN.test(body) && !allowed(node)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        found.push([`${rel}:${line}`, node.text.length > 40 ? node.text.slice(0, 40) + '…' : node.text]);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // index.html：<title> 要和文本表一致；<noscript> 是关掉 JS 时的系统提示，走不了文本表，放行
  const html = existsSync(join(root, 'index.html')) ? readFileSync(join(root, 'index.html'), 'utf8') : '';
  const title = html.match(/<title>(.*?)<\/title>/)?.[1];
  if (title !== undefined && title !== strings['ui.title']) found.push(['index.html <title>', `${title}（应与 ui.title「${strings['ui.title']}」一致）`]);
  const rest = html.replace(/<title>.*?<\/title>/s, '').replace(/<noscript>.*?<\/noscript>/s, '').replace(/<!--.*?-->/gs, '');
  for (const m of rest.matchAll(/[^<>\n]*[\u3400-\u9fff][^<>\n]*/g)) found.push(['index.html', m[0].trim()]);
  return found;
}

export function missingIds() {
  return scanIds().filter(([id]) => !(id in strings));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}

async function main() {
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
  const story = hardcodedStory();
  if (story.length) {
    fail++;
    console.log(`✗ 文本表之外硬编码的剧情中文：${story.length} 处`);
    for (const [frag, id, f] of story) console.log(`    「${frag}」（${id}）  ${f}`);
  } else console.log(`✓ 文本表之外没有硬编码的剧情中文（检查 ${storyFragments().size} 个剧情短句片段）`);
  const cjk = await hardcodedCjk();
  if (cjk.length) {
    fail++;
    console.log(`✗ 文本表之外写死的玩家可见中文：${cjk.length} 处（改用 t(id)；纯调试文字放 DEV_ONLY 或在行尾 / 上一行注 text-ok: 原因）`);
    for (const [where, lit] of cjk) console.log(`    ${where}  「${lit}」`);
  } else console.log(`✓ src 全部场景 / UI / 系统代码里没有写死的玩家可见中文（例外：日志 / 报错 / 调试面板 / ${Object.keys(DEV_ONLY).length} 个调试文件）`);
  process.exit(fail ? 1 : 0);
}
