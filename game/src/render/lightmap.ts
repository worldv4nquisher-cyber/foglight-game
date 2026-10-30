import * as THREE from 'three';

/**
 * v0.1-029 烘焙光照贴图（编码定案：RGBM 8，KTX2 UASTC LDR，线性；交付说明 art/textures/README-029.md §0）。
 *
 * - 贴图：线性数据（NoColorSpace）、flipY = false、channel = 1（glTF TEXCOORD_1 = three uv1）。
 * - 解码：E = rgb · a · 8（E = three 的辐照度，与 HemisphereLight 同单位；只含天光 + 太阳反弹，不含太阳直射）。
 *   onBeforeCompile 把 lights_fragment_maps 里的 `lightMapTexel.rgb * lightMapIntensity` 换成 RGBM 解码。
 * - 挂了光照贴图的材质去掉半球光（光照贴图里已经有天光）；太阳直射 / 阴影、风灯 / 灯室等实时光照旧。
 *   没挂的（礁石实例、道具、透镜、门、钥匙 / 草图 / 日记 / 锡杯）照旧吃半球光。
 * - 挂法：GLB 根节点 extras.lightmap（→ userData.lightmap）的 texture 指定贴图；rect 只是说明（已经烤进 UV2，不再设 offset / repeat）。
 *   只挂可见网格（-collider / -wall 不挂），要求几何有 uv1。
 * - lightMapIntensity：extras 的值（缺省 1）× 运行时倍率（预设天光倍率、开门角），见 LightmapHandle.setScale。
 */
export const RGBM_RANGE = 8;
export const LIGHTMAP_TICKET = 'v0.1-029';

export interface LightmapExtras {
  texture: string;
  encoding: string;
  uv: string;
  lightMapIntensity: number;
  rect: [number, number, number, number] | null;
}

/** RGBM8 解码（与着色器同一公式；rgb、a 为 0–1） */
export function decodeRgbm(r: number, g: number, b: number, a: number, range = RGBM_RANGE): [number, number, number] {
  const m = a * range;
  return [r * m, g * m, b * m];
}

/** 0–255 字节版（单测 / 截图比对用） */
export function decodeRgbm8(bytes: ArrayLike<number>, i = 0): [number, number, number] {
  return decodeRgbm((bytes[i] ?? 0) / 255, (bytes[i + 1] ?? 0) / 255, (bytes[i + 2] ?? 0) / 255, (bytes[i + 3] ?? 0) / 255);
}

/** 编码（编码定案的公式：M 向上取到 1/255，下限 1/255）；单测做往返用 */
export function encodeRgbm(r: number, g: number, b: number, range = RGBM_RANGE): [number, number, number, number] {
  const mx = Math.max(r, g, b) / range;
  const m = Math.min(1, Math.max(1 / 255, Math.ceil(mx * 255) / 255));
  const k = range * m;
  return [Math.min(1, r / k), Math.min(1, g / k), Math.min(1, b / k), m];
}

/** 贴图文件名 → manifest key（tex-s3-tower-lightmap.ktx2 → tex-s3-tower-lightmap） */
export function lightmapKey(texture: string): string {
  return texture.replace(/^.*\//, '').replace(/\.ktx2$/i, '');
}

/** 读根节点 extras.lightmap（userData.lightmap）；没有 texture 的（_lodN 上的统计信息）返回 null */
export function readLightmapExtras(o: THREE.Object3D): LightmapExtras | null {
  const lm = (o.userData as { lightmap?: Partial<LightmapExtras> & { rect?: unknown } }).lightmap;
  if (!lm || typeof lm.texture !== 'string' || !lm.texture) return null;
  const rect = Array.isArray(lm.rect) && lm.rect.length === 4 && lm.rect.every((v) => typeof v === 'number') ? (lm.rect as LightmapExtras['rect']) : null;
  const k = typeof lm.lightMapIntensity === 'number' && Number.isFinite(lm.lightMapIntensity) ? lm.lightMapIntensity : 1;
  return { texture: lm.texture, encoding: lm.encoding ?? 'RGBM8', uv: lm.uv ?? 'TEXCOORD_1', lightMapIntensity: k, rect };
}

// ---------------------------------------------------------------- 着色器

/** three 原文（lights_fragment_maps）：被替换的那一句 */
export const LIGHTMAP_SAMPLE_SRC = 'vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;';
export const LIGHTMAP_SAMPLE_RGBM = `vec3 lightMapIrradiance = lightMapTexel.rgb * ( lightMapTexel.a * ${RGBM_RANGE.toFixed(1)} ) * lightMapIntensity;`;
/** three 原文（lights_fragment_begin）：半球光那一句（挂光照贴图的材质去掉） */
export const HEMI_IRRADIANCE_SRC = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';

/** 把 three 的两个 chunk 改成 RGBM + 去半球光；chunk 原文变了（three 升级）抛错，不悄悄失效 */
export function patchLightmapChunks(maps: string, begin: string): { maps: string; begin: string } {
  if (!maps.includes(LIGHTMAP_SAMPLE_SRC)) throw new Error('[lightmap] three lights_fragment_maps chunk changed: RGBM decode not patched');
  if (!begin.includes(HEMI_IRRADIANCE_SRC)) throw new Error('[lightmap] three lights_fragment_begin chunk changed: hemisphere irradiance not removed');
  return {
    maps: maps.replace(LIGHTMAP_SAMPLE_SRC, LIGHTMAP_SAMPLE_RGBM),
    begin: begin.replace(HEMI_IRRADIANCE_SRC, '/* v0.1-029: baked mesh, hemisphere light skipped (sky is in the lightmap) */'),
  };
}

let patchedChunks: { maps: string; begin: string } | null = null;
function chunks(): { maps: string; begin: string } {
  patchedChunks ??= patchLightmapChunks(THREE.ShaderChunk.lights_fragment_maps, THREE.ShaderChunk.lights_fragment_begin);
  return patchedChunks;
}

/** 片元着色器源码里把两个 include 展开成改过的版本 */
export function patchLightmapShader(fragmentShader: string): string {
  const c = chunks();
  return fragmentShader.replace('#include <lights_fragment_maps>', c.maps).replace('#include <lights_fragment_begin>', c.begin);
}

/** 给材质挂 RGBM 光照贴图（原地修改；保留已有 onBeforeCompile / programCacheKey 链） */
export function withRgbmLightmap<T extends THREE.MeshStandardMaterial>(material: T, tex: THREE.Texture, intensity: number): T {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.lightMap = tex;
  material.lightMapIntensity = intensity;
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.fragmentShader = patchLightmapShader(shader.fragmentShader);
  };
  material.customProgramCacheKey = () => `${prevKey()}|rgbm8lm`;
  material.userData.rgbmLightmap = true;
  material.needsUpdate = true;
  return material;
}

/** 光照贴图纹理参数（KTX2 线性 / channel 1 / 不翻转） */
export function prepareLightmapTexture(tex: THREE.Texture): THREE.Texture {
  if (tex.userData.rgbmLightmap) return tex;
  tex.colorSpace = THREE.NoColorSpace;
  tex.channel = 1;
  tex.flipY = false;
  // 图集：分块之间不能环绕；clifftop 有少量 UV2 出 [0,1]（≤ 0.032），夹到边
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.userData.rgbmLightmap = true;
  tex.needsUpdate = true;
  return tex;
}

const SKIP_NAME = /-(collider|wall)(\.\d+)?$/i;

export interface LightmapHandle {
  /** GLB 根（userData.lightmap 所在） */
  root: THREE.Object3D;
  key: string;
  extras: LightmapExtras;
  materials: THREE.MeshStandardMaterial[];
  meshes: number;
  /** 当前倍率（预设 × 开门角等，乘到 extras.lightMapIntensity 上） */
  scale: number;
  setScale(k: number): void;
}

/**
 * 给一个 GLB 根挂光照贴图：可见网格（有 uv1、MeshStandardMaterial 系）的材质克隆一份（GLB 缓存里的原材质被其它实例共用），
 * 挂 RGBM 贴图并去掉半球光。没有可挂的网格返回 null。
 */
export function applyLightmap(root: THREE.Object3D, tex: THREE.Texture, extras: LightmapExtras, key = lightmapKey(extras.texture)): LightmapHandle | null {
  prepareLightmapTexture(tex);
  const cloned = new Map<THREE.Material, THREE.MeshStandardMaterial>();
  let meshes = 0;
  const visit = (o: THREE.Object3D): void => {
    if (SKIP_NAME.test(o.name) || o.userData.collider === true || o.userData.wall === true) return;
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry.getAttribute('uv1')) {
      let hit = false;
      const swap = (m: THREE.Material): THREE.Material => {
        const s = m as THREE.MeshStandardMaterial;
        if (!s.isMeshStandardMaterial) return m;
        hit = true;
        let c = cloned.get(m);
        if (!c) {
          c = s.clone();
          // clone() 不带实例上挂的 onBeforeCompile（湿痕 / 按物体雾），接回去
          c.onBeforeCompile = s.onBeforeCompile;
          c.customProgramCacheKey = s.customProgramCacheKey;
          withRgbmLightmap(c, tex, extras.lightMapIntensity);
          // ORM 的 AO 已经在光照贴图里算过一遍（README-029 §0：叠得太暗调到约 0.5）
          if (c.aoMap) c.aoMapIntensity = Math.min(c.aoMapIntensity, 0.5);
          cloned.set(m, c);
        }
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
      if (hit) meshes++;
    }
    for (const ch of o.children) visit(ch);
  };
  visit(root);
  if (!meshes) return null;
  const materials = [...cloned.values()];
  const h: LightmapHandle = {
    root,
    key,
    extras,
    materials,
    meshes,
    scale: 1,
    setScale(k: number) {
      if (k === h.scale) return;
      h.scale = k;
      for (const m of materials) m.lightMapIntensity = extras.lightMapIntensity * k;
    },
  };
  root.userData.lightmapHandle = h;
  return h;
}

/**
 * 场景里所有带 extras.lightmap 的 GLB 根挂光照贴图。getTexture 返回 null（没登记 / 不在本场景资源组 / ?art=0）就跳过。
 */
export function applySceneLightmaps(scene: THREE.Object3D, getTexture: (key: string) => THREE.Texture | null): LightmapHandle[] {
  const out: LightmapHandle[] = [];
  const visit = (o: THREE.Object3D): void => {
    const ex = readLightmapExtras(o);
    if (ex) {
      if (ex.encoding !== 'RGBM8') console.warn(`[lightmap] ${o.name}: unknown encoding ${ex.encoding}, decoding as RGBM8`);
      const key = lightmapKey(ex.texture);
      const tex = getTexture(key);
      if (tex) {
        const h = applyLightmap(o, tex, ex, key);
        if (h) out.push(h);
      }
      return; // 一个 GLB 根只挂一次（子节点的 extras 是统计信息）
    }
    for (const ch of o.children) visit(ch);
  };
  visit(scene);
  return out;
}

/** 预设天光倍率：光照贴图按 026 黄昏天光烘（hemiIntensity 1.6），雨夜 ×0.35 时跟着压暗 */
export const LIGHTMAP_REF_HEMI_INTENSITY = 1.6;
export function presetLightmapScale(hemiIntensity: number): number {
  return hemiIntensity / LIGHTMAP_REF_HEMI_INTENSITY;
}

/**
 * 开门角 → 门后（塔内 / 地窖）光照贴图倍率：烘焙时门开 −100°（open = 1 → 1），关门（open = 0）→ closed。
 * open 已经是平滑过的 0–1；这里再 smoothstep 一次，开门前一小段变化慢、不突兀。
 */
export function doorLightmapScale(open: number, closed: number): number {
  const u = Math.min(1, Math.max(0, open));
  const s = u * u * (3 - 2 * u);
  return closed + (1 - closed) * s;
}
