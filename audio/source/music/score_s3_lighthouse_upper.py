"""mus-s3-lighthouse-upper（S3 紧张层）：与底层同速同长（从 score_s3_lighthouse 取 TEMPO / BARS / SECTIONS / TRANSPOSE），样本对齐。
程序按玩家高度 0 → 1 淡入；单独听只是一层「压力」，不是完整的曲子。
- 大提琴组颤弓（trem，pp 层）：每段一个三全音对，跟着底层和声每段挪半音（D–Ab → Eb–A → C–F# → E–Bb）。
- 高音 pad：小二度簇（A5/Bb5 一带），细、冷，像玻璃 / 灯室的啸声；10 个周期的慢起伏。
- 钢琴：高音区每拍一下的极轻钟摆式脉动（两个音交替），像透镜机构的嘀嗒 / 心跳，每小节第一下稍重。
不用主题动机。"""
from score_s3_lighthouse import TEMPO, BARS, TRANSPOSE, SECTIONS, B, SWELL, FLAT

CELLO_ARTIC = 'trem'
CELLO_REL = 3.0
CELLO = []
for i, (bar, _, _, _, _, tri, _) in enumerate(SECTIONS):
    for j, m in enumerate(tri):
        CELLO.append((bar, 1 + j * 0.5, m, .2, 21, 5.0, [(0, .6), (.5, 1.0), (1, .7)]))

PAD_BEATS = 20
PAD_ATT, PAD_REL, PAD_LEAD, PAD_BRIGHT = 6.0, 6.0, 3.0, 0.3
PAD = [(bar, hi) for bar, _, _, _, _, _, hi in SECTIONS]

PIANO_REL = 0.6
PIANO = []
for bar, _, _, _, _, tri, hi in SECTIONS:
    a, b = tri[1] + 12, tri[0] + 24   # 例：Ab4 / D5
    for k in range(5 * 4):
        bb = bar + k // 4; beat = 1 + k % 4
        PIANO.append((bb, beat, a if k % 2 == 0 else b, .12 if beat == 1 else .08, 1.5))

FILTERS = dict(piano=[('low', 6000)], cello=[('high', 80), ('low', 6000)], pad=[('low', 7000), ('high', 300)])
BUS_LFO = dict(cello=(10, 2.5, 0.0), pad=(10, 3.0, 2.0))
MIX = dict(piano=-33.0, cello=-30.0, pad=-36.0)
SENDS = dict(piano=0.45, cello=0.4, pad=0.55)
PIANO_NOTE_NORM = True
STRING_FLATTEN = 0.5
