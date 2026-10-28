import * as THREE from 'three';
import type { AtmospherePreset } from '@/config/atmosphere';

/**
 * 占位灯塔：塔身（锥台）+ 灯室（自发光，触发 Bloom）+ 暖色点光源 + 缓慢扫过的体积光束。
 * 灯塔暖光是忧郁冷色画面里唯一的温度，用于对比。
 */
export class Lighthouse extends THREE.Group {
  readonly light: THREE.PointLight;
  readonly tower: THREE.Mesh;
  private lamp: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private beamPivot = new THREE.Group();
  private beamMat: THREE.ShaderMaterial;
  private baseIntensity = 60;
  private flicker = 0.08;
  private t = 0;
  private _on = true;
  readonly height = 9;

  constructor() {
    super();
    this.name = 'lighthouse';
    const h = this.height;

    const stone = new THREE.MeshStandardMaterial({ color: 0x8a8f92, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.6, metalness: 0.4 });

    this.tower = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 1.4, h, 24), stone);
    this.tower.position.y = h / 2;
    this.tower.castShadow = this.tower.receiveShadow = true;
    this.add(this.tower);

    // 红白色带（低饱和）
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(1.13, 1.22, 1.2, 24),
      new THREE.MeshStandardMaterial({ color: 0x6b3b36, roughness: 0.85 }),
    );
    band.position.y = h * 0.55;
    band.castShadow = true;
    this.add(band);

    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 0.18, 24), dark);
    gallery.position.y = h + 0.09;
    gallery.castShadow = true;
    this.add(gallery);

    this.lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 20, 12),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffa95a, emissiveIntensity: 8 }),
    );
    this.lamp.position.y = h + 0.75;
    this.add(this.lamp);

    const glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.85, 0.85, 1.2, 16, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1a1f22, roughness: 0.1, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    glass.position.y = h + 0.78;
    this.add(glass);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.0, 24), dark);
    roof.position.y = h + 1.88;
    roof.castShadow = true;
    this.add(roof);

    this.light = new THREE.PointLight(0xffa95a, this.baseIntensity, 28, 2);
    this.light.position.y = h + 0.75;
    this.add(this.light);

    // 光束：开口圆锥，顶点在灯处，沿 +X 方向延伸；沿长度和边缘淡出，加法混合
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color(0xffa95a) }, uStrength: { value: 0.35 } },
      vertexShader: /* glsl */ `
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          vAlong = clamp(position.x / 40.0, 0.0, 1.0); // 0=灯处 1=远端
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vNormalV = normalize(normalMatrix * normal);
          vViewDir = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uStrength;
        varying float vAlong;
        varying vec3 vNormalV;
        varying vec3 vViewDir;
        void main() {
          float rim = abs(dot(normalize(vNormalV), normalize(vViewDir)));
          float a = pow(rim, 2.0) * pow(1.0 - vAlong, 1.6) * uStrength;
          gl_FragColor = vec4(uColor * a, a);
          #include <colorspace_fragment>
        }
      `,
    });
    const beamGeo = new THREE.ConeGeometry(3.2, 40, 24, 1, true);
    // 圆锥尖端对准原点，朝 +X 延伸
    beamGeo.rotateZ(Math.PI / 2);
    beamGeo.translate(20, 0, 0);
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.frustumCulled = false;
    beam.renderOrder = 2;
    this.beamPivot.position.y = h + 0.75;
    this.beamPivot.add(beam);
    // 双向光束
    const beam2 = beam.clone();
    beam2.rotation.y = Math.PI;
    this.beamPivot.add(beam2);
    this.add(this.beamPivot);
  }

  get on(): boolean {
    return this._on;
  }

  toggle(): void {
    this._on = !this._on;
    this.beamPivot.visible = this._on;
    this.lamp.material.emissiveIntensity = this._on ? 8 : 0.2;
  }

  applyAtmosphere(a: AtmospherePreset): void {
    this.baseIntensity = a.lighthouseIntensity;
    this.flicker = a.lighthouseFlicker;
    this.light.color.set(a.lighthouseColor);
    this.light.distance = a.lighthouseDistance;
    this.lamp.material.emissive.set(a.lighthouseColor);
    (this.beamMat.uniforms.uColor!.value as THREE.Color).set(a.lighthouseColor);
  }

  update(dt: number): void {
    this.t += dt;
    this.beamPivot.rotation.y += dt * 0.35;
    const breath = 1 + Math.sin(this.t * 1.7) * this.flicker * 0.6 + Math.sin(this.t * 7.3) * this.flicker * 0.4;
    this.light.intensity = this._on ? this.baseIntensity * breath : this.baseIntensity * 0.03;
  }
}
