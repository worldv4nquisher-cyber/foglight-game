/**
 * 配乐电平对齐（033 改，制作人 c0d81c9 反馈 2）。
 *
 * 主菜单没有环境音，「比环境音低 12 dB」（036）在主菜单不适用；主菜单曲单独给增益，让它在音乐总线上和
 * S1 稳定后的场景曲一样响（±MUSIC_MATCH_TOL_DB），且不削波。
 *
 * 量法（两首用同一方法）：
 *   A. 离线（下面的数字）：ffmpeg -af astats 整文件 RMS level（全部声道、整条循环）、ebur128 积分响度 / 峰值。
 *        mus-menu         RMS −22.09 dBFS，−19.9 LUFS，采样峰值 −1.46 dBFS，真峰值 −1.5 dBTP
 *        mus-s1-ebb-shore RMS −21.83 dBFS，−20.0 LUFS，采样峰值 −1.42 dBFS，真峰值 −1.4 dBTP
 *      verify-audio 在有 ffmpeg 和 ../art 时重新量 RMS，和这里差 > 0.05 dB 就失败（文件换了要重定增益）。
 *   B. 浏览器内（冒烟 v0.1-033）：解码后的 AudioBuffer 整条 RMS × 曲目增益 × 音乐总线增益 = 音乐总线输出电平；
 *      另外在音乐总线上实采一段（AudioContext 时钟 MUSIC_LIVE_WINDOW_SEC 秒）作旁证——稀疏的曲子短窗口
 *      和整条差很多，c0d81c9 报的 −51 / −42 dBFS 就是 2048 样本（46 ms）快照，不代表整首响度。
 *
 * 结论：两首整条 RMS 只差 0.26 dB（积分响度差 0.1 LU），主菜单曲增益 +0.3 dB 后差 0.04 dB；
 * 主菜单曲峰值 −1.46 + 0.3 = −1.16 dBFS（进总线前），总线 −16 dB 后 ≈ −17 dBFS，不削波。
 */
export interface MusicFileLevel {
  rmsDb: number;
  lufs: number;
  peakDb: number;
  truePeakDb: number;
}

export const MUSIC_FILE_LEVELS: Readonly<Record<string, MusicFileLevel>> = Object.freeze({
  'mus-menu': { rmsDb: -22.09, lufs: -19.9, peakDb: -1.46, truePeakDb: -1.5 },
  'mus-s1-ebb-shore': { rmsDb: -21.83, lufs: -20.0, peakDb: -1.42, truePeakDb: -1.4 },
});

/** 主菜单曲和 S1 场景曲在音乐总线上的电平差上限（dB） */
export const MUSIC_MATCH_TOL_DB = 1;
/** 冒烟实采窗口（音频时钟秒） */
export const MUSIC_LIVE_WINDOW_SEC = 8;
