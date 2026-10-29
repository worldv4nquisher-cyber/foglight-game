import type { AssetGroup } from '@/assets/manifest';

/**
 * 第一章三个场景（v0.1-010，GDD §6）：场景名、存档 ID、资源组、下一个场景。
 * 线性推进 S1 → S2 → S3，不能往回走（GDD §6 动线），所以离开一个场景就可以释放它的资源组。
 */
export type LevelId = 's1' | 's2' | 's3';
export type LevelSceneName = 's1-ebb-shore' | 's2-keeper-house' | 's3-lighthouse';

export interface LevelDef {
  /** 存档里的 sceneId */
  id: LevelId;
  /** SceneManager 注册名 */
  scene: LevelSceneName;
  /** 场景专属资源组（common 另外随首场景加载、常驻） */
  group: AssetGroup;
  /** 进入后在后台预加载的下一个场景（GDD §14：S2 / S3 后台流式预加载） */
  next: LevelId | null;
  /** 默认入口点 id（模型 / 白盒里的 `<名>-spawn-<id>` 节点） */
  defaultEntry: string;
}

export const LEVELS: Record<LevelId, LevelDef> = {
  s1: { id: 's1', scene: 's1-ebb-shore', group: 's1', next: 's2', defaultEntry: 'start' },
  s2: { id: 's2', scene: 's2-keeper-house', group: 's2', next: 's3', defaultEntry: 'from-s1' },
  s3: { id: 's3', scene: 's3-lighthouse', group: 's3', next: null, defaultEntry: 'from-s2' },
};

export const LEVEL_LIST: readonly LevelDef[] = [LEVELS.s1, LEVELS.s2, LEVELS.s3];

export function isLevelId(id: string): id is LevelId {
  return id === 's1' || id === 's2' || id === 's3';
}

export function levelByScene(scene: string): LevelDef | null {
  return LEVEL_LIST.find((l) => l.scene === scene) ?? null;
}

/**
 * 存档 sceneId → 关卡。010 之前的存档 sceneId 是 'main'（demo 灰盒 = S1 入口），按 S1 读；
 * 认不出的 ID 也回到 S1 开头（不崩溃，GDD §11）。
 */
export function levelForSave(sceneId: string): LevelDef {
  return isLevelId(sceneId) ? LEVELS[sceneId] : LEVELS.s1;
}
