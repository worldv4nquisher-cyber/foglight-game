import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';

/** 上限 = 极致档 rainParticles.count（style-guide §8：30k） */
const MAX_DROPS = 30000;

/**
 * 细雨：线段雨丝，全部运动在顶点着色器里完成（下落 + 围绕相机循环平铺），CPU 每帧只更新两个 uniform。
 * 数量由画质档位决定（setCount），开关与颜色由气氛预设决定。
 */
export class Rain extends THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial> {
  constructor(areaSize = 46, areaHeight = 26) {
    const geometry = new THREE.BufferGeometry();
    const seeds = new Float32Array(MAX_DROPS * 2 * 4);
    for (let i = 0; i < MAX_DROPS; i++) {
      const x = Math.random() * areaSize;
      const y = Math.random() * areaHeight;
      const z = Math.random() * areaSize;
      const len = 0.35 + Math.random() * 0.45;
      // 两个端点：w 分量 0=顶端 1=底端，并带上长度
      seeds.set([x, y, z, 0], i * 8);
      seeds.set([x, y, z, len], i * 8 + 4);
    }
    // position 仅用于包围盒；实际位置在着色器里计算
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 2 * 3), 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new THREE.Vector3() },
        uSpeed: { value: 20 },
        uColor: { value: new THREE.Color(0x9fb0c0) },
        uOpacity: { value: 0.22 },
        uArea: { value: new THREE.Vector2(areaSize, areaHeight) },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform float uSpeed;
        uniform vec2 uArea;
        varying float vFade;
        void main() {
          float S = uArea.x;
          float H = uArea.y;
          vec3 p;
          p.x = mod(seed.x - uCenter.x, S) - S * 0.5 + uCenter.x;
          p.z = mod(seed.z - uCenter.z, S) - S * 0.5 + uCenter.z;
          p.y = mod(seed.y - uTime * uSpeed, H) + uCenter.y - H * 0.4;
          // 雨丝略微倾斜（风）
          p.x += seed.w * 0.25;
          p.y -= seed.w;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          vFade = smoothstep(S * 0.5, 3.0, d) * smoothstep(0.6, 2.0, d);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        varying float vFade;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity * vFade);
          #include <colorspace_fragment>
        }
      `,
    });
    super(geometry, material);
    this.name = 'rain';
    this.frustumCulled = false;
  }

  setCount(n: number): void {
    this.geometry.setDrawRange(0, Math.min(n, MAX_DROPS) * 2);
  }

  applyAtmosphere(a: AtmospherePreset): void {
    this.visible = a.rain.enabled;
    const u = this.material.uniforms;
    u.uSpeed!.value = a.rain.speed;
    u.uOpacity!.value = 0.2;
    (u.uColor!.value as THREE.Color).set(a.rain.color);
  }

  update(dt: number, camera: THREE.Camera): void {
    const u = this.material.uniforms;
    u.uTime!.value = (u.uTime!.value as number) + dt;
    (u.uCenter!.value as THREE.Vector3).copy(camera.position);
  }
}
