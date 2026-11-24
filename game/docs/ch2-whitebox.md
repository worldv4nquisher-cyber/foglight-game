# 裂湾村 · 白盒阅览

只供开发和测试构建审阅，不写存档，不从第一章的菜单、关卡或结尾进入。GitHub Pages 的生产构建不包含白盒。

在 `game/` 运行 `npm run dev`，然后打开：

| 场景 | 可走入口 | 固定镜头 `view` |
|---|---|---|
| 峡口与船骸 | `/?quality=low&ch2-whitebox=s1` | `overview` / `dock` / `market` |
| 镜巷 | `/?quality=low&ch2-whitebox=s2` | `overview` / `plaza` |
| 崖顶与礁柱灯塔 | `/?quality=low&ch2-whitebox=s3` | `overview` / `cable` |

固定镜头在入口 URL 后追加相应的 `&view=overview` 等参数。去掉 `view` 即可步行。S1 沿码头的楼梯登船，E 进入 S2；S2 从甲板西侧过栈桥，沿四段折返梯上崖，E 进入 S3；S3 靠近缆车站按 E 跨到礁柱（白盒跨越替代，不是货运缆车实现），再走塔内螺旋坡道上灯室。三处采用同一世界坐标，共用峡谷、北鲱号和塔礁。

鱼闸、吊鱼箱、镜巷传光、缆车配重和半盏灯均为标牌及几何占位，不会解谜、不分光、不推进剧情。
