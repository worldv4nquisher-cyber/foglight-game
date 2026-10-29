import * as THREE from 'three';

/**
 * 七段数字（白盒占位，不用字体 / canvas）：谜题 4 的白石数字显影、拨盘刻度共用。
 * 段：a 上、b 右上、c 右下、d 下、e 左下、f 左上、g 中。原点 = 数字中心，局部 +Z 朝外，高 h、宽 0.55h。
 */
const SEGMENTS: Record<number, string> = {
  0: 'abcdef',
  1: 'bc',
  2: 'abged',
  3: 'abgcd',
  4: 'fgbc',
  5: 'afgcd',
  6: 'afgedc',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

export function sevenSegment(digit: number, h: number, mat: THREE.Material, thickness = 0.14): THREE.Group {
  const g = new THREE.Group();
  g.name = `digit-${digit}`;
  const w = h * 0.55;
  const t = h * thickness;
  const horiz = new THREE.PlaneGeometry(w, t);
  const vert = new THREE.PlaneGeometry(t, h / 2);
  const at: Record<string, [THREE.BufferGeometry, number, number]> = {
    a: [horiz, 0, h / 2 - t / 2],
    g: [horiz, 0, 0],
    d: [horiz, 0, -h / 2 + t / 2],
    b: [vert, w / 2 - t / 2, h / 4],
    c: [vert, w / 2 - t / 2, -h / 4],
    f: [vert, -w / 2 + t / 2, h / 4],
    e: [vert, -w / 2 + t / 2, -h / 4],
  };
  for (const s of SEGMENTS[((digit % 10) + 10) % 10] ?? '') {
    const [geo, x, y] = at[s]!;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, 0);
    g.add(m);
  }
  return g;
}
