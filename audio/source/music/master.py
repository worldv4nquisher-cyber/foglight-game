"""母带 + 编码 + 校验：python3 master.py <mix.npy> <out.ogg> [--lufs -20] [--q Q | --kbps 128:160] [--ceiling -1.5]
响度用 ffmpeg ebur128 实测（环形：先接三圈测中间一圈）；真峰值 4× 过采样；Vorbis 编码后解码再查接缝。"""
import sys, os, json, subprocess, tempfile, re, argparse
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(__file__)); import musiclib as M

ONESHOT = '--oneshot' in sys.argv  # 不循环的单次曲（结尾曲）：响度 / 短时只测一遍，不测接缝，改测首尾

def lufs(x):
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'a.wav'); sf.write(f, x if ONESHOT else np.vstack([x, x, x]), M.SR, subtype='FLOAT')
        r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    s = r[r.rfind('Summary'):]
    return float(re.search(r'I:\s+(-?[\d.]+) LUFS', s).group(1)), float(re.search(r'LRA:\s+([\d.]+) LU', s).group(1))

def short_term(x):
    """EBU 短时响度（3 s 窗）在 t ≥ 3 s 部分的 p50 / p90 / max —— 检查「没有高潮」"""
    with tempfile.TemporaryDirectory() as d:
        f = os.path.join(d, 'a.wav'); sf.write(f, x if ONESHOT else np.vstack([x, x]), M.SR, subtype='FLOAT')  # 接两圈，取第二圈（循环时的真实状态）；单次曲只测一遍
        r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    n = len(x) / M.SR; v = []
    for m in re.finditer(r't:\s*([\d.]+).*?S:\s*(-?[\d.]+)', r):
        t, s_ = float(m.group(1)), float(m.group(2))
        if (3 <= t <= n) if ONESHOT else (n <= t < 2 * n): v.append(s_)
    v = np.array(v); return dict(p50=round(float(np.percentile(v, 50)), 1), p90=round(float(np.percentile(v, 90)), 1), max=round(float(v.max()), 1))

def seam(x):
    """接缝二阶差分台阶 vs 近邻 0.1 s 最大台阶（与 032 同口径）"""
    d2 = np.abs(np.diff(np.vstack([x[-2000:], x[:2000]]), 2, axis=0)).max(1)
    j = 2000 - 1; near = np.concatenate([d2[j - 4410 if j > 4410 else 0:j - 2], d2[j + 2:j + 400]])
    return float(M.db(d2[j - 1:j + 1].max())), float(M.db(near.max())), float(M.db(np.sqrt(np.mean(x ** 2))))

ap = argparse.ArgumentParser(); ap.add_argument('mix'); ap.add_argument('out'); ap.add_argument('--lufs', type=float, default=-20); ap.add_argument('--q', type=float, default=None); ap.add_argument('--kbps', default='128:160'); ap.add_argument('--ceiling', type=float, default=-1.5); ap.add_argument('--oneshot', action='store_true')
a = ap.parse_args()
x = np.load(a.mix).astype(np.float64)
I, lra = lufs(x); x *= 10 ** ((a.lufs - I) / 20)
lim = dict(maxGrDb=0.0, grSeconds=0.0)
for _ in range(3):  # 稀疏的曲子峰值因数高：先归一到目标响度，峰超了就环形限幅，再重测响度，迭代到稳定
    if M.true_peak_db(x) <= a.ceiling: break
    x, gr, sec = M.circ_limiter(x, a.ceiling); lim = dict(maxGrDb=round(max(gr, lim['maxGrDb']), 2), grSeconds=round(sec, 3))
    I, _ = lufs(x); x *= 10 ** ((a.lufs - I) / 20)
if M.true_peak_db(x) > -1.0: raise SystemExit('限幅后真峰值仍 > -1 dBTP')
wav = a.out.replace('.ogg', '.master.wav') if a.out.endswith('.ogg') else a.out + '.wav'
tmpwav = os.path.join(tempfile.mkdtemp(), 'm.wav'); sf.write(tmpwav, x.astype(np.float32), M.SR, subtype='FLOAT')
dur = len(x) / M.SR; lo, hi = map(float, a.kbps.split(':'))
for q in ([a.q] if a.q is not None else [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9]):  # Vorbis 是 VBR：稀疏的曲子同样 q 码率更低，自动挑落在需求单区间里的最低 q
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', tmpwav, '-c:a', 'libvorbis', '-q:a', str(q), a.out], check=True)
    kb = os.path.getsize(a.out) * 8 / dur / 1000
    if kb >= lo: break
if not lo <= kb <= hi: print(f'warning: {kb:.1f} kbps 不在 {a.kbps}')
dec = os.path.join(os.path.dirname(tmpwav), 'd.wav'); subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', a.out, dec], check=True)
y, _ = sf.read(dec)
I2, lra2 = lufs(y)
rep = dict(file=os.path.basename(a.out), vorbisQ=q, bytes=os.path.getsize(a.out), seconds=round(len(y) / M.SR, 3), samples=len(y), srcSamples=len(x),
           kbps=round(os.path.getsize(a.out) * 8 / (len(y) / M.SR) / 1000, 1), lufs=I2, lra=lra2, truePeakDb=round(M.true_peak_db(y), 2), limiter=lim,
           **(dict(oneshot=True, headTail=dict(firstSampleAbs=round(float(np.abs(y[0]).max()), 6), first10msDb=round(float(M.db(np.sqrt(np.mean(y[:441] ** 2)))), 1),
                                               last1sDb=round(float(M.db(np.sqrt(np.mean(y[-M.SR:] ** 2)))), 1), lastSampleAbs=round(float(np.abs(y[-1]).max()), 6)))
              if ONESHOT else dict(seamSrc=[round(v, 1) for v in seam(x)], seamDec=[round(v, 1) for v in seam(y)],
           seamDecVsTrackStepP999=round(float(M.db(np.percentile(np.abs(np.diff(y, 2, axis=0)).max(1), 99.9))), 1))),
           shortTermLufs=short_term(y), path=os.path.relpath(os.path.abspath(a.out), os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../..')))
print(json.dumps(rep, ensure_ascii=False))
json.dump(rep, open(a.out.replace('.ogg', '.report.json'), 'w'), indent=1, ensure_ascii=False)
