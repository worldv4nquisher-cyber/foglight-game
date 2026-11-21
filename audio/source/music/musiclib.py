"""v0.1-033 配乐渲染库（美术 Bot）。

- 采样器：VSCO 2 CE（CC0）的立式钢琴 / 大提琴组 / 低音提琴单音采样，按音高 / 力度挑最近的样本，用 resample_poly 移调。
  起音对齐 + 每个样本测音高（YIN）修正音分 + 力度层内响度拉平。
- 合成：铺底 pad（加法合成，自有）。
- 环形时间轴：所有音符和混响都按「循环长度 L」取模叠加（混响用 L 点循环卷积），
  所以首尾天然相接，整文件 loop 即可。
- 混响：自己生成的立体声冲激响应（分频段衰减 + 早期反射），不含外部素材。
"""
import os, re, glob, json, math
from fractions import Fraction
import numpy as np, soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt, sosfiltfilt

SR = 44100
SAMPLE_ROOT = os.environ.get('VSCO_ROOT', 'samples/vsco2ce')  # VSCO 2 CE 采样目录（CC0，见 VSCO_URL），用环境变量 VSCO_ROOT 指定
VSCO_COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'
VSCO_URL = 'https://github.com/sgossner/VSCO-2-CE'
NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}
USED = set()  # 实际用到的样本（写 credits）


def yin(x, fmin=25, fmax=1500, th=0.12):
    tmax = int(SR / fmin); tmin = int(SR / fmax); n = len(x) - tmax
    if n < tmax: return None
    d = np.array([np.sum((x[:n] - x[t:t + n]) ** 2) for t in range(tmax)])
    cm = np.ones_like(d); cm[1:] = d[1:] * np.arange(1, tmax) / np.maximum(np.cumsum(d[1:]), 1e-12)
    for t in range(tmin, tmax - 1):
        if cm[t] < th and cm[t] <= cm[t + 1]:
            a, b, c = cm[t - 1], cm[t], cm[t + 1]; s = (a - c) / (2 * (a - 2 * b + c) + 1e-12); return SR / (t + s)
    return None


def db(x): return 20 * np.log10(np.maximum(x, 1e-12))


class Sampler:
    """files: [(path, midi, layer)]；layer 0 = 最轻。"""

    def __init__(self, name, files, tune_at=0.3, rms_win=(0.0, 1.0), loopable=False):
        self.name = name; self.loopable = loopable; self.s = []; self.cache = {}
        for path, midi, layer in files:
            x, sr = sf.read(path, always_2d=True); assert sr == SR
            x = x[:, :2] if x.shape[1] >= 2 else np.repeat(x, 2, 1)
            m = np.abs(x).max(1); pk = m.max(); on = int(np.argmax(m > pk * 10 ** (-40 / 20)))
            x = x[max(0, on - int(0.002 * SR)):]
            mono = x.mean(1); seg = mono[int(tune_at * SR):int(tune_at * SR) + int(0.25 * SR)]
            f = yin(seg, fmin=max(25, 440 * 2 ** ((midi - 69) / 12) * 0.6), fmax=min(2000, 440 * 2 ** ((midi - 69) / 12) * 1.6))
            cents = 0.0
            if f:
                c = 1200 * math.log2(f / (440 * 2 ** ((midi - 69) / 12)))
                if abs(c) < 40: cents = c
            a, b = rms_win; r = np.sqrt(np.mean(mono[int(a * SR):int(b * SR)] ** 2))
            self.s.append(dict(path=path, midi=midi, layer=layer, x=x.astype(np.float32), cents=cents, rmsdb=db(r)))
        # 力度层内响度拉平：对 rms(dB)~midi 做线性拟合，把偏离拉回趋势线（保留音区自然的明暗）
        for L in set(s['layer'] for s in self.s):
            ss = [s for s in self.s if s['layer'] == L]
            if len(ss) < 3:
                for s in ss: s['gain'] = 1.0
                continue
            mm = np.array([s['midi'] for s in ss]); rr = np.array([s['rmsdb'] for s in ss])
            k = np.polyfit(mm, rr, 1); tr = np.polyval(k, mm)
            for s, t, r in zip(ss, tr, rr): s['gain'] = 10 ** (np.clip(t - r, -6, 6) / 20)
        self.layers = sorted(set(s['layer'] for s in self.s))

    def report(self):
        return [dict(file=os.path.relpath(s['path'], SAMPLE_ROOT), midi=s['midi'], layer=s['layer'], cents=round(s['cents'], 1), gainDb=round(float(db(s['gain'])), 2)) for s in self.s]

    def pick(self, midi, layer):
        ss = [s for s in self.s if s['layer'] == layer] or self.s
        return min(ss, key=lambda s: (abs(s['midi'] - midi), s['midi'] < midi))

    def shifted(self, s, midi):
        key = (s['path'], midi)
        if key in self.cache: return self.cache[key]
        r = 2 ** ((midi - s['midi'] - s['cents'] / 100) / 12)
        fr = Fraction(r).limit_denominator(1200)
        y = s['x'] if fr == 1 else resample_poly(s['x'], fr.denominator, fr.numerator, axis=0).astype(np.float32)
        y = y * s['gain']; self.cache[key] = y; USED.add(s['path']); return y


def extend_loop(y, need, start=2.0, xf=0.8, rng=None):
    """把持续音样本延长到 need 个样本：在 [start, 末尾 −1 s] 区间随机取段，等功率交叉淡化拼接。"""
    if len(y) >= need: return y[:need]
    rng = rng or np.random.default_rng(0)
    a = int(start * SR); b = len(y) - int(1.0 * SR); X = int(xf * SR)
    out = y[:b].copy()
    t = np.linspace(0, np.pi / 2, X)[:, None]; fo, fi = np.cos(t), np.sin(t)
    while len(out) < need + X:
        seg_len = int(rng.uniform(2.0, 3.5) * SR); s0 = int(rng.uniform(a, max(a + 1, b - seg_len)))
        seg = y[s0:s0 + seg_len]
        out = np.concatenate([out[:-X], out[-X:] * fo + seg[:X] * fi, seg[X:]])
    return out[:need]


class Loop:
    """环形时间轴上的立体声缓冲。"""

    def __init__(self, seconds, tempo=None, linear=False):
        self.n = int(round(seconds * SR)); self.tempo = tempo; self.linear = linear  # linear=True：不循环的单次曲（结尾曲），超出部分截掉、不绕回
        self.bus = {}

    def sec(self, beat): return beat * 60.0 / self.tempo

    def add(self, bus, y, t):
        b = self.bus.setdefault(bus, np.zeros((self.n, 2), np.float32))
        if self.linear:
            i = int(round(t * SR))
            if i < 0: y = y[-i:]; i = 0
            m = max(0, min(len(y), self.n - i)); b[i:i + m] += y[:m]; return
        i = int(round(t * SR)) % self.n; k = 0
        while k < len(y):
            m = min(len(y) - k, self.n - i); b[i:i + m] += y[k:k + m]; k += m; i = 0


def pan(y, p, width=1.0):
    """p ∈ [-1,1]；width 缩窄原始立体声。"""
    m = y.mean(1, keepdims=True); s = (y[:, :1] - y[:, 1:]) / 2 * width
    l = m + s; r = m - s; a = (p + 1) * np.pi / 4
    return np.hstack([l * np.cos(a) * 1.414, r * np.sin(a) * 1.414]).astype(np.float32)


def env_release(y, hold, rel):
    n = min(len(y), hold + int(rel * 6 * SR)); y = y[:n].copy()
    if n > hold:
        t = np.arange(n - hold) / SR; y[hold:] *= np.exp(-t / rel)[:, None]
    return y


def piano_note(smp, midi, vel, dur, rel=0.35):
    layer = smp.layers[min(len(smp.layers) - 1, int(vel * len(smp.layers)))]
    y = smp.shifted(smp.pick(midi, layer), midi)
    g = 0.35 + 0.65 * vel
    return env_release(y, int(dur * SR), rel) * g


def flatten_env(y, win=0.6, amount=0.7):
    """把长音拼接后忽大忽小的弓压起伏按 win 秒滑动 RMS 拉平 amount（0 = 不动，1 = 完全拉平），保留一点自然起伏。"""
    from scipy.ndimage import uniform_filter1d
    e = np.sqrt(uniform_filter1d(y.mean(1).astype(np.float64) ** 2, max(1, int(win * SR)), mode='nearest')) + 1e-9
    ref = np.median(e[int(1.0 * SR):]) if len(e) > 2 * SR else np.median(e)
    g = np.clip(ref / e, 0.5, 2.0) ** amount
    return (y * g[:, None]).astype(np.float32)


def string_note(smp, midi, vel, dur, att=1.2, rel=1.5, shape=None, seed=0, flatten=0.0):
    layer = smp.layers[min(len(smp.layers) - 1, int(vel * len(smp.layers)))]
    y = smp.shifted(smp.pick(midi, layer), midi)
    n = int((dur + rel) * SR)
    y = extend_loop(y, n, rng=np.random.default_rng(seed + midi))
    if flatten: y = flatten_env(y, amount=flatten)
    t = np.arange(n) / SR
    e = np.clip(t / max(att, 1e-3), 0, 1); e = np.sin(e * np.pi / 2) ** 2
    r = np.clip((t - dur) / rel, 0, 1); e *= np.cos(r * np.pi / 2) ** 2
    if shape:  # [(相对时间 0..1, 增益)] 线性插值 —— 渐强渐弱
        xs, gs = zip(*shape); e *= np.interp(t / max(dur, 1e-3), xs, gs)
    return (y * e[:, None] * (0.4 + 0.6 * vel)).astype(np.float32)


def pad_voice(midi, dur, seed, att=3.0, rel=3.0, bright=1.0, detune=4.0, partials=8):
    """自有加法合成的铺底：每个音 3 个微失谐的谐波串（1/k^1.7），慢速随机起伏，左右独立。"""
    rng = np.random.default_rng(seed); n = int((dur + rel) * SR); t = np.arange(n) / SR
    f0 = 440 * 2 ** ((midi - 69) / 12); out = np.zeros((n, 2), np.float32)
    for ch in range(2):
        acc = np.zeros(n)
        for v in range(3):
            fd = f0 * 2 ** (rng.uniform(-detune, detune) / 1200)
            for k in range(1, partials + 1):
                if fd * k > 6000: break
                amp = (1 / k ** 1.7) * (bright ** (k - 1))
                lfo = 1 + 0.35 * np.sin(2 * np.pi * rng.uniform(0.03, 0.12) * t + rng.uniform(0, 6.28))
                acc += amp * lfo * np.sin(2 * np.pi * fd * k * t + rng.uniform(0, 6.28))
        out[:, ch] = acc / 3
    e = np.clip(t / att, 0, 1) ** 2 * (3 - 2 * np.clip(t / att, 0, 1)) if att > 0 else np.ones(n)
    r = np.clip((t - dur) / rel, 0, 1); e = e * (1 - r * r * (3 - 2 * r))
    return (out * e[:, None] * 0.12).astype(np.float32)


def make_ir(seconds=6.0, t60=(4.2, 3.4, 2.4, 1.1), pre=0.025, seed=7):
    """自有合成 IR：4 个频段（<300 / 300–2k / 2–6k / >6k Hz）各自指数衰减的去相关噪声 + 早期反射。"""
    rng = np.random.default_rng(seed); n = int(seconds * SR); t = np.arange(n) / SR
    edges = [(None, 300), (300, 2000), (2000, 6000), (6000, None)]
    ir = np.zeros((n, 2))
    for ch in range(2):
        noise = rng.standard_normal(n)
        for (lo, hi), T in zip(edges, t60):
            if lo is None: sos = butter(4, hi, 'low', fs=SR, output='sos')
            elif hi is None: sos = butter(4, lo, 'high', fs=SR, output='sos')
            else: sos = butter(4, [lo, hi], 'band', fs=SR, output='sos')
            ir[:, ch] += sosfiltfilt(sos, noise) * 10 ** (-3 * t / T)
        ir[:, ch] *= 1 - np.exp(-t / 0.04)  # 软起
        for d, g in [(0.011, .5), (0.019, .38), (0.029, .3), (0.041, .22), (0.057, .16)]:
            ir[int((d + rng.uniform(0, 0.004)) * SR), ch] += g * (8 if ch == 0 else 7)
    ir = np.vstack([np.zeros((int(pre * SR), 2)), ir])
    return ir / np.sqrt(np.sum(ir ** 2) / 2)


def circ_reverb(x, ir):
    n = len(x); m = min(len(ir), n); out = np.zeros_like(x)
    for ch in range(2):
        X = np.fft.rfft(x[:, ch]); H = np.fft.rfft(np.pad(ir[:m, ch], (0, n - m)))
        out[:, ch] = np.fft.irfft(X * H, n)
    return out.astype(np.float32)


def lin_reverb(x, ir):
    """不循环曲用的线性卷积（尾巴超出缓冲的部分截掉；结尾曲缓冲本身留足尾音）。"""
    n = len(x); m = len(ir); N = 1 << int(np.ceil(np.log2(n + m))); out = np.zeros_like(x)
    for ch in range(2):
        out[:, ch] = np.fft.irfft(np.fft.rfft(x[:, ch], N) * np.fft.rfft(ir[:, ch], N), N)[:n]
    return out.astype(np.float32)


def circ_filter(x, sos):
    """环形滤波（先接两圈再取中间），保证首尾连续。"""
    y = sosfilt(sos, np.vstack([x, x]), axis=0)
    return y[len(x):].astype(np.float32)


def true_peak_db(x):
    up = resample_poly(x, 4, 1, axis=0); return float(db(np.abs(up).max()))


def circ_limiter_gain(x, ceiling_db=-1.5, hold=0.010):
    """只算增益曲线（多层叠加时：按叠加信号算，同一条曲线乘到每一层上，层之间保持对齐）"""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    c = 10 ** (ceiling_db / 20)
    tp = np.abs(resample_poly(x, 4, 1, axis=0)).max(1)[:len(x) * 4].reshape(-1, 4).max(1)
    need = np.minimum(1.0, c / np.maximum(tp, 1e-12))
    W = int(hold * SR)
    g = minimum_filter1d(need, 2 * W + 1, mode='wrap')
    return uniform_filter1d(g, W + 1, mode='wrap')


def circ_limiter(x, ceiling_db=-1.5, hold=0.010):
    """环形、前视的真峰值限幅（只压极少数钢琴起音的峰）：4× 过采样取峰 → 所需增益
    → ±hold 秒的滑动最小值（提前压、稍后放）→ 再做 hold 秒滑动平均让增益平滑。返回 (y, 最大压缩 dB, 压缩 >0.5 dB 的时长 s)。"""
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    c = 10 ** (ceiling_db / 20)
    tp = np.abs(resample_poly(x, 4, 1, axis=0)).max(1)[:len(x) * 4].reshape(-1, 4).max(1)
    need = np.minimum(1.0, c / np.maximum(tp, 1e-12))
    W = int(hold * SR)
    g = minimum_filter1d(need, 2 * W + 1, mode='wrap')
    g = uniform_filter1d(g, W + 1, mode='wrap')
    return (x * g[:, None]).astype(np.float32), float(-db(g.min())), float(np.sum(g < 10 ** (-0.5 / 20)) / SR)
