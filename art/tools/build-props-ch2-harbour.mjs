import { writeFileSync } from 'node:fs';
import * as T from '../../game/node_modules/three/build/three.module.js';
import { GLTFExporter } from '../../game/node_modules/three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from '../../game/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';

globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    void blob.arrayBuffer().then((result) => {
      this.result = result;
      this.onloadend();
    });
  }
};

const root = new T.Group();
root.name = 'prop-harbour-kit-ch2-s1';
const colors = {
  oak: 0x796454, tar: 0x4a4240, salt: 0x998571, rope: 0xa4997a, net: 0x4d706e,
  iron: 0x584d49, rust: 0x794c39, cork: 0xa37d4f, red: 0x975746, fish: 0x8a9b9e,
};
let batch;
function shape(geometry, mat, x, y, z, rotation = new T.Quaternion()) {
  geometry.applyQuaternion(rotation).translate(x, y, z);
  if (!batch.has(mat)) batch.set(mat, []);
  batch.get(mat).push(geometry.index ? geometry.toNonIndexed() : geometry);
}
const box = (mat, x, y, z, w, h, d) => shape(new T.BoxGeometry(w, h, d), mat, x, y, z);
function pole(mat, a, b, radius, sides = 6) {
  const va = new T.Vector3(...a), vb = new T.Vector3(...b);
  const d = vb.clone().sub(va);
  shape(new T.CylinderGeometry(radius, radius, d.length(), sides), mat, ...va.lerp(vb, 0.5).toArray(),
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize()));
}
function prop(name, build) {
  batch = new Map();
  build();
  const part = new T.Group();
  part.name = name;
  const mesh = new T.Group();
  mesh.name = name + '_lod0';
  for (const [key, pieces] of batch) {
    const material = new T.MeshStandardMaterial({ color: colors[key], roughness: 0.83 });
    material.name = 'mat-ch2-' + key;
    mesh.add(new T.Mesh(mergeGeometries(pieces), material));
  }
  part.add(mesh);
  root.add(part);
}

prop('harbour-net-rack', () => {
  for (const x of [-0.93, 0.93]) {
    pole('tar', [x, 0, 0.29], [x, 1.64, 0], 0.047);
    pole('oak', [x, 0, -0.37], [x, 1.64, 0], 0.045);
  }
  pole('salt', [-1.06, 1.65, 0], [1.06, 1.65, 0], 0.051);
  const point = (u, v) => [u * 0.88, 1.6 - v * (0.89 + 0.14 * Math.cos(u * 2.5)), -0.15 * Math.sin(v * 3.1) + Math.sin(u * 3) * v * 0.08];
  for (let i = 0; i <= 16; i++) {
    const u = i / 8 - 1;
    for (let j = 0; j < 6; j++) pole('net', point(u, j / 6), point(u, (j + 1) / 6), 0.008, 4);
  }
  for (let j = 1; j <= 6; j++) {
    for (let i = 0; i < 16; i++) pole(j === 6 ? 'rope' : 'net', point(i / 8 - 1, j / 6), point((i + 1) / 8 - 1, j / 6), 0.008, 4);
  }
  for (const x of [-0.8, -0.4, 0, 0.4, 0.8]) box('cork', x, 1.59, -0.03, 0.10, 0.045, 0.055);
});

prop('harbour-fish-basket', () => {
  shape(new T.CylinderGeometry(0.29, 0.22, 0.3, 12, 1, true), 'oak', 0, 0.16, 0);
  shape(new T.CylinderGeometry(0.22, 0.22, 0.043, 12), 'tar', 0, 0.025, 0);
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i < 7; i++) shape(new T.TorusGeometry(0.222 + i * 0.0112, 0.012, 4, 16), i % 3 ? 'cork' : 'rope', 0, 0.062 + i * 0.04, 0, q);
  for (let i = 0; i < 5; i++) {
    const theta = i * 2.4;
    const g = new T.SphereGeometry(1, 8, 4).scale(0.13, 0.022, 0.035);
    shape(g, 'fish', Math.sin(theta) * 0.109, 0.20 + i * 0.013, Math.cos(theta) * 0.12,
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), theta));
  }
});

prop('harbour-mooring', () => {
  box('oak', 0, 0.41, 0, 0.23, 0.82, 0.23);
  box('salt', 0, 0.814, 0, 0.235, 0.028, 0.235);
  pole('iron', [-0.21, 0.57, 0], [0.21, 0.57, 0], 0.032);
  const q = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), -Math.PI / 2);
  for (let i = 0; i < 4; i++) shape(new T.TorusGeometry(0.173, 0.016, 5, 12), 'rope', 0, 0.47 + i * 0.03, 0, q);
  pole('rope', [0.12, 0.55, -0.08], [0.33, 0.17, -0.28], 0.016);
  pole('rope', [0.33, 0.17, -0.28], [0.42, 0.03, -0.44], 0.016);
});

prop('harbour-checkboard', () => {
  box('oak', 0, 1.26, 0, 1.42, 0.79, 0.085);
  box('tar', 0, 1.26, 0.053, 1.32, 0.69, 0.022);
  for (const x of [-0.62, 0.62]) box('oak', x, 0.414, 0, 0.072, 0.84, 0.08);
  box('salt', 0, 0.859, 0.083, 1.42, 0.045, 0.17);
});

const bytes = await new GLTFExporter().parseAsync(root, { binary: true });
writeFileSync(new URL('../models/props/prop-harbour-kit-ch2-s1.glb', import.meta.url), Buffer.from(bytes));
