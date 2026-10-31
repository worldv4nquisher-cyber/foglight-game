#!/usr/bin/env python3
# 037 反射强度对比：shots-025/strength/s1-<机位>-strength-{k0,k05,k1,kdef}.png → s1-<机位>-strength-1x4.png（每格带标签）
# 用法：python3 scripts/compose-025-strength.py [目录]（默认 ../docs/tasks/shots-025/strength）
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

here = os.path.dirname(os.path.abspath(__file__))
d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(here, '..', '..', 'docs', 'tasks', 'shots-025', 'strength')
rep = {}
p = os.path.join(d, 'shots-025-strength.json')
if os.path.exists(p):
    rep = json.load(open(p))
dflt = rep.get('defaultStrength', '?')
font = None
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc']:
    if os.path.exists(f):
        font = ImageFont.truetype(f, 30)
        break
font = font or ImageFont.load_default()
CELLS = [('k0', '强度 0（= 关）'), ('k05', '强度 0.5'), ('k1', '强度 1'), ('kdef', f'当前默认（{dflt}）')]
out = []
for view in ['pier', 'pier-low', 'opening']:
    ims = []
    for k, label in CELLS:
        f = os.path.join(d, f's1-{view}-strength-{k}.png')
        if not os.path.exists(f):
            print('缺', f)
            ims = None
            break
        ims.append((Image.open(f).convert('RGB'), label))
    if not ims:
        continue
    w, h = ims[0][0].size
    tw = 800  # 每格缩到 800 宽（1600×900 → 800×450），四格 3200 宽
    th = h * tw // w
    bar = 52
    canvas = Image.new('RGB', (tw * 4 + 12 * 3, th + bar), (16, 18, 22))
    dr = ImageDraw.Draw(canvas)
    for i, (im, label) in enumerate(ims):
        x = i * (tw + 12)
        canvas.paste(im.resize((tw, th), Image.LANCZOS), (x, bar))
        dr.text((x + 14, 8), f's1-{view} · {label}', fill=(230, 230, 230), font=font)
    o = os.path.join(d, f's1-{view}-strength-1x4.png')
    canvas.save(o, optimize=True)
    out.append(o)
    print('→', o)
print(len(out), '张')
