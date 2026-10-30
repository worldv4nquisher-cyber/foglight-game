// 构建产物 CSS 检查（BUG-003，npm run css；npm run check 在 build 之后跑）。
//
// 背景：vite 8 用 lightningcss 压缩 CSS。同一条规则里先写 backdrop-filter、后写 -webkit-backdrop-filter 时，
// lightningcss 把两者当成同一属性的不同前缀，「后写的覆盖先写的」，无前缀版本被删掉（与 build.target 无关，
// 不给 targets 也一样）；Chrome / Firefox 只认无前缀写法，于是背景模糊整个失效。mask-image 等属性不受影响，
// 但手写前缀本来就多余：lightningcss 会按 build.target（es2020 → Safari 14 等）自动补 -webkit-。
//
// 检查三件事（任一不满足 → 退出码 1）：
//   1. 源码 src/**/*.css 不手写 -webkit- / -moz- 前缀的 backdrop-filter、mask*（交给 lightningcss 补）
//   2. 源码里每条带「必须保留属性」的规则，在 dist/static/*.css 里同一选择器下仍有无前缀写法；
//      backdrop-filter 另外要求带 -webkit- 版本（Safari 14–17 只认前缀）
//   3. BUG-022：button / input / select / textarea 有全局 font: inherit（源码 + 产物），源码没有别的 font 简写把它盖掉
//
//   npm run css   （需要先 npm run build）
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const MUST_KEEP = ['backdrop-filter', 'mask-image', 'user-select'];
const NEED_WEBKIT = ['backdrop-filter'];
const NO_HAND_PREFIX = /^-(webkit|moz)-(backdrop-filter|mask)/;

const walk = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

/** 极简 CSS 规则解析：只取顶层「选择器 { 声明 }」，跳过 @keyframes 等 at 规则块 */
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).trim();
    if (head.startsWith('@')) {
      // 跳过整个 at 规则块（含嵌套）
      let depth = 1;
      let j = open + 1;
      for (; j < css.length && depth; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
      i = j;
      continue;
    }
    const close = css.indexOf('}', open);
    const body = css.slice(open + 1, close);
    const props = new Set(
      body
        .split(';')
        .map((d) => d.split(':')[0].trim().toLowerCase())
        .filter(Boolean),
    );
    out.push({ selector: head.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/\s*>\s*/g, '>').replace(/::(before|after)/g, ':$1'), props });
    i = close + 1;
  }
  return out;
}

const errors = [];
const srcFiles = walk(join(root, 'src')).filter((p) => p.endsWith('.css'));
const srcRules = [];
for (const f of srcFiles) {
  for (const r of rules(readFileSync(f, 'utf8'))) {
    for (const p of r.props) if (NO_HAND_PREFIX.test(p)) errors.push(`${relative(root, f)}：${r.selector} 手写了 ${p}（删掉，lightningcss 会按 build.target 自动补前缀）`);
    srcRules.push(r);
  }
}

const distDir = join(root, 'dist', 'static');
let distCss;
try {
  distCss = readdirSync(distDir).filter((n) => n.endsWith('.css'));
} catch {
  console.error('✗ 没有 dist/static，先 npm run build');
  process.exit(1);
}
if (!distCss.length) errors.push('dist/static 里没有 CSS');
const built = distCss.flatMap((n) => rules(readFileSync(join(distDir, n), 'utf8')));
const bySel = new Map();
for (const r of built) {
  const set = bySel.get(r.selector) ?? new Set();
  for (const p of r.props) set.add(p);
  bySel.set(r.selector, set);
}

let checked = 0;
for (const r of srcRules) {
  for (const prop of MUST_KEEP) {
    if (!r.props.has(prop)) continue;
    checked++;
    const got = bySel.get(r.selector);
    if (!got) {
      errors.push(`产物里找不到规则 ${r.selector}（源码有 ${prop}）`);
      continue;
    }
    if (!got.has(prop)) errors.push(`产物 ${r.selector} 丢了无前缀 ${prop}（只剩 ${[...got].filter((p) => p.includes(prop)).join(', ') || '无'}）`);
    if (NEED_WEBKIT.includes(prop) && !got.has('-webkit-' + prop)) errors.push(`产物 ${r.selector} 没有 -webkit-${prop}（Safari 14–17 需要）`);
  }
}

// 3. BUG-022：button / input / select（/ textarea）全局 font: inherit（源码和产物都要有；产物里选择器可能被合并 / 重排，按集合比）
const CONTROLS = ['button', 'input', 'select', 'textarea'];
/** 只取最内层「选择器 { 声明 }」：按 } 切开，每段最后一个 { 前是选择器（at 规则头自然落在更前面） */
const flatRules = (css) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('}')
    .map((chunk) => {
      const k = chunk.lastIndexOf('{');
      if (k < 0) return null;
      const head = chunk.slice(0, k);
      const sel = head.slice(Math.max(head.lastIndexOf(';'), head.lastIndexOf('{')) + 1).trim();
      return { sels: sel.split(',').map((x) => x.trim()), body: chunk.slice(k + 1).trim(), sel };
    })
    .filter((r) => r && r.sel && !r.sel.startsWith('@'));
const fontInherit = (css) => flatRules(css).some((r) => CONTROLS.every((c) => r.sels.includes(c)) && /(^|;)\s*font\s*:\s*inherit\s*(;|$)/.test(r.body));
if (!srcFiles.some((f) => fontInherit(readFileSync(f, 'utf8')))) errors.push(`源码 CSS 缺全局规则 ${CONTROLS.join(', ')} { font: inherit }（BUG-022：控件会回落 Arial）`);
if (!distCss.some((n) => fontInherit(readFileSync(join(distDir, n), 'utf8')))) errors.push(`产物 CSS 缺全局规则 ${CONTROLS.join(',')}{font:inherit}（BUG-022）`);
// 源码里不许再给控件写别的 font 简写把继承盖掉（font-family / font-size 单项可以）
for (const f of srcFiles) {
  for (const r of flatRules(readFileSync(f, 'utf8'))) {
    const short = /(^|;)\s*font\s*:\s*([^;]+)/.exec(r.body);
    if (r.sels.some((x) => CONTROLS.includes(x)) && short && short[2].trim() !== 'inherit') errors.push(`${relative(root, f)}：${r.sel} 用 font: ${short[2].trim()} 盖掉了继承（BUG-022）`);
  }
}

if (errors.length) {
  for (const e of errors) console.error('✗ ' + e);
  process.exit(1);
}
console.log(`✓ 构建 CSS：${checked} 处必须保留的属性（${MUST_KEEP.join(' / ')}）都在，源码无手写前缀；${CONTROLS.join(' / ')} 全局 font: inherit（BUG-022）`);
