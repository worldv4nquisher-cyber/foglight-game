#!/usr/bin/env python3
# BUG-028 前后对比：shots-bug028/bug028-<机位>-{before,after}.png → bug028-<机位>-1x2.png（标签带相机离头距离）
# 用法：python3 scripts/compose-bug028.py [目录]（默认 ../docs/tasks/shots-bug028）
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', '..', 'docs', 'tasks', 'shots-bug028')
info = {}
for v in ['before', 'after']:
    p = os.path.join(d, f'shots-bug028-{v}.json')
    if os.path.exists(p):
        for s in json.load(open(p)).get('shots', []):
            info[s['name']] = s
font = None
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc']:
    if os.path.exists(f):
        font = ImageFont.truetype(f, 30)
        break
font = font or ImageFont.load_default()
NAMES = {'east': '朝东', 'spin-66': '原地转到 −66°', 'north-rock': '朝北看礁石'}
for view, vn in NAMES.items():
    cells = []
    for v, vl in [('before', '修前'), ('after', '修后')]:
        f = os.path.join(d, f'bug028-{view}-{v}.png')
        if not os.path.exists(f):
            print('缺', f)
            cells = None
            break
        s = info.get(f'bug028-{view}-{v}', {})
        lab = f'{vn} · {vl} · 相机离头 {s.get("camHead", "?")} m'
        if s.get('xiAlpha') is not None and s['xiAlpha'] < 1:
            lab += f' · 汐不透明度 {s["xiAlpha"]:.2f}'
        cells.append((Image.open(f).convert('RGB'), lab))
    if not cells:
        continue
    w, h = cells[0][0].size
    tw, bar = 960, 52
    th = h * tw // w
    canvas = Image.new('RGB', (tw * 2 + 12, th + bar), (16, 18, 22))
    dr = ImageDraw.Draw(canvas)
    for i, (im, lab) in enumerate(cells):
        x = i * (tw + 12)
        canvas.paste(im.resize((tw, th), Image.LANCZOS), (x, bar))
        dr.text((x + 12, 8), lab, fill=(235, 235, 235), font=font)
    out = os.path.join(d, f'bug028-{view}-1x2.png')
    canvas.save(out)
    print('→', out)
