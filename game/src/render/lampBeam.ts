import * as THREE from 'three';
import { ATMO028 } from '@/config/atmosphere028';

/**
 * 灯塔体积灯束（裁定 25 程序 P2，取代 015 的 MeshBasic 均匀半透明圆锥）。
 *
 * 旧实现的问题（shots-035 01 / 02 / 07）：开口圆锥 + MeshBasicMaterial opacity 0.16 加法混合，沿长度、横截面都没有衰减 ——
 * 侧面看就是两条硬边平带；视线顺着光束轴看时，远端开口的圆投影成一个椭圆：圆里的视线只穿过一层锥壁、圆外穿过两层，
 * 于是末端出现一个硬边「半透明圆盘」。
 *
 * 现在：仍是同一个开口圆锥（每束 1 个 draw call，片元很便宜），但亮度全在 shader 里算 ——
 * - 横向软边：法线和「视线去掉轴向分量」的夹角（剪影中心 1、边缘 0），pow 软化；视线顺轴看时也成立。
 * - 侧面淡化：按视线和光束轴的夹角（|V·axis|）做 fresnel 式淡化，侧面只剩 sideMin；正对 / 迎着光源看时有前向散射加成。
 * - 沿长度：起点在灯室玻璃附近淡入（灯室里不画出一条实心带）、1/(1+k·s) 发散衰减、后段 smoothstep 到 0 —— 末端没有边界可见，没有圆盘。
 * - 和雾互动：亮度 ∝ sqrt(雾密度 / 参考密度)（雾越浓散射越亮，035 雾口推开时光束跟着变淡），
 *   再乘雾透射率 exp(−(ρ·d)²·fogAtt)（远处被雾吃掉而不是变成雾色），028 tex-beam-noise 沿光束滚动做密度起伏，
 *   片元抖动去色带。
 * - 近相机淡出（相机穿进光束不糊屏）。
 * 灯室辉光：tex-glow-lighthouse 面向相机的 billboard（028 glow.lighthouse：9 m、强度 1.6、2.5 s 淡入、雾衰减 0.4），
 * 深度往相机挪一点避免被透镜本体切一半；近处（灯室里）淡出。
 * 贴图缺失（?art=0）时噪声取常数、不建辉光。
 */
export const LAMP_BEAM = Object.freeze({
  length: 60,
  /** 灯处 / 末端半径（m） */
  rootRadius: 0.45,
  endRadius: 3.4,
  radialSegments: 32,
  heightSegments: 24,
  /** 峰值亮度（加法） */
  strength: 0.42,
  /** 侧面（视线 ⟂ 光束）剩下的比例 */
  sideMin: 0.28,
  /** 迎着光束看时的前向散射加成 */
  forward: 0.6,
  /** 横向软边指数（越大越窄、边越软） */
  edgePow: 1.6,
  /** 起点淡入（离灯 m）：灯室玻璃半径约 3 m */
  startFade: [0.8, 3.6] as readonly [number, number],
  /** 末段淡出（占全长比例） */
  endFade: [0.3, 1.0] as readonly [number, number],
  /** 发散衰减 1/(1+k·s) */
  spread: 2.2,
  /** 近相机淡出（m） */
  nearFade: [0.5, 3.0] as readonly [number, number],
  /** 雾：参考密度（after-lit 0.008）、散射调制夹在 [min, max]、透射指数 */
  fogRef: 0.008,
  fogScatter: [0.55, 1.35] as readonly [number, number],
  fogAtt: 0.6,
  /** 旋转（rad/s，与旧实现一致） */
  spin: 0.35,
});

export const LAMP_GLOW = Object.freeze({
  ...ATMO028.glow.lighthouse,
  /** 深度往相机挪（m），不被透镜本体切掉 */
  pull: 1.4,
  /** 近处淡出（m）：灯室里 / 门口看不到 9 m 的光晕糊脸 */
  nearFade: [6, 14] as readonly [number, number],
});

const NOISE = ATMO028.beam.noise;

const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
/** 与 shader 同式（单测用）：离灯 m 米处沿长度的亮度系数 */
export function lampBeamAlong(m: number): number {
  const B = LAMP_BEAM;
  const s = Math.min(1, Math.max(0, m / B.length));
  return (smoothstep(B.startFade[0], B.startFade[1], m) * (1 - smoothstep(B.endFade[0], B.endFade[1], s))) / (1 + B.spread * s);
}
/** 与 shader 同式：va = 视线（片元→相机）· 光束轴 */
export function lampBeamPhase(va: number): number {
  const B = LAMP_BEAM;
  const c = Math.abs(va);
  return (B.sideMin + (1 - B.sideMin) * c * c) * (1 + B.forward * Math.pow(Math.max(va, 0), 4));
}
/** 与 shader 同式：片元离相机 dist 米的近处淡出（BUG-026：灯束扫过灯室里的演出相机时，贴着相机的锥壁不画） */
export function lampBeamNear(dist: number): number {
  return smoothstep(LAMP_BEAM.nearFade[0], LAMP_BEAM.nearFade[1], dist);
}
/** 与 shader 同式：facing = |N · 视线去掉轴向分量|（剪影中心 1、边缘 0） */
export function lampBeamEdge(facing: number): number {
  return Math.pow(smoothstep(0, 1, facing), LAMP_BEAM.edgePow);
}

export interface LampBeamTextures {
  noise?: THREE.Texture | null;
  glow?: THREE.Texture | null;
}

function fogDensityOf(scene: THREE.Scene | null): number {
  const f = scene?.fog;
  return f && 'density' in f ? f.density : 0;
}

function noiseTexture(src: THREE.Texture | null | undefined): THREE.Texture | null {
  if (!src) return null;
  const t = src.clone();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function makeLampBeamMaterial(color: THREE.ColorRepresentation, noise: THREE.Texture | null): THREE.ShaderMaterial {
  const B = LAMP_BEAM;
  return new THREE.ShaderMaterial({
    name: 'lamp-beam-volume',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: B.strength },
      uOn: { value: 1 },
      uTime: { value: 0 },
      uNoise: { value: noise },
      uNoiseOn: { value: noise ? 1 : 0 },
      uFogDensity: { value: B.fogRef },
    },
    defines: {
      BEAM_LEN: B.length.toFixed(3),
    },
    vertexShader: /* glsl */ `
      varying float vS;
      varying float vAround;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying vec3 vAxisW;
      void main() {
        vS = clamp(position.x / BEAM_LEN, 0.0, 1.0);
        vAround = uv.x;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
        vAxisW = normalize((modelMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      uniform float uOn;
      uniform float uTime;
      uniform sampler2D uNoise;
      uniform float uNoiseOn;
      uniform float uFogDensity;
      varying float vS;
      varying float vAround;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying vec3 vAxisW;
      void main() {
        vec3 toCam = cameraPosition - vWorldPos;
        float dist = length(toCam);
        vec3 V = toCam / max(dist, 1e-4);
        vec3 A = normalize(vAxisW);
        float va = dot(V, A);
        // 横向软边：去掉轴向分量后的视线和法线夹角（剪影中心 1，边缘 0）
        vec3 Vp = V - A * va;
        float vpl = length(Vp);
        float facing = vpl > 1e-4 ? abs(dot(normalize(vNormalW), Vp / vpl)) : 1.0;
        float edge = pow(smoothstep(0.0, 1.0, facing), ${B.edgePow.toFixed(3)});
        // 侧面 fresnel 淡化 + 迎光前向散射
        float c = abs(va);
        float phase = mix(${B.sideMin.toFixed(3)}, 1.0, c * c) * (1.0 + ${B.forward.toFixed(3)} * pow(max(va, 0.0), 4.0));
        // 沿长度：起点淡入、发散衰减、末段淡到 0（没有可见的末端）
        float m = vS * BEAM_LEN;
        float along = smoothstep(${B.startFade[0].toFixed(3)}, ${B.startFade[1].toFixed(3)}, m)
          * (1.0 - smoothstep(${B.endFade[0].toFixed(3)}, ${B.endFade[1].toFixed(3)}, vS))
          / (1.0 + ${B.spread.toFixed(3)} * vS);
        // 028 噪声：沿光束滚动的密度起伏（雨雾微粒）
        float n = 1.0;
        if (uNoiseOn > 0.5) {
          vec2 nuv = vec2(vS * ${NOISE.tile[0].toFixed(3)} - uTime * ${NOISE.scrollAlongBeam.toFixed(4)}, vAround * ${NOISE.tile[1].toFixed(3)});
          float nv = texture2D(uNoise, nuv).r;
          n = mix(1.0, nv / 0.62, ${NOISE.strength.toFixed(3)});
        }
        // 雾：浓雾散射更亮，远处被雾吃掉（透射率，不混雾色）
        float scatter = clamp(sqrt(max(uFogDensity, 0.0) / ${B.fogRef.toFixed(5)}), ${B.fogScatter[0].toFixed(3)}, ${B.fogScatter[1].toFixed(3)});
        float fd = uFogDensity * dist;
        float trans = exp(-fd * fd * ${B.fogAtt.toFixed(3)});
        float nearK = smoothstep(${B.nearFade[0].toFixed(3)}, ${B.nearFade[1].toFixed(3)}, dist);
        float a = uStrength * uOn * edge * phase * along * n * scatter * trans * nearK;
        // 抖动去色带（interleaved gradient noise）
        float ign = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
        a = max(a + (ign - 0.5) * (1.5 / 255.0) * step(0.0005, a), 0.0);
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

export function makeLampGlowMaterial(color: THREE.ColorRepresentation, map: THREE.Texture): THREE.ShaderMaterial {
  const G = LAMP_GLOW;
  return new THREE.ShaderMaterial({
    name: 'lamp-glow-billboard',
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uMap: { value: map },
      uTint: { value: new THREE.Color(color) },
      uIntensity: { value: 0 },
      uFogDensity: { value: LAMP_BEAM.fogRef },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 c = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float d = length(c.xyz);
        vDist = d;
        vec3 cc = c.xyz * (max(d - ${G.pull.toFixed(3)}, 0.2) / max(d, 1e-4));
        gl_Position = projectionMatrix * vec4(cc + vec3(position.xy * ${G.sizeM.toFixed(3)}, 0.0), 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uTint;
      uniform float uIntensity;
      uniform float uFogDensity;
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vec4 g = texture2D(uMap, vUv);
        float fd = uFogDensity * vDist;
        float k = uIntensity * exp(-fd * fd * ${G.fogAttenuation.toFixed(3)}) * smoothstep(${G.nearFade[0].toFixed(2)}, ${G.nearFade[1].toFixed(2)}, vDist);
        // 贴图本身是暖色（#FFD38A 核 / #E8A24A 晕），uTint 默认白
        gl_FragColor = vec4(g.rgb * uTint * k, g.a * k);
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * 灯束组：两束背对背的体积光束（绕 Y 转）+ 灯室辉光。原点 = 灯（lamp-light-origin）。
 * update(dt) 推进旋转 / 噪声 / 辉光淡入；雾密度在 onBeforeRender 里读场景雾（雾口演出里会变）。
 */
export class LampBeam extends THREE.Group {
  readonly beams = new THREE.Group();
  readonly material: THREE.ShaderMaterial;
  readonly glow: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  private time = 0;
  private glowK = 0;
  private _on = false;

  constructor(color: THREE.ColorRepresentation, tex: LampBeamTextures = {}) {
    super();
    this.name = 'lamp-beam-volume';
    const B = LAMP_BEAM;
    this.material = makeLampBeamMaterial(color, noiseTexture(tex.noise));
    // CylinderGeometry 沿 +Y、top = 末端；转到 +X，灯处在原点
    const geo = new THREE.CylinderGeometry(B.endRadius, B.rootRadius, B.length, B.radialSegments, B.heightSegments, true);
    geo.rotateZ(-Math.PI / 2);
    geo.translate(B.length / 2, 0, 0);
    const readFog = (_r: THREE.WebGLRenderer, scene: THREE.Scene): void => {
      this.material.uniforms.uFogDensity!.value = fogDensityOf(scene);
    };
    for (const r of [0, Math.PI]) {
      const m = new THREE.Mesh(geo, this.material);
      m.name = 'lamp-beam-cone';
      m.rotation.y = r;
      m.frustumCulled = false;
      m.renderOrder = 2;
      m.onBeforeRender = readFog;
      this.beams.add(m);
    }
    this.add(this.beams);
    if (tex.glow) {
      const gm = makeLampGlowMaterial(0xffffff, tex.glow);
      const g = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gm);
      g.name = 'lamp-glow';
      g.frustumCulled = false;
      g.renderOrder = 3;
      g.onBeforeRender = (_r, scene) => {
        gm.uniforms.uFogDensity!.value = fogDensityOf(scene);
      };
      this.add(g);
      this.glow = g;
    }
    this.visible = false;
  }

  get on(): boolean {
    return this._on;
  }

  setOn(on: boolean): void {
    this._on = on;
    this.visible = on;
    if (!on) this.glowK = 0;
  }

  private _boost = 1;
  /** 强度倍率（035 镜头 02 用；只乘峰值亮度，辉光不变） */
  get boost(): number {
    return this._boost;
  }
  setBoost(k: number): void {
    if (k === this._boost) return;
    this._boost = k;
    this.material.uniforms.uStrength!.value = LAMP_BEAM.strength * k;
  }

  setColor(c: THREE.ColorRepresentation): void {
    (this.material.uniforms.uColor!.value as THREE.Color).set(c);
  }

  update(dt: number): void {
    if (!this._on) return;
    this.time += dt;
    this.beams.rotation.y += dt * LAMP_BEAM.spin;
    this.material.uniforms.uTime!.value = this.time;
    if (this.glow) {
      this.glowK = Math.min(1, this.glowK + dt / LAMP_GLOW.fadeInS);
      const k = this.glowK * this.glowK * (3 - 2 * this.glowK);
      this.glow.material.uniforms.uIntensity!.value = k * LAMP_GLOW.intensity;
    }
  }
}
