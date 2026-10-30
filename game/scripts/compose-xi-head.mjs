// 汐头部精修对比图（batch15 D，可重复跑：美术交 r3 等新版本后直接重跑）：
//   游戏内 s1-xi-face-front / s1-xi-face-side / s3-father-hand-closeup（docs/tasks/shots-031/）× 美术预览 art/models/characters/preview/char-xi-head-rN-*.png
//   → docs/tasks/shots-031/xi-head-rN-compare.png。N 默认取 preview 里最大的版本号，XI_HEAD_REV=r2 可指定。
// 完整流程：npm run build && node --import ./scripts/register-ts-paths.mjs scripts/shots-031.mjs s1-xi-face \
//           && node --import ./scripts/register-ts-paths.mjs scripts/shots-031-father.mjs hand && node scripts/compose-xi-head.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(root, '../docs/tasks/shots-031');
const PREVIEW = resolve(root, '../art/models/characters/preview');
const revs = readdirSync(PREVIEW).map((f) => /^char-xi-head-r(\d+)-/.exec(f)?.[1]).filter(Boolean).map(Number);
const REV = process.env.XI_HEAD_REV ?? (revs.length ? 'r' + Math.max(...revs) : null);
if (!REV) throw new Error('preview 里没有 char-xi-head-rN-*.png');
const FONT = ['/home/box/.local/share/fonts/NotoSansSC.ttf', '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'].find(existsSync);
const H = 540, W = 1860; // 最宽一行：16:9 游戏图 960 + gamecam 877
const when = (f) => new Date(statSync(f).mtimeMs).toLocaleString('sv-SE').slice(5, 16);
const rows = [
  [['s1-xi-face-front.png', SHOTS, '游戏内 正脸（S1 涨潮 art=1 high）'], [`char-xi-head-${REV}-front-compare.png`, PREVIEW, `美术 ${REV} 正面对比`]],
  [['s1-xi-face-side.png', SHOTS, '游戏内 侧脸'], [`char-xi-head-${REV}-side-compare.png`, PREVIEW, `美术 ${REV} 侧面对比`]],
  [['s3-father-hand-closeup.png', SHOTS, '游戏内 S3 父亲摸头近景'], [`char-xi-head-${REV}-gamecam.png`, PREVIEW, `美术 ${REV} 游戏机位`]],
];
const inputs = [], filters = [];
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
rows.forEach((row, r) => {
  const labels = [];
  row.forEach(([file, dir, label], k) => {
    const f = join(dir, file);
    if (!existsSync(f)) throw new Error('缺图：' + f);
    const i = inputs.length / 2; inputs.push('-i', f);
    const txt = `${label}  ${file}  ${when(f)}`;
    filters.push(`[${i}:v]scale=-2:${H},drawtext=fontfile='${FONT}':text='${esc(txt)}':x=10:y=h-th-10:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.6[c${r}${k}]`);
    labels.push(`[c${r}${k}]`);
  });
  filters.push(`${labels.join('')}hstack=inputs=${labels.length},pad=${W}:${H}:0:0:color=0x141414[r${r}]`);
});
filters.push(`${rows.map((_, r) => `[r${r}]`).join('')}vstack=inputs=${rows.length}[out]`);
const out = join(SHOTS, `xi-head-${REV}-compare.png`);
const res = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[out]', '-frames:v', '1', out], { encoding: 'utf8' });
if (res.status !== 0) throw new Error('ffmpeg 失败：' + res.stderr);
console.log('✓', out);
