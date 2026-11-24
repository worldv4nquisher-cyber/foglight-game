// 字体子集化（v0.1-010，npm run fonts）：按游戏里实际用到的字生成 WOFF2，每个 ≤ 2 MB。
//
// 用字来源：src/content/text/zh-CN.ts（文本表全部）+ src/**/*.ts 里的字符串（去掉注释）+ index.html + 基本 ASCII 与中文标点。
// 源字体：思源黑体 / 思源宋体（Noto Sans / Serif CJK SC Regular，SIL OFL 1.1），默认放在 ../art/source/fonts/，
//         可用环境变量 FONT_SRC_DIR 指定。源字体 40 MB，不进游戏仓库；生成的子集（几百 KB）进仓库。
// 输出：public/assets/fonts/foglight-sans.woff2、foglight-serif.woff2（随包附 OFL.txt）；src/assets/fonts.json（字符集 + 大小，供 --check 比对，不进包）
//
//   npm run fonts            重新生成（改了文本表 / 界面文字后跑）
//   node scripts/subset-fonts.mjs --check   （npm test 里）只校验：fonts.json 的字符集和当前用字一致、文件都 ≤ 2 MB
//                                            不需要源字体；不一致时提示跑 npm run fonts
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public/assets/fonts');
const SRC_DIR = process.env.FONT_SRC_DIR ?? join(ROOT, '../art/source/fonts');
const META = join(ROOT, 'src/assets/fonts.json');
const MAX_BYTES = 2 * 1024 * 1024;
export const FONTS = [
  { out: 'foglight-sans.woff2', src: 'NotoSansSC-Regular.otf', family: 'Foglight Sans' },
  { out: 'foglight-serif.woff2', src: 'NotoSerifSC-Regular.otf', family: 'Foglight Serif' },
];

/** 去掉 // 和 /* *\/ 注释（粗略：不处理字符串里的 //，够用——URL 不含中文） */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/** 不在生产界面显示的文字（含开发专用白盒标牌）不进字体子集 */
const NOT_IN_PLAYER_UI = [
  'src/config/atmosphere028.ts', 'src/config/perf-spots.ts', 'src/debug/perfSpot.ts',
  'src/levels/ch2/WhiteboxScene.ts', 'src/levels/ch2/layout.ts',
];

/** 当前用字（排序后的字符串） */
export function collectCharset() {
  const chars = new Set();
  const add = (s) => {
    for (const ch of s) if (ch.codePointAt(0) > 0x20) chars.add(ch);
  };
  // 基本 ASCII + 常用中文标点 / 符号
  for (let c = 0x21; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  add('，。、：；！？「」『』（）《》〈〉【】—…·“”‘’～　％＋－×÷°');
  add(readFileSync(join(ROOT, 'src/content/text/zh-CN.ts'), 'utf8'));
  for (const f of walk(join(ROOT, 'src'))) {
    if (NOT_IN_PLAYER_UI.some((n) => f.endsWith(n))) continue;
    // 只收非 ASCII（中文、标点）；ASCII 已全部包含
    const src = stripComments(readFileSync(f, 'utf8'));
    for (const ch of src) if (ch.codePointAt(0) > 0x7f) chars.add(ch);
  }
  for (const ch of readFileSync(join(ROOT, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')) {
    if (ch.codePointAt(0) > 0x7f) chars.add(ch);
  }
  chars.add(' ');
  return [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0)).join('');
}

function check() {
  const metaPath = META;
  if (!existsSync(metaPath)) throw new Error('缺少 src/assets/fonts.json，运行 npm run fonts');
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const want = collectCharset();
  const have = new Set(meta.charset);
  const missing = [...want].filter((c) => !have.has(c));
  let ok = true;
  if (missing.length) {
    console.error(`  ✗ 字体子集缺 ${missing.length} 个字：${missing.slice(0, 40).join('')}${missing.length > 40 ? '…' : ''}\n    运行 npm run fonts 重新生成（需要源字体，见 README「字体」）`);
    ok = false;
  }
  for (const f of FONTS) {
    const p = join(OUT_DIR, f.out);
    if (!existsSync(p)) {
      console.error(`  ✗ 缺少 ${relative(ROOT, p)}`);
      ok = false;
      continue;
    }
    const size = statSync(p).size;
    if (size > MAX_BYTES) {
      console.error(`  ✗ ${f.out} ${(size / 1024 / 1024).toFixed(2)} MB > 2 MB`);
      ok = false;
    } else console.log(`  ✓ ${f.out} ${(size / 1024).toFixed(0)} KB ≤ 2 MB`);
  }
  if (ok) console.log(`  ✓ 字体子集覆盖当前全部用字（${want.length} 字，子集 ${have.size} 字）`);
  if (!ok) process.exit(1);
}

async function build() {
  const { default: subsetFont } = await import('subset-font');
  const charset = collectCharset();
  mkdirSync(OUT_DIR, { recursive: true });
  const files = {};
  for (const f of FONTS) {
    const src = join(SRC_DIR, f.src);
    if (!existsSync(src)) {
      throw new Error(`找不到源字体 ${src}\n  思源黑体 / 宋体（Noto Sans / Serif CJK SC Regular，OFL）放到 ${SRC_DIR}，或设 FONT_SRC_DIR`);
    }
    const t0 = Date.now();
    const out = await subsetFont(readFileSync(src), charset, { targetFormat: 'woff2' });
    if (out.length > MAX_BYTES) throw new Error(`${f.out} ${(out.length / 1024 / 1024).toFixed(2)} MB 超过 2 MB`);
    writeFileSync(join(OUT_DIR, f.out), out);
    files[f.out] = { family: f.family, source: f.src, bytes: out.length };
    console.log(`  ✓ ${f.out}  ${(out.length / 1024).toFixed(0)} KB  （${f.src}，${Date.now() - t0} ms）`);
  }
  writeFileSync(
    META,
    JSON.stringify({ note: 'npm run fonts 生成，勿手改', license: 'SIL OFL 1.1（见 OFL.txt）', chars: [...charset].length, files, charset }, null, 2) + '\n',
  );
  console.log(`  ✓ 字符集 ${[...charset].length} 字 → src/assets/fonts.json`);
}

if (process.argv.includes('--check')) check();
else await build();
