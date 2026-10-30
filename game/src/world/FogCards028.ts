import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';
import { ATMO028 } from '@/config/atmosphere028';
import type { QualityTier } from '@/config/quality';

/**
 * v0.1-028 S1 雾片（README-028 §3，照搬 art/tools/preview/atmo028.js addS1Fog）：
 * - 远景雾墙：s1.farWalls 5 层圆柱段（内表面朝中心，tex-fog-card-a），**跟随相机 xz**（同天空穹顶），
 *   不吃场景雾、depthWrite false、renderOrder 2；颜色 = 预设 farWallTint × (层 tint / #C9D0D4)。
 *   半径 290–470 m 超过标准档 250 m 视距：顶点深度夹在远平面内侧（不被 camera.far 裁掉，仍在天空层剪影前面）。
 * - 岛边地面雾（018 遗留）：主灯塔岛两圈面向相机的雾片 + 2 个雾团 + 8 片贴水薄雾，y 跟潮位，吃场景雾。
 * - 所有雾片两端 uv.x 淡出（雾墙 12% / 雾片 22%）+ 近相机淡出（雾墙 20→60 m / 雾片 8→25 m），不会露硬边。
 * - 档位：fogTiers.farLayers（standard 4 层）、groundFogOpacityMul（standard ×1.15）。
 * 贴图缺失（?art=0）时不建。
 */
export const FOG_CARD_KEYS = ATMO028.textures.fogCards;
const BASE_TINT = new THREE.Color('#C9D0D4');
/** 远景雾墙深度夹到远平面内侧（天空层剪影钉在 0.999995，雾墙在它前面） */
const WALL_DEPTH = 0.99999;

interface SoftOpts {
  edge: number;
  near: readonly [number, number];
  clampDepth?: boolean;
}

/** 两端 uv.x 淡出 + 近相机淡出（预览 soft()） */
function soft<T extends THREE.Material>(mat: T, o: SoftOpts): T {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vEdgeU;\nvarying float vViewD;')
      .replace(
        '#include <fog_vertex>',
        `#include <fog_vertex>\n  vEdgeU = uv.x;\n  vViewD = -mvPosition.z;${o.clampDepth ? `\n  gl_Position.z = min(gl_Position.z, gl_Position.w * ${WALL_DEPTH.toFixed(6)});` : ''}`,
      );
    const e = o.edge;
    const edge = e > 0 ? `smoothstep(0.0, ${e.toFixed(3)}, vEdgeU) * smoothstep(1.0, ${(1 - e).toFixed(3)}, vEdgeU)` : '1.0';
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vEdgeU;\nvarying float vViewD;')
      .replace(
        '#include <alphamap_fragment>',
        `#include <alphamap_fragment>\n  diffuseColor.a *= ${edge} * smoothstep(${o.near[0].toFixed(1)}, ${o.near[1].toFixed(1)}, vViewD);`,
      );
  };
  mat.customProgramCacheKey = () => `fog028|${o.edge}|${o.near.join(',')}|${o.clampDepth ? 1 : 0}`;
  return mat;
}

function repeated(map: THREE.Texture, rx: number, ox = 0): THREE.Texture {
  const t = map.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  t.repeat.set(rx, 1);
  t.offset.x = ox;
  t.needsUpdate = true;
  return t;
}

interface Wall {
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  tint: THREE.Color;
  drift: number;
}
interface Card {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  baseY: number;
  baseOpacity: number;
}

export class FogCards028 extends THREE.Group {
  private walls: Wall[] = [];
  private cards: Card[] = [];
  private tideY = 0;

  constructor(tex: { wall: THREE.Texture; puff: THREE.Texture; ground: THREE.Texture }) {
    super();
    this.name = 'atmo028-fog';
    const S = ATMO028.s1;
    for (const w of S.farWalls) {
      const [a0, a1] = w.arcDeg;
      const len = ((a1 - a0) * Math.PI) / 180;
      const g = new THREE.CylinderGeometry(w.radius, w.radius, w.height, Math.max(8, Math.round((len * w.radius) / 6)), 1, true, ((90 - a1) * Math.PI) / 180, len);
      const map = repeated(tex.wall, Math.max(1, Math.round((len * w.radius) / (w.height * w.tileAspect))));
      const mat = soft(new THREE.MeshBasicMaterial({ map, transparent: true, opacity: w.opacity, depthWrite: false, side: THREE.DoubleSide, fog: false }), {
        edge: 0.12,
        near: [20, 60],
        clampDepth: true,
      });
      mat.name = 'mat-fog028-wall';
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `fog028-wall-${w.radius}`;
      mesh.position.set(S.center[0], w.y + w.height / 2, S.center[2]);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.walls.push({ mesh, tint: new THREE.Color(w.tint), drift: w.drift ?? 0 });
      this.add(mesh);
    }
    const gf = S.groundFog;
    const addCard = (map: THREE.Texture, w: number, h: number, x: number, y: number, z: number, opacity: number, name: string): void => {
      const mat = soft(new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, fog: true }), { edge: 0.22, near: [8, 25] });
      mat.name = 'mat-fog028-card';
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      mesh.name = name;
      mesh.position.set(x, y, z);
      mesh.renderOrder = 2;
      mesh.castShadow = mesh.receiveShadow = false;
      this.cards.push({ mesh, baseY: y, baseOpacity: opacity });
      this.add(mesh);
    };
    const isl = gf.island;
    isl.rings.forEach((r, ri) => {
      for (let k = 0; k < r.count; k++) {
        const a = ((k + 0.5 * ri) / r.count) * Math.PI * 2;
        const map = repeated(tex.ground, r.width / (r.height * 4), (k * 0.37 + ri * 0.21) % 1);
        addCard(map, r.width, r.height, isl.center[0] + Math.cos(a) * r.radius, r.y + r.height * 0.5, isl.center[2] + Math.sin(a) * r.radius, r.opacity, `fog028-island-${ri}-${k}`);
      }
    });
    isl.puffs.forEach((p, i) => {
      const puff = tex.puff.clone();
      puff.needsUpdate = true;
      addCard(puff, p.size[0], p.size[1], p.pos[0], p.pos[1] + p.size[1] * 0.3, p.pos[2], p.opacity, `fog028-puff-${i}`);
    });
    const nw = gf.nearWater;
    let s: number = nw.seed;
    const R = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < nw.count; i++) {
      const d = nw.distance[0] + R() * (nw.distance[1] - nw.distance[0]);
      const a = ((nw.arcDeg[0] + R() * (nw.arcDeg[1] - nw.arcDeg[0])) * Math.PI) / 180;
      const w = nw.width[0] + R() * (nw.width[1] - nw.width[0]);
      const h = nw.height[0] + R() * (nw.height[1] - nw.height[0]);
      const op = nw.opacity[0] + R() * (nw.opacity[1] - nw.opacity[0]);
      addCard(tex.ground, w, h, S.center[0] + Math.cos(a) * d, h * 0.32 - 0.4, S.center[2] + Math.sin(a) * d, op, `fog028-water-${i}`);
    }
  }

  /** 远景雾墙颜色跟预设 farWallTint（夜里随之变暗，不出亮带） */
  applyAtmosphere(a: AtmospherePreset): void {
    const p = new THREE.Color(a.farWallTint);
    for (const w of this.walls) w.mesh.material.color.setRGB((p.r * w.tint.r) / BASE_TINT.r, (p.g * w.tint.g) / BASE_TINT.g, (p.b * w.tint.b) / BASE_TINT.b);
  }

  applyQuality(tier: QualityTier): void {
    const t = ATMO028.fogTiers[tier];
    this.walls.forEach((w, i) => (w.mesh.visible = i < t.farLayers));
    const mul = 'groundFogOpacityMul' in t ? (t.groundFogOpacityMul as number) : 1;
    for (const c of this.cards) c.mesh.material.opacity = c.baseOpacity * mul;
  }

  /** 每帧：雾墙跟相机 xz、缓慢横向漂移；雾片面向相机（水平）、y 跟潮位（只抬不降） */
  update(dt: number, camera: THREE.Camera, tideLevel: number): void {
    const cp = camera.position;
    for (const w of this.walls) {
      w.mesh.position.x = cp.x;
      w.mesh.position.z = cp.z;
      const m = w.mesh.material.map;
      if (m && w.drift) m.offset.x = (m.offset.x + w.drift * dt) % 1;
    }
    const ty = Math.max(tideLevel, 0);
    const dy = ty - this.tideY;
    this.tideY = ty;
    for (const c of this.cards) {
      if (dy) c.mesh.position.y = c.baseY + ty;
      c.mesh.lookAt(cp.x, c.mesh.position.y, cp.z);
    }
  }

  get debugCounts(): { walls: number; cards: number } {
    return { walls: this.walls.filter((w) => w.mesh.visible).length, cards: this.cards.length };
  }
}

/** 三张雾片贴图都在才建（?art=0 / 未交付 → null） */
export function buildFogCards028(assets: { has(k: string): boolean; getTexture(k: string): THREE.Texture }): FogCards028 | null {
  const K = FOG_CARD_KEYS;
  if (!assets.has(K.wall) || !assets.has(K.puff) || !assets.has(K.ground)) return null;
  return new FogCards028({ wall: assets.getTexture(K.wall), puff: assets.getTexture(K.puff), ground: assets.getTexture(K.ground) });
}
