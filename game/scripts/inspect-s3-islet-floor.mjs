import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { S3 } from '@/levels/s3/layout';
globalThis.self ??= globalThis;
const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
const ktx2Stub = { load: (_u, onLoad) => onLoad(new THREE.CompressedTexture([], 1, 1)) };
const ART = '/workspace/game-studio/art/models';
async function load(f) { const buf = readFileSync(f); return (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '')).scene; }
const COLL = /-(collider|wall)(\.\d+)?$/i;
const islet = await load(`${ART}/env/env-rock-islet-a.glb`);
const inter = await load(`${ART}/env/env-lighthouse-ch1-interior.glb`);
const tower = await load(`${ART}/env/env-lighthouse-ch1-s3.glb`).catch(() => null);
for (const s of [islet, inter, tower]) s?.updateMatrixWorld(true);
const nodes = {};
for (const s of [islet, inter, tower]) s?.traverse((o) => { if (/stair|floor|door|socket|bottom/i.test(o.name) && !o.isMesh) { const p = o.getWorldPosition(new THREE.Vector3()); nodes[o.name] = p.toArray().map((v) => +v.toFixed(3)); } });
console.log('节点', JSON.stringify(nodes, null, 0).slice(0, 3000));
const meshesOf = (s, lod0) => { const r = []; s?.traverse((o) => { if (o.isMesh && !COLL.test(o.name) && !(o.parent && COLL.test(o.parent.name)) && (!lod0 || !/_lod[12]/i.test(o.name + (o.parent?.name ?? '')))) r.push(o); }); return r; };
const im = meshesOf(islet, true);
console.log('islet 网格', im.map((m) => m.name).join(', '));
// 礁岛塔内 r<rIn 的三角形：朝上面最高点
const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
let up = [];
for (const m of im) {
  const g = m.geometry, P = g.attributes.position, I = g.index;
  const cnt = I ? I.count : P.count;
  for (let i = 0; i < cnt; i += 3) {
    const ix = (k) => (I ? I.getX(i + k) : i + k);
    a.fromBufferAttribute(P, ix(0)).applyMatrix4(m.matrixWorld); b.fromBufferAttribute(P, ix(1)).applyMatrix4(m.matrixWorld); c.fromBufferAttribute(P, ix(2)).applyMatrix4(m.matrixWorld);
    const cx = (a.x + b.x + c.x) / 3, cz = (a.z + b.z + c.z) / 3, cy = (a.y + b.y + c.y) / 3;
    if (Math.hypot(cx, cz) > S3.tower.rIn) continue;
    n.subVectors(b, a).cross(c.clone().sub(a)); const area = n.length() / 2; n.normalize();
    if (cy > S3.groundFloorY - 0.02) up.push({ m: m.name, cx, cy, cz, ny: n.y, area, ymax: Math.max(a.y, b.y, c.y) });
  }
}
const above = up.filter((t) => t.ymax > S3.groundFloorY + 0.01);
const areaUp = above.filter((t) => t.ny > 0.5).reduce((s, t) => s + t.area, 0);
console.log(`塔内(r<${S3.tower.rIn}) 礁岛三角形高于地板 ${S3.groundFloorY}：${above.length} 个，其中朝上(ny>0.5)面积 ${areaUp.toFixed(2)} m²，最高 ${Math.max(...above.map((t) => t.ymax)).toFixed(3)}`);
if (above.length) {
  const xs = above.map((t) => t.cx), zs = above.map((t) => t.cz);
  console.log('  范围 x', Math.min(...xs).toFixed(2), Math.max(...xs).toFixed(2), 'z', Math.min(...zs).toFixed(2), Math.max(...zs).toFixed(2));
  const byMesh = {}; for (const t of above) byMesh[t.m] = (byMesh[t.m] ?? 0) + 1; console.log('  按网格', JSON.stringify(byMesh));
}
// 竖直射线：取各点礁岛 / 室内地板最高命中
const rc = new THREE.Raycaster();
const hitY = (meshes, x, z) => { rc.set(new THREE.Vector3(x, 5, z), new THREE.Vector3(0, -1, 0)); rc.far = 10; const h = rc.intersectObjects(meshes, false).filter((h) => h.point.y < 4); return h.length ? +h[0].point.y.toFixed(3) : null; };
const intM = meshesOf(inter, true);
const pts = { stairBottom: S3.points.stairBottom, doorLanding: S3.points.doorLanding, logbookRead: S3.points.logbookRead, ...Object.fromEntries(Object.entries(S3.points).filter(([, v]) => Array.isArray(v) && v[1] < 1.5)) };
console.log('点  [x,y,z]  礁岛顶 | 室内地板顶');
for (const [k, p] of Object.entries(pts)) console.log(' ', k, JSON.stringify(p), hitY(im, p[0], p[2]), '|', hitY(intM, p[0], p[2]));
// 塔内网格扫：礁岛露出地板的格子
let grid = [];
for (let x = -3; x <= 3; x += 0.25) for (let z = -3; z <= 3; z += 0.25) { if (Math.hypot(x, z) > S3.tower.rIn - 0.05) continue; const y = hitY(im, x, z), f = hitY(intM, x, z); if (y !== null && y > (f ?? S3.groundFloorY) + 0.01) grid.push([x, z, y, f]); }
console.log('礁岛高于室内地板的格点（0.25 m）', grid.length, JSON.stringify(grid.slice(0, 60)));
// 覆盖率 + 各 LOD
const lods = {};
islet.traverse((o) => { if (o.isMesh && !COLL.test(o.name)) { const m = /_lod(\d)/i.exec(o.name + ' ' + (o.parent?.name ?? '')); const k = m ? m[1] : '0'; (lods[k] ??= []).push(o); } });
for (const [k, ms] of Object.entries(lods)) {
  let tot = 0, cov = 0, maxD = 0; const hs = {};
  for (let x = -3; x <= 3; x += 0.1) for (let z = -3; z <= 3; z += 0.1) { if (Math.hypot(x, z) > S3.tower.rIn - 0.05) continue; tot++; const y = hitY(ms, x, z); if (y !== null && y > S3.groundFloorY + 0.01) { cov++; maxD = Math.max(maxD, y - S3.groundFloorY); hs[y.toFixed(2)] = (hs[y.toFixed(2)] ?? 0) + 1; } }
  console.log(`LOD${k}：塔内 ${tot} 格（0.1 m）中礁岛高过 0.2 地板 ${cov} 格 = ${(100 * cov / tot).toFixed(1)}%（≈${(cov * 0.01).toFixed(1)} m²），最大高出 ${maxD.toFixed(2)} m；高度分布 ${JSON.stringify(Object.entries(hs).sort((a, b) => b[1] - a[1]).slice(0, 5))}`);
}
// ASCII 图（0.25 m，S3 局部 x 横、z 纵）：# 礁岛高过地板，. 地板，S 楼梯起点，D 门口
let out = '';
for (let z = 3; z >= -3; z -= 0.25) { let row = ''; for (let x = -3; x <= 3; x += 0.25) { if (Math.hypot(x, z) > S3.tower.rIn) { row += ' '; continue; } if (Math.hypot(x - S3.points.stairBottom[0], z - S3.points.stairBottom[2]) < 0.15) { row += 'S'; continue; } const y = hitY(lods['0'], x, z); row += y !== null && y > S3.groundFloorY + 0.01 ? '#' : '.'; } out += row + '\n'; }
console.log(out);
