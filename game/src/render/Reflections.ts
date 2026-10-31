import * as THREE from 'three';

/**
 * v0.1-025 水面平面反射（style-guide §7.5 / §8 `reflections.planar`：极致 1.0× / 高 0.5× / 标准 0.25×）。
 *
 * 做法（同 three/examples Reflector 的镜像相机，但不自带材质：Water 在自己的 MeshStandardMaterial 里采样）：
 * - 镜像相机 = 主相机关于水平面 y = level（平均水位，不含浪）的镜像；投影 = 主相机投影 + Lengyel 斜裁剪（近平面换成水面，
 *   水面以下的东西不进倒影；clipBias 往下让一点，浪谷附近的岸石不被切掉一条缝）。
 * - 渲染到 HalfFloat 线性 RT（后处理之前的辐亮度，色调映射 / LUT 在主画面统一做）；不重算阴影贴图（沿用上一帧）。
 * - 只在可见时更新：水面不可见 / 不在视锥里（水面平板 ±浪高的包围盒）/ 相机在水面以下 → 不渲染，强度 k = 0。
 * - 相机贴近水面：k = smoothstep(fadeIn[0], fadeIn[1], 相机离水面高度)，从水面下到上平滑淡入，不跳变（斜裁剪在相机贴着平面时退化，正好被淡掉）。
 * - 雾：镜像相机到物体的距离 = 真实光路（相机 → 水面 → 物体），所以 RT 里的雾就是对的；Water 在自己的雾之后再混反射（不重复上雾）。
 * - 雨（镜头附近的粒子）和水面自身不进倒影（hide 列表）；角色 / 灯束 / 雾卡照常画。
 * 分辨率 = 画布 × scale（画质档）；?reflect=off|0.25|0.5|1 调试覆盖。
 */
export interface ReflectionStats {
  /** 本帧是否渲染了倒影 */
  rendered: boolean;
  /** 没渲染的原因 */
  skip: string | null;
  /** 倒影 pass 的 draw call / 三角形（renderer.info，单 pass） */
  calls: number;
  triangles: number;
  /** 倒影 pass 的 CPU 提交时间（ms，含 swiftshader 下的光栅化，GPU 计时没有） */
  ms: number;
  width: number;
  height: number;
  /** 累计渲染 / 跳过帧数 */
  renders: number;
  skips: number;
  k: number;
}

export interface ReflectionUniforms {
  tReflect: { value: THREE.Texture | null };
  uReflMatrix: { value: THREE.Matrix4 };
  uReflK: { value: number };
}

export const REFLECTION = Object.freeze({
  /** 相机离平均水面多高时倒影从 0 淡到全（m） */
  fadeIn: [0.05, 0.6] as readonly [number, number],
  /** 斜裁剪平面往水面下让多少（裁剪空间 z 偏移，同 Reflector.clipBias） */
  clipBias: 0.003,
  /** 视锥判定时水面包围盒上下各放宽（m）：浪振幅和 0.375 */
  waveBand: 0.4,
  /** RT 最小边长 */
  minSize: 64,
  /** 水面被挡住（遮挡查询 0 样本，如塔内）时每隔几帧补画一次，免得重新露出来的第一帧是很旧的倒影 */
  occludedEvery: 8,
});

const smoothstep = (a: number, b: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

/** 相机离水面 h 米时的倒影强度（单测 / 着色同式） */
export function reflectionFade(h: number): number {
  return smoothstep(REFLECTION.fadeIn[0], REFLECTION.fadeIn[1], h);
}

/** URL 覆盖：?reflect=off → 0；数字 → 倍率；没有 → null（按画质档） */
export function reflectionOverride(search: string | null): number | null {
  if (!search) return null;
  const v = new URLSearchParams(search).get('reflect');
  if (v === null) return null;
  if (v === 'off' || v === '0') return 0;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(1, n) : null;
}

export class PlanarReflection {
  readonly target: THREE.WebGLRenderTarget;
  readonly camera = new THREE.PerspectiveCamera();
  /** Water 着色器共享的 uniform（tReflect / uReflMatrix / uReflK）；bindUniforms 换成水面材质自己的对象 */
  uniforms: ReflectionUniforms = {
    tReflect: { value: null as THREE.Texture | null },
    uReflMatrix: { value: new THREE.Matrix4() },
    uReflK: { value: 0 },
  };
  /** 画质档倍率（0 = 关） */
  scale = 0.5;
  /** 倒影里不画的东西（雨、水面自身） */
  readonly hide: THREE.Object3D[] = [];
  enabled = true;
  readonly stats: ReflectionStats = { rendered: false, skip: 'init', calls: 0, triangles: 0, ms: 0, width: 0, height: 0, renders: 0, skips: 0, k: 0 };

  private readonly size = new THREE.Vector2();
  private readonly box = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly m4 = new THREE.Matrix4();
  private readonly camPos = new THREE.Vector3();
  private readonly planePoint = new THREE.Vector3();
  private readonly normal = new THREE.Vector3(0, 1, 0);
  private readonly view = new THREE.Vector3();
  private readonly target3 = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly rot = new THREE.Matrix4();
  private readonly plane = new THREE.Plane();
  private readonly clipPlane = new THREE.Vector4();
  private readonly q = new THREE.Vector4();
  private readonly hiddenState: boolean[] = [];
  // 遮挡查询（WebGL2 ANY_SAMPLES_PASSED_CONSERVATIVE）：主画面里水面有没有像素通过深度测试；结果晚 1–2 帧，只用来省「被墙挡住」时的开销
  private gl: WebGL2RenderingContext | null = null;
  private query: WebGLQuery | null = null;
  private queryOpen = false;
  private queryPending = false;
  /** 最近一次查询结果：null = 还没有 / 不支持（当作可见） */
  occluded: boolean | null = null;
  private frame = 0;

  constructor() {
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 0 });
    this.target.texture.name = 'planar-reflection';
    this.target.texture.generateMipmaps = false;
    this.target.texture.minFilter = THREE.LinearFilter;
    this.target.texture.magFilter = THREE.LinearFilter;
    this.uniforms.tReflect.value = this.target.texture;
    this.camera.name = 'planar-reflection-cam';
    this.camera.matrixAutoUpdate = true;
  }

  /** 写进水面材质自己的 uniform 对象（材质编译时已经抓住了它们） */
  bindUniforms(u: ReflectionUniforms): void {
    u.tReflect.value = this.target.texture;
    u.uReflK.value = this.uniforms.uReflK.value;
    this.uniforms = u;
  }

  /**
   * 在水面主画面那次绘制上挂遮挡查询（onBeforeRender / onAfterRender 夹住 draw call）。
   * 只认主相机 + 水面自己的材质（后处理的法线 / ID pass 用 overrideMaterial，不算）+ 不是在画倒影。
   */
  attachOcclusion(renderer: THREE.WebGLRenderer, water: THREE.Mesh, mainCamera: THREE.Camera): void {
    const gl = renderer.getContext();
    if (!(typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext)) return;
    this.gl = gl;
    const mat = water.material;
    water.onBeforeRender = (r, _s, cam, _g, m) => {
      if (cam !== mainCamera || m !== mat || r.getRenderTarget() === this.target || this.queryOpen) return;
      if (this.queryPending) {
        if (!this.query || !gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
        this.occluded = !gl.getQueryParameter(this.query, gl.QUERY_RESULT);
        this.queryPending = false;
      }
      this.query ??= gl.createQuery();
      if (!this.query) return;
      gl.beginQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE, this.query);
      this.queryOpen = true;
    };
    water.onAfterRender = () => {
      if (!this.queryOpen) return;
      gl.endQuery(gl.ANY_SAMPLES_PASSED_CONSERVATIVE);
      this.queryOpen = false;
      this.queryPending = true;
    };
  }

  private skip(reason: string): void {
    const s = this.stats;
    s.rendered = false;
    s.skip = reason;
    s.skips++;
    s.k = 0;
    this.uniforms.uReflK.value = 0;
  }

  /**
   * 每帧主画面之前调用。water = 水面网格（取 level / 范围 / 可见性），halfExtent = 水面平板半边长（m）。
   */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, water: THREE.Mesh | null, halfExtent: number): void {
    if (!this.enabled || this.scale <= 0) return this.skip('off');
    if (!water || !water.visible || !water.parent) return this.skip('no-water');
    const level = water.position.y;
    camera.updateMatrixWorld();
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    const k = reflectionFade(this.camPos.y - level);
    if (k <= 0) return this.skip('below');
    // 视锥：水面平板（±浪带）
    const wx = water.position.x;
    const wz = water.position.z;
    const band = REFLECTION.waveBand;
    this.box.min.set(wx - halfExtent, level - band, wz - halfExtent);
    this.box.max.set(wx + halfExtent, level + band, wz + halfExtent);
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.m4);
    if (!this.frustum.intersectsBox(this.box)) return this.skip('frustum');
    this.frame++;
    if (this.occluded === true && this.frame % REFLECTION.occludedEvery !== 0) {
      // 挡住：不画，k 不变（重新露出来那一帧用最多 8 帧前的倒影，不闪）
      this.stats.rendered = false;
      this.stats.skip = 'occluded';
      this.stats.skips++;
      return;
    }

    // RT 尺寸
    renderer.getDrawingBufferSize(this.size);
    const w = Math.max(REFLECTION.minSize, Math.round(this.size.x * this.scale));
    const h = Math.max(REFLECTION.minSize, Math.round(this.size.y * this.scale));
    if (this.target.width !== w || this.target.height !== h) this.target.setSize(w, h);

    // 镜像相机（Reflector 同式）
    const n = this.normal;
    this.planePoint.set(this.camPos.x, level, this.camPos.z);
    this.view.subVectors(this.planePoint, this.camPos);
    this.view.reflect(n).negate().add(this.planePoint);
    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.target3.subVectors(this.planePoint, this.lookAt).reflect(n).negate().add(this.planePoint);
    const vc = this.camera;
    vc.position.copy(this.view);
    vc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(n);
    vc.lookAt(this.target3);
    vc.near = camera.near;
    vc.far = camera.far;
    vc.updateMatrixWorld();
    vc.projectionMatrix.copy(camera.projectionMatrix);
    vc.layers.mask = camera.layers.mask;

    // 世界坐标 → 倒影贴图投影坐标
    this.uniforms.uReflMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vc.projectionMatrix).multiply(vc.matrixWorldInverse);

    // 斜裁剪：近平面 = 水面（镜像相机空间）
    this.plane.setFromNormalAndCoplanarPoint(n, this.planePoint).applyMatrix4(vc.matrixWorldInverse);
    this.clipPlane.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = vc.projectionMatrix.elements;
    this.q.set((Math.sign(this.clipPlane.x) + e[8]) / e[0], (Math.sign(this.clipPlane.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clipPlane.multiplyScalar(2 / this.clipPlane.dot(this.q));
    e[2] = this.clipPlane.x;
    e[6] = this.clipPlane.y;
    e[10] = this.clipPlane.z + 1 - REFLECTION.clipBias;
    e[14] = this.clipPlane.w;
    vc.projectionMatrixInverse.copy(vc.projectionMatrix).invert();

    // 渲染
    const prevTarget = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevTone = renderer.toneMapping;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.toneMapping = THREE.NoToneMapping;
    for (let i = 0; i < this.hide.length; i++) {
      this.hiddenState[i] = this.hide[i]!.visible;
      this.hide[i]!.visible = false;
    }
    const info = renderer.info.render;
    const calls0 = info.calls;
    const tri0 = info.triangles;
    const t0 = performance.now();
    renderer.setRenderTarget(this.target);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, vc);
    const ms = performance.now() - t0;
    // Game 关了 info.autoReset（整帧累计）→ 取差值；autoReset 开着时 render() 自己清零，差值 = 本 pass
    const calls = renderer.info.autoReset ? info.calls : info.calls - calls0;
    const tris = renderer.info.autoReset ? info.triangles : info.triangles - tri0;
    for (let i = 0; i < this.hide.length; i++) this.hide[i]!.visible = this.hiddenState[i]!;
    renderer.setRenderTarget(prevTarget);
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.toneMapping = prevTone;

    const s = this.stats;
    s.rendered = true;
    s.skip = null;
    s.calls = calls;
    s.triangles = tris;
    s.ms = ms;
    s.width = w;
    s.height = h;
    s.renders++;
    s.k = k;
    this.uniforms.uReflK.value = k;
  }

  debugLine(): string {
    const s = this.stats;
    return s.rendered ? `倒影${this.occluded ? '（挡住，补画）' : ''} ${s.width}×${s.height} ×${this.scale} · ${s.calls} dc · ${(s.triangles / 1000).toFixed(0)}k tri · ${s.ms.toFixed(1)} ms · k ${s.k.toFixed(2)}` : `倒影 跳过（${s.skip}）`;
  }

  dispose(): void {
    if (this.gl && this.query) this.gl.deleteQuery(this.query);
    this.query = null;
    this.target.dispose();
  }
}
