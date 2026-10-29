import * as THREE from 'three';

/**
 * 简易外扩描边（v0.1-004；正式描边在 023）：给目标的每个网格加一个沿法线外扩、只画背面的纯色壳。
 * 有 COLOR_0 平滑法线（geometry.userData.outlineNormals = 'color'，见 assets/vertexColors.ts）时用它外扩，
 * 否则用普通法线（方盒的棱角处会有小缝，白盒阶段可以接受）。
 *
 * 两种样式：
 * - part：机关当前部件，冷色、半透明、细（「微弱描边」）
 * - hint：提示系统二级提示 highlight()，琥珀色、更粗，到时自动消失
 */
export type OutlineStyle = 'part' | 'hint';

const STYLE: Record<OutlineStyle, { color: number; opacity: number; width: number }> = {
  part: { color: 0xa9bcc4, opacity: 0.45, width: 0.012 },
  hint: { color: 0xffd38a, opacity: 0.9, width: 0.022 },
};

const OUTLINE_TAG = '__outline';

function makeMaterial(style: OutlineStyle, useColorNormals: boolean): THREE.ShaderMaterial {
  const s = STYLE[style];
  return new THREE.ShaderMaterial({
    name: `outline-${style}`,
    uniforms: { uColor: { value: new THREE.Color(s.color) }, uOpacity: { value: s.opacity }, uWidth: { value: s.width } },
    vertexShader: /* glsl */ `
      uniform float uWidth;
      ${useColorNormals ? 'attribute vec3 color;' : ''}
      void main() {
        vec3 n = ${useColorNormals ? 'normalize(color * 2.0 - 1.0)' : 'normalize(normal)'};
        // 外扩宽度按世界米：除以模型矩阵的缩放
        float sx = length(modelMatrix[0].xyz);
        vec3 p = position + n * (uWidth / max(sx, 1e-4));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      void main() { gl_FragColor = vec4(uColor, uOpacity); }`,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
  });
}

interface Active {
  root: THREE.Object3D;
  shells: THREE.Mesh[];
  style: OutlineStyle;
  /** 剩余时间（s），Infinity = 一直亮到手动关 */
  remaining: number;
  key: string;
}

export class Highlighter {
  private active = new Map<string, Active>();
  private materials = new Map<string, THREE.ShaderMaterial>();

  /** 给 root 下所有网格加描边；同一 key 再调用只刷新时长 */
  add(key: string, root: THREE.Object3D, style: OutlineStyle, seconds = Infinity): void {
    const cur = this.active.get(key);
    if (cur) {
      cur.remaining = seconds;
      return;
    }
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !m.userData[OUTLINE_TAG] && m.visible) meshes.push(m);
    });
    const shells: THREE.Mesh[] = [];
    for (const m of meshes) {
      const colorNormals = m.geometry.userData.outlineNormals === 'color' && Boolean(m.geometry.getAttribute('color'));
      const shell = new THREE.Mesh(m.geometry, this.material(style, colorNormals));
      shell.name = `${m.name || 'mesh'}${OUTLINE_TAG}`;
      shell.userData[OUTLINE_TAG] = true;
      shell.renderOrder = 2;
      shell.castShadow = shell.receiveShadow = false;
      shell.raycast = () => undefined;
      m.add(shell);
      shells.push(shell);
    }
    this.active.set(key, { root, shells, style, remaining: seconds, key });
  }

  remove(key: string): boolean {
    const a = this.active.get(key);
    if (!a) return false;
    for (const s of a.shells) s.removeFromParent();
    this.active.delete(key);
    return true;
  }

  has(key: string): boolean {
    return this.active.has(key);
  }

  /** 当前有描边壳的 key（测试 / 调试用） */
  keys(): string[] {
    return [...this.active.keys()];
  }

  /** 计时：到时的移除，返回本次移除的 key */
  update(dt: number): string[] {
    const ended: string[] = [];
    for (const a of this.active.values()) {
      if (a.remaining === Infinity) continue;
      a.remaining -= dt;
      if (a.remaining <= 0) ended.push(a.key);
    }
    for (const k of ended) this.remove(k);
    return ended;
  }

  clear(): void {
    for (const k of [...this.active.keys()]) this.remove(k);
  }

  dispose(): void {
    this.clear();
    for (const m of this.materials.values()) m.dispose();
    this.materials.clear();
  }

  private material(style: OutlineStyle, colorNormals: boolean): THREE.ShaderMaterial {
    const k = `${style}:${colorNormals ? 1 : 0}`;
    let m = this.materials.get(k);
    if (!m) {
      m = makeMaterial(style, colorNormals);
      this.materials.set(k, m);
    }
    return m;
  }
}
