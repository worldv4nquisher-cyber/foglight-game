import * as THREE from 'three';
import { gameplay } from '@/config/gameplay';
import type { BeamColor } from './BeamEmitter';
import type { BeamTracer } from './BeamTracer';

/**
 * 光束画面接口（v0.1-012）：白盒版用发光圆柱 + 末端光斑；024 换成体积光束时实现同一个接口即可，BeamTracer 不变。
 * - sync：光路重算后调（tracer.traceCount 变化）
 * - update：每帧调（光源淡入淡出、接收器脉动）
 */
export interface BeamRenderer {
  readonly root: THREE.Object3D;
  update(dt: number, tracer: BeamTracer): void;
  dispose(): void;
}

const C = gameplay.beam.colors;
export function beamColors(c: BeamColor): { core: number; glow: number } {
  return c === 'warm' ? { core: C.warmCore, glow: C.warm } : { core: C.coldWhite, glow: C.coldWhite };
}

const UP_Z = new THREE.Vector3(0, 0, 1);

interface Seg {
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

/** 白盒光束：每段一根细芯 + 一层光晕（加法混合、不写深度），末端光斑；接收器透镜按进度写自发光、命中时脉动 */
export class WhiteboxBeamRenderer implements BeamRenderer {
  readonly root = new THREE.Group();
  coreRadius = 0.022;
  glowRadius = 0.085;
  private readonly cylinder: THREE.BufferGeometry;
  private readonly sphere = new THREE.SphereGeometry(1, 16, 10);
  private readonly segs: Seg[] = [];
  private readonly spots: Array<THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>> = [];
  /** 每段属于哪条光路（光源 intensity 用） */
  private segOwner: number[] = [];
  private seenTrace = -1;
  private time = 0;
  private readonly debug: THREE.LineSegments | null;

  constructor(opts: { debug?: boolean } = {}) {
    this.root.name = 'beam-renderer';
    // 单位圆柱沿 +Z，从 z = 0 到 z = 1
    this.cylinder = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    if (opts.debug) {
      const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true });
      this.debug = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
      this.debug.name = 'beam-debug';
      this.debug.renderOrder = 999;
      this.debug.frustumCulled = false;
      this.root.add(this.debug);
    } else this.debug = null;
  }

  get debugEnabled(): boolean {
    return this.debug !== null;
  }

  private mat(opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: true,
    });
  }

  private seg(i: number): Seg {
    let s = this.segs[i];
    if (!s) {
      const core = new THREE.Mesh(this.cylinder, this.mat(0.9));
      const glow = new THREE.Mesh(this.cylinder, this.mat(0.22));
      core.name = `beam-seg-${i}-core`;
      glow.name = `beam-seg-${i}-glow`;
      core.renderOrder = glow.renderOrder = 10;
      this.root.add(core, glow);
      s = { core, glow };
      this.segs[i] = s;
    }
    return s;
  }

  private spot(i: number): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    let s = this.spots[i];
    if (!s) {
      s = new THREE.Mesh(this.sphere, this.mat(0.8));
      s.name = `beam-spot-${i}`;
      s.renderOrder = 11;
      this.root.add(s);
      this.spots[i] = s;
    }
    return s;
  }

  /** 光路变了：摆放圆柱与光斑 */
  private sync(tracer: BeamTracer): void {
    let n = 0;
    this.segOwner = [];
    tracer.paths.forEach((p, pi) => {
      const col = beamColors(p.emitter.color);
      for (const s of p.segments) {
        const len = s.from.distanceTo(s.to);
        const g = this.seg(n);
        for (const [m, r] of [[g.core, this.coreRadius], [g.glow, this.glowRadius]] as const) {
          m.position.copy(s.from);
          m.quaternion.setFromUnitVectors(UP_Z, s.to.clone().sub(s.from).normalize());
          m.scale.set(r, r, Math.max(len, 1e-4));
          m.visible = len > 1e-4;
        }
        g.core.material.color.setHex(col.core);
        g.glow.material.color.setHex(col.glow);
        this.segOwner[n] = pi;
        n++;
      }
      const spot = this.spot(pi);
      spot.position.copy(p.endPoint);
      spot.scale.setScalar(p.end === 'receiver' ? 0.12 : 0.07);
      spot.visible = p.end !== 'none';
      spot.material.color.setHex(col.core);
    });
    for (let i = n; i < this.segs.length; i++) {
      const s = this.segs[i];
      if (s) s.core.visible = s.glow.visible = false;
    }
    for (let i = tracer.paths.length; i < this.spots.length; i++) {
      const s = this.spots[i];
      if (s) s.visible = false;
    }
    if (this.debug) this.syncDebug(tracer);
  }

  private syncDebug(tracer: BeamTracer): void {
    const pos: number[] = [];
    const col: number[] = [];
    const line = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Color): void => {
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    };
    const ray = new THREE.Color(0xffee55);
    const normal = new THREE.Color(0x55e0ff);
    const back = new THREE.Color(0xff5555);
    const frame = new THREE.Color(0xffffff);
    const recv = new THREE.Color(0x88ff88);
    for (const p of tracer.paths) for (const s of p.segments) line(s.from, s.to, ray);
    for (const m of tracer.mirrors) {
      const c = m.center();
      const n = m.normal();
      line(c, c.clone().addScaledVector(n, 0.5), normal);
      line(c, c.clone().addScaledVector(n, -0.15), back);
      const w = m.node.matrixWorld;
      const corners = [
        [-m.halfWidth, -m.halfHeight],
        [m.halfWidth, -m.halfHeight],
        [m.halfWidth, m.halfHeight],
        [-m.halfWidth, m.halfHeight],
      ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(w));
      for (let i = 0; i < 4; i++) line(corners[i] as THREE.Vector3, corners[(i + 1) % 4] as THREE.Vector3, frame);
    }
    for (const r of tracer.receivers) {
      const c = r.center();
      const seg = 24;
      for (const axis of [0, 1, 2]) {
        for (let i = 0; i < seg; i++) {
          const a0 = (i / seg) * Math.PI * 2;
          const a1 = ((i + 1) / seg) * Math.PI * 2;
          const pt = (a: number): THREE.Vector3 => {
            const u = Math.cos(a) * r.radius;
            const v = Math.sin(a) * r.radius;
            return c.clone().add(axis === 0 ? new THREE.Vector3(0, u, v) : axis === 1 ? new THREE.Vector3(u, 0, v) : new THREE.Vector3(u, v, 0));
          };
          line(pt(a0), pt(a1), recv);
        }
      }
    }
    const g = this.debug?.geometry;
    if (!g) return;
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeBoundingSphere();
  }

  update(dt: number, tracer: BeamTracer): void {
    this.time += dt;
    if (tracer.traceCount !== this.seenTrace) {
      this.seenTrace = tracer.traceCount;
      this.sync(tracer);
    }
    // 光源淡入淡出
    this.segOwner.forEach((pi, i) => {
      const s = this.segs[i];
      const e = tracer.paths[pi]?.emitter;
      if (!s || !e) return;
      s.core.material.opacity = 0.9 * e.intensity;
      s.glow.material.opacity = 0.22 * e.intensity;
      const on = e.intensity > 0.001;
      s.core.visible = s.glow.visible = on && s.core.scale.z > 1e-4;
    });
    tracer.paths.forEach((p, pi) => {
      const spot = this.spots[pi];
      if (!spot) return;
      const pulse = p.end === 'receiver' ? 0.75 + 0.25 * Math.sin(this.time * 7) : 1;
      spot.material.opacity = 0.8 * p.emitter.intensity * pulse;
      spot.visible = p.end !== 'none' && p.emitter.intensity > 0.001;
    });
    // 接收器透镜：充能按进度变亮并脉动；前置条件不满足 = 红光脉动；触发后常亮
    for (const r of tracer.receivers) {
      const m = r.lens?.material as THREE.MeshStandardMaterial | undefined;
      if (!m || !('emissive' in m)) continue;
      const pulse = 0.8 + 0.2 * Math.sin(this.time * 8);
      if (r.state === 'activated') {
        m.emissive.setHex(beamColors(r.hitColor ?? 'warm').core);
        m.emissiveIntensity = 2.2;
      } else if (r.state === 'blocked') {
        m.emissive.setHex(C.blocked);
        m.emissiveIntensity = (0.6 + 1.2 * r.progress) * pulse;
      } else if (r.state === 'charging') {
        m.emissive.setHex(beamColors(r.hitColor ?? 'warm').core);
        m.emissiveIntensity = (0.15 + 1.8 * r.progress) * pulse;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 0;
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.cylinder.dispose();
    this.sphere.dispose();
    for (const s of this.segs) {
      s.core.material.dispose();
      s.glow.material.dispose();
    }
    for (const s of this.spots) s.material.dispose();
    if (this.debug) {
      this.debug.geometry.dispose();
      (this.debug.material as THREE.Material).dispose();
    }
  }
}
