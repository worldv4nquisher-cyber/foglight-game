import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';
import { ATMO028, type Atmo028Tier } from '@/config/atmosphere028';

/** 上限 = 极致档 rainParticles.count（style-guide §8 / 028：30k） */
const MAX_DROPS = 30000;
/** 028 雨丝 / 溅水贴图 key（manifest common） */
export const RAIN_STREAK_KEY = ATMO028.textures.rainStreak;
export const RAIN_SPLASH_KEY = ATMO028.textures.rainSplash;
/** 溅水序列帧：4×4 共 16 帧（gen_tex_atmosphere.py rain_splash：侧视，底部中心 = 落点） */
const SPLASH_GRID = 4;
const SPLASH_FRAMES = SPLASH_GRID * SPLASH_GRID;

type TierCfg = (typeof ATMO028.rainTiers)[Atmo028Tier];

/** 固定种子随机（每次进场雨的分布一样，截图可复现） */
function rng(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** 室内体积上限（S2 石屋 + 地窖、S3 塔内、testbed 房间；超出的忽略并告警） */
const MAX_INDOOR = 8;

/** 雨滴循环平铺 + 距离淡出（line / quad 共用；照搬 atmo028.js makeRain） */
const COMMON = /* glsl */ `
uniform float uTime, uSpeed, uTilt;
uniform vec3 uCenter;
uniform vec2 uArea;
uniform vec4 uFade;
uniform vec2 uBoost[5];
uniform mat4 uIndoorInv[${MAX_INDOOR}];
uniform vec4 uIndoorHalf[${MAX_INDOOR}];
uniform int uIndoorN;
// BUG-020：点在任一室内体积里（局部空间：w = 0 轴对齐盒半尺寸 xyz；w = 1 竖直圆柱，x = 半径、y = 半高）
bool indoorAt(vec3 p) {
  for (int i = 0; i < ${MAX_INDOOR}; i++) {
    if (i >= uIndoorN) break;
    vec3 l = (uIndoorInv[i] * vec4(p, 1.0)).xyz;
    vec4 h = uIndoorHalf[i];
    if (h.w > 0.5 ? (length(l.xz) < h.x && abs(l.y) < h.y) : all(lessThan(abs(l), h.xyz))) return true;
  }
  return false;
}
vec3 dropPos(vec4 sd, float w) {
  float S = uArea.x, H = uArea.y;
  vec3 p;
  p.x = mod(sd.x - uCenter.x, S) - S * 0.5 + uCenter.x;
  p.z = mod(sd.z - uCenter.z, S) - S * 0.5 + uCenter.z;
  p.y = mod(sd.y - uTime * uSpeed, H) + uCenter.y - H * 0.4;
  p.x += w * uTilt;
  p.y -= w;
  return p;
}
float boostAt(float d) {
  float k = uBoost[4].y;
  for (int i = 3; i >= 0; i--) {
    if (d < uBoost[i + 1].x) k = mix(uBoost[i].y, uBoost[i + 1].y, clamp((d - uBoost[i].x) / max(uBoost[i + 1].x - uBoost[i].x, 1e-3), 0.0, 1.0));
  }
  return k;
}
float fadeAt(float d) {
  return smoothstep(uFade.w, uFade.z, d) * smoothstep(uFade.x, uFade.y, d) * boostAt(d);
}
`;

function makeUniforms(area: [number, number]): Record<string, THREE.IUniform> {
  return {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3() },
    uSpeed: { value: 22 },
    uTilt: { value: 0.25 },
    uArea: { value: new THREE.Vector2(area[0], area[1]) },
    uColor: { value: new THREE.Color(0xa3b0ba) },
    uOpacity: { value: 0.2 },
    uFade: { value: new THREE.Vector4(0.8, 2.2, 3, 21) },
    uBoost: { value: [0, 10, 20, 30, 40].map((d) => new THREE.Vector2(d, 1)) },
    uW: { value: new THREE.Vector3(0.01, 1, 2.5) },
    uViewH: { value: 720 },
    map: { value: null },
    uIndoorInv: { value: Array.from({ length: MAX_INDOOR }, () => new THREE.Matrix4()) },
    uIndoorHalf: { value: Array.from({ length: MAX_INDOOR }, () => new THREE.Vector4()) },
    uIndoorN: { value: 0 },
  };
}

/**
 * BUG-020 室内体积（雨丝 / 溅水剔除用）：世界 → 局部的逆矩阵 + 局部半尺寸；cylinder = 竖直圆柱（半径 half.x、半高 half.y）。
 * 来自场景里名字以 -indoor 结尾的节点（白盒按 layout 生成，美术 GLB 带的也算），见 collectIndoorShapes()。
 */
export interface RainIndoorShape {
  inverse: THREE.Matrix4;
  half: THREE.Vector3;
  cylinder: boolean;
}

const INDOOR_NAME = /-indoor(\.\d+)?$/i;
const tmpBox3 = new THREE.Box3();
const tmpV = new THREE.Vector3();

/**
 * 收集 root 下所有 -indoor 网格的室内体积（不改可见性；相机用的世界 AABB 仍是 collectIndoorVolumes）。
 * 形状：几何体局部包围盒（跟着节点的旋转 / 缩放，不会因为场景根绕 Y 转了就放大成世界 AABB）；
 * 节点 userData.indoorRadius（m，layout 给的内壁半径）= 竖直圆柱（S3 圆塔：方盒的角会伸出墙外、边又贴不到墙）。
 */
export function collectIndoorShapes(root: THREE.Object3D): RainIndoorShape[] {
  root.updateWorldMatrix(true, true);
  const out: RainIndoorShape[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!INDOOR_NAME.test(o.name) || !m.geometry) return;
    m.geometry.computeBoundingBox();
    const bb = tmpBox3.copy(m.geometry.boundingBox!);
    const center = bb.getCenter(tmpV);
    const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const local = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, new THREE.Matrix4().makeTranslation(center.x, center.y, center.z));
    const r: unknown = o.userData.indoorRadius;
    const cylinder = typeof r === 'number' && r > 0;
    if (cylinder) {
      // 半径按节点世界缩放（取 x）换回局部
      const sx = new THREE.Vector3().setFromMatrixColumn(o.matrixWorld, 0).length() || 1;
      half.x = half.z = r / sx;
    }
    out.push({ inverse: local.invert(), half, cylinder });
  });
  return out;
}

/** 世界点是否在任一室内体积里（与着色器 indoorAt 同一判定；溅水 / 测试用） */
export function insideIndoorShapes(shapes: readonly RainIndoorShape[], p: THREE.Vector3): boolean {
  for (const s of shapes) {
    const l = tmpV.copy(p).applyMatrix4(s.inverse);
    if (s.cylinder ? Math.hypot(l.x, l.z) < s.half.x && Math.abs(l.y) < s.half.y : Math.abs(l.x) < s.half.x && Math.abs(l.y) < s.half.y && Math.abs(l.z) < s.half.z) return true;
  }
  return false;
}

/** 落点高度查询：从 (x, fromY, z) 往下找地面 / 水面；null = 没有（不溅） */
export type RainGroundQuery = (x: number, z: number, fromY: number) => number | null;

/**
 * 溅水（028 splash）：落点在相机周围 radius 内随机，每秒 perSecond 个；4×4 序列帧（40 fps，16 帧 = 0.4 s）
 * 竖直面向相机的小面片，底部中心贴在落点。环形缓冲，CPU 每帧只写新生成的几个实例。
 */
class RainSplashes extends THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> {
  private readonly cap: number;
  private head = 0;
  private acc = 0;
  private readonly spawn: THREE.InstancedBufferAttribute;
  private readonly rand = rng(29);
  cfg: TierCfg['splash'] | null = null;
  ground: RainGroundQuery | null = null;
  indoor: readonly RainIndoorShape[] = [];
  private readonly probe = new THREE.Vector3();

  constructor(map: THREE.Texture, cap = 512) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
    g.setIndex([0, 2, 1, 1, 2, 3]);
    // xyz = 落点，w = 出生时间（负 = 空槽）
    const spawn = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4).fill(-1e6), 4);
    spawn.setUsage(THREE.DynamicDrawUsage);
    const size = new Float32Array(cap);
    g.setAttribute('aSpawn', spawn);
    g.setAttribute('aSize', new THREE.InstancedBufferAttribute(size, 1));
    g.instanceCount = cap;
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        map: { value: map },
        uTime: { value: 0 },
        uFps: { value: 40 },
        uColor: { value: new THREE.Color(0xa3b0ba) },
        uOpacity: { value: 0.35 },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSpawn;
        attribute float aSize;
        uniform float uTime, uFps;
        varying vec2 vUv;
        varying float vA;
        void main() {
          float f = floor((uTime - aSpawn.w) * uFps);
          vA = (f >= 0.0 && f < ${SPLASH_FRAMES.toFixed(1)}) ? 1.0 : 0.0;
          f = clamp(f, 0.0, ${(SPLASH_FRAMES - 1).toFixed(1)});
          // 竖直、水平朝向相机的面片（只绕 y 转）
          vec3 toCam = cameraPosition - aSpawn.xyz;
          vec2 h = normalize(toCam.xz + 1e-5);
          vec3 right = vec3(h.y, 0.0, -h.x);
          vec3 p = aSpawn.xyz + right * position.x * aSize * 2.0 + vec3(0.0, position.y * aSize, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vA *= smoothstep(0.4, 1.2, -mv.z);
          // KTX2 不翻转：uv.y = 0 是图片第 0 行（顶）；格内底部（落点）= 该格最后一行
          float col = mod(f, ${SPLASH_GRID.toFixed(1)});
          float row = floor(f / ${SPLASH_GRID.toFixed(1)});
          vUv = vec2((col + position.x + 0.5) / ${SPLASH_GRID.toFixed(1)}, (row + 1.0 - position.y) / ${SPLASH_GRID.toFixed(1)});
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        uniform vec3 uColor;
        uniform float uOpacity;
        varying vec2 vUv;
        varying float vA;
        void main() {
          if (vA <= 0.0) discard;
          vec4 t = texture2D(map, vUv);
          float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
          gl_FragColor = vec4(uColor * mix(0.95, 1.15, l), t.a * uOpacity * vA);
        }
      `,
    });
    super(g, m);
    this.name = 'rain-splashes';
    this.frustumCulled = false;
    this.renderOrder = 8;
    this.cap = cap;
    this.spawn = spawn;
  }

  /** 当前存活的溅水数（测试用） */
  aliveCount(time: number): number {
    const a = this.spawn.array as Float32Array;
    const life = SPLASH_FRAMES / (this.cfg?.fps ?? 40);
    let n = 0;
    for (let i = 0; i < this.cap; i++) if (time - a[i * 4 + 3]! < life && time >= a[i * 4 + 3]!) n++;
    return n;
  }

  update(dt: number, time: number, center: THREE.Vector3): void {
    const c = this.cfg;
    const m = this.material.uniforms;
    m.uTime!.value = time;
    if (!c || !c.enabled || !this.ground) return;
    m.uFps!.value = c.fps;
    m.uOpacity!.value = c.opacity;
    this.acc += c.perSecond * Math.min(dt, 0.1);
    let n = Math.floor(this.acc);
    this.acc -= n;
    if (n <= 0) return;
    n = Math.min(n, this.cap);
    const a = this.spawn.array as Float32Array;
    const size = this.geometry.getAttribute('aSize') as THREE.InstancedBufferAttribute;
    const sz = size.array as Float32Array;
    const first = this.head;
    let wrote = 0;
    for (let k = 0; k < n; k++) {
      const r = c.radius * Math.sqrt(this.rand());
      const th = this.rand() * Math.PI * 2;
      const x = center.x + Math.cos(th) * r;
      const z = center.z + Math.sin(th) * r;
      const y = this.ground(x, z, center.y + 12);
      if (y === null) continue;
      // BUG-020：落点在室内（塔内楼梯 / 地窖地面——射线从相机上方 12 m 起，塔内够不到屋顶）不溅
      if (this.indoor.length && insideIndoorShapes(this.indoor, this.probe.set(x, y + 0.05, z))) continue;
      const i = this.head;
      a.set([x, y + 0.005, z, time - this.rand() / c.fps], i * 4);
      sz[i] = c.size[0] + this.rand() * (c.size[1] - c.size[0]);
      this.head = (this.head + 1) % this.cap;
      wrote++;
    }
    if (!wrote) return;
    // 只上传写过的槽（环形缓冲可能绕回）
    const span = (this.head - first + this.cap) % this.cap || this.cap;
    this.spawn.clearUpdateRanges();
    size.clearUpdateRanges();
    if (first + span <= this.cap) {
      this.spawn.addUpdateRange(first * 4, span * 4);
      size.addUpdateRange(first, span);
    } else {
      this.spawn.addUpdateRange(first * 4, (this.cap - first) * 4);
      this.spawn.addUpdateRange(0, (first + span - this.cap) * 4);
      size.addUpdateRange(first, this.cap - first);
      size.addUpdateRange(0, first + span - this.cap);
    }
    this.spawn.needsUpdate = true;
    size.needsUpdate = true;
  }
}

/**
 * 雨（v0.1-028，README-028 §2；照搬 art/tools/preview/atmo028.js makeRain）：
 * - ultra / high：带 tex-rain-streak 贴图的细长 quad（InstancedBufferGeometry，4 列变体）。
 *   屏幕宽度 = widthM 投影后夹在 [minPx, maxPx]（1–2.5 px），细于 minPx 时按覆盖率降 alpha（透明度守恒，不靠放大变白线）；
 *   近 / 远 smoothstep 淡出 + depthBoost 分段倍率。普通 alpha 混合（不是 additive），颜色取预设中灰。
 * - standard：保留 1 px LineSegments（6k，opacity 0.20）。
 * - 溅水：相机周围 radius 内每秒 perSecond 个序列帧面片（落点用 setGround 的查询：物理射线 / 水面）。
 * 全部运动在顶点着色器里（下落 + 围绕相机循环平铺）。档位 = setTier()；开关 / 颜色 / 速度 / 风斜 = 预设。
 * 贴图缺失（?art=0）时 quad 档退回线段（透明度仍按档位）。
 */
export class Rain extends THREE.Group {
  readonly lines: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  quads: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | null = null;
  splashes: RainSplashes | null = null;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly area: [number, number];
  private dropN = 6000;
  private tierCfg: TierCfg | null = null;
  private presetColor = new THREE.Color(0xa3b0ba);
  private time = 0;
  /** 当前实际形式（测试 / 调试用） */
  mode: 'line' | 'quad' = 'line';

  constructor(areaSize = 46, areaHeight = 26, streak: THREE.Texture | null = null, splash: THREE.Texture | null = null) {
    super();
    this.name = 'rain';
    this.area = [areaSize, areaHeight];
    this.uniforms = makeUniforms(this.area);
    const R = rng(11);
    const seeds = new Float32Array(MAX_DROPS * 4);
    const vari = new Float32Array(MAX_DROPS);
    for (let i = 0; i < MAX_DROPS; i++) {
      seeds.set([R() * areaSize, R() * areaHeight, R() * areaSize, R()], i * 4);
      vari[i] = Math.floor(R() * 4);
    }
    // 长度在着色器里由 seed.w（0..1）× [lenMin, lenMax] 换算，换档不用重建缓冲
    this.uniforms.uLen = { value: new THREE.Vector2(0.35, 0.75) };

    // ---- 线段（standard）
    const lg = new THREE.BufferGeometry();
    const sd2 = new Float32Array(MAX_DROPS * 8);
    for (let i = 0; i < MAX_DROPS; i++) {
      const s = seeds.subarray(i * 4, i * 4 + 4);
      sd2.set([s[0]!, s[1]!, s[2]!, 0], i * 8);
      sd2.set([s[0]!, s[1]!, s[2]!, s[3]! + 1], i * 8 + 4);
    }
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 6), 3));
    lg.setAttribute('seed', new THREE.BufferAttribute(sd2, 4));
    this.lines = new THREE.LineSegments(
      lg,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform vec2 uLen;
          varying float vF;
          ${COMMON}
          void main() {
            // seed.w：0 = 顶端；1..2 = 底端（长度 = mix(lenMin, lenMax, seed.w - 1)）
            float w = seed.w > 0.5 ? mix(uLen.x, uLen.y, seed.w - 1.0) : 0.0;
            vec3 p = dropPos(seed, w);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vF = fadeAt(length(mv.xyz));
            gl_Position = projectionMatrix * mv;
            // BUG-020：上端或（最长）下端落在室内体积里 → 整条丢到裁剪空间外（两个顶点同一判定，不会半截）
            if (indoorAt(dropPos(seed, 0.0)) || indoorAt(dropPos(seed, uLen.y))) { vF = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vF;
          void main() {
            gl_FragColor = vec4(uColor, uOpacity * vF);
          }
        `,
      }),
    );
    this.lines.name = 'rain-lines';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 8;
    this.add(this.lines);

    // ---- quad（ultra / high）
    if (streak) {
      streak.wrapS = streak.wrapT = THREE.ClampToEdgeWrapping;
      this.uniforms.map!.value = streak;
      const g = new THREE.InstancedBufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
      g.setAttribute('vari', new THREE.InstancedBufferAttribute(vari, 1));
      g.instanceCount = 0;
      const m = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          attribute float vari;
          uniform vec3 uW;
          uniform float uViewH;
          uniform vec2 uLen;
          varying float vF;
          varying vec2 vUv;
          ${COMMON}
          void main() {
            float len = mix(uLen.x, uLen.y, seed.w);
            vec3 p0 = (modelViewMatrix * vec4(dropPos(seed, 0.0), 1.0)).xyz;
            vec3 p1 = (modelViewMatrix * vec4(dropPos(seed, len), 1.0)).xyz;
            vec3 mid = mix(p0, p1, position.y);
            float depth = max(-mid.z, 0.05);
            float Fp = projectionMatrix[1][1] * uViewH * 0.5;        // 1 m 在 depth = 1 处的像素数
            float wpx = uW.x * Fp / depth;
            float wc = clamp(wpx, uW.y, uW.z);                      // 屏幕宽度夹在 [minPx, maxPx]
            vec2 dir = p1.xy - p0.xy;
            vec3 side = normalize(vec3(-dir.y, dir.x, 0.0) + 1e-5);
            vec3 pos = mid + side * position.x * wc * depth / Fp;
            vF = fadeAt(length(mix(p0, p1, 0.5))) * min(wpx / wc, 1.0);   // 不足 minPx 的按覆盖率降 alpha
            vUv = vec2((vari + position.x + 0.5) / 4.0, position.y);
            gl_Position = projectionMatrix * vec4(pos, 1.0);
            // BUG-020：雨丝上 / 下端在室内体积里 → 整条丢掉（窗外 / 门外的雨不在体积里，照常画）
            if (indoorAt(dropPos(seed, 0.0)) || indoorAt(dropPos(seed, len))) { vF = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D map;
          uniform vec3 uColor;
          uniform float uOpacity;
          varying float vF;
          varying vec2 vUv;
          void main() {
            vec4 t = texture2D(map, vUv);
            float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722));
            gl_FragColor = vec4(uColor * mix(0.9, 1.12, l), t.a * uOpacity * vF);
          }
        `,
      });
      this.quads = new THREE.Mesh(g, m);
      this.quads.name = 'rain-quads';
      this.quads.frustumCulled = false;
      this.quads.renderOrder = 8;
      this.add(this.quads);
    }
    if (splash) {
      this.splashes = new RainSplashes(splash, 1024);
      this.add(this.splashes);
    }
    this.setTier('standard', 6000);
  }

  /** 画质档：形式 / 透明度 / 宽度 / 淡出 / depthBoost / 溅水按 ATMO028.rainTiers[tier]，数量 = count（quality.rainParticles.count） */
  setTier(tier: Atmo028Tier, count: number): void {
    const c = ATMO028.rainTiers[tier];
    this.tierCfg = c;
    const u = this.uniforms;
    u.uOpacity!.value = c.opacity;
    (u.uFade!.value as THREE.Vector4).set(c.fadeNear[0], c.fadeNear[1], c.fadeFar[0], c.fadeFar[1]);
    (u.uLen!.value as THREE.Vector2).set(c.lenMin, c.lenMax);
    const db = c.depthBoost as readonly (readonly [number, number])[] | null;
    const boost: (readonly [number, number])[] = db ? [...db] : [[0, 1], [10, 1], [20, 1], [30, 1], [40, 1]];
    while (boost.length < 5) boost.push(boost[boost.length - 1]!);
    (u.uBoost!.value as THREE.Vector2[]).forEach((v, i) => v.set(boost[i]![0], boost[i]![1]));
    if ('widthM' in c) (u.uW!.value as THREE.Vector3).set(c.widthM, c.minPx, c.maxPx);
    this.mode = c.mode === 'quad' && this.quads ? 'quad' : 'line';
    if (this.splashes) this.splashes.cfg = c.splash;
    this.setCount(count);
  }

  /** 数量（菜单场景直接用；关卡走 setTier） */
  setCount(n: number): void {
    this.dropN = Math.min(n, MAX_DROPS);
    const quad = this.mode === 'quad';
    this.lines.visible = !quad;
    this.lines.geometry.setDrawRange(0, quad ? 0 : this.dropN * 2);
    if (this.quads) {
      this.quads.visible = quad;
      this.quads.geometry.instanceCount = quad ? this.dropN : 0;
    }
  }

  get dropCount(): number {
    return this.dropN;
  }

  get tier(): TierCfg | null {
    return this.tierCfg;
  }

  /** 室内体积（BUG-020）：体积里的雨丝不画、落点不溅；超过 MAX_INDOOR 的忽略 */
  indoor: RainIndoorShape[] = [];
  setIndoor(shapes: readonly RainIndoorShape[]): void {
    if (shapes.length > MAX_INDOOR) console.warn(`[rain] 室内 -indoor ${shapes.length} 个，只用前 ${MAX_INDOOR} 个`);
    this.indoor = shapes.slice(0, MAX_INDOOR);
    const u = this.uniforms;
    const inv = u.uIndoorInv!.value as THREE.Matrix4[];
    const half = u.uIndoorHalf!.value as THREE.Vector4[];
    this.indoor.forEach((sh, i) => {
      inv[i]!.copy(sh.inverse);
      half[i]!.set(sh.half.x, sh.half.y, sh.half.z, sh.cylinder ? 1 : 0);
    });
    u.uIndoorN!.value = this.indoor.length;
    if (this.splashes) this.splashes.indoor = this.indoor;
  }

  /** 世界点上的雨丝会不会被室内剔除（测试 / 调试读；与着色器同一判定） */
  culledAt(p: THREE.Vector3): boolean {
    return insideIndoorShapes(this.indoor, p);
  }

  /** 溅水落点查询（关卡：物理射线 + 水面；不设 = 不溅） */
  setGround(q: RainGroundQuery | null): void {
    if (this.splashes) this.splashes.ground = q;
  }

  applyAtmosphere(a: AtmospherePreset): void {
    this.visible = a.rain.enabled;
    const u = this.uniforms;
    u.uSpeed!.value = a.rain.speed;
    u.uTilt!.value = a.rain.windTilt;
    this.presetColor.set(a.rain.color).multiplyScalar(a.rain.brightness);
    (u.uColor!.value as THREE.Color).copy(this.presetColor);
    if (this.splashes) (this.splashes.material.uniforms.uColor!.value as THREE.Color).copy(this.presetColor);
  }

  /** 视口高度（像素宽度钳制用；Game 尺寸变化时由场景传进来，默认读 renderer） */
  setViewHeight(px: number): void {
    this.uniforms.uViewH!.value = px;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.time += dt;
    const u = this.uniforms;
    u.uTime!.value = this.time;
    (u.uCenter!.value as THREE.Vector3).copy(camera.position);
    if (this.visible) this.splashes?.update(dt, this.time, camera.position);
  }
}
