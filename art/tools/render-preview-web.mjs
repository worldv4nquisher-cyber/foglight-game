// 无头 Chrome 渲染预览 PNG（不需要 Blender）。
//   node art/tools/render-preview-web.mjs --s3 [view,view]   → S3 初望灯塔 art/models/env/preview/s3-*.png（preview/env-s3.html，020）
//   node art/tools/render-preview-web.mjs --s2 [view,view]   → S2 守灯人小屋 art/models/env/preview/s2-*.png（preview/env-s2.html，019）
//   node art/tools/render-preview-web.mjs [--props bell,bell-side,bell-scale,raft,raft-float,raft-top,mirror,mirror-back,guide-a,guide-b,gate,gate-open,gate-dials,lock,lock-lit,valve,valve-open,window,window-side,ignite,ignite-pulled,ignite-below,door,door-open,door-key] → 道具 art/models/props/preview/*.png（preview/index.html；--props 只渲染列出的视图）
//   node art/tools/render-preview-web.mjs --char   → 汐 art/models/characters/preview/*.png（preview/char.html）
//   node art/tools/render-preview-web.mjs --anims jobs.json → 汐动画网格（preview/anims.html，017）；jobs = [[query, 输出名或绝对路径.png, w, h], …]
//   node art/tools/render-preview-web.mjs --env [view,view]  → S1 场景组装 art/models/env/preview/*.png（preview/env.html）
//   node art/tools/render-preview-web.mjs --page env.html --jobs jobs.json → 任意预览页（028）；jobs = [[完整 query, 绝对路径.png, w, h], …]
// 本地起静态服务（只监听 127.0.0.1）：/models → art/models，/three → game/node_modules/three，/ → art/tools/preview。
// 用独立临时配置目录启动 Chrome，经 CDP（Node 内置 WebSocket）等页面 title=done 后截图。CHROME=/path 可指定浏览器。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ART = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = { '/models/': join(ART, 'models') + '/', '/textures/': join(ART, 'textures') + '/', '/source/': join(ART, 'source') + '/', '/three/': join(ART, '../game/node_modules/three') + '/', '/': join(ART, 'tools/preview') + '/' };
// PREVIEW_MOUNT="/before/=/abs/dir/"（可选）：额外挂一个只读目录（r2 头部改前 / 改后对比用备份的旧 GLB + 贴图）
for (const m of (process.env.PREVIEW_MOUNT ?? '').split(',').filter(Boolean)) { const [k, d] = m.split('='); MAP[k] = d.endsWith('/') ? d : d + '/'; }
const TYPES = { '.ktx2': 'image/ktx2', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const pre = Object.keys(MAP).sort((x, y) => y.length - x.length).find((k) => p.startsWith(k));
  try {
    const file = MAP[pre] + (p.slice(pre.length) || 'index.html');
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const profile = mkdtempSync(join(tmpdir(), 'preview-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run',
  '--disable-extensions', `--user-data-dir=${profile}`, '--remote-debugging-port=0', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let portFile = join(profile, 'DevToolsActivePort');
for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
const devPort = readFileSync(portFile, 'utf8').split('\n')[0];
const targets = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
const cdp = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

const ANIMS = process.argv.includes('--anims');
const CUSTOM = process.argv.includes('--page') ? process.argv[process.argv.indexOf('--page') + 1] : null;
const CHAR = process.argv.includes('--char') || ANIMS;
const S2 = process.argv.includes('--s2');
const S3 = process.argv.includes('--s3');
const ENV = process.argv.includes('--env') || S2 || S3;
const OUT = join(ART, ENV ? 'models/env/preview' : ANIMS ? 'models/characters/preview/anims' : CHAR ? 'models/characters/preview' : 'models/props/preview');
const PAGE = CUSTOM ? CUSTOM : ANIMS ? 'anims.html' : S3 ? 'env-s3.html' : S2 ? 'env-s2.html' : ENV ? 'env.html' : CHAR ? 'char.html' : 'index.html';
const S2_ONLY = (process.argv[process.argv.indexOf('--s2') + 1] ?? '').startsWith('--') ? [] : (process.argv[process.argv.indexOf('--s2') + 1] ?? '').split(',').filter(Boolean);
const S3_ONLY = (process.argv[process.argv.indexOf('--s3') + 1] ?? '').startsWith('--') ? [] : (process.argv[process.argv.indexOf('--s3') + 1] ?? '').split(',').filter(Boolean);
const PROPS_ONLY = process.argv.includes('--props') ? (process.argv[process.argv.indexOf('--props') + 1] ?? '').split(',').filter(Boolean) : [];
const ENV_ONLY = (process.argv[process.argv.indexOf('--env') + 1] ?? '').startsWith('--') ? [] : (process.argv[process.argv.indexOf('--env') + 1] ?? '').split(',').filter(Boolean);
const JOBS = CUSTOM
  ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--jobs') + 1], 'utf8'))
  : ANIMS
  ? JSON.parse(readFileSync(process.argv[process.argv.indexOf('--anims') + 1], 'utf8'))
  : S3
  ? [['exterior', 's3-exterior', 1600, 900], ['concept', 's3-concept-angle', 900, 1200], ['overview', 's3-overview', 1600, 1000], ['stairs', 's3-spiral-stairs', 1600, 900],
    ['lookup', 's3-lookup-from-ground', 1200, 1200], ['window', 's3-machine-room', 1600, 900], ['lamp', 's3-lamp-room', 1600, 900], ['s1far', 's3-vs-s1-far', 1600, 900]].filter(([v]) => !S3_ONLY.length || S3_ONLY.includes(v))
    .concat(S3_ONLY.filter((v) => v.includes('&')).map((v, i) => [v, `s3-debug-${i}`, 1024, 640]))
  : S2
  ? [['exterior', 's2-exterior', 1600, 900], ['west', 's2-west-slope', 1600, 900], ['yard', 's2-yard-lantern-window', 1600, 900], ['overview', 's2-overview', 1600, 1000],
    ['ground', 's2-interior-ground', 1600, 900], ['upper', 's2-interior-upper-lantern', 1600, 900], ['viewpoint', 's2-viewpoint-fov30', 1600, 900],
    ...['ws-eye', 'ws-6deg', 'ws-off1m-s', 'ws-off1m-n'].flatMap((v) => [[v, `s2-white-stones-${v.slice(3)}`, 1600, 900], [`${v}-id`, `s2-white-stones-${v.slice(3)}-id`, 1600, 900]])].filter(([v]) => !S2_ONLY.length || S2_ONLY.includes(v))
    .concat(S2_ONLY.filter((v) => v.includes('&')).map((v, i) => [v, `s2-debug-${i}`, 1024, 640]))
  : ENV
  ? [['opening', 's1-opening-hightide', 1600, 900], ['opening-low', 's1-opening-lowtide', 1600, 900], ['overview', 's1-overview-lowtide', 1600, 1000],
    ['channel', 's1-channel-lowtide', 1600, 900], ['ledge', 's1-ledge-cam-hightide', 1600, 900], ['assets', 's1-assets', 1600, 900], ['rocks', 's1-rocks-closeup', 1600, 900]].filter(([v]) => !ENV_ONLY.length || ENV_ONLY.includes(v))
    .concat(ENV_ONLY.filter((v) => v.includes('&')).map((v, i) => [v, `s1-debug-${i}`, 1024, 640]))
  : CHAR
  ? [['front', 'char-xi-front', 900, 1350], ['side', 'char-xi-side', 900, 1350], ['back', 'char-xi-back', 900, 1350],
    ['lantern', 'char-xi-lantern', 900, 1350], ['face', 'char-xi-face', 900, 900], ['lods', 'char-xi-lods', 1500, 1000]]
  : [['lantern', 'prop-lantern-brass', 1200, 1200], ['stand', 'prop-lantern-stand-s2', 1200, 1200], ['stand-back', 'prop-lantern-stand-s2-back', 1200, 1200],
    ['bell', 'prop-tide-bell', 1200, 1500], ['bell-side', 'prop-tide-bell-swing-side', 1200, 1200], ['bell-scale', 'prop-tide-bell-scale', 1200, 1200],
    ['raft', 'prop-raft-s1', 1600, 1100], ['raft-float', 'prop-raft-s1-float', 1600, 1000], ['raft-top', 'prop-raft-s1-top', 1500, 1150],
    ['mirror', 'prop-mirror-stand-s2', 1200, 1200], ['mirror-back', 'prop-mirror-stand-s2-back', 1200, 1200], ['guide-a', 'prop-guide-mirror-wall-s3-a', 1200, 1200], ['guide-b', 'prop-guide-mirror-wall-s3-b', 1200, 1200],
    ['gate', 'prop-dial-gate-s2', 1400, 1100], ['gate-open', 'prop-dial-gate-s2-open', 1400, 1100], ['gate-dials', 'prop-dial-gate-s2-dials-317', 1400, 900], ['gate-dial-close', 'prop-dial-gate-s2-dial-1-close', 900, 900],
    ['lock', 'prop-light-lock-s2', 1100, 1100], ['lock-lit', 'prop-light-lock-s2-lit', 1100, 1100], ['valve', 'prop-oil-valve-s3', 1100, 1100], ['valve-open', 'prop-oil-valve-s3-open', 1100, 1100],
    ['window', 'prop-guide-mirror-window-s3', 1200, 1200], ['window-side', 'prop-guide-mirror-window-s3-side', 1200, 1200], ['ignite', 'prop-ignition-port-s3', 1200, 1100], ['ignite-pulled', 'prop-ignition-port-s3-pulled-lit', 1200, 1100],
    ['ignite-below', 'prop-ignition-port-s3-below-cold', 1100, 1100], ['door', 'prop-lighthouse-door-s3', 1100, 1300], ['door-open', 'prop-lighthouse-door-s3-open', 1100, 1300], ['door-key', 'prop-lighthouse-door-s3-keyhole', 1000, 1000]]
      .filter(([v]) => !PROPS_ONLY.length || PROPS_ONLY.includes(v));
mkdirSync(OUT, { recursive: true });
let failed = false;
for (const [view, name, w, h] of JOBS) {
  await cdp('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: `http://127.0.0.1:${port}/${PAGE}?${ANIMS || CUSTOM ? view : 'view=' + view}` });
  let title = '';
  for (let i = 0; i < (ENV || CUSTOM ? 3000 : 600) && !/^(done|error)/.test(title); i++) { await sleep(200); title = (await Promise.race([cdp('Runtime.evaluate', { expression: 'document.title' }), sleep(240000).then(() => ({ result: { result: { value: 'error 页面无响应（GPU 崩溃？）' } } }))])).result?.result?.value ?? ''; }
  if (title !== 'done') { console.error(`✗ ${view}: ${title || '超时'}`); failed = true; continue; }
  const shot = await cdp('Page.captureScreenshot', { format: 'png' });
  const out = name.startsWith('/') ? name : join(OUT, `${name}.png`);
  writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
  console.log('preview ->', out);
}
ws.close(); chrome.kill(); server.close();
await sleep(300); rmSync(profile, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
