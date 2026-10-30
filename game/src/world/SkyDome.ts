import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';

/** 028 层云贴图（manifest common） */
export const SKY_CLOUDS_KEY = 'tex-sky-clouds-overcast-albedo';

/** 云层贴图缺失（?art=0 / 未加载）时用的全透明 1×1：只剩三段渐变 */
const NO_CLOUDS = (() => {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  t.needsUpdate = true;
  return t;
})();

/** 云层初始偏移（同预览 makeSky 的 cOff） */
const CLOUD_OFFSET: [number, number] = [0.37, 0.61];

/**
 * 天空穹顶（v0.1-028，照搬 art/tools/preview/atmo028.js 的 makeSky()）：
 * - 地平线 / 中段 / 顶部三段渐变（midElev、topElev 仰角 sin 值）；
 * - 层云贴图 tex-sky-clouds-overcast-albedo 平面投影 uv = dir.xz / (dir.y + 0.12)，按 scroll 每秒滚动；
 *   近地平线的云往地平线色收（空气透视）、horizonLift 提亮融进雾、在 fadeElev 内淡出；
 * - 黄昏 duskBand：只在低仰角出现的暖灰带（#C9A88A，不是光源，不违反「唯一暖光」）；
 * - 仰角 < 0.04 收到地平线色（= 雾墙 / 远景雾的过渡）。
 * 不参与雾计算，跟随相机位置；depthWrite false、renderOrder −1 最先画。
 */
export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(radius = 180) {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        mid: { value: new THREE.Color() },
        hor: { value: new THREE.Color() },
        elev: { value: new THREE.Vector2(0.18, 0.7) },
        dusk: { value: new THREE.Color() },
        duskDir: { value: new THREE.Vector3(1, 0, 0) },
        duskK: { value: new THREE.Vector3(1, 0.1, 0) },
        tC: { value: NO_CLOUDS as THREE.Texture },
        cScale: { value: 0.55 },
        cOff: { value: new THREE.Vector2(...CLOUD_OFFSET) },
        cOpacity: { value: 0 },
        cTint: { value: new THREE.Color() },
        cFade: { value: new THREE.Vector2(0.015, 0.16) },
        cLift: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform vec3 top, mid, hor, dusk, duskDir, duskK, cTint;
        uniform vec2 elev, cOff, cFade;
        uniform float cScale, cOpacity, cLift;
        uniform sampler2D tC;
        void main() {
          vec3 d = normalize(vDir);
          float e = max(d.y, 0.0);
          vec3 c = mix(hor, mid, smoothstep(0.0, elev.x, e));
          c = mix(c, top, smoothstep(elev.x, elev.y, e));
          vec2 uv = d.xz / (max(d.y, 0.0) + 0.12) * cScale + cOff;
          vec4 cl = texture2D(tC, uv);
          vec3 cc = mix(hor, cl.rgb * cTint, smoothstep(0.0, 0.22, e));
          cc = mix(cc, hor, cLift * (1.0 - smoothstep(0.0, 0.3, e)));
          c = mix(c, cc, cl.a * cOpacity * smoothstep(cFade.x, cFade.y, e));
          float az = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), duskDir), 0.0);
          c = mix(c, dusk, pow(az, duskK.x) * (1.0 - smoothstep(0.0, duskK.y, e)) * duskK.z * (0.75 + 0.25 * (1.0 - cl.a)));
          c = mix(c, hor, 1.0 - smoothstep(0.0, 0.04, e));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    super(new THREE.SphereGeometry(radius, 64, 32), material);
    this.name = 'sky-dome';
    this.frustumCulled = false;
    this.renderOrder = -1;
  }

  private scroll: [number, number] = [0, 0];

  /** 云层贴图（028 tex-sky-clouds-overcast-albedo）；null = 只用渐变 */
  setClouds(tex: THREE.Texture | null): void {
    if (tex) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
    }
    this.material.uniforms.tC!.value = tex ?? NO_CLOUDS;
  }

  get hasClouds(): boolean {
    return this.material.uniforms.tC!.value !== NO_CLOUDS;
  }

  applyAtmosphere(a: AtmospherePreset): void {
    const u = this.material.uniforms;
    const s = a.sky;
    (u.top!.value as THREE.Color).set(s.top);
    (u.mid!.value as THREE.Color).set(s.mid);
    (u.hor!.value as THREE.Color).set(s.horizon);
    (u.elev!.value as THREE.Vector2).set(s.midElev, s.topElev);
    const db = s.duskBand;
    (u.dusk!.value as THREE.Color).set(db?.color ?? '#000000');
    const dir = db?.dir ?? [1, 0, 0];
    (u.duskDir!.value as THREE.Vector3).set(dir[0], dir[1], dir[2]).normalize();
    (u.duskK!.value as THREE.Vector3).set(db?.power ?? 1, db?.maxElev ?? 0.1, db ? db.strength : 0);
    const cl = s.clouds;
    u.cScale!.value = cl.scale;
    u.cOpacity!.value = cl.opacity;
    (u.cTint!.value as THREE.Color).set(cl.tint);
    (u.cFade!.value as THREE.Vector2).set(cl.fadeElev[0], cl.fadeElev[1]);
    u.cLift!.value = cl.horizonLift;
    this.scroll = [cl.scroll[0], cl.scroll[1]];
  }

  /** 云层滚动（每秒 scroll uv） */
  update(dt: number): void {
    const o = this.material.uniforms.cOff!.value as THREE.Vector2;
    o.x = (o.x + this.scroll[0] * dt) % 1;
    o.y = (o.y + this.scroll[1] * dt) % 1;
  }

  follow(camera: THREE.Camera): void {
    this.position.copy(camera.position);
  }
}
