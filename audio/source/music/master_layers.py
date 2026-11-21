"""分层曲母带：python3 master_layers.py <base.mix.npy> <upper.mix.npy> <base.ogg> <upper.ogg> [--lufs -20] [--upper-db 0] [--ceiling -1.5] [--tempo BPM]
- 两层用同一个增益：底层归一到 --lufs，上层保持渲染时的相对电平（再加 --upper-db）。
- 限幅增益曲线按「底层 + 上层」叠加信号算，同一条曲线乘到两层上：叠加不爆、两层仍样本对齐、单独播底层也安全。
- 分别编码，解码后再测：底层、上层、叠加（解码后相加）三者的响度 / 真峰值 / 接缝 / 短时响度。"""
import sys, os, json, subprocess, tempfile, argparse
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(__file__)); import musiclib as M
import importlib.util
spec = importlib.util.spec_from_file_location('mst', os.path.join(os.path.dirname(__file__), 'master.py'))
src = open(spec.origin).read(); src = src[:src.index('ap = argparse')]  # 复用 master.py 里的测量函数
mst = {'__file__': spec.origin}; exec(compile(src, 'master.py', 'exec'), mst)
lufs, seam, short_term = mst['lufs'], mst['seam'], mst['short_term']
ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..'))

ap = argparse.ArgumentParser()
for k in ('base', 'upper', 'out_base', 'out_upper'): ap.add_argument(k)
ap.add_argument('--lufs', type=float, default=-20); ap.add_argument('--upper-db', type=float, default=0.0)
ap.add_argument('--ceiling', type=float, default=-1.5); ap.add_argument('--kbps', default='128:160')
ap.add_argument('--tempo', type=float, default=None, help='给了就把两层一起旋到最安静的半拍点做文件起点（Vorbis 首尾编码误差最小）')
a = ap.parse_args()
b = np.load(a.base).astype(np.float64); u = np.load(a.upper).astype(np.float64) * 10 ** (a.upper_db / 20)
assert b.shape == u.shape, (b.shape, u.shape)
rot = 0
if a.tempo:  # 环形旋转：两层同一偏移，仍样本对齐；只在半拍点（拍与拍之间，避开上层每拍的嘀嗒）里挑
    from scipy.signal import butter, sosfilt
    hp = butter(4, 2000, 'high', fs=M.SR, output='sos'); s0 = b + u
    hf = sosfilt(hp, np.vstack([s0[-M.SR:], s0]), axis=0)[M.SR:]
    beat = 60 / a.tempo * M.SR; W = int(0.05 * M.SR); best = None
    for k in range(int(len(b) / beat)):
        c = int(round((k + 0.5) * beat)); idx = np.arange(c - W, c + W) % len(b)
        e = float(np.sqrt(np.mean(hf[idx] ** 2)) + 0.3 * np.sqrt(np.mean(s0[idx] ** 2)))
        if best is None or e < best[0]: best = (e, c, k + 0.5)
    rot = best[1]; b = np.roll(b, -rot, 0); u = np.roll(u, -rot, 0)
    print('rotate', rot, 'samples =', round(rot / M.SR, 3), 's = beat', best[2], file=sys.stderr)
gr = 0.0
for it in range(4):
    I, _ = lufs(b); g = 10 ** ((a.lufs - I) / 20); b *= g; u *= g
    s = b + u
    worst = max(M.true_peak_db(s), M.true_peak_db(b), M.true_peak_db(u))
    if worst <= a.ceiling: break
    gc = np.minimum(M.circ_limiter_gain(s, a.ceiling), np.minimum(M.circ_limiter_gain(b, a.ceiling), M.circ_limiter_gain(u, a.ceiling)))
    gr = max(gr, float(-M.db(gc.min()))); b *= gc[:, None]; u *= gc[:, None]
if max(M.true_peak_db(b + u), M.true_peak_db(b)) > -1.0: raise SystemExit('限幅后真峰值仍 > -1 dBTP')

def encode(x, out):
    d = tempfile.mkdtemp(); w = os.path.join(d, 'm.wav'); sf.write(w, x.astype(np.float32), M.SR, subtype='FLOAT')
    lo, hi = map(float, a.kbps.split(':'))
    for q in [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9]:
        subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', w, '-c:a', 'libvorbis', '-q:a', str(q), out], check=True)
        if os.path.getsize(out) * 8 / (len(x) / M.SR) / 1000 >= lo: break
    dw = os.path.join(d, 'd.wav'); subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', out, dw], check=True)
    y, _ = sf.read(dw); return y, q

def meas(y, x=None):
    I, lra = lufs(y)
    r = dict(seconds=round(len(y) / M.SR, 3), samples=len(y), lufs=I, lra=lra, truePeakDb=round(M.true_peak_db(y), 2),
             seamDec=[round(v, 1) for v in seam(y)], seamDecVsTrackStepP999=round(float(M.db(np.percentile(np.abs(np.diff(y, 2, axis=0)).max(1), 99.9))), 1),
             shortTermLufs=short_term(y))
    if x is not None: r['seamSrc'] = [round(v, 1) for v in seam(x)]
    return r

yb, qb = encode(b, a.out_base); yu, qu = encode(u, a.out_upper)
assert len(yb) == len(yu) == len(b), (len(yb), len(yu), len(b))
rep = {}
for name, out, y, x, q in (('base', a.out_base, yb, b, qb), ('upper', a.out_upper, yu, u, qu)):
    rep[name] = dict(file=os.path.basename(out), path=os.path.relpath(os.path.abspath(out), ROOT), vorbisQ=q, bytes=os.path.getsize(out),
                     kbps=round(os.path.getsize(out) * 8 / (len(y) / M.SR) / 1000, 1), **meas(y, x))
rep['sum'] = dict(note='底层 + 上层（上层增益 1，即淡入到顶），解码后相加', **meas(yb + yu, b + u))
# 中间高度：上层 0.5（−6 dB）
rep['sumHalf'] = dict(note='底层 + 0.5 × 上层', lufs=lufs(yb + 0.5 * yu)[0], truePeakDb=round(M.true_peak_db(yb + 0.5 * yu), 2))
rep['limiterMaxGrDb'] = round(gr, 2); rep['upperDb'] = a.upper_db
rep['rotateSamples'] = int(rot); rep['rotateBeats'] = round(rot / (60 / a.tempo * M.SR), 3) if a.tempo else 0
print(json.dumps(rep, ensure_ascii=False, indent=1))
for name, out in (('base', a.out_base), ('upper', a.out_upper)):
    json.dump(dict(rep[name], layerPair=rep['base']['file'] if name == 'upper' else rep['upper']['file'], sum=rep['sum'], sumHalf=rep['sumHalf'],
                   limiterMaxGrDb=rep['limiterMaxGrDb'], upperDb=a.upper_db, rotateSamples=rep['rotateSamples'], rotateBeats=rep['rotateBeats']), open(out.replace('.ogg', '.report.json'), 'w'), indent=1, ensure_ascii=False)
