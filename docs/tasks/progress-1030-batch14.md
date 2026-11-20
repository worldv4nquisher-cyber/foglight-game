# batch14 进度（030 UI 接入）— 2026-10-30
起点 HEAD 03130cc

- [x] 1 styles.css token 对齐（206f159）
- [ ] 2 R2 接入（logo / 面板框 / 按钮光效 / 图标 / favicon）
- [ ] 3 R3 纸张
- [ ] 4 R4 插画（菜单 / 加载 / 结尾）
- [ ] 5 manifest 登记 + 懒加载
- [ ] 6 check-size char-* 规则
- [ ] 7 回归
- [ ] 8 截图 shots-030
- [x] 5a manifest 登记 21 个 + image 类型 + loadImage 懒加载 + vite 放行 ui/ + uiArt.ts（d072a2d）
- [x] 2 R2 接入：logo / 面板框 / 按钮光效 / 5 图标 / favicon（ac92fe3）
- [x] 3 R3 纸张 ×6 懒加载接入（4e47746；格线对齐待截图量）
- [x] 4 R4 插画：加载页 / 结尾 840 / 主菜单兜底（3f5eb3a）。008 结论：MenuScene 全程序生成不加载文件，实时背景保留，插画只做兜底
- [x] 6 031 准备：size-groups.mjs（char-* → common，char-father → s3）+ 单测（3b92014）
- [x] 5b UI 清单 / 懒加载单测，ImageCache 抽出（3f5531a）
- [x] 7a npm run check 全绿（HEAD 2771b45）；size：menu+boot 3.70 MB、common+s1 126.11 MB、首次进 S1 129.81 MB（≤150）
- [ ] 7b 冒烟 008 / 005 / 010 / 007 / 008(art=1) 串行跑
  - 19:38 重启 /tmp/runsmoke-b14.sh：改成等所有无头 Chrome（制作人 queue13 / qa-shots）都退出才起，每项 timeout 1800，跑完自动接 shots-030。日志 /tmp/smoke-b14.log、/tmp/smoke-b14-<tag>.log
- [ ] 9 追加：礁岛塔内石面修复复核（美术 19:14/19:28 直接替换 3 个文件）
  - [x] ① 字节数：env-rock-islet-a.glb 7,442,520 / tex-s3-islet-lightmap.ktx2 1,318,290 / tex-s3-interior-lightmap.ktx2 1,064,440，全对；dist 拷贝同字节
  - [x] ② inspect-s3-islet-floor：塔内 2733 格 LOD0/1/2 高出 0.2 地板 0 格、z-fight(0.168–0.208) 0 格；礁岛顶 0.10；stair-bottom 0.2（室内地板顶 0.195）在地板/礁岛之上。日志 /tmp/b14-islet-floor.log
  - [x] ③ test:lightmap 9 项全过（s3-islet 1.32 MB、s3-interior 1.06 MB）；test:s3 通过（白盒 walk：门内平台→下楼→底层→油阀 / 底层→窗口镜 都落 0.2；桥尾→门外平台→门内平台不掉）。注：S3 美术 GLB 的 -collider 只隐藏不注册（s3/art.ts），碰撞以白盒为准，礁岛碰撞体挖空不影响站立
  - [x] ④ 19:52 从 HEAD 2771b45 重建 dist（之前 19:00 的 dist 是旧礁岛文件）；size：s3 20.58 MB、menu+boot 3.70、common+s1 126.11、首次进 S1 129.81（≤150）；未登记已交付 12 个（s1 4.82 MB、s3 0.95 MB），全接入估首次 134.63 MB
  - [ ] ⑤ shots-029 重截 s3-floor / s3-room / s3-room-doorclosed / s3-islet（lm1），排在 shots-030 之后
  - [ ] ⑥ 冒烟加跑 S3 一项
  - 20:01 bb69b2a：shots-029.mjs 加第 4 参数只截指定机位
- [ ] 10 追加：clifftop UV2 修复复核（美术 19:56 替换 2 个文件）
  - [x] ① 字节：env-clifftop-s2.glb 3,361,480 / tex-s2-clifftop-lightmap.ktx2 1,359,623 对；20:00 从 HEAD 重建 dist（dist 拷贝同字节，礁岛三件也在）
  - [x] ② 9 个 LOD 网格 uv1 全是 Uint16 normalized（KHR_mesh_quantization，extensionsRequired 里有），getX 反归一化后范围 [0.0020, 0.9980]，出 rect / 出 [0.002,0.998] 都是 0。顶点数：lod1_2 21852→21881（+29，美术说 LOD1 +27）、lod2_2 15665→15691（+26）、lod0_2 35876 不变
  - [x] 48e320e：test:lightmap 收紧（出 rect 必须 0；整数 uv1 必须 normalized；补 wrapT ClampToEdge 断言，兜底保留）——18 个 GLB 实际都已是 Uint16-norm，运行时（three r186 GL normalized 属性 + 标准 lightmap 顶点链 / xiMaterials 的 uv1）本来就支持，无运行时代码改动
  - [x] ③ test:s2 通过：白石组 14 块数字石挂崖顶零变换、眼位不挡；动线 / 坡地 / 铁门 ✓。S2 美术 -collider 只隐藏不注册，碰撞以白盒为准
  - [ ] ④ shots-029 s2 lm1 clifftop,court 重截（排队）
- 7b 冒烟（20:11–20:18，dist = 20:00 HEAD 构建）：010 ✓、007 ✓；008 ✗「结束页没回主菜单」（008 / 008 art=1 都挂）；005 ✗「字号切换不对 22px/m ×3」（暂停设置里点 data-size 没生效）→ 待查（怀疑 030 布局：点击点被挡或在视口外），写了 scripts/_probe-b14.mjs 1280×720 量点击点
- [x] 8 shots-030 跑完（20:20–20:26）16 张 + shots-030.json；格线：journal/letter/note/logbook 格线与预测差 ≤0.3px，字底在格线上方 2.8px（不压线）；sketch 无横格（窗框画）、notice 无横格；进 S1 无懒加载请求，打开阅读才请求纸张
- shots-029 s3 lm1 四机位 20:27–20:29 跑完

## 7c 冒烟修复（续）
- 008 / 008a1：根因 1280×720 窗口视口 633 高，结尾页内容 725 高，「回到主菜单」在 y=634 视口外。修：`.chapter-end-art` 宽 `min(840px, 70vw, calc((100vh - 300px) * 16 / 9))` → commit b2069c2。重建 dist 后 008 ✓。
- 005：探针在 testbed 里按冒烟同样流程（Esc 暂停 → openSettings → 100ms → CDP 点击）s/l/m 都生效；单跑 SMOKE_ONLY=v0.1-005 ✓（50s）。先前失败判断为高负载下的偶发（当时 producer 同时在跑浏览器），未改代码。
- 008a1（art=1）重跑 ✓

## 10 ④ 崖顶 / 中庭 lm1 重拍对比
- before-fixr2/ 对现拍：clifftop 平均灰度 99.91→99.90，court 79.21→79.22；|Δ|>12 的像素集中在天空 / 远雾上部两行（雨幕与云动画），下半地面区 4×4 网格每格 ≤410 px，石板地 / 白石组 / 屋体无可见变化，没有新接缝或黑斑。
- 美术 029-s2-fixr2-compare.png 修的是 irradiance 下崖边右下一条黑带；我们的 clifftop 视角那条崖边在画面右下边缘，前后都没有黑带（雾 + 光照混合后本来就不显）。结论：无回归，修复区在我们机位下不显著。

## 11 制作人 batch13 验收追加（steering 3）
### BUG-019 返工 → 629ca5b
- 复现：临时探针 = S2 白盒碰撞 + CharacterBody 胶囊 + 相机球扫 + 限高带，8 路径 × 8 yaw × 俯仰 −15/−30/−40 × 走/跑 = 384 组，60 Hz 改前 15 组超（yaw 270 −15 外走 2.641 m ≈ 制作人 2.63；yaw 315 −15 1.886 m ≈ 1.89；出带恢复 0.60–1.01 m）。
- 根因：①硬限高一帧到位，视线擦过斜天花板时第一碰撞距离突变 4.5→1.9；②过渡区只外扩不压低，同样突变、提前量 0；③恢复 smoothstep 用旧起点，途中目标变大直接按 k 跳过去（回弹 1.89）；远距离恢复峰值超速。
- 改：真实带比当前近 → 24 m/s 收；过渡区天花板再低 0.8 m（heightCapLeadDrop）；恢复每帧 ≤ 21 m/s（3 m 内仍 0.25 s smoothstep，原 0.25 s 测试照过）。物理遮挡立即前拉不变。
- 改后：60 Hz 384 组非物理前拉单帧最大 0.402 m（上限 0.6），30 Hz 0.804（上限 1.2），回弹 0，高过真实限高最多 0.019 m（≤0.02，0 帧超）。制作人用例：yaw270 −15 2.641→0.027；yaw315 −15 1.886→0.027 回弹 0；横出 yaw90 −30 1.010→0.351、−40 0.916→0.351；沿视线出 yaw180 −40 0.736→0.350。新测试在旧代码上 22 组失败（已 stash 验证）。
- 旧 BUG-019 测试仍过（60 Hz）：沿视线进带 0.155、离开 0.371，横入 0.027/0.156/0.156，横出 0.027，斜入跑 0.053 m/帧。
### BUG-020 → b591c5b
- 体积：LevelScene.enter 在 buildLevel 后 collectIndoorShapes(scene) 收所有 -indoor 节点（S2 石屋 + 地窖、S3 塔内；白盒按 layout 生成），局部 OBB；S3 塔节点 userData.indoorRadius = S3.tower.rIn → 竖直圆柱。
- 着色器：line / quad 两种都在顶点里判上端 / 下端，在体积内整条丢到裁剪空间外；溅水落点在体积内不生成。
- 断言（verify-atmo028）：S2 5 内（含 QA 地窖相机位）/ 6 外（西窗外、前门外、地窖门外、东窗外、屋顶上、院子），S3 5 内（含贴内壁）/ 5 外（门外、西窗外、5 m 窗外、方盒角伸出墙外处、塔顶上）；塔内溅水 0、塔外照常。
### 码头船绳 → ac43df5（只补断言，代码已满足）
- applyLightmap 是整根遍历：凡有 uv1 + Standard 材质的网格都挂，不看 _lodN、不看可见性，不设 offset。rope-high 1 个、rope-low 2 个子网格（mat-env-wood-ch1 / mat-env-rope-wet-ch1），全挂 tex-s1-shore-lightmap；切潮 4 次只改可见性。

## 12 031 父亲体积分组（steering 4）→ 8b55558
- size-groups CHAR_SCENE 加 'tex-father': 's3'；verify-assets 单测：char-father.glb / char-father-anims.glb / tex-father-albedo|normal|orm.ktx2 都 → s3，tex-fatherland → s1（整段匹配），art/ 实际 5 个文件也逐个断言。test:assets 29 项全过。
- npm run size：实际 common+s1 126.11 MB 不变、首次 129.81 MB 不变；[预估] 未登记 s1 7.23→3.22 MB、s3 5.78→9.79 MB，全部接入后首场景包 ≈133.34→129.33 MB。
- 父亲实际接入（mixer、hand-on-head 对齐）不在本批。

## 13 收尾验证（HEAD 8b55558）
- npm run check 首跑 EXIT 1：test:fonts 报缺字「积」（Rain.ts 告警字符串）→ 667a38f 改字；重跑 EXIT 0（/tmp/b14-check2.log），dist 由此重建（之后只有 scripts 改动）。
- npm run size ✓：common+s1 126.11/150，首次 129.81/150。
- sample-317（Node）：A=3 B=0 EXIT 0（/tmp/b14-sample317.log）。
- 浏览器冒烟（串行，等 chrome 0 再起）：014 S2 art=1 ✓（/tmp/smoke-b14-014a1.log）、015 S3 art=1 ✓（/tmp/smoke-b14-015a1.log）、003 相机 ✓（/tmp/smoke-b14-003.log）；日志无 shader 报错，雨着色器在浏览器里编译通过。
- 临时 _probe-b14.mjs / _cam19-probe.mjs 已删；uv.json 不在工作区。

## 14 S1 脚印贴花（美术 033，起点 HEAD 8b55558）
- [x] a 路径 json 入库 + 4 块贴花 T1–T4（json 读坐标 / yaw / y，不打射线），roughness 0.65（9eeafc8）
- [x] b 独白触发区移到 T2 中心 r 1.4 + 不重叠断言（9eeafc8；subtitleZones.ts，脚印独白离小径尽头 0.71 m、离沟边 3.16 m、离钟 9.78 m）
- [x] c art=1 隐藏白盒脚印块 s1-footprint-*（9eeafc8）；冒烟 013 断言（ba43a0b）
- [x] d npm run check EXIT 0（HEAD 58a69e3，/tmp/b14-fp-check.log；首跑 lint 报 shots 脚本未用 import、test:fonts 缺「于圆形花」→ 45757d2 报错改英文）；dist 由此重建；size：common+s1 126.10/150（原 126.11，新脚印贴图小 7.7 KB）、首次 129.81/150
- [ ] e 冒烟 013 S1（art=0 / art=1）
- [ ] f 截图 shots-030/footprints-*.png + 对照
- e 冒烟 013 S1：art=0 ✓（21:32–21:34，/tmp/smoke-b14fp-013a0.log；「033 脚印独白：小径尽头不弹、T2 弹 ✓」）；art=1 首跑 ✗「漂回没结束」（负载 19，150 s 墙钟潮位只到 0.9；脚印独白 / 贴花断言之前已过）→ 8ad6b9b 潮汐等待改游戏时间，截图后重跑
- [x] f 截图（58a69e3 dist，shots-footprints.mjs 21:40–22:01，退出码 0）：docs/tasks/shots-030/footprints-{opening,pier,pathend,pathend-off,close,top}.png + footprints.json
  - 贴花 4 块全在 json 坐标、roughness 0.65、白盒脚印暗斑可见 0 块。
  - 对照 033-footprints-proposed-path.jpg：小径尽头往浮台看 / 近景 / 俯视三张和美术一致——深色硬边靴印、有鞋底纹，从小径尽头沿湿沙连成一线走向浮台，不压礁石、不悬空；开 / 关对比清楚。
  - 差别：画面里深色多边形是低潮 0 时海面波浪（4 列波振幅合计最高 0.375 m）漫过 0.1 m 的沙面，随时间移动（pathend 和 pathend-off 同机位两张位置不同）；拍到的那一刻正好盖住 T2–T3 一段，美术那张拍的时刻没盖住。不是贴花问题（贴花 y 0.112–0.119，浪顶高过它时被盖是对的）。是否给 S1 潮间带压浪，归 025 水面。
  - 开场机位（码头尽头跟随相机朝东）本来就看不到脚印（脚印在北边 z 4–8），只作场景无回归确认。
- [x] e 冒烟 013 S1 art=1 重跑 ✓（8ad6b9b，22:01–22:08，/tmp/smoke-b14fp-013a1b.log）：脚印独白小径尽头不弹 / T2 弹、4 块贴花 + 白盒暗斑 10 块全隐藏、船绳 / 美术件全过。art=0 ✓ 见上。
- 14 完成。commit：9eeafc8、ba43a0b、45757d2、58a69e3、8ad6b9b
