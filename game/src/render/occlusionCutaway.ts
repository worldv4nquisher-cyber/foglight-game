import * as THREE from 'three';

const PATCHED = Symbol('occlusionCutaway');
const SWEEP_INTERVAL = 0.5;
/** 视窗半宽 / 半高（m，在汐的深度上）、中心离脚底的高度 */
const HALF_W = 0.6;
const HALF_H = 1.05;
const CENTER_Y = 0.9;
/** 只挖比汐近这么多（m）的片元，汐脚边的地面不挖 */
const DEPTH_MARGIN = 0.45;
/** 只挖高于汐脚底这么多（m）的片元：前方的地面、台阶面保留，挡住身体的岩石 / 墙 / 台阶侧板挖开 */
const FEET_CLEARANCE = 0.3;

type Patchable = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial;

function patchable(m: THREE.Material): m is Patchable {
  return (m instanceof THREE.MeshStandardMaterial || m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshPhongMaterial)
    && !m.transparent && !(m as unknown as Record<symbol, boolean>)[PATCHED];
}

/**
 * 第三人称遮挡透视：相机和汐之间的不透明几何（只做美术、不挡相机的岩石 / 楼梯 / 门框等），在汐周围一块屏幕窗口里抖动挖空，
 * 汐和路线始终看得见。只挖比汐近 DEPTH_MARGIN、高于脚底 FEET_CLEARANCE 的片元，脚下和前方的路面不受影响；只在探索相机下生效。
 * 场景每帧 update；新加载的美术材质每 0.5 s 扫一次补上（`userData.noCutaway` 的物体及其子树跳过，如汐本身）。
 */
export class OcclusionCutaway {
  /** 汐胸口（视空间，z 取正 = 深度；z = 0 关闭） */
  private readonly focus = new THREE.Vector3();
  /** 视空间里的世界向上方向 */
  private readonly up = new THREE.Vector3();
  /** x, y = 窗口半宽 / 半高，z = 深度余量，w = 脚底到焦点的高度 − 脚底余量 */
  private readonly params = new THREE.Vector4(HALF_W, HALF_H, DEPTH_MARGIN, CENTER_Y - FEET_CLEARANCE);
  private sweep = Infinity;

  constructor(private readonly root: THREE.Object3D) {}

  get active(): boolean {
    return this.focus.z > 0;
  }

  update(dt: number, camera: THREE.Camera, player: THREE.Vector3, exploring: boolean): void {
    this.sweep += dt;
    if (this.sweep >= SWEEP_INTERVAL) {
      this.sweep = 0;
      this.patchTree(this.root);
    }
    if (!exploring) {
      this.focus.set(0, 0, 0);
      return;
    }
    camera.updateMatrixWorld();
    const view = camera.matrixWorldInverse;
    this.focus.copy(player).y += CENTER_Y;
    this.focus.applyMatrix4(view);
    this.focus.z = Math.max(0, -this.focus.z);
    this.up.set(0, 1, 0).transformDirection(view);
  }

  private patchTree(root: THREE.Object3D): void {
    const visit = (o: THREE.Object3D): void => {
      if (o.userData.noCutaway) return;
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if ((o as THREE.Mesh).isMesh && m) for (const mat of Array.isArray(m) ? m : [m]) if (patchable(mat)) this.patch(mat);
      for (const c of o.children) visit(c);
    };
    visit(root);
  }

  private patch(material: Patchable): void {
    (material as unknown as Record<symbol, boolean>)[PATCHED] = true;
    const prev = material.onBeforeCompile.bind(material);
    const prevKey = material.customProgramCacheKey.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      prev(shader, renderer);
      shader.uniforms.cutFocus = { value: this.focus };
      shader.uniforms.cutUp = { value: this.up };
      shader.uniforms.cutParams = { value: this.params };
      shader.fragmentShader = 'uniform vec3 cutFocus;\nuniform vec3 cutUp;\nuniform vec4 cutParams;\n' + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `
        #include <clipping_planes_fragment>
        if (cutFocus.z > 0.3 && vViewPosition.z < cutFocus.z - cutParams.z) {
          vec3 cutP = -vViewPosition;
          vec3 cutF = vec3(cutFocus.xy, -cutFocus.z);
          if (dot(cutP - cutF, cutUp) > -cutParams.w) {
            float cutT = max(vViewPosition.z / cutFocus.z, 0.01);
            vec2 cutO = (cutP.xy / cutT - cutFocus.xy) / cutParams.xy;
            float cutRim = smoothstep(0.75, 1.05, length(cutO));
            float cutGrain = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (cutRim < cutGrain) discard;
          }
        }
      `);
    };
    material.customProgramCacheKey = () => `${prevKey()}|cutaway`;
    material.needsUpdate = true;
  }
}
