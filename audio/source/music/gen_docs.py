"""由 renders/*.render.json + *.report.json 生成 033 配乐文档（python3 audio/source/music/gen_docs.py）：
- art/audio/music/README.md：曲目表（解码后实测）+ 接入要点 + 复现方法
- docs/audio-credits.md：用到的每个 CC0 采样文件逐条（来源链接 @ 固定提交 + 授权 + 用于哪首）
- audio/CREDITS.md：夹在 <!-- 033-music:begin/end --> 之间的配乐摘要行（032 的 gen_readme.py 会保留这一段）"""
import os, json, glob, urllib.parse
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.abspath(os.path.join(HERE, '../../..'))
import sys; sys.path.insert(0, HERE); import musiclib as M

TRACKS = {  # 顺序 = 表格顺序；desc / use 手写，数字全部来自 report.json
    'mus-menu': dict(
        status='交付（定稿：用户 2026-10-31 听样张 mus-menu-preview-v1 后确认「可以」；乐谱与样张完全相同，渲染混音逐样本一致）',
        use='主菜单（属主菜单包，≤ 3 MB）：进入主菜单 `playMusic`（整文件 loop）；进入 S1 时 2 s 交叉淡化到场景曲',
        desc='D 小调（爱奥利亚）54 bpm 4/4，24 小节 = 106.67 s。钢琴开头给出主题动机「灯语」A3–D4–F4–E4 一次（停在 E4，不解决），中段高八度回声 A4–D5–F5…E5 晚到半拍，结尾缩成 A3–D4 两音；高音 A5「灯光」点反复出现；大提琴组持续低音 + 中段叹息式长线；pad 铺底。完整并解决到 D 的主题留给结尾曲。样张 `preview/mus-menu-preview-v1.ogg` 保留作对照，不进 manifest。',
        score='score_menu.py'),
    'mus-s1-ebb-shore': dict(
        status='交付',
        use='S1 退潮岸：进入场景 `playMusic`（整文件 loop）；036：比环境音低 12 dB，场景间 2 s 交叉淡化',
        desc='极稀、不出现主题动机。独奏低音提琴（无揉弦）长音做潮底 D2 → Bb1 → D2 → C2 → A1，pad 用开放五度 / 九度暗色和弦，每 25 s 换一次，整体按 25 s 周期 ±2.5 dB 慢起伏（退潮呼吸）；大提琴组整圈只出现 3 次长音；钢琴单音或空五度，间隔 10–20 s，pp、低通、湿混响（雾中远处）。避开 A–D–F–E 动机音程和菜单的 A5 灯光音。全曲短时响度最大值只比中位数高约 6 LU，没有高潮。',
        score='score_s1_ebb_shore.py'),
    'mus-s2-keeper-house': dict(
        status='交付',
        use='S2 守塔人小屋：进入场景 `playMusic`（整文件 loop）；036：比环境音低 12 dB，场景间 2 s 交叉淡化',
        desc='与菜单同调同速：D 小调 54 bpm，34 小节 = 151.1 s。钢琴为主（屋内、近、比 S1 干），每 2 小节一个和弦 Dm – Bbmaj7 – Gm7 – Asus4 – Dm – F/C – Bbmaj7 – Gm – … – Asus4 – A，左手低音 + 五度、右手稀疏分解和弦音；「灯语」只出现前 3 音 A–D–F，整圈两次（第 5 小节 A3 D4 F4、第 21 小节高八度），都停在 F，不接 E、不解决；大提琴组 4 次叹息式应答，pad 很轻；不用低音提琴和 A5 灯光音。短时响度最大值只比中位数高约 5 LU，没有高潮。',
        score='score_s2_keeper_house.py'),
    'mus-s3-lighthouse': dict(
        status='交付（底层）',
        use='S3 灯塔内部：进入场景 `playMusic`（整文件 loop），单独播放即成立；和上层同时、同一时刻起播（见下「S3 分层」）',
        desc='40 bpm，25 小节（每段 5 小节 × 5 段，一圈 150 s）。不用主题动机（动机做成 `MOTIF` 参数，默认 None）。低音提琴长音 D2 → D2 → C2 → Bb1 → A1 下行，pad 暗色和弦 Dm → Eb/D → Cm → Bb → A(b9)（每 30 s 一换，最后一段属和弦回到 Dm 首段，循环成立），大提琴组揉弦长音每段一次；钢琴在段首敲一记低八度「塔钟」，段中一个中音区单音。pad / 低音按 5 圈/循环 ±1–2 dB 缓慢起伏。整体偏暗（2 kHz 以上能量约 −35 dB），石塔内部的闷。短时响度最大值只比中位数高约 3.6 LU。',
        score='score_s3_lighthouse.py'),
    'mus-s3-lighthouse-upper': dict(
        status='交付（紧张层）',
        use='S3 紧张层：与底层**同时起播、样本对齐**（同一 AudioContext 时刻 start，同为 loop），初始增益 0；036 按玩家高度把增益 0 → 1 线性淡入。不要单独起播或中途 seek',
        desc='与底层同拍同长（150 s，6,615,000 样本），和声跟着底层每段的和弦走，但叠出不协和：大提琴组震音（trem）奏每段和弦根音上的三全音对，高音区 pad 是小二度对（G#5/A5 一类，带 300 Hz 高通），钢琴每拍一下高音脉冲（交替三全音的两个音，pp，第一拍稍重），像钟表 / 灯机的机械滴答。大提琴与 pad 按 10 圈/循环 ±2.5–3 dB 起伏。不用主题动机。能量集中在 120 Hz–2 kHz，低频很少，叠加后不会把低音糊住。',
        score='score_s3_lighthouse_upper.py'),
    'mus-ending-ch1': dict(
        status='交付（不循环）',
        use='第一章结尾演出：035 在 `lighthouse:ignited`（拉杆到底那一帧）起播，**单次、loop = false**，文件 0 s = 点燃；不要和场景曲叠，场景曲在点燃时淡出。卡点见下「结尾曲卡点」',
        desc='**不循环**（线性时间轴、线性混响，开头从静音起、结尾余弦淡出到静音）。与菜单同调同速同配器：D 小调 54 bpm，钢琴 + 大提琴组 + pad。0:00 点燃进入；0:14 雾散开时「灯语」**完整出现一次** A3 → D4 → F4 → E4（E 压在属和弦 A 上）→ 0:21.8 **解决到 D4**——全章唯一的音乐高点（pad 打开、大提琴组八度 D3+D4 长线 D → C → Bb 下行）；之后回落；0:50「那边没有亮。」只剩大提琴组一个孤独长音 A3；1:06 写日志时只回声前两音 A–D；1:28 落到 D 小三和弦（无九音），最后一个旋律音钢琴 D4（1:29.1），1:35 起淡出，1:46 静音。音符时间全由 `CUES` 参数算出，035 时间点变了改 CUES 重渲染即可。',
        score='score_ending_ch1.py'),
}

def rel(p): return os.path.relpath(p, ROOT)

rep = {k: json.load(open(os.path.join(HERE, 'renders', k + '.report.json'))) for k in TRACKS}
ren = {k: json.load(open(os.path.join(HERE, 'renders', k + '.render.json'))) for k in TRACKS}
tot = sum(r['bytes'] for k, r in rep.items() if 'preview' not in k)

def mmss(s): return f'{int(s // 60)}:{s % 60:04.1f}'

rows = []
for k, t in TRACKS.items():
    r = rep[k]; st = r.get('shortTermLufs', {})
    rows.append(f"| `{r['path']}` | {t['status']} | {mmss(r['seconds'])}（{r['samples']} 样本） | {r['bytes'] / 1e6:.2f} MB | {r['kbps']} | {r['lufs']} | {r['lra']} | {r['truePeakDb']} | "
                + (f"{st['p50']} / {st['max']}" if st else '—') + (f" | 不循环（单次）<br>首样本 {r['headTail']['firstSampleAbs']}，末 1 s {r['headTail']['last1sDb']} dBFS ✓" if r.get('oneshot') else f" | 0–{r['samples']}（整文件）<br>接缝 {r['seamDec'][0]} dBFS（近邻 {r['seamDec'][1]}，源 {r['seamSrc'][0]}）✓") + f" | {t['use']} |")

readme = f"""# art/audio/music — v0.1-033 配乐

需求单：docs/tasks/v0.1-033-music.md；GDD §13（极简、留白；钢琴 + 大提琴 + 氛围 pad；点灯是唯一音乐高点）。
本 README 由 `audio/source/music/gen_docs.py` 从 `audio/source/music/renders/*.json` 生成，数字均为**解码后的 ogg 实测**。

- **格式**：Ogg Vorbis 立体声 44.1 kHz，128–160 kbps（Vorbis 是 VBR，`master.py` 自动挑能落进这个区间的最低质量档）。正式曲目合计 {tot / 1e6:.2f} MB（上限 20 MB；样张不计）。
- **路径**：`art/audio/music/<名字>.ogg`，manifest URL `assets/art/audio/music/<名字>.ogg`；样张放在 `art/audio/music/preview/`，不进 manifest。
- **响度**：音乐统一 −20 LUFS（integrated），真峰值 ≤ −1 dBTP。稀疏曲峰值因数高，`master.py` 用了环形前视限幅，最大压缩见 report.json（菜单 0.32 dB、S1 0.24 dB，S2、S3 两层、结尾曲为 0）。036 混音时再压到比环境音低 12 dB。
- **循环**：除结尾曲（不循环，见下）外，曲子都在**环形时间轴**上构造（音符尾音、混响用 L 点循环卷积、滤波、潮汐起伏都按整圈取模），首尾天然相接，没有淡入淡出。循环点就是整个文件（0 → 样本总数），`AudioSystem.playMusic` 的 `loop = true` 可以直接用。接缝按 032 的同一口径检查（解码后的二阶差分台阶 vs 近邻 0.1 s），并且和全曲样本台阶的 99.9 百分位比较，接缝不比曲内普通样本突出。
- **没有高潮**：表里「短时 p50 / max」是 EBU 3 s 短时响度，在循环第二圈上测的中位数和最大值。

| 文件 | 状态 | 时长 | 体积 | kbps | LUFS | LRA | 真峰值 dBTP | 短时 p50 / max | 循环点（样本 @44.1 kHz） | 用途 / 接入 |
|---|---|---|---|---|---|---|---|---|---|---|
""" + '\n'.join(rows) + '\n\n## 内容\n\n' + '\n'.join(f"- **{k}**（`audio/source/music/{t['score']}`）：{t['desc']}" for k, t in TRACKS.items()) + f"""

## 来源 / 授权

- 钢琴（立式）、大提琴组（susvib、trem）、独奏低音提琴（SusNV）是 **VSCO 2 Community Edition** 的采样，授权 **CC0 1.0**，固定在提交 `{M.VSCO_COMMIT}`。用到的每个文件都逐条列在 **[docs/audio-credits.md](../../../docs/audio-credits.md)**，摘要行在 **[audio/CREDITS.md](../../../audio/CREDITS.md)**。
- pad（加法合成）、混响冲激响应、编曲、母带都是自制。

## 源脚本与复现

脚本放在仓库根的 **`audio/source/music/`**（保持需求单写的位置），不放在 `art/audio/` 下，避免 Python 文件混进打包的资源目录。采样和分轨不进仓库，用固定提交复现：

```sh
git clone --filter=blob:none --sparse {M.VSCO_URL} vsco2ce && cd vsco2ce && git checkout {M.VSCO_COMMIT}
git sparse-checkout set "Keys/Upright Piano" "Strings/Cello Section" "Strings/Solo Contrabass"
export VSCO_ROOT=$PWD
python3 audio/source/music/gen_music.py mus-s1-ebb-shore /tmp/s1            # 渲染（结尾曲：master.py 加 --oneshot）：混音 .npy + 4–5 条 24-bit FLAC 分轨 + render.json
python3 audio/source/music/master.py /tmp/s1/mus-s1-ebb-shore.mix.npy art/audio/music/mus-s1-ebb-shore.ogg   # 母带 + 编码 + 解码实测
python3 audio/source/music/gen_docs.py                                         # 本 README、docs/audio-credits.md、CREDITS 摘要
```

- `musiclib.py`：采样器（YIN 逐样本校音、力度层内响度拉平、resample_poly 移调）、长音拼接延长、环形时间轴、pad 合成、自制 IR、环形卷积 / 滤波 / 限幅。
- `score_*.py`：每首一份乐谱（小节、拍、音高、力度），带 `TRANSPOSE`（整曲移调），调性定下后可以一键重出。
- 渲染是确定的（固定种子）；只有 Ogg 流序列号每次编码都不同，所以文件字节会变，测量值不变。
"""
L = rep.get('mus-s3-lighthouse')
if L and 'sum' in L:
    S, H = L['sum'], L['sumHalf']; sst = S.get('shortTermLufs', {})
    readme += f"""
## S3 分层（mus-s3-lighthouse + mus-s3-lighthouse-upper）

两层用 `master_layers.py` 一起做母带：两层乘**同一个**增益（底层落在 −20 LUFS，上层相对 +{L['upperDb']} dB），限幅增益曲线由「底层 + 上层」之和算出、同时作用在两层上（本次实际压缩 {L['limiterMaxGrDb']} dB，即没有触发），两层解码后长度断言相等（{L['samples']} 样本）。

| 组合（解码后实测） | LUFS | 真峰值 dBTP | 短时 p50 / max | 接缝 dBFS（近邻） |
|---|---|---|---|---|
| 只播底层 | {L['lufs']} | {L['truePeakDb']} | {L['shortTermLufs']['p50']} / {L['shortTermLufs']['max']} | {L['seamDec'][0]}（{L['seamDec'][1]}）✓ |
| 底层 + 0.5 × 上层（淡入一半） | {H['lufs']} | {H['truePeakDb']} | — | — |
| 底层 + 上层（完全淡入） | {S['lufs']} | {S['truePeakDb']} | {sst.get('p50')} / {sst.get('max')} | {S['seamDec'][0]}（{S['seamDec'][1]}）✓ |

- 增益 0 → 1 之间真峰值单调上升，最大就是完全淡入时的 {S['truePeakDb']} dBTP，不会爆音；即使两层意外错位起播，抽查的随机错位真峰值也在 −2.9 dBTP 以内。
- 完全淡入比只播底层响约 {round(S['lufs'] - L['lufs'], 1)} LU，这是有意的「越往上越紧」；如果 036 希望总响度不变，可以在上层淡入时把底层同步压 0–2.5 dB。
- 两层都按同一偏移做了环形旋转（{L['rotateSamples']} 样本 = 第 {L['rotateBeats']} 拍，落在最安静的半拍点），让 Vorbis 在文件首尾的接缝误差最小；所以文件开头是乐谱第 2 小节第 4.5 拍。旋转对两层完全相同，对齐不受影响。
- 复现：`python3 audio/source/music/gen_music.py mus-s3-lighthouse /tmp/s3 && python3 audio/source/music/gen_music.py mus-s3-lighthouse-upper /tmp/s3 && python3 audio/source/music/master_layers.py /tmp/s3/mus-s3-lighthouse.mix.npy /tmp/s3/mus-s3-lighthouse-upper.mix.npy art/audio/music/mus-s3-lighthouse.ogg art/audio/music/mus-s3-lighthouse-upper.ogg --upper-db 1.5 --tempo 40`，再把两个 `*.report.json` 移到 `audio/source/music/renders/`。
"""
E = rep.get('mus-ending-ch1')
if E:
    import importlib; SE = importlib.import_module('score_ending_ch1'); V = json.load(open(os.path.join(HERE, 'renders', 'mus-ending-ch1.verify.json')))
    cue_rows = '\n'.join(f"| `{k}` | {v:.2f} |" for k, v in SE.CUES.items())
    mot = '、'.join(f"{x['want']}@{x['t']:.2f}s {'✓' if x['ok'] else '✗'}" for x in V['motif'])
    tc = '；'.join(f"{w['win'][0]}–{w['win'][1]} s：" + ' / '.join(f'{n} {v:.2f}' for n, v in w['top'][:2]) + f"，E {w['E']:.3f}" for w in V['tailChroma'])
    readme += f"""
## 结尾曲卡点（mus-ending-ch1，不循环）

`score_ending_ch1.py` 的 `CUES`（秒，文件 0 s = 点燃那一帧）。所有音符都由这些值算出：035 的时间点变了，改 `CUES` 后 `gen_music.py mus-ending-ch1` → `master.py … --oneshot` → `verify_ending.py` 重出即可。

| 卡点 | 秒 |
|---|---|
""" + cue_rows + f"""

- 派生时间：动机 A3 {SE.m(0):.2f} s / D4 {SE.m(1):.2f} / F4 {SE.m(2):.2f} / E4 {SE.m(3):.2f} → **解决 D4 {SE.RES:.2f} s**（高点）；收尾 D 小三和弦 {SE.FINAL:.2f} s，最后旋律音 D4 {SE.FINAL + SE.BEAT:.2f} s；淡出 {SE.MASTER_FADE[0]:.0f}–{SE.MASTER_FADE[1]:.0f} s，文件长 {E['seconds']} s（最后 1 s 静音）。
- 解码后验证（`renders/mus-ending-ch1.verify.json`）：动机各音起音处新增能量最大的音级 {mot}；最后旋律音 {V['lastMelodic']['got']}；结尾音级分布 {tc}（不停在 E）。短时响度最大 {V['shortTermMax'][1]} LUFS 在 {V['shortTermMax'][0]:.1f} s（解决后），中位数 {E['shortTermLufs']['p50']}。
- 接入：035 在 `lighthouse:ignited` 那一帧 `start(0)`，loop = false；跳过演出时 0.5–1 s 淡出即可。字幕 / 镜头按上表对齐，误差 ≤ 0.2 s。
"""
open(os.path.join(ROOT, 'art/audio/music/README.md'), 'w').write(readme)

# docs/audio-credits.md
use = {}
for k in TRACKS:
    for p in ren[k]['used']: use.setdefault(p, []).append(k)
def who(p): return 'Simon Dalzell（Ivy Audio），经 Versilian Studios 以 VSCO 2 CE 发布' if p.startswith('Keys') else 'Versilian Studios / Sam Gossner'
crow = [f"| `{p}` | [链接]({M.VSCO_URL}/blob/{M.VSCO_COMMIT}/{urllib.parse.quote(p)}) | {who(p)} | CC0 1.0 | {', '.join(v)} |" for p, v in sorted(use.items())]
credits = f"""# 音频采样来源与授权（v0.1-033 配乐）

制作人裁定：033 只允许使用**明确标为 CC0** 的采样，每个都要登记来源链接和授权；其余全部自制。
本文件由 `audio/source/music/gen_docs.py` 从各曲的 render.json（渲染时自动记录实际用到的采样）生成。

## 采样库

- **VSCO 2 Community Edition**（Versilian Studios Chamber Orchestra 2 CE）
  - 仓库：{M.VSCO_URL}，固定在提交 `{M.VSCO_COMMIT}`（2020-08-04）
  - 授权：CC0 1.0 Universal，{M.VSCO_URL}/blob/{M.VSCO_COMMIT}/LICENSE
  - 库说明的要求：不要直接售卖采样本身。我们只发布混好的成品曲，不分发原始采样。库说明还鼓励署名 Versilian Studios / Sam Gossner 和 Ivy Audio / Simon Dalzell，游戏 credits 里会写上。
  - `Keys/Upright Piano/Info.txt`：立式钢琴由 Ivy Audio 的 Simon Dalzell 采样，Versilian Studios 获准再分发。
- **没有用到**：Salamander Grand Piano。仓库内标注 CC-BY-3.0，作者的公有领域声明不是明确的 CC0，按裁定排除。

## 实际用到的采样文件（共 {len(use)} 个）

| 文件 | 来源链接 | 作者 | 授权 | 用于 |
|---|---|---|---|---|
""" + '\n'.join(crow) + """

## 自制部分

- 铺底 pad：加法合成（`audio/source/music/musiclib.py` 的 `pad_voice`）
- 混响：自制多频段衰减立体声冲激响应 + 环形卷积（`make_ir` / `circ_reverb`）
- 编曲、音高修正、力度层拉平、长音拼接、母带 / 限幅：`score_*.py`、`gen_music.py`、`musiclib.py`、`master.py`
"""
open(os.path.join(ROOT, 'docs/audio-credits.md'), 'w').write(credits)

# audio/CREDITS.md 摘要段
b, e = '<!-- 033-music:begin -->', '<!-- 033-music:end -->'
lines = [b]
for k, t in TRACKS.items():
    n = len(ren[k]['used'])
    lines.append(f"| {rep[k]['path']} | 编曲与渲染：audio/source/music/{t['score']} + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（{n} 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；{t['status']} |")
lines.append(e)
cp = os.path.join(ROOT, 'audio/CREDITS.md'); old = open(cp).read()
if b in old: old = old[:old.index(b)] + old[old.index(e) + len(e):].lstrip('\n')
else:  # 第一轮手写的那一行换成受管段
    old = '\n'.join(l for l in old.split('\n') if 'mus-menu-preview-v1' not in l)
open(cp, 'w').write(old.rstrip('\n') + '\n' + '\n'.join(lines) + '\n')
print('ok', len(use), 'samples', tot, 'bytes')
