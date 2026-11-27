import type { AssetGroup } from '@/assets/manifest';

/**
 * 第一章与第二章可玩场景：场景名、存档 ID、资源组、下一个场景。
 */
export type LevelId = 's1' | 's2' | 's3' | 'ch2-s1' | 'ch2-s2' | 'ch2-s3';
export type LevelSceneName =
  | 's1-ebb-shore'
  | 's2-keeper-house'
  | 's3-lighthouse'
  | 'ch2-harbour'
  | 'ch2-mirror-alley'
  | 'ch2-lighthouse';

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
  /** 场景曲（manifest 音频 key，033；S2 1031 接入）：进场时从上一首 2 s 交叉淡化；null = 没有场景曲（进场时上一首 2 s 淡出） */
  music: string | null;
  /** 1031：和 music 同步循环的上层（S3 紧张层）：同时起播、样本对齐，增益由场景 musicUpperGain() 每帧给 */
  musicUpper?: string;
}

export const LEVELS: Record<LevelId, LevelDef> = {
  s1: { id: 's1', scene: 's1-ebb-shore', group: 's1', next: 's2', defaultEntry: 'start', music: 'mus-s1-ebb-shore' },
  s2: { id: 's2', scene: 's2-keeper-house', group: 's2', next: 's3', defaultEntry: 'from-s1', music: 'mus-s2-keeper-house' },
  s3: { id: 's3', scene: 's3-lighthouse', group: 's3', next: null, defaultEntry: 'from-s2', music: 'mus-s3-lighthouse', musicUpper: 'mus-s3-lighthouse-upper' },
  'ch2-s1': { id: 'ch2-s1', scene: 'ch2-harbour', group: 'ch2-s1', next: 'ch2-s2', defaultEntry: 'start', music: null },
  'ch2-s2': { id: 'ch2-s2', scene: 'ch2-mirror-alley', group: 'ch2-s2', next: 'ch2-s3', defaultEntry: 'from-s1', music: null },
  'ch2-s3': { id: 'ch2-s3', scene: 'ch2-lighthouse', group: 'ch2-s3', next: null, defaultEntry: 'from-s2', music: null },
};

/** 主菜单曲（033 定稿，menu 组） */
export const MENU_MUSIC = 'mus-menu';

export const LEVEL_LIST: readonly LevelDef[] = [
  LEVELS.s1,
  LEVELS.s2,
  LEVELS.s3,
  LEVELS['ch2-s1'],
  LEVELS['ch2-s2'],
  LEVELS['ch2-s3'],
];

export function isLevelId(id: string): id is LevelId {
  return id === 's1' || id === 's2' || id === 's3' || id === 'ch2-s1' || id === 'ch2-s2' || id === 'ch2-s3';
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
