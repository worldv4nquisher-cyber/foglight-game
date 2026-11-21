"""mus-s3-lighthouse（S3 灯塔内部，底层）：单独播放要成立；与 mus-s3-lighthouse-upper 等长、样本对齐，程序按玩家高度淡入上层。
D 调中心，偏弗里几亚（bII = Eb 的暗色），40 bpm 4/4，25 小节 = 150.0 s 整文件无缝循环（1 拍 = 1.5 s）。
5 段 × 5 小节（30 s）的和声（底层与上层共用 SECTIONS）：
  A Dm（D–A–F）→ B Eb/D（弗里几亚，压抑）→ C Cm/C → D Bb → E A(b9)，绕回 D。
- 低音提琴：每段一个长音 D2 / D2 / C2 / Bb1 / A1（石塔里沉的底）。
- 大提琴组（susvib）：每段一个低长音 A2 / Bb2 / G2 / F2 / Bb2，渐强渐弱。
- pad：暗（低通 1.2 kHz），慢起伏。
- 钢琴：像远处的钟——每段开头一记低八度（pp），段中一个中音区单音；间隔 15–20 s。
不用主题动机（MOTIF 参数默认关闭，见文末）。"""
TEMPO = 40
BARS = 25
TRANSPOSE = 0

def B(bar, beat=1.0):
    return (bar - 1) * 4 + (beat - 1)

# (起始小节, 名, 低音, 底层 pad, 底层大提琴, 上层颤弓三全音对, 上层高音小二度对)
SECTIONS = [
    (1, 'Dm', 38, [38, 45, 53], 45, [50, 56], [80, 81]),
    (6, 'Eb/D', 38, [39, 46, 55], 46, [51, 57], [81, 82]),
    (11, 'Cm', 36, [36, 43, 51], 43, [48, 54], [78, 79]),
    (16, 'Bb', 34, [34, 41, 50, 53], 41, [52, 58], [82, 83]),
    (21, 'A(b9)', 33, [33, 40, 46, 52], 46, [52, 58], [81, 82]),
]

SWELL = [(0, .5), (.5, 1.0), (1, .6)]
FADE = [(0, .9), (.35, 1.0), (1, .5)]
FLAT = [(0, 1.0), (1, 1.0)]

PAD_BEATS = 20
PAD_ATT, PAD_REL, PAD_LEAD, PAD_BRIGHT = 7.0, 7.0, 3.5, 0.35
PAD = [(bar, pad) for bar, _, _, pad, _, _, _ in SECTIONS]

BASS_REL = 4.0
BASS = [(bar, 1, bass, .30, 21, 4.0, FLAT) for bar, _, bass, _, _, _, _ in SECTIONS]

CELLO_REL = 3.0
CELLO = [(bar, 3, vc, .24, 16, 4.5, SWELL) for bar, _, _, _, vc, _, _ in SECTIONS]

# 钢琴：(小节, 拍, midi, 力度, 时值拍)
PIANO_REL = 1.2
PIANO = [
    (1, 1.02, 26, .12, 10), (1, 1.0, 38, .10, 10),     # D1 + D2 远钟
    (3, 3, 65, .12, 8),                                # F4
    (6, 1.02, 26, .12, 10), (6, 1.0, 38, .10, 10),
    (8, 2, 63, .11, 8),                                # Eb4（弗里几亚的那个音）
    (11, 1.02, 24, .12, 10), (11, 1.0, 36, .10, 10),  # C1 + C2
    (13, 3, 67, .11, 8),                               # G4
    (16, 1.02, 22, .12, 10), (16, 1.0, 34, .10, 10),  # Bb0 + Bb1
    (18, 2, 62, .11, 8),                               # D4
    (21, 1.02, 21, .12, 10), (21, 1.0, 33, .10, 10),  # A0 + A1
    (23, 3, 58, .12, 8), (23, 3.04, 64, .10, 8),       # Bb3 + E4（b9 上的三全音）
]

FILTERS = dict(piano=[('low', 4000)], bass=[('high', 28), ('low', 2500)], cello=[('high', 45), ('low', 4500)], pad=[('low', 1200)])
BUS_LFO = dict(pad=(5, 2.0, 0.0), bass=(5, 1.0, 1.0))
MIX = dict(piano=-33.0, cello=-29.0, bass=-27.0, pad=-31.0)
SENDS = dict(piano=0.5, cello=0.42, bass=0.2, pad=0.5)
PIANO_NOTE_NORM = True
STRING_FLATTEN = 0.7

# 主题动机：默认不用。若定下要用，把 MOTIF 设成 midi 列表（如 [57, 62, 65, 64]），会在第 MOTIF_BAR 小节由钢琴极轻地给出前两个音。
MOTIF = None
MOTIF_BAR = 13
if MOTIF:
    PIANO += [(MOTIF_BAR, 1 + i * 1.5, m + 12, .1, 6) for i, m in enumerate(MOTIF[:2])]
