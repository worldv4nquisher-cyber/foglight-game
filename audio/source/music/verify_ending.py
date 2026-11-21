"""用法：python3 audio/source/music/verify_ending.py art/audio/music/mus-ending-ch1.ogg [out.json]。结尾曲解码后验证：短时响度曲线 / 各卡点、动机 5 音的音高（起音前后半音能量增量）、结尾音高分布。"""
import sys, os, re, json, subprocess, tempfile, importlib
import numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__))); S = importlib.import_module('score_ending_ch1')
p = sys.argv[1]; f = tempfile.mktemp(suffix='.wav'); subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', p, f], check=True)
y, sr = sf.read(f); mono = y.mean(1)
r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
st = [(float(a), float(b)) for a, b in re.findall(r't:\s*([\d.]+).*?S:\s*(-?[\d.]+)', r)]
def S_at(t): return min(st, key=lambda x: abs(x[0] - t))[1]
print('short-term (3 s window ending at t):', ' '.join(f'{t}s:{S_at(t):.1f}' for t in range(2, 108, 3)))
tmax = max(st, key=lambda x: x[1]); print('short-term max', tmax)
NN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
def nm(m): return f'{NN[m % 12]}{m // 12 - 1}'
def semis(a, b):
    seg = mono[int(a * sr):int(b * sr)] * np.hanning(int(b * sr) - int(a * sr)); X = np.abs(np.fft.rfft(seg, 1 << 17)) ** 2; fr = np.fft.rfftfreq(1 << 17, 1 / sr)
    e = np.zeros(128)
    for m_ in range(36, 90):
        f0 = 440 * 2 ** ((m_ - 69) / 12); k = (fr > f0 * 2 ** (-0.5 / 12)) & (fr < f0 * 2 ** (0.5 / 12)); e[m_] = X[k].sum()
    return e
out = dict(motif=[])
for k, want in enumerate(S.MOTIF_NOTES):
    t = S.m(k); inc = semis(t + 0.03, t + 0.45) - semis(t - 0.45, t - 0.03)
    got = int(np.argmax(inc[50:80]) + 50); out['motif'].append(dict(t=round(t, 3), want=nm(want), got=nm(got), ok=got % 12 == want % 12))  # 只比音级（钢琴泛音会造成八度误判），八度以乐谱为准
print('motif', out['motif'])
t = S.FINAL + S.BEAT; inc = semis(t + 0.03, t + 0.45) - semis(t - 0.45, t - 0.03); g = int(np.argmax(inc[50:80]) + 50)
print('last melodic onset', round(t, 2), 'want D got', nm(g)); out['lastMelodic'] = dict(t=round(t, 2), got=nm(g), ok=g % 12 == 2)
def chroma(a, b):
    e = semis(a, b); c = np.zeros(12)
    for m_ in range(36, 90): c[m_ % 12] += e[m_]
    return c / c.sum()
for a, b in [(S.FINAL + 2, S.MASTER_FADE[0]), (S.MASTER_FADE[0], S.MASTER_FADE[1])]:
    c = chroma(a, b); top = np.argsort(c)[::-1][:4]
    print(f'chroma {a:.1f}-{b:.1f}s', [(NN[i], round(float(c[i]), 3)) for i in top], 'E share', round(float(c[4]), 4))
    out.setdefault('tailChroma', []).append(dict(win=[round(a, 1), round(b, 1)], top=[(NN[i], round(float(c[i]), 3)) for i in top], E=round(float(c[4]), 4)))
db = lambda x: 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-12)
print('RMS last 5 s per s', [round(db(y[int((len(y) / sr - k - 1) * sr):int((len(y) / sr - k) * sr)]), 1) for k in range(5)][::-1])
print('cues', S.CUES, 'RES', round(S.RES, 3), 'FINAL', S.FINAL, 'MASTER_FADE', S.MASTER_FADE, 'DURATION', S.DURATION)
out['shortTermMax'] = tmax; json.dump(out, open(sys.argv[2], 'w') if len(sys.argv) > 2 else sys.stdout, ensure_ascii=False, indent=1); os.remove(f)
