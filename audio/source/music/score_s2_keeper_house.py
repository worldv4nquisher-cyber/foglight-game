"""mus-s2-keeper-house（S2 守塔人小屋）：家、回忆。与菜单同调同速：D 小调（爱奥利亚），54 bpm 4/4，
34 小节 = 151.11 s 整文件无缝循环（环形时间轴）。
- 钢琴为主（屋内、近、比 S1 干）：每 2 小节一个和弦，左手低音 + 五度，右手稀疏的分解和弦音（种子固定的轻微变化）。
- 主题「灯语」只出现前 3 音 A–D–F，整圈两次（第 5 小节 A3 D4 F4、第 21 小节高八度 A4 D5 F5），都停在 F 上，不接 E、不解决——完整动机留给结尾曲。
- 大提琴组整圈 4 次应答（叹息式下行），pad 很轻；不用低音提琴，也不用菜单的 A5「灯光」音。
- 最后两小节 Asus4 → A（属）接回第 1 小节 Dm，循环成立。没有高潮（PIANO_NOTE_NORM）。"""
import numpy as np
TEMPO = 54
BARS = 34
TRANSPOSE = 0

def B(bar, beat=1.0):
    return (bar - 1) * 4 + (beat - 1)

PAD_BEATS = 8
PAD_ATT, PAD_REL, PAD_LEAD, PAD_BRIGHT = 3.0, 3.5, 1.2, 0.45
PAD = [
    (1, [50, 57, 64, 65]),    # Dm(add9)
    (3, [46, 53, 57, 62]),    # Bbmaj7
    (5, [43, 50, 58, 65]),    # Gm7        ← 动机碎片 A3 D4 F4
    (7, [45, 52, 57, 62]),    # Asus4
    (9, [50, 57, 62, 65]),    # Dm
    (11, [48, 53, 57, 60]),   # F/C
    (13, [46, 53, 57, 62]),   # Bbmaj7
    (15, [43, 50, 57, 58]),   # Gm(add9)
    (17, [50, 57, 64, 65]),   # Dm(add9)
    (19, [46, 53, 57, 62]),   # Bbmaj7
    (21, [43, 50, 58, 65]),   # Gm7        ← 动机碎片高八度 A4 D5 F5
    (23, [48, 55, 62, 64]),   # C(add9)
    (25, [41, 48, 57, 64]),   # Fmaj7
    (27, [46, 53, 57, 62]),   # Bbmaj7
    (29, [43, 50, 55, 58]),   # Gm
    (31, [45, 52, 57, 62]),   # Asus4
    (33, [45, 52, 57, 61]),   # A（属）→ 回 Dm
]

SWELL = [(0, .55), (.45, 1.0), (1, .7)]
FADE = [(0, .8), (.3, 1.0), (1, .45)]
CELLO_REL = 2.0
CELLO = [  # (小节, 拍, midi, 力度, 时值拍, 起音 s, 形状)
    (7, 1, 52, .30, 5, 1.5, SWELL), (8, 2, 50, .26, 3, .8, FADE),        # E3 → D3（在 Asus4 上叹一口气）
    (13, 1, 53, .30, 5, 1.5, SWELL), (14, 2, 52, .26, 3, .8, FADE),      # F3 → E3
    (25, 1, 48, .28, 6, 1.8, SWELL), (26, 3, 45, .24, 2, .6, FADE),      # C3 → A2
    (31, 1, 50, .26, 6, 2.0, SWELL), (32, 3, 49, .22, 6, 1.0, FADE),     # D3 → C#3（属，带回开头）
]

MOTIF_BARS = {5: [57, 62, 65], 21: [69, 74, 77]}   # 只用前三音，停在 F

def _piano():
    rng = np.random.default_rng(2033)
    out = []
    for i, (bar, ch) in enumerate(PAD):
        root = ch[0] - 12 if ch[0] >= 43 else ch[0]
        lv = .20 + .03 * rng.random()
        out += [(bar, 1, root, lv, 8), (bar, 1.06, root + 7, lv - .03, 8)]
        if bar in MOTIF_BARS:
            a, d, f = MOTIF_BARS[bar]
            out += [(bar, 2, a, .26, 6), (bar, 3, d, .28, 4), (bar, 4.5, f, .29, 6)]   # 停在 F（不接 E）
            continue
        tones = sorted({n + 12 * k for n in ch[1:] for k in (0, 1) if 60 <= n + 12 * k <= 76})
        slots = [(bar, 2), (bar, 3.5), (bar + 1, 1.5), (bar + 1, 3)]
        keep = rng.random(4) < np.array([.85, .55, .7, .45])
        if i % 4 == 3: keep[2:] = False   # 每四个和弦留一次空（留白）
        prev = None
        for (b_, bt), k in zip(slots, keep):
            if not k: continue
            n = int(rng.choice([t for t in tones if t != prev])); prev = n
            out.append((b_, bt + rng.normal(0, .02), n, .15 + .07 * rng.random(), 5))
    return out

PIANO = _piano()
PIANO_REL = 0.7
FILTERS = dict(piano=[('low', 6000)], cello=[('high', 45), ('low', 5500)], pad=[('low', 1800)])
BUS_LFO = dict(pad=(4, 1.5, 0.0))
MIX = dict(piano=-25.0, cello=-28.0, pad=-38.0)
SENDS = dict(piano=0.30, cello=0.35, pad=0.50)
STRING_FLATTEN = 0.5
PIANO_NOTE_NORM = True
