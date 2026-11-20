# 音频素材来源与授权

| 文件 | 来源 | 作者 | 授权 | 备注 |
|---|---|---|---|---|
| art/audio/sfx/*.ogg（59 个，清单见 art/audio/README.md） | 程序合成：Python numpy / scipy（模态合成、噪声滤波、黏滑摩擦、Minnaert 气泡、合成卷积混响），ffmpeg libvorbis 编码；脚本 art/source/audio/gen_audio.py + sfxlib.py，固定种子 | 美术 Bot | 自有 | v0.1-032；未用任何录音样本 / 外部素材 |
| art/audio/ambience/*.ogg（20 个，清单见 art/audio/README.md） | 同上（环形构造的无缝循环 + 单发） | 美术 Bot | 自有 | v0.1-032；未用任何录音样本 / 外部素材 |
| art/source/audio/audio-report.json、art/audio/README.md | gen_audio.py 解码实测 + gen_readme.py 生成 | 美术 Bot | 自有 | 响度 / 峰值 / 循环接缝报告 |
<!-- 033-music:begin -->
| art/audio/music/mus-menu.ogg | 编曲与渲染：audio/source/music/score_menu.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（20 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付（定稿：用户 2026-10-31 听样张 mus-menu-preview-v1 后确认「可以」；乐谱与样张完全相同，渲染混音逐样本一致） |
| art/audio/music/mus-s1-ebb-shore.ogg | 编曲与渲染：audio/source/music/score_s1_ebb_shore.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（11 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付 |
| art/audio/music/mus-s2-keeper-house.ogg | 编曲与渲染：audio/source/music/score_s2_keeper_house.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（14 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付 |
| art/audio/music/mus-s3-lighthouse.ogg | 编曲与渲染：audio/source/music/score_s3_lighthouse.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（14 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付（底层） |
| art/audio/music/mus-s3-lighthouse-upper.ogg | 编曲与渲染：audio/source/music/score_s3_lighthouse_upper.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（8 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付（紧张层） |
| art/audio/music/mus-ending-ch1.ogg | 编曲与渲染：audio/source/music/score_ending_ch1.py + gen_music / master / musiclib；钢琴、弦乐采样来自 VSCO 2 CE（20 个文件，逐条清单见 docs/audio-credits.md）；pad 与混响为程序合成 | 美术 Bot；采样：Versilian Studios / Sam Gossner、Ivy Audio / Simon Dalzell | 曲目：自有；采样：CC0 1.0 | v0.1-033；交付（不循环） |
<!-- 033-music:end -->
