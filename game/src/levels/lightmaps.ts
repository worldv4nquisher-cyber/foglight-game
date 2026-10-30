// v0.1-029 关卡侧光照贴图参数（开门角相关；美术 / 制作人可调）
//   塔门、地窖门都是按开门 −100° 烘的；关门时室内光照贴图按门角平滑压暗到 closed 倍。
//   烘焙没出关门版，这两个数是程序估的（塔底只剩高窗 → 0.6；地窖只剩楼梯口顶上的屋内光 → 0.55）。

/** S3 塔门全关时塔内（env-lighthouse-ch1-interior + env-lamp-room-ch1）光照贴图倍率 */
export const S3_TOWER_CLOSED_LM = 0.6;
/** S2 地窖门全关时室内光照贴图倍率（只作用 env-cellar-s2 那一段，屋里不变） */
export const S2_CELLAR_CLOSED_LM = 0.55;
