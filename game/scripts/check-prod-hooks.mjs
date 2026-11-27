// batch25 第 1 项：断言生产构建（dist/）不含调试 / QA 钩子。check:release 在 build 之后跑。
// __game / __qa / __perfSpot / __s1..__s3 / __testbed 只在 vite dev 和测试构建（--mode smoke，见 scripts/lib/test-server.mjs）里有；
// 生产构建里 main.ts 的条件是构建期常量，整段连同 debug/qaHooks、debug/perfSpot 模块被摇树删掉，线上加 ?smoke=1 也拿不到。
// 用法：npm run verify:prod-hooks（DIST=别的目录 可选，默认 dist）
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLYFILL_PLACEHOLDER, polyfillInlineScript } from './lib/inline-polyfill.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = resolve(root, process.env.DIST ?? 'dist');
if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`✗ ${DIST}/index.html 不存在，先 npm run build`);
  process.exit(1);
}
/** 只在钩子代码里出现的字符串（游戏代码自己的属性名如 puzzles 不算） */
export const FORBIDDEN = ['__qa', '__game', '__perfSpot', '__testbed', '__s1', '__s2', '__s3', '__lods', 'installQaHooks', 'unparsable', 'ch2-whitebox', '裂湾村白盒'];
/**
 * batch26：?debug=1 和 ?scene= 直进场景也只在 dev / 测试构建里（src/config/debug.ts 的 TEST_BUILD 是构建期常量）。
 * 生产构建里不能还有读这两个 URL 参数的代码，也不能还有直进 testbed / sandbox 的分支（压缩后引号可能是 ` ' "）。
 */
export const FORBIDDEN_RE = [
  [/\.(?:has|get)\(\s*[`'"](?:debug|scene)[`'"]\s*\)/, '读 ?debug / ?scene 参数'],
  // batch26 追加：?smoke 的 4 处行为（默认关美术、帧率面板详细模式、?hintScale、S3 ?father= 预览）也只在 dev / 测试构建里
  [/\.(?:has|get)\(\s*[`'"]smoke[`'"]\s*\)/, '读 ?smoke 参数'],
  [/\.(?:has|get)\(\s*[`'"]hintScale[`'"]\s*\)/, '读 ?hintScale 参数'],
  [/\.(?:has|get)\(\s*[`'"]father[`'"]\s*\)/, '读 ?father= 预览参数'],
  // batch26 再追加（同裁决 31）：?autostart 跳过主菜单也只在 dev / 测试构建里
  [/\.(?:has|get)\(\s*[`'"]autostart[`'"]\s*\)/, '读 ?autostart 参数'],
  [/startLoading\(\s*[`'"](?:testbed|sandbox)[`'"]\s*\)/, '?scene=testbed / sandbox 直进分支'],
];

/**
 * batch27（裁决 31 扩展）：URL 参数改成**白名单**。生产包里对 URLSearchParams 的 get / has 只能是
 * `new URLSearchParams(location.search).get|has('白名单键')` 这种字面量写法；其余一律拦：
 * - 非白名单键（quality / atmo / lut / reflect / reflectK / simulateFps / slowLoad / greybox / beamDebug / lens / xiShadow …）；
 * - 变量传参（get(k)）、把 URLSearchParams / location.search / url.searchParams 存进变量再读、getAll / entries / forEach 等。
 * 实现：先把白名单允许的字面量读法抹掉，剩下的文件里只要还出现 URLSearchParams / location.search / searchParams 就失败
 * （生产代码里没有别的正当用途；资源 URL 解析用的是 location.href）。
 * 键 → 理由。目前**为空**：画质等只走游戏内设置，生产包不读任何 URL 参数。要加键必须写理由并经制作人确认。
 */
export const URL_PARAM_WHITELIST = Object.freeze({});
const URL_TOKENS = /URLSearchParams|location\s*\.\s*search|searchParams/g;
/**
 * batch27 QA 回归（给程序 2）：不经 URLSearchParams / location.search 也能拿到查询串的写法，同样一律拦（与白名单无关）：
 * - 方括号取属性：location[`search`]、x['searchParams']、document["URL"] 等（压缩器不会产出，只可能是手写绕过）；
 * - 整个地址自己切：location.href.split(`?`)、xxx.href.indexOf('?') / slice / match …；
 * - URL 对象的 .search（new URL(location.href).search），只认属性读取、不认 String#search(…) 调用；
 * - document.URL / documentURI / baseURI（等于整个地址），location.toString()。
 * 现有 dist 里这些写法都是 0 处（资源解析用的 new URL(x, location.href) 不受影响）。
 */
const URL_BYPASS_RE = [
  [/\blocation\s*\[/g, 'location[…] 方括号取属性'],
  [/\[\s*[\x60'"](?:search|searchParams|URL|documentURI|baseURI)[\x60'"]\s*\]/g, '方括号读 search / URL 属性'],
  [/\bhref\s*\.\s*(?:split|indexOf|lastIndexOf|slice|substring|substr|match|matchAll|replace|search)\s*\(/g, '切 / 解析整个 href 取查询串'],
  [/(?<!location\s*)\.\s*search\b(?!\s*\()/g, 'URL 对象的 .search（new URL(…).search 等）'],
  [/\bdocument\s*\.\s*(?:URL|documentURI|baseURI)\b/g, 'document.URL / documentURI / baseURI 读整个地址'],
  [/\blocation\s*\.\s*toString\s*\(/g, 'location.toString() 读整个地址'],
];
const quoteKeys = (wl) => Object.keys(wl).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
/** 返回违规列表：[{ what, index, text }] */
export function urlParamViolations(src, whitelist = URL_PARAM_WHITELIST) {
  let s = src;
  const keys = quoteKeys(whitelist);
  if (keys) {
    const allowed = new RegExp(
      String.raw`new\s+URLSearchParams\(\s*(?:(?:globalThis|window|self)\s*\.\s*)?location\s*(?:\?\.|\.)\s*search\s*\)\s*\.\s*(?:get|has)\(\s*([\x60'"])(?:${keys})\1\s*\)`,
      'g',
    );
    s = s.replace(allowed, (m) => ' '.repeat(m.length));
  }
  const out = [];
  const tokenSpans = [];
  let consumed = -1;
  for (const m of s.matchAll(URL_TOKENS)) {
    if (m.index < consumed) continue; // 同一个表达式里的 location.search（URLSearchParams(location.search)）只报一次
    consumed = m.index + m[0].length;
    if (m[0] === 'URLSearchParams') {
      const head = /^URLSearchParams\([^()]*(?:\([^()]*\))?[^()]*\)/.exec(s.slice(m.index, m.index + 200));
      if (head) consumed = m.index + head[0].length;
    }
    const tail = s.slice(m.index, m.index + 160);
    const lit = /^URLSearchParams\([^()]*(?:\([^()]*\))?[^()]*\)\s*\.\s*(get|has|getAll)\(\s*([\x60'"])([^\x60'"]*)\2\s*\)/.exec(tail);
    const varArg = /^URLSearchParams\([^()]*(?:\([^()]*\))?[^()]*\)\s*\.\s*(?:get|has|getAll)\(\s*[^\x60'"\s)]/.test(tail);
    const what = lit ? `读非白名单 URL 参数 ?${lit[3]}` : varArg ? 'URLSearchParams 变量传参（get(k) 之类）' : `${m[0]} 的其它用法（存进变量再读 / 解析 search 等）`;
    out.push({ what, index: m.index, text: src.slice(Math.max(0, m.index - 40), m.index + 80).replace(/\s+/g, ' ') });
    tokenSpans.push([m.index, consumed]);
  }
  // 绕过写法：同一处被多条规则命中只报一次（按区间去重，也不和上面已报的重叠）
  const extra = [];
  for (const [re, what] of URL_BYPASS_RE) for (const m of s.matchAll(re)) extra.push({ what, index: m.index, end: m.index + m[0].length });
  extra.sort((a, b) => a.index - b.index);
  let until = -1;
  for (const v of extra) {
    if (v.index < until || tokenSpans.some(([a, b]) => v.index >= a && v.index < b)) continue;
    until = v.end;
    out.push({ what: v.what, index: v.index, text: src.slice(Math.max(0, v.index - 40), v.index + 80).replace(/\s+/g, ' ') });
  }
  return out.sort((a, b) => a.index - b.index);
}
// 自检：规则本身不能失效（每次都跑，几毫秒）
{
  const wl = { lang: '自检用' };
  const cases = [
    ['new URLSearchParams(location.search).get(`lang`)', 0],
    ['new URLSearchParams(location.search).get("quality")', 1],
    ['new URLSearchParams(location.search).get(k)', 1],
    ['let q=new URLSearchParams(location.search);q.get(`lang`)', 1],
    ['function f(k){return new URLSearchParams(location.search).get(k)}', 1],
    ['new URL(location.href).searchParams.get(`lang`)', 1],
    ['/quality=(\\w+)/.exec(location.search)', 1],
    ['new URLSearchParams(e).has(`lang`)', 1],
    // batch27 QA 回归：4 种原来拦不住的写法（及同族变体）
    ['location[`search`]', 1],
    ["const q=location['search'].slice(1)", 1],
    ['location.href.split(`?`)[1]', 1],
    ["location.href.indexOf('?')", 1],
    ['new URL(location.href).search', 1],
    ['const u=new URL(location.href);u.search.slice(1)', 1],
    ['document.URL', 1],
    ['document.URL.split("?")[1]', 1],
    ['document["URL"]', 1],
    ['document.documentURI', 1],
    ['location.toString()', 1],
    // 不该误报：资源解析、String#search 调用、单纯读 href
    ['new URL(e, location.href)', 0],
    ['n.search(/^image\\/jpe?g$/)', 0],
    ['const a=location.href', 0],
    ['x.research=1;y.searchable=2', 0],
  ];
  for (const [src, n] of cases) {
    const got = urlParamViolations(src, wl).length;
    if (got !== n) {
      console.error(`✗ check-prod-hooks 自检失败：${src} 期望 ${n} 处违规，得到 ${got}`);
      process.exit(1);
    }
  }
  if (urlParamViolations('new URLSearchParams(location.search).get(`lang`)').length !== 1) {
    console.error('✗ check-prod-hooks 自检失败：空白名单时任何读法都应拦');
    process.exit(1);
  }
}

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
// batch26：除了 static/，dist/assets/ 下所有 JS（含以后放进去的 worker / 解码器等）也扫；目录不存在就跳过
const scan = (d, re) => (existsSync(d) ? walk(d).filter((f) => re.test(f)) : []);
const staticFiles = scan(join(DIST, 'static'), /\.(js|mjs|html|css)$/);
const assetJs = scan(join(DIST, 'assets'), /\.(js|mjs|cjs)$/);
const files = [join(DIST, 'index.html'), ...staticFiles, ...assetJs];
const hits = [];
for (const f of files) {
  const s = readFileSync(f, 'utf8');
  for (const w of FORBIDDEN) {
    const i = s.indexOf(w);
    if (i >= 0) hits.push(`${relative(root, f)}：「${w}」…${s.slice(Math.max(0, i - 30), i + 40).replace(/\s+/g, ' ')}…`);
  }
  for (const v of urlParamViolations(s)) hits.push(`${relative(root, f)}：${v.what}「…${v.text}…」`);
  for (const [re, what] of FORBIDDEN_RE) {
    const m = re.exec(s);
    if (m) hits.push(`${relative(root, f)}：${what}「${m[0]}」…${s.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}…`);
  }
}
// batch27 第 2 项：dist/index.html 的 structuredClone 内联 polyfill 必须由插件从 src/platform/structuredClonePolyfill.js 生成（同一份源码）、在入口模块之前
{
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const m = /<script id="polyfill-structured-clone">([\s\S]*?)<\/script>/.exec(html);
  const mod = html.indexOf('<script type="module"');
  if (!m) hits.push('index.html：没有 <script id="polyfill-structured-clone">');
  else if (m[1].includes(POLYFILL_PLACEHOLDER)) hits.push('index.html：polyfill 占位没被替换（vite 插件没生效）');
  else if (m[1].trim() !== polyfillInlineScript().trim()) hits.push('index.html：内联 polyfill 与 src/platform/structuredClonePolyfill.js 不一致（dist 过期？）');
  else if (mod >= 0 && m.index > mod) hits.push('index.html：内联 polyfill 在入口模块之后');
}
if (hits.length) {
  console.error(`✗ 生产构建里还有调试 / QA 钩子（${hits.length} 处）——是不是用 --mode smoke 建的 dist，或新加的钩子没用构建期条件？`);
  for (const h of hits) console.error('  ' + h);
  process.exit(1);
}
console.log(`✓ index.html 内联 structuredClone polyfill 与 src/platform/structuredClonePolyfill.js 一致、在入口模块之前\n✓ 生产构建不含调试 / QA 钩子：${files.length} 个文件（index.html + static/*.js|css ${staticFiles.length} 个 + assets/**/*.js ${assetJs.length} 个）里没有 ${FORBIDDEN.join(' / ')}；也没有 ${FORBIDDEN_RE.map(([, w]) => w).join(' / ')}；URL 参数白名单 ${Object.keys(URL_PARAM_WHITELIST).length ? Object.entries(URL_PARAM_WHITELIST).map(([k, r]) => `${k}（${r}）`).join('、') : '为空'}，生产包里没有其它 URLSearchParams / location.search / searchParams 用法（含变量传参），也没有 location[…] / 切 href / URL.search / document.URL 之类的绕过读法`);
