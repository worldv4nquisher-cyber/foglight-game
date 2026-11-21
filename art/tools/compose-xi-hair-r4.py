#!/usr/bin/env python3
"""汐头发 r4 对比图拼版：概念图 A 裁切 / r3 / r4 三栏 + r4 LOD1/LOD2；游戏机位；父亲摸头复查。
输入：render-preview-web.mjs --page char-head.html 渲出的单图（默认 $XI_HEAD_DIR/（默认 ./bxi-head）/r4f），概念图裁切 $XI_HEAD_DIR/（默认 ./bxi-head）/r4/ca-*.png
输出：art/models/characters/preview/char-xi-hair-r4-{front,three-quarter,side,back}-compare.png、char-xi-hair-r4-gamecam.png、char-father-r8-xi-hair-hoh-check.png
用法：python3 art/tools/compose-xi-hair-r4.py [渲染目录] [notes.json]"""
import sys, os, json
from PIL import Image, ImageDraw, ImageFont
R = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.environ.get('XI_HEAD_DIR', 'bxi-head'), 'r4f')
NOTES = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else {}
CA = os.path.join(os.environ.get('XI_HEAD_DIR', 'bxi-head'), 'r4')
OUT = os.path.join(os.path.dirname(__file__), '../models/characters/preview')
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
def font(s): return ImageFont.truetype(FONT, s, index=2)
BG, FG, SUB = (30, 33, 38), (232, 232, 232), (160, 168, 178)
COL = [(255, 210, 170), (200, 210, 255), (170, 230, 190)]
def im(n, size=None, root=None):
    a = Image.open(os.path.join(root or R, n)).convert('RGB')
    return a.resize(size, Image.LANCZOS) if size else a
def fit(a, S):
    w, h = a.size; k = S / max(w, h); a = a.resize((int(w * k), int(h * k)), Image.LANCZOS)
    c = Image.new('RGB', (S, S), BG); c.paste(a, ((S - a.size[0]) // 2, (S - a.size[1]) // 2)); return c
def label(d, xy, t, s=28, c=FG): d.text(xy, t, font=font(s), fill=c)
HEAD = ['概念图 A（用户选定）', 'r3（顶 0.85 cm，像秃头）', 'r4（整头重做）']

def view_cmp(v, ca, name, title):
    S = 1000; W = 20 + 3 * (S + 20); H = 60 + S + 24 + 44 + 480 + 40
    C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
    label(d, (20, 12), title, 32)
    x = 20
    if ca: C.paste(fit(im(f'ca-{ca}.png', root=CA), S), (x, 60))
    else: label(d, (x + 300, 60 + S // 2 - 20), '（概念图 A 没有背面）', 30, SUB)
    label(d, (x + 10, 66), HEAD[0], 28, COL[0])
    for k, r in enumerate(['r3', 'r4']):
        x = 20 + (k + 1) * (S + 20); C.paste(im(f'{v}-{r}.png', (S, S)), (x, 60)); label(d, (x + 10, 66), HEAD[k + 1], 28, COL[k + 1])
    y = 60 + S + 24; label(d, (20, y), 'r4 LOD（同机位）', 26, SUB); y += 44
    for k, (n, t) in enumerate([(f'{v}-r4-lod1.png', 'r4 LOD1'), (f'{v}-r4-lod2.png', 'r4 LOD2')]):
        x = 20 + k * 500; C.paste(im(n, (480, 480)), (x, y)); label(d, (x + 8, y + 6), t, 22)
    yy = y
    for line in NOTES.get(v, NOTES.get('lines', [])):
        label(d, (1040, yy), line, 24, SUB); yy += 38
    C.save(os.path.join(OUT, name)); print('wrote', name, C.size)

view_cmp('head-front', 'front', 'char-xi-hair-r4-front-compare.png', '汐 · 头发 r4 · 正面（相机在中线 x=0，fov 18）')
view_cmp('head-34', '34', 'char-xi-hair-r4-three-quarter-compare.png', '汐 · 头发 r4 · 3/4（35°）')
view_cmp('head-side', 'side', 'char-xi-hair-r4-side-compare.png', '汐 · 头发 r4 · 侧面（90°）')
view_cmp('head-back', None, 'char-xi-hair-r4-back-compare.png', '汐 · 头发 r4 · 背面（180°）')

# --- 游戏机位
W, H = 2420, 60 + 900 + 20 + 450 + 60
C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
label(d, (20, 12), '汐 · 头发 r4 · 游戏跟随机位（fov 55、dist 4.0、pivotHeight 1.35、shoulderOffset 0.4、pitch −0.3 rad，toon 材质，2560×1440 渲染）', 28)
C.paste(im('gc-180-r4.png', (1600, 900)), (20, 60)); label(d, (30, 66), '默认：yaw 180（身后），xi-idle', 24)
C.paste(im('gc-0-r4.png', (790, 444)), (20, 980)); label(d, (30, 986), 'yaw 0（转到正面）', 22)
C.paste(im('gc-35-r4.png', (790, 444)), (830, 980)); label(d, (840, 986), 'yaw 35', 22)
label(d, (1640, 60), '头部放大：同一相机位置，镜头对准头、fov 5°', 24, SUB)
cells = [('z-330-xi-walk-0.3-r3.png', 'r3 yaw 330 walk'), ('z-330-xi-walk-0.3-r4.png', 'r4 yaw 330 walk'),
         ('z-0-xi-idle-0.5-r4.png', 'r4 yaw 0 idle'), ('z-35-xi-idle-0.5-r4.png', 'r4 yaw 35 idle'),
         ('z-180-xi-walk-0.3-r4.png', 'r4 yaw 180 walk'), ('z-0-xi-walk-0.3-r4.png', 'r4 yaw 0 walk')]
for k, (n, t) in enumerate(cells):
    x = 1640 + (k % 2) * 390; y = 100 + (k // 2) * 420
    C.paste(im(n, (380, 380)), (x, y)); label(d, (x + 6, y + 384), t, 20, SUB)
yy = 1440
C.save(os.path.join(OUT, 'char-xi-hair-r4-gamecam.png')); print('wrote gamecam', C.size)

# --- 父亲摸头复查
fr = NOTES.get('hoh_frames', [56, 80, 100, 120, 136])
W, H = 20 + len(fr) * 470, 60 + 450 + 50 + 264 + 40 + 160
C = Image.new('RGB', (W, H), BG); d = ImageDraw.Draw(C)
label(d, (20, 12), '父亲摸头 × 汐 r4 头发 复查（father-hand-on-head，xi-stand-gaze，手在 #56–136）', 28)
for k, f in enumerate(fr):
    x = 20 + k * 470
    C.paste(im(f'hoh-side-{f}.png', (450, 450)), (x, 60)); label(d, (x + 6, 64), f'#{f} 侧面（正交）', 22)
    C.paste(im(f'hoh-game-{f}.png', (450, 254)), (x, 560)); label(d, (x + 6, 564), f'#{f} 身后 2 m', 20)
yy = 560 + 264 + 20
for line in NOTES.get('hoh', []):
    label(d, (20, yy), line, 22, SUB); yy += 32
C.save(os.path.join(OUT, 'char-father-r8-xi-hair-hoh-check.png')); print('wrote hoh', C.size)
