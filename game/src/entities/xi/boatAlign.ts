import * as THREE from 'three';
import { XI_FPS } from './clips';

/**
 * 开场 / 结尾演出用的小船对位接口（017 收尾；演出本身归 v0.1-035「开场演出」，当前版本单子里没有可玩的上船 / 划船）。
 * 只依赖 three，Node 单测直接导入（verify-xi 用真 GLB 校验）。
 *
 * - 划船 xi-row-boat：clip 原点 = 船上 `prop-boat-rowboat-seat` 节点（船底踏板面、+Z 朝船尾 = 汐面朝方向，座面 = 原点 + 0.35）。
 *   桨架 `-oarlock-l / -r` = extras.align.rowing.oarlockL / R（汐局部 [±0.56, 0.525, 0.22]）；每帧桨角 yawDegPerFrame / pitchDegPerFrame（91 个值，循环）。
 * - 系船 xi-tie-boat：clip 根 = 码头 `env-pier-wood-ch1-boat-mooring`（桥面上、+Z 朝 +X 侧系船桩，桩中心在正前方 0.37 m）。
 */
export const XI_BOAT_NODES = {
  seat: 'prop-boat-rowboat-seat',
  oarlockL: 'prop-boat-rowboat-oarlock-l',
  oarlockR: 'prop-boat-rowboat-oarlock-r',
  bowRing: 'prop-boat-rowboat-bow-ring',
  mooring: 'env-pier-wood-ch1-boat-mooring',
  postTop: 'env-pier-wood-ch1-mooring-post-top',
} as const;

/** extras.align.rowing（anims.glb xi-row-boat clip.userData.align.rowing）里用到的字段 */
export interface XiRowingAlign {
  seatTop: number;
  oarlockL: readonly number[];
  oarlockR: readonly number[];
  yawDegPerFrame: readonly number[];
  pitchDegPerFrame: readonly number[];
}

/** 按原始节点名找（GLTFLoader 会把重名改成 `_1`，原名在 userData.name） */
export function findArtNode(root: THREE.Object3D, name: string): THREE.Object3D | null {
  let hit: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!hit && (o.userData.name === name || o.name === name)) hit = o;
  });
  return hit;
}

/** 划船座位锚点（= xi-row-boat 原点）；没有该节点 = null */
export const rowerSeat = (boat: THREE.Object3D): THREE.Object3D | null => findArtNode(boat, XI_BOAT_NODES.seat);
/** 系船站位锚点（= xi-tie-boat 根）；没有该节点 = null */
export const tieBoatStand = (pier: THREE.Object3D): THREE.Object3D | null => findArtNode(pier, XI_BOAT_NODES.mooring);
/** 桨架转轴（她的左 = oarlock-l） */
export const oarlock = (boat: THREE.Object3D, side: 'l' | 'r'): THREE.Object3D | null =>
  findArtNode(boat, side === 'l' ? XI_BOAT_NODES.oarlockL : XI_BOAT_NODES.oarlockR);

const m4 = new THREE.Matrix4();
const sc = new THREE.Vector3();

/**
 * 把汐（模型根 / 角色实体的 object3D）对到锚点：世界位置 + 朝向 = 锚点，缩放保持。
 * 船在动（划船）时每帧调一次即可；anchor 的 matrixWorld 会先更新。
 */
export function alignXiTo(xi: THREE.Object3D, anchor: THREE.Object3D): void {
  anchor.updateWorldMatrix(true, false);
  m4.copy(anchor.matrixWorld);
  if (xi.parent) {
    xi.parent.updateWorldMatrix(true, false);
    m4.premultiply(new THREE.Matrix4().copy(xi.parent.matrixWorld).invert());
  }
  const s = xi.scale.clone();
  m4.decompose(xi.position, xi.quaternion, sc);
  xi.scale.copy(s);
  xi.updateMatrixWorld(true);
}

/** 第 t 秒（循环 3 s）的桨角（度），帧间线性插值 */
export function rowingAngles(align: XiRowingAlign, t: number): { yawDeg: number; pitchDeg: number } {
  const n = Math.min(align.yawDegPerFrame.length, align.pitchDegPerFrame.length);
  if (n < 2) return { yawDeg: align.yawDegPerFrame[0] ?? 0, pitchDeg: align.pitchDegPerFrame[0] ?? 0 };
  const period = (n - 1) / XI_FPS;
  const f = ((((t % period) + period) % period) * XI_FPS) % (n - 1);
  const i = Math.floor(f);
  const k = f - i;
  const lerp = (a: readonly number[]): number => (a[i] ?? 0) * (1 - k) + (a[i + 1] ?? 0) * k;
  return { yawDeg: lerp(align.yawDegPerFrame), pitchDeg: lerp(align.pitchDegPerFrame) };
}

/**
 * 桨手柄方向（汐局部，单位向量；README 约定）：左桨 (−cos y·cos p, sin p, sin y·cos p)，右桨 x 取反。
 * 桨叶在反方向：桨杆 = 桨架 − dir·outboard … 桨架 + dir·inboard。
 */
export function oarHandleDir(yawDeg: number, pitchDeg: number, side: 'l' | 'r', out = new THREE.Vector3()): THREE.Vector3 {
  const y = THREE.MathUtils.degToRad(yawDeg);
  const p = THREE.MathUtils.degToRad(pitchDeg);
  out.set(-Math.cos(y) * Math.cos(p), Math.sin(p), Math.sin(y) * Math.cos(p));
  if (side === 'r') out.x = -out.x;
  return out;
}
