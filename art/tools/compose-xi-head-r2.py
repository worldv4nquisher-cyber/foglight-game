#!/usr/bin/env python3
"""汐头部 r2 对比图拼版。输入：render-preview-web.mjs --page char-head.html 渲出的单图（默认 $XI_HEAD_DIR/（默认 ./bxi-head）/r），
输出：art/models/characters/preview/char-xi-head-r2-{front,three-quarter,side}-compare.png、char-xi-head-r2-gamecam.png、char-father-r6-xi-head-hoh-check.png
用法：python3 art/tools/compose-xi-head-r2.py [渲染目录] [notes.json]"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
R = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('XI_HEAD_DIR', 'bxi-head'), 'r')
NOTES = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
OUT = os.path.join(os.path.dirname(__file__), '../models/characters/preview')
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(s): return ImageFont.truetype(FONT, s, index=2)   # SC
BG, FG, SUB = (30, 33, 38), (232, 232, 232), (160, 168, 178)
def im(n, size=None):
    a = Image.open(os.path.join(R, n)).convert('RGB')
    return a.resize(size, Image.LANCZOS) if size else a
def label(d, xy, t, s=28, c=FG): d.text(xy, t, font=font(s), fill=c)

def view_cmp(v, name, title):
    W, H = 2260, 60 + 1100 + 60 + 560 + 70
    C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
    label(d, (20, 12), title, 32)
    C.paste(im(f'{v}-before.png'), (20, 60)); C.paste(im(f'{v}-after.png'), (1140, 60))
    label(d, (30, 66), '改前 r1（旧描边：#2A2F36 固定 2.2 px）', 26, (255, 210, 170))
    label(d, (1150, 66), '改后 r2（新描边：1.5 px@1080p × COLOR_0.a，颜色取 albedo×0.4）', 26, (170, 230, 190))
    y = 60 + 1100 + 14
    label(d, (20, y), 'LOD 对比（同机位）', 26, SUB); y += 44
    for k, (n, t) in enumerate([(f'{v}-before-lod1.png', '改前 LOD1（Decimate，左右不对称）'), (f'{v}-after-lod1.png', '改后 LOD1（参数网格重建，严格镜像）'), (f'{v}-after-lod2.png', '改后 LOD2')]):
        x = 20 + k * 580; C.paste(im(n, (560, 560)), (x, y)); label(d, (x + 8, y + 6), t, 22, FG)
    x = 20 + 3 * 580 + 10; yy = y
    for line in NOTES.get('lines', []):
        label(d, (x, yy), line, 22, SUB); yy += 34
    C.save(os.path.join(OUT, name)); print('wrote', name, C.size)

view_cmp('head-front', 'char-xi-head-r2-front-compare.png', '汐 · 头部 r2 · 正面（相机在中线 x=0，fov 18）')
view_cmp('head-34', 'char-xi-head-r2-three-quarter-compare.png', '汐 · 头部 r2 · 3/4（35°）')
view_cmp('head-side', 'char-xi-head-r2-side-compare.png', '汐 · 头部 r2 · 侧面（90°）')

# --- 游戏机位
W, H = 2420, 60 + 900 + 20 + 450 + 60
C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
label(d, (20, 12), '汐 · 头部 r2 · 游戏跟随机位（fov 55、dist 4.0、pivotHeight 1.35、shoulderOffset 0.4、pitch −0.3 rad，toon 材质，2560×1440 渲染）', 28)
C.paste(im('gc-180-after.png', (1600, 900)), (20, 60)); label(d, (30, 66), '默认：yaw 180（身后），xi-idle', 24)
C.paste(im('gc-0-after.png', (790, 444)), (20, 980)); label(d, (30, 986), 'yaw 0（转到正面）', 22)
C.paste(im('gc-35-after.png', (790, 444)), (830, 980)); label(d, (840, 986), 'yaw 35', 22)
label(d, (1640, 60), '头部放大：同一相机位置（遮挡关系不变）', 24, SUB)
label(d, (1640, 92), '只把镜头对准头、fov 5°', 24, SUB)
cells = [('z-0-xi-idle-0.5-before.png', '改前 yaw 0 idle'), ('z-0-xi-idle-0.5-after.png', '改后 yaw 0 idle'),
         ('z-30-xi-idle-3.0-after.png', '改后 yaw 30 idle t=3'), ('z-330-xi-walk-0.3-after.png', '改后 yaw 330 walk'),
         ('z-0-xi-walk-0.3-before.png', '改前 yaw 0 walk'), ('z-0-xi-walk-0.3-after.png', '改后 yaw 0 walk')]
for k, (n, t) in enumerate(cells):
    x = 1640 + (k % 2) * 390; y = 134 + (k // 2) * 410
    C.paste(im(n, (380, 380)), (x, y)); label(d, (x + 6, y + 384), t, 20, SUB)
C.save(os.path.join(OUT, 'char-xi-head-r2-gamecam.png')); print('wrote gamecam', C.size)

# --- 父亲摸头复查
fr = NOTES.get('hoh_frames', [56, 80, 100, 120, 136])
W, H = 20 + len(fr) * 470, 60 + 450 + 50 + 264 + 40 + 120
C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
label(d, (20, 12), '父亲摸头 × 汐 r2 头发 复查（father-hand-on-head，xi-stand-gaze，手在 #56–136）', 28)
for k, f in enumerate(fr):
    x = 20 + k * 470
    C.paste(im(f'hoh-side-{f}.png', (450, 450)), (x, 60)); label(d, (x + 6, 64), f'#{f} 侧面（正交）', 22)
    C.paste(im(f'hoh-game-{f}.png', (450, 254)), (x, 560)); label(d, (x + 6, 564), f'#{f} 身后 2 m', 20)
yy = 560 + 264 + 20
for line in NOTES.get('hoh', []):
    label(d, (20, yy), line, 22, SUB); yy += 32
C.save(os.path.join(OUT, 'char-father-r6-xi-head-hoh-check.png')); print('wrote hoh', C.size)
