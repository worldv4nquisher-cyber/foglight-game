"""汐：渲染图与概念图并排（art/models/characters/preview/char-xi-vs-concept.png）。
用法：python3 art/tools/compose-vs-concept.py（先跑 render-preview-web.mjs --char）"""
from PIL import Image, ImageDraw
from pathlib import Path
A = Path(__file__).resolve().parents[1]
P = A / 'models/characters/preview'
c = Image.open(A / 'style/concept-ch1-xi-character.png').convert('RGB')
H = 1000
c = c.resize((int(c.width * H / c.height), H))
shots = [Image.open(P / f'char-xi-{v}.png').convert('RGB') for v in ('lantern', 'back', 'face')]
shots = [s.resize((int(s.width * H / s.height), H)) for s in shots]
W = c.width + sum(s.width for s in shots) + 10 * len(shots)
out = Image.new('RGB', (W, H + 40), (24, 26, 30)); d = ImageDraw.Draw(out)
out.paste(c, (0, 40)); d.text((10, 12), 'concept', fill=(230, 230, 230))
x = c.width + 10
for s, n in zip(shots, ('model: lantern pose', 'model: back', 'model: face')):
    out.paste(s, (x, 40)); d.text((x + 10, 12), n, fill=(230, 230, 230)); x += s.width + 10
out.save(P / 'char-xi-vs-concept.png'); print('wrote', P / 'char-xi-vs-concept.png', out.size)
