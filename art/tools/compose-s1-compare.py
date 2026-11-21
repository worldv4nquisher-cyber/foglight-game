#!/usr/bin/env python3
"""Concept on the left, assembled preview on the right, with a label bar (2568x720). Usage: compose-s1-compare.py hightide|lowtide"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
A = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mode = sys.argv[1]
src = {'hightide': ('s1-opening-hightide.png', '组装预览 · 涨潮 1.6（开场）'), 'lowtide': ('s1-opening-lowtide.png', '组装预览 · 退潮 0.0')}[mode]
W, H, BAR, GAP = 1280, 720 - 40, 40, 8
def fit(p):
    im = Image.open(p).convert('RGB'); s = max(W / im.width, H / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - W) // 2, (im.height - H) // 2
    return im.crop((l, t, l + W, t + H))
out = Image.new('RGB', (W * 2 + GAP, 720), (24, 26, 30))
out.paste(fit(f'{A}/style/concept-ch1-opening-wide.png'), (0, BAR))
out.paste(fit(f'{A}/models/env/preview/{src[0]}'), (W + GAP, BAR))
d = ImageDraw.Draw(out)
fp = next((f for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'] if os.path.exists(f)), None)
font = ImageFont.truetype(fp, 22) if fp else ImageFont.load_default()
d.text((14, 8), '概念图 concept-ch1-opening-wide', fill=(230, 230, 230), font=font)
d.text((W + GAP + 14, 8), src[1], fill=(230, 230, 230), font=font)
dst = f'{A}/models/env/preview/s1-compare-concept-{mode}.png'
out.save(dst); print(dst, out.size)
