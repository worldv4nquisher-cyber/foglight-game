"""v0.1-033 配乐生成：python3 audio/source/music/gen_music.py <曲名> <输出目录>
样本：VSCO 2 CE（CC0），用环境变量 VSCO_ROOT 指定采样目录（默认 ./samples/vsco2ce），提交号见 musiclib.VSCO_COMMIT。"""
import sys, os, json, glob, re, subprocess, importlib
import numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt
sys.path.insert(0, os.path.dirname(__file__))
import musiclib as M

def piano_sampler():
    fs = []
    for p in sorted(glob.glob(os.path.join(M.SAMPLE_ROOT, 'Keys/Upright Piano/Player_dyn*_rr1_*.wav'))):
        m = re.search(r'dyn(\d)_rr1_(\d+)\.wav', p); fs.append((p, 21 + 2 * int(m.group(2)), int(m.group(1)) - 1))
    return M.Sampler('upright-piano', fs, tune_at=0.15, rms_win=(0, 1.0))

def cello_sampler():
    fs = []
    for p in sorted(glob.glob(os.path.join(M.SAMPLE_ROOT, 'Strings/Cello Section/susvib/susvib_*_v[13]_1.wav'))):
        m = re.search(r'susvib_([A-G]#?)(\d)_v(\d)_1', p)
        fs.append((p, 12 * (int(m.group(2)) + 2) + M.NOTE[m.group(1)], 0 if m.group(3) == '1' else 1))
    return M.Sampler('cello-section-susvib', fs, tune_at=1.5, rms_win=(1.0, 3.0), loopable=True)

def cello_trem_sampler():
    fs = []
    for p in sorted(glob.glob(os.path.join(M.SAMPLE_ROOT, 'Strings/Cello Section/trem/trem_*_v[12]_1.wav'))):
        m = re.search(r'trem_([A-G]#?)(\d)_v(\d)_1', p)
        midi = 12 * (int(m.group(2)) + 2) + M.NOTE[m.group(1)]
        if os.path.basename(p) == 'trem_B2_v2_1.wav': midi = 47  # 文件名写 B2，YIN 实测是 B1 那个音（MIDI 47.2）
        fs.append((p, midi, int(m.group(3)) - 1))
    return M.Sampler('cello-section-trem', fs, tune_at=1.0, rms_win=(1.0, 3.0), loopable=True)

def bass_sampler():
    fs = []
    for p in sorted(glob.glob(os.path.join(M.SAMPLE_ROOT, 'Strings/Solo Contrabass/SusNV/BKCtbss_SusNV_*_v[13]_rr1.wav'))):
        m = re.search(r'SusNV_([A-G]#?)(\d)_v(\d)_rr1', p)  # 文件名比科学音高高一个八度（E0 = MIDI 28，YIN 实测）
        fs.append((p, 12 * (int(m.group(2)) + 2) + M.NOTE[m.group(1)], 0 if m.group(3) == '1' else 1))
    return M.Sampler('contrabass-solo-susnv', fs, tune_at=1.0, rms_win=(1.0, 4.0), loopable=True)

def active_rms(x):
    f = int(0.05 * M.SR); n = len(x) // f; e = np.sqrt((x[:n * f] ** 2).reshape(n, f, 2).mean((1, 2)))
    a = e[e > e.max() * 10 ** (-45 / 20)]; return float(M.db(np.sqrt(np.mean(a ** 2))))

def render(name, out):
    S = importlib.import_module('score_' + name.replace('mus-', '').replace('-', '_'))
    rng = np.random.default_rng(33)
    T = getattr(S, 'TRANSPOSE', 0)  # 整曲移调（半音），调性未定时可以一键重出
    LIN = getattr(S, 'LINEAR', False)  # 不循环（结尾曲）：缓冲长度 = DURATION 秒，不绕回；线性混响 / 滤波
    L = M.Loop(S.DURATION if LIN else S.BARS * 4 * 60 / S.TEMPO, S.TEMPO, linear=LIN)
    pno = piano_sampler()
    vc = cello_trem_sampler() if getattr(S, 'CELLO_ARTIC', 'susvib') == 'trem' else cello_sampler()
    reps = dict(piano=pno.report(), cello=vc.report())
    for ent in S.PIANO:  # (小节, 拍, midi, 力度, 时值[, 增益 dB])
        bar, beat, midi, vel, dur = ent[:5]; gdb = ent[5] if len(ent) > 5 else 0.0
        t = L.sec(S.B(bar, beat)) + rng.normal(0, 0.008)
        y = M.piano_note(pno, midi + T, vel, L.sec(dur), rel=getattr(S, 'PIANO_REL', 0.45))
        if getattr(S, 'PIANO_NOTE_NORM', False):  # 每个音按头 1 s 的 RMS 对齐，响度只由力度决定（稀疏曲里单个音太突出就会像「高潮」）
            y = y * (0.05 * (0.35 + 0.65 * vel) / (np.sqrt(np.mean(y[:M.SR] ** 2)) + 1e-9))
        L.add('piano', M.pan(y * 10 ** (gdb / 20), np.clip((midi - 60) / 48, -.35, .35), 0.8), t)
    for i, ent in enumerate(S.CELLO):  # (小节, 拍, midi, 力度, 时值, 起音, 形状[, 增益 dB])
        bar, beat, midi, vel, dur, att, shape = ent[:7]; gdb = ent[7] if len(ent) > 7 else 0.0
        y = M.string_note(vc, midi + T, vel, L.sec(dur), att=att, rel=getattr(S, 'CELLO_REL', 1.8), shape=shape, seed=i, flatten=getattr(S, 'STRING_FLATTEN', 0.0))
        L.add('cello', M.pan(y * 10 ** (gdb / 20), 0.22, 0.6), L.sec(S.B(bar, beat)))
    if getattr(S, 'BASS', None):
        cb = bass_sampler(); reps['bass'] = cb.report()
        for i, (bar, beat, midi, vel, dur, att, shape) in enumerate(S.BASS):
            y = M.string_note(cb, midi + T, vel, L.sec(dur), att=att, rel=getattr(S, 'BASS_REL', 3.0), shape=shape, seed=500 + i, flatten=getattr(S, 'STRING_FLATTEN', 0.0))
            L.add('bass', M.pan(y, -0.15, 0.5), L.sec(S.B(bar, beat)))
    pb, pa, pr, pbr = getattr(S, 'PAD_BEATS', 8), getattr(S, 'PAD_ATT', 3.5), getattr(S, 'PAD_REL', 3.5), getattr(S, 'PAD_BRIGHT', 0.55)
    for i, ent in enumerate(S.PAD):  # (起点, [midi]) 或 (起点, [midi], 拍数, 增益, 亮度[, 起音 s, 释音 s])：后者给结尾曲逐和弦控制
        bar, notes = ent[:2]; ex = list(ent[2:]) + [None] * 5
        pb_i, g_i, br_i, pa_i, pr_i = ex[0] or pb, ex[1] or 1.0, ex[2] or pbr, ex[3] or pa, ex[4] or pr
        for j, m in enumerate(notes):
            y = M.pad_voice(m + T, L.sec(pb_i) + 1.0, seed=100 + i * 10 + j, att=pa_i, rel=pr_i, bright=br_i) * g_i
            L.add('pad', y, L.sec(S.B(bar)) - getattr(S, 'PAD_LEAD', 1.5))
    # 分轨处理
    filt = dict(piano=[('low', 6500)], cello=[('high', 45)], pad=[('low', 2200)])
    filt.update(getattr(S, 'FILTERS', {}))
    for k, fl in filt.items():
        for kind, fc in fl:
            if k in L.bus:
                sos = butter(2, fc, kind, fs=M.SR, output='sos')
                L.bus[k] = sosfilt(sos, L.bus[k], axis=0).astype(np.float32) if LIN else M.circ_filter(L.bus[k], sos)
    # 分轨慢速起伏（潮汐）：整圈内整数个周期，保证循环无缝
    for k, (cycles, depth_db, phase) in getattr(S, 'BUS_LFO', {}).items():
        ph = 2 * np.pi * cycles * np.arange(L.n) / L.n + phase
        L.bus[k] = (L.bus[k] * (10 ** (depth_db * np.sin(ph) / 20))[:, None]).astype(np.float32)
    # 分轨电平：按「发声部分」的 RMS（50 ms 帧，高于该轨峰值 −45 dB 的帧）对齐到乐谱给的目标值
    gains = {k: 10 ** ((S.MIX[k] - active_rms(L.bus[k])) / 20) for k in L.bus}
    sends = S.SENDS
    ir = M.make_ir()
    dry = sum(L.bus[k] * gains[k] for k in L.bus)
    send = sum(L.bus[k] * gains[k] * sends[k] for k in L.bus)
    wet = M.lin_reverb(send, ir) if LIN else M.circ_reverb(send, ir)
    mix = dry + wet
    if LIN and getattr(S, 'MASTER_FADE', None):  # 结尾曲：(起 s, 止 s) 余弦淡出，止点之后为 0
        a, b = (int(v * M.SR) for v in S.MASTER_FADE); g = np.ones(L.n); g[b:] = 0
        g[a:b] = 0.5 * (1 + np.cos(np.linspace(0, np.pi, b - a))); mix = (mix * g[:, None]).astype(np.float32); wet = wet * g[:, None]
    os.makedirs(out, exist_ok=True)
    stems = {k: L.bus[k] * gains[k] for k in L.bus}; stems['reverb'] = wet
    print('busActiveRms', {k: round(active_rms(v), 1) for k, v in stems.items()})
    return mix, stems, reps

if __name__ == '__main__':
    name, out = sys.argv[1], sys.argv[2]
    mix, stems, rep = render(name, out)
    np.save(os.path.join(out, name + '.mix.npy'), mix)
    for k, v in stems.items(): sf.write(os.path.join(out, f'{name}-stem-{k}.flac'), np.clip(v, -1, 1), M.SR, subtype='PCM_24')
    json.dump(dict(samplers=rep, used=sorted(os.path.relpath(p, M.SAMPLE_ROOT) for p in M.USED)), open(os.path.join(out, name + '.render.json'), 'w'), indent=1, ensure_ascii=False)
    print('done', mix.shape, float(np.abs(mix).max()))
