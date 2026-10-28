import * as THREE from 'three';

/**
 * 占位水面：MeshStandardMaterial + 顶点着色器里叠加几组 Gerstner 风格正弦波（GPU，零 CPU 开销），
 * 法线由解析导数计算，配合低粗糙度得到暗沉、缓慢起伏的海面。以后可替换为带反射/折射的正式水体。
 */
export class Water extends THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  private uniforms = { uTime: { value: 0 } };

  constructor(size = 600, segments = 200, color = 0x1b252c) {
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.18,
      metalness: 0.0,
      envMapIntensity: 0.6,
    });
    super(geometry, material);
    this.name = 'water';
    this.receiveShadow = true;

    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          /* glsl */ `#include <common>
          uniform float uTime;
          // dir.xy, 振幅, 波长, 速度
          vec3 waveSum(vec2 p, out vec2 grad) {
            const int N = 4;
            vec4 W[N];
            W[0] = vec4(normalize(vec2(1.0, 0.3)), 0.18, 9.0);
            W[1] = vec4(normalize(vec2(-0.4, 1.0)), 0.10, 5.5);
            W[2] = vec4(normalize(vec2(0.7, -0.8)), 0.06, 3.1);
            W[3] = vec4(normalize(vec2(-1.0, -0.2)), 0.035, 1.7);
            float h = 0.0;
            grad = vec2(0.0);
            for (int i = 0; i < N; i++) {
              float k = 6.28318 / W[i].w;
              float c = sqrt(9.8 / k) * 0.6;
              float f = k * (dot(W[i].xy, p) - c * uTime);
              h += W[i].z * sin(f);
              grad += W[i].z * k * cos(f) * W[i].xy;
            }
            return vec3(0.0, h, 0.0);
          }`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `vec2 wGrad;
          vec3 wOffset = waveSum(position.xz, wGrad);
          vec3 objectNormal = normalize(vec3(-wGrad.x, 1.0, -wGrad.y));
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3( tangent.xyz );
          #endif`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = position + wOffset;');
    };
  }

  update(dt: number): void {
    this.uniforms.uTime.value += dt;
  }
}
