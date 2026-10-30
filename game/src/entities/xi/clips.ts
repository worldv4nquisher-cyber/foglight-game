/**
 * 汐的动画 clip 表（v0.1-017，char-xi-anims.glb：31 个 clip（需求单 28 + 需求单外 3 个，见 XI_CLIP_OFF_TICKET），30 fps，原地动画，朝向 +Z）。
 * 数值抄自 art/models/characters/README.md 与 GLB 的 animations[].extras；scripts/verify-xi.mjs 逐项比对 GLB，
 * 不一致时以 GLB 为准（改这里）。运行时 clip 名以 anims.glb 实际名字为准：美术统一命名前的旧名放在 XI_CLIP_ALIASES。
 * 本文件不依赖 three / DOM，Node 单测直接导入。
 */
export const XI_FPS = 30;

export interface XiClipSpec {
  /** 帧数（含收尾帧；循环 clip 的最后一帧 = 第一帧） */
  frames: number;
  loop: boolean;
  /** 事件帧（extras.eventFrames） */
  events?: Readonly<Record<string, number>>;
  /** 移动类：步幅速度（m/s，extras.strideSpeed）与两步周期长度（m） */
  strideSpeed?: number;
  strideM?: number;
  /** 楼梯：竖直速度（m/s，extras.vertSpeed） */
  vertSpeed?: number;
  /** 转身：root 骨偏航（°）与转完帧 */
  rootYawDeg?: number;
  rootYawEndFrame?: number;
  /** 根运动平移（m，汐局部 +Z） */
  rootTranslateZ?: number;
  /** 提灯类 */
  lantern?: boolean;
}

export const XI_CLIP_SPECS = {
  'xi-idle': { frames: 211, loop: true },
  'xi-idle-lantern': { frames: 151, loop: true, lantern: true },
  'xi-walk': { frames: 25, loop: true, strideSpeed: 1.6, strideM: 1.28 },
  'xi-walk-lantern': { frames: 25, loop: true, strideSpeed: 1.6, strideM: 1.28, lantern: true },
  'xi-jog': { frames: 19, loop: true, strideSpeed: 3.2, strideM: 1.92 },
  'xi-jog-lantern': { frames: 19, loop: true, strideSpeed: 3.2, strideM: 1.92, lantern: true },
  'xi-turn-l90': { frames: 41, loop: false, rootYawDeg: 90, rootYawEndFrame: 34 },
  'xi-turn-r90': { frames: 41, loop: false, rootYawDeg: -90, rootYawEndFrame: 34 },
  'xi-stairs-up': { frames: 23, loop: true, strideSpeed: 0.7091, vertSpeed: 0.5455 },
  'xi-stairs-down': { frames: 23, loop: true, strideSpeed: 0.7091, vertSpeed: -0.5455 },
  'xi-step-across': { frames: 49, loop: false, events: { leftOff: 8, leftLand: 22, rightOff: 25, rightLand: 42 }, rootTranslateZ: 0.85 },
  'xi-push-start': { frames: 37, loop: false, events: { handsOn: 26 } },
  'xi-push-loop': { frames: 37, loop: true, strideSpeed: 0.8, strideM: 0.96 },
  'xi-push-end': { frames: 37, loop: false, events: { handsOff: 6 } },
  'xi-ring-bell': { frames: 61, loop: false, events: { touch: 22, ring: 30 } },
  'xi-place': { frames: 71, loop: false, events: { set: 44, release: 48 }, lantern: true },
  'xi-pickup': { frames: 78, loop: false, events: { grab: 22, lift: 24 }, lantern: true },
  'xi-place-table': { frames: 55, loop: false, events: { set: 30, release: 34 }, lantern: true },
  'xi-pickup-table': { frames: 65, loop: false, events: { grab: 20, lift: 22 }, lantern: true },
  // S2 地窖木架取钥匙（架面 1.10 m，钥匙正前 0.45 m、偏右 5 cm）；grab 帧把钥匙挂 middle_03_r
  'xi-pickup-shelf': { frames: 81, loop: false, events: { grab: 22, lift: 25 } },
  'xi-operate-loop': { frames: 73, loop: true },
  'xi-valve-hold': { frames: 91, loop: false, events: { grip: 14, turnStart: 16, turnEnd: 76, release: 80 } },
  'xi-ignite-lever': { frames: 46, loop: false, events: { grip: 15, pullStart: 22, ignite: 34 }, lantern: true },
  'xi-read-loop': { frames: 121, loop: true },
  'xi-look-up': { frames: 151, loop: false, events: { upReached: 44, lookDown: 108 } },
  'xi-observe': { frames: 121, loop: true },
  'xi-shiver': { frames: 91, loop: false, events: { shiverStart: 10, shiverEnd: 66 } },
  'xi-row-boat': { frames: 91, loop: true, events: { catch: 0, finish: 33, bladeOut: 38, bladeIn: 86 } },
  'xi-tie-boat': { frames: 166, loop: false, events: { ropeAround1: 44, ropeAround2: 92, hitch: 118, tug: 130, tied: 134 } },
  'xi-sit-write': { frames: 121, loop: true, events: { penDown1: 0, penUp1: 42, penDown2: 54, penUp2: 96 } },
  'xi-stand-gaze': { frames: 181, loop: true },
} as const satisfies Record<string, XiClipSpec>;

export type XiClipName = keyof typeof XI_CLIP_SPECS;
export const XI_CLIP_NAMES = Object.keys(XI_CLIP_SPECS) as XiClipName[];

/**
 * 需求单（art/tools/verify-xi-anims.mjs 的 TICKET，batch 1–3 共 28 个）以外、美术另交的 clip 清单（batch15 D 核对）。
 * status：used = 游戏代码在用（uses 写调用处）；unused-keep = 没用到、保留不删。scripts/verify-xi.mjs 扫 src 核对 status 与实际引用一致。
 * 注：verify-xi-anims.mjs 默认 --batch=1，EXTRA_OK 登记在 batch 2，所以不带参数跑会把这 3 个报成「工单里没有的 clip」；
 * 带 --batch=3 跑全部通过（美术工具，不改）。
 */
export const XI_CLIP_OFF_TICKET = {
  'xi-pickup-table': { status: 'used', uses: ['s2/puzzles.ts 书桌上拿提灯（onDesk 时代替 xi-pickup）', 'xi-pickup-shelf 缺失时的 fallback'] },
  'xi-place-table': { status: 'used', uses: ['s2/puzzles.ts 书桌放提灯 desk-lantern-s2（release 第 34 帧放下）'] },
  'xi-pickup-shelf': { status: 'used', uses: ['s2/puzzles.ts 地窖架子拿钥匙（env-cellar-s2-shelf-interact，grab 第 22 帧挂钥匙骨）'] },
} as const satisfies Partial<Record<string, { status: 'used' | 'unused-keep'; uses: readonly string[] }>>;

/**
 * 运行时 clip 缺失时的代替（旧版 anims.glb 没有 xi-pickup-shelf → 用 pickup-table，grab 帧 20 vs 22）。
 */
export const XI_CLIP_FALLBACK: Partial<Record<XiClipName, XiClipName>> = { 'xi-pickup-shelf': 'xi-pickup-table' };
/** 交互代码里统一用的 clip 名 */
export type XiAnyClip = XiClipName;

/** 美术统一命名前的旧名（anims.glb 里如果还是旧名，按旧名取） */
export const XI_CLIP_ALIASES: Partial<Record<XiAnyClip, readonly string[]>> = {
  'xi-ignite-lever': ['xi-pull-lever'],
};

export const xiSpec = (name: XiClipName): XiClipSpec => XI_CLIP_SPECS[name];

/** clip 时长（s）= (帧数 − 1) / 30 */
export const xiClipDuration = (name: XiAnyClip): number => (xiSpec(name).frames - 1) / XI_FPS;

/** 事件帧 → 秒；没有这个事件返回 null */
export function xiEventSec(name: XiAnyClip, event: string): number | null {
  const f = xiSpec(name).events?.[event];
  return f === undefined ? null : f / XI_FPS;
}

// ---------------------------------------------------------------- 播放率（防滑步）

export interface LocoBlend {
  idle: number;
  walk: number;
  jog: number;
  /** 各 clip 的 timeScale */
  walkRate: number;
  jogRate: number;
}

const WALK = XI_CLIP_SPECS['xi-walk'];
const JOG = XI_CLIP_SPECS['xi-jog'];
/** 起步 / 停步：0 → FULL_WALK_AT m/s 之间 idle 与 walk 交叉；walk 播放率最低 MIN_RATE（更慢时脚会略滑，只在起停的一瞬） */
const FULL_WALK_AT = 0.5;
const IDLE_BELOW = 0.05;

/**
 * 按水平速度 s（m/s）算 idle / walk / jog 权重与播放率（017：1.6 / 3.2 m/s 无滑步）：
 * - s ≥ 0.5 时「脚下速度」Σ w·rate·stride/周期 = s（verify-xi 断言）；
 * - 1.6–3.2 之间走 / 跑按同一步频播放（两步周期从 1.28 m 线性过渡到 1.92 m），左右脚落地相位一致（walk 0 / 12 of 24，jog 0 / 9 of 18）。
 */
export function locoBlend(s: number, out: LocoBlend = { idle: 1, walk: 0, jog: 0, walkRate: 1, jogRate: 1 }): LocoBlend {
  const ws = WALK.strideSpeed;
  const js = JOG.strideSpeed;
  const walkDur = (WALK.frames - 1) / XI_FPS;
  const jogDur = (JOG.frames - 1) / XI_FPS;
  if (s < IDLE_BELOW) {
    out.idle = 1;
    out.walk = out.jog = 0;
    out.walkRate = FULL_WALK_AT / ws;
    out.jogRate = 1;
    return out;
  }
  if (s <= ws) {
    const k = Math.min(1, s / FULL_WALK_AT);
    out.idle = 1 - k;
    out.walk = k;
    out.jog = 0;
    out.walkRate = Math.max(s, FULL_WALK_AT) / ws;
    out.jogRate = (out.walkRate * jogDur) / walkDur;
    return out;
  }
  out.idle = 0;
  if (s >= js) {
    out.walk = 0;
    out.jog = 1;
    out.jogRate = s / js;
    out.walkRate = (out.jogRate * walkDur) / jogDur;
    return out;
  }
  const k = (s - ws) / (js - ws);
  const stride = WALK.strideM + (JOG.strideM - WALK.strideM) * k;
  const freq = s / stride; // 两步周期 / s
  out.walk = 1 - k;
  out.jog = k;
  out.walkRate = freq * walkDur;
  out.jogRate = freq * jogDur;
  return out;
}

/** 混合后脚下的地面速度（m/s）：Σ w · rate · strideSpeed（单测用） */
export function locoGroundSpeed(b: LocoBlend): number {
  const w = b.walk + b.jog + b.idle;
  if (w <= 0) return 0;
  return (b.walk * b.walkRate * WALK.strideSpeed + b.jog * b.jogRate * JOG.strideSpeed) / w;
}

/**
 * 起步 / 停步防滑步（batch8）：移动层（idle / walk / jog 之间）权重淡化时间（s）。
 * 控制器 0.12 s 加速到位，原来沿用通用 FADE 0.2 s 时权重跟不上速度，起步瞬间脚下比地面慢最多 0.67 m/s（走）/ 1.53 m/s（跑）。
 * 从动作 / 循环回到移动层仍用 0.2 s。
 */
export const LOCO_FADE = 0.1;
/** 起停瞬间播放率补偿上限（倍）：权重还没到位时把 walk / jog 播放率放大 / 缩小，最多这么多倍 */
export const LOCO_RATE_COMP_MAX = 1.5;

/**
 * 权重还在淡化时的播放率补偿系数 k（walk / jog 的 timeScale 同乘 k，相位锁定不变）：
 * 让实际权重下的脚下速度 Σ w·rate·strideSpeed / max(1, Σw) 尽量等于根速度 s；稳态（权重 = 目标）时 k = 1。
 * s < 0.05（停下）不补偿。
 */
export function locoRateComp(s: number, w: { idle: number; walk: number; jog: number }, b: LocoBlend): number {
  if (s < IDLE_BELOW) return 1;
  const got = (w.walk * b.walkRate * WALK.strideSpeed + w.jog * b.jogRate * JOG.strideSpeed) / Math.max(1, w.idle + w.walk + w.jog);
  if (got < 1e-6) return 1;
  return Math.min(LOCO_RATE_COMP_MAX, Math.max(1 / LOCO_RATE_COMP_MAX, s / got));
}

/** 楼梯：按实际水平速度（m/s）同步 stairs-up/down 播放率（clip 水平 0.7091 / 竖直 0.5455 m/s） */
export const stairsRate = (horizontalSpeed: number): number => horizontalSpeed / XI_CLIP_SPECS['xi-stairs-up'].strideSpeed;

/** 推浮台：按实际推动速度同步 push-loop 播放率（clip 0.8 m/s；004 实测 0.812） */
export const pushRate = (speed: number): number => speed / XI_CLIP_SPECS['xi-push-loop'].strideSpeed;

/**
 * step-across 的根运动（hips 沿 +Z，smoothstep 覆盖整个 clip）：t 秒时已前进的距离（m）。
 * total 默认取 README / extras 的 0.85 m；运行时用 clip 里 hips 轨道实测的值（measureRootZ）——
 * anims.glb 是原地的（extras.rootMotion.inPlace = true，hips 首尾差 0）→ 抵消量 0；同一条曲线也是跨越路径的水平位移（XI_STEP_ACROSS）。
 */
export function stepAcrossRootZ(t: number, total: number = XI_CLIP_SPECS['xi-step-across'].rootTranslateZ): number {
  const s = XI_CLIP_SPECS['xi-step-across'];
  const u = Math.min(1, Math.max(0, (t * XI_FPS) / (s.frames - 1)));
  return total * u * u * (3 - 2 * u);
}

/** 从 hips.position 轨道（扁平 xyz 数组）实测首尾 z 差；< 2 cm 视为原地（0） */
export function measureRootZ(values: ArrayLike<number> | null): number {
  if (!values || values.length < 6) return 0;
  const dz = (values[values.length - 1] ?? 0) - (values[2] ?? 0);
  return Math.abs(dz) < 0.02 ? 0 : dz;
}

// ---------------------------------------------------------------- 交互动作

/**
 * 交互动作的「生效」事件帧（v0.1-017）：拿起 = grab（物体挂到手上）、放下 = release（物体留在 socket）、
 * 敲钟 = ring（钟声 + 摆动）、拉杆 = ignite（lighthouse:ignited）、阀门 = turnStart（hold 圆环从这帧开始计）、系船 = tied。
 */
export const XI_INTERACT_EVENT: Partial<Record<XiClipName, string>> = {
  'xi-place': 'release',
  'xi-place-table': 'release',
  'xi-pickup': 'grab',
  'xi-pickup-table': 'grab',
  'xi-pickup-shelf': 'grab',
  'xi-ring-bell': 'ring',
  'xi-ignite-lever': 'ignite',
  'xi-valve-hold': 'turnStart',
  'xi-tie-boat': 'tied',
  'xi-step-across': 'rightLand',
};

/** 交互动作生效时间（s）：没登记事件的 clip = 播完 */
export function xiInteractEventSec(name: XiClipName): number {
  const ev = XI_INTERACT_EVENT[name];
  return (ev ? xiEventSec(name, ev) : null) ?? xiClipDuration(name);
}

/** 字符串（GLB 节点 extras.anim 等）→ clip 名；不认识返回 null */
export function asXiClip(v: unknown): XiClipName | null {
  if (typeof v !== 'string') return null;
  if (v in XI_CLIP_SPECS) return v as XiClipName;
  for (const [k, olds] of Object.entries(XI_CLIP_ALIASES)) if (olds?.includes(v)) return k as XiClipName;
  return null;
}

/** 交互站位离 socket 的水平距离（m）：灯台 0.65（extras.align.lanternSocket，返工 1029）、桌面 0.45 */
export const XI_SOCKET_STAND = { stand: 0.65, table: 0.45 } as const;

/**
 * 美术交互点节点上的 anim（GLB extras.anim → userData.anim）：在美术根节点里按名字找，找不到 / 不认识 → fallback。
 * 返回函数：美术是异步加载的（art=1），每次触发时再查。
 */
export function nodeAnim(
  root: { getObjectByName(name: string): { userData: Record<string, unknown> } | undefined } | null | undefined,
  nodeName: string,
  fallback: XiClipName | null,
): () => XiClipName | null {
  return () => asXiClip(root?.getObjectByName(nodeName)?.userData.anim) ?? fallback;
}

/** xi-pickup-shelf 的 grab 帧把钥匙挂到这根骨骼（中指末节；extras.align.keyShelf.attachBone，verify-xi 比对） */
export const XI_KEY_BONE = 'middle_03_r';

/**
 * 地窖钥匙 prop-key-cellar-s2 挂到 middle_03_r 的局部变换（key.matrix = middle_03_r.matrixWorld × attach，缩放 1）。
 * 运行时从钥匙根节点 extras.attach 读；这份只是缺省 / 校验（verify-xi 比对 GLB）。
 */
export const XI_KEY_ATTACH = {
  translation: [-0.00843, 0.02492, 0.00414] as const,
  rotation: [0.04513, -0.26586, 0.96208, 0.04104] as const,
};

/**
 * 读挂点变换：传 userData（GLB 节点 extras）或 Object3D（在子树里找第一个带 userData.attach 的节点——
 * GLTFLoader 的场景组和根节点同名，extras 在根节点上）；缺 / 格式不对 → XI_KEY_ATTACH
 */
export function readKeyAttach(
  src: Record<string, unknown> | { traverse(cb: (o: { userData: Record<string, unknown> }) => void): void } | undefined,
): { translation: readonly number[]; rotation: readonly number[]; fromGlb: boolean } {
  let userData: Record<string, unknown> | undefined;
  if (src && typeof (src as { traverse?: unknown }).traverse === 'function') {
    (src as { traverse(cb: (o: { userData: Record<string, unknown> }) => void): void }).traverse((o) => {
      if (!userData && o.userData.attach) userData = o.userData;
    });
  } else userData = src;
  const a = userData?.attach as { translation?: unknown; rotation?: unknown } | undefined;
  const ok = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every((x) => typeof x === 'number' && Number.isFinite(x));
  if (a && ok(a.translation, 3) && ok(a.rotation, 4)) return { translation: a.translation, rotation: a.rotation, fromGlb: true };
  return { translation: XI_KEY_ATTACH.translation, rotation: XI_KEY_ATTACH.rotation, fromGlb: false };
}

/**
 * step-across 的跨越几何（anims.glb extras：rootMotion.inPlace = true、translateM [0,0,0.85]、profile smoothstep；gap near 0.20 / far 0.70）：
 * clip 原地，游戏沿 TraversalLink 前移，进度曲线 smoothstep 覆盖第 0–48 帧（TraversalLink.sample 同一条曲线、
 * XiAnimator 按跨越进度映射 clip 时间）→ 水平位移 = span · smoothstep(帧 / 48)。
 *
 * 制作人拍板（落点离任何边沿 ≥ 0.30 m）：美术原设「缝前 0.20 m 起跳、前移 0.85 m」落点只离远沿 0.15 m。
 * 做法：先把起跳点往缝沿挪（不缩放、零滑步），但起跳脚尖（toe 骨，第 0 帧在根前 toeLeadM）至少留在台面上 takeoffToeMarginM；
 * 挪到底还不够时，再把路径位移按实际距离缩放（span / 0.85），多出来的量按同一条 smoothstep 摊开。
 * S1 的 0.5 m 缝：起跳点离近沿 0.15 m，落点离远沿 0.32 m，span 0.97 m（×1.14，支撑脚滑移约 6 cm / 0.8 s）。
 */
export const XI_STEP_ACROSS = {
  translateM: 0.85,
  gapNearM: 0.2,
  gapFarM: 0.7,
  /** 第 0 帧前脚 toe 骨在根前的距离（char-xi-anims.glb 实测 0.124 m，verify-xi 核对） */
  toeLeadM: 0.124,
  /** 起跳时 toe 骨离近沿至少留这么多（脚掌不悬空） */
  takeoffToeMarginM: 0.026,
  /** 落点（根 / 胶囊中心）离远沿至少（制作人 ≥ 0.30，留 2 cm 给浮台位置误差） */
  landMarginM: 0.32,
} as const;

export interface StepAcrossSpan {
  start: number;
  end: number;
  /** 路径水平位移 / translateM（1 = 不缩放） */
  scale: number;
  /** 起点离近沿 / 落点离远沿（m） */
  takeoffInset: number;
  landMargin: number;
}

/**
 * 沿一维方向（dir = ±1）跨过 [nearEdge, farEdge] 这道缝（farEdge = nearEdge + dir · 缝宽）：返回起点 / 终点坐标与缩放。
 * 只给 nearEdge 时缝宽 = gapFarM − gapNearM（美术原设 0.5 m）。
 */
export function stepAcrossSpan(nearEdge: number, dir: 1 | -1, farEdge: number = nearEdge + dir * (XI_STEP_ACROSS.gapFarM - XI_STEP_ACROSS.gapNearM)): StepAcrossSpan {
  const g = XI_STEP_ACROSS;
  const gap = Math.abs(farEdge - nearEdge);
  const minInset = g.toeLeadM + g.takeoffToeMarginM;
  // 不缩放时为了落点留够 landMargin 需要的起跳内缩；不超过美术原设 gapNearM
  const want = g.translateM - gap - g.landMarginM;
  let inset: number;
  let span: number;
  if (want >= minInset) {
    inset = Math.min(g.gapNearM, want);
    span = g.translateM;
  } else {
    inset = minInset;
    span = inset + gap + g.landMarginM;
  }
  const start = nearEdge - dir * inset;
  const end = start + dir * span;
  return { start, end, scale: span / g.translateM, takeoffInset: inset, landMargin: span - inset - gap };
}
