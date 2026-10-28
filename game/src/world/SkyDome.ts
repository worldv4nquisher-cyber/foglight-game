import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';

/**
 * 渐变天空穹顶：地平线处与雾色一致（远景自然融进雾里），向上过渡到天空色、顶部色。
 * 不参与雾计算，始终跟随相机。
 */
export class SkyDome extends THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> {
  constructor(radius = 180) {
    const material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uFog: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uFog;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = mix(uFog, uHorizon, smoothstep(-0.02, 0.18, h));
          col = mix(col, uTop, smoothstep(0.15, 0.85, h));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    super(new THREE.SphereGeometry(radius, 32, 16), material);
    this.name = 'sky-dome';
    this.frustumCulled = false;
    this.renderOrder = -1;
  }

  applyAtmosphere(a: AtmospherePreset): void {
    const u = this.material.uniforms;
    (u.uTop!.value as THREE.Color).set(a.skyTop);
    (u.uHorizon!.value as THREE.Color).set(a.skyHorizon);
    (u.uFog!.value as THREE.Color).set(a.fogColor);
  }

  follow(camera: THREE.Camera): void {
    this.position.copy(camera.position);
  }
}
