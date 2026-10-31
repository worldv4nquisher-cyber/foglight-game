#!/usr/bin/env python3
# BUG-030 前后对比：shots-bug030/raw/{before,after}/<名>.png → shots-bug030/bug030-<名>-1x2.png（左修前 ?rampfix=0、右修后），
# 每对记平均亮度（Rec.709 luma，0–255，整张 / 汐所在的中心区域）和差值 → shots-bug030/bug030-brightness.json。
# 另把修前袖口侧面和 shots-031/s1-xi-cuff-side.png（旧图，修前代码拍）比平均绝对差，确认「修前」复现的是同一个坏画面。
# 用法：python3 scripts/compose-bug030.py
import json, os
from PIL import Image, ImageDraw, ImageFont, ImageStat, ImageChops

here = os.path.dirname(os.path.abspath(__file__))
D = os.path.join(here, '..', '..', 'docs', 'tasks', 'shots-bug030')
OLD = os.path.join(here, '..', '..', 'docs', 'tasks', 'shots-031', 's1-xi-cuff-side.png')
font = None
for f in ['/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc']:
    if os.path.exists(f):
        font = ImageFont.truetype(f, 28)
        break
font = font or ImageFont.load_default()
PAIRS = [('s1-xi-body-front', 'S1 汐全身正面'), ('s1-xi-body-side', 'S1 汐全身侧面'), ('s1-xi-cuff-side-031cam', 'S1 袖口特写（侧，旧图机位）'), ('s3-ending-05-journal-write', 'S3 结尾镜头 05')]


def luma(im, box=None):
    g = (im.crop(box) if box else im).convert('L')  # PIL L = 0.299R + 0.587G + 0.114B
    return ImageStat.Stat(g).mean[0]


def center(im):
    w, h = im.size
    return (w * 3 // 10, h // 10, w * 7 // 10, h * 9 // 10)


res = {}
for name, label in PAIRS:
    fb, fa = (os.path.join(D, 'raw', v, name + '.png') for v in ('before', 'after'))
    if not (os.path.exists(fb) and os.path.exists(fa)):
        print('缺', name)
        continue
    b, a = Image.open(fb).convert('RGB'), Image.open(fa).convert('RGB')
    lb, la, cb, ca = luma(b), luma(a), luma(b, center(b)), luma(a, center(a))
    diff = ImageStat.Stat(ImageChops.difference(b, a).convert('L')).mean[0]
    res[name] = {'label': label, 'before': round(lb, 2), 'after': round(la, 2), 'delta': round(la - lb, 2),
                 'centerBefore': round(cb, 2), 'centerAfter': round(ca, 2), 'centerDelta': round(ca - cb, 2), 'meanAbsDiff': round(diff, 2)}
    w, h = b.size
    tw, bar = 960, 52
    th = h * tw // w
    canvas = Image.new('RGB', (tw * 2 + 12, th + bar), (16, 18, 22))
    dr = ImageDraw.Draw(canvas)
    for i, (im, lab) in enumerate([(b, f'{label} · 修前（?rampfix=0）· 亮度 {lb:.1f}'), (a, f'{label} · 修后 · 亮度 {la:.1f}（{la - lb:+.1f}）')]):
        x = i * (tw + 12)
        canvas.paste(im.resize((tw, th), Image.LANCZOS), (x, bar))
        dr.text((x + 12, 8), lab, fill=(235, 235, 235), font=font)
    out = os.path.join(D, f'bug030-{name}-1x2.png')
    canvas.save(out)
    print('→', out, json.dumps(res[name], ensure_ascii=False))

fb = os.path.join(D, 'raw', 'before', 's1-xi-cuff-side-031cam.png')
if os.path.exists(fb) and os.path.exists(OLD):
    b, o = Image.open(fb).convert('RGB'), Image.open(OLD).convert('RGB')
    if b.size == o.size:
        fa = os.path.join(D, 'raw', 'after', 's1-xi-cuff-side-031cam.png')
        a = Image.open(fa).convert('RGB') if os.path.exists(fa) else None
        m = lambda x, y: round(ImageStat.Stat(ImageChops.difference(x, y).convert('L')).mean[0], 2)
        res['oldShotCheck'] = {'old': os.path.relpath(OLD, D), 'oldLuma': round(luma(o), 2), 'beforeLuma': round(luma(b), 2),
                               'meanAbsDiff_before_vs_old': m(b, o), 'meanAbsDiff_after_vs_old': m(a, o) if a else None,
                               'centerLuma_old': round(luma(o, center(o)), 2), 'centerLuma_before': round(luma(b, center(b)), 2)}
        print('旧图核对', json.dumps(res['oldShotCheck'], ensure_ascii=False))
json.dump(res, open(os.path.join(D, 'bug030-brightness.json'), 'w'), ensure_ascii=False, indent=2)
