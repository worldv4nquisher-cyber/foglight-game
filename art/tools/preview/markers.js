// 预览调试：?mark=<正则> 把名字匹配的空节点（socket / interact / 挂点）画成穿透显示的小球 + 标签（名字尾段与 y）
// 返工 2026-10-29 加：前后对比图里看节点位置用。用法：import { addMarkers } from './markers.js'; addMarkers(THREE, scene, Q.get('mark'), label)
export function addMarkers(THREE, scene, pattern, label, opt = {}) {
  if (!pattern) return 0;
  const re = new RegExp(pattern);
  const found = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (!o.isMesh && o.name && re.test(o.name)) found.push(o); });
  const cols = ['#ff3b30', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2', '#ff9f0a', '#64d2ff'];
  found.forEach((o, i) => {
    const p = new THREE.Vector3(); o.getWorldPosition(p);
    const m = new THREE.Mesh(new THREE.SphereGeometry(opt.r ?? 0.06, 12, 8), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], depthTest: false, fog: false }));
    m.position.copy(p); m.renderOrder = 999; scene.add(m);
    // +Z 朝向小箭头
    const q = new THREE.Quaternion(); o.getWorldQuaternion(q);
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const ar = new THREE.ArrowHelper(dir, p, opt.arrow ?? 0.3, cols[i % cols.length], 0.08, 0.05);
    ar.traverse((c) => { if (c.material) { c.material.depthTest = false; c.material.fog = false; } c.renderOrder = 999; }); scene.add(ar);
    const short = o.name.replace(/^env-[a-z0-9-]*?-(?=(light|desk|key|shelf|sketch|lamp|tide|ignite|ignition|oil|stand|mid|lamp-room|boat|bell|oarlock|seat|mooring|window|lighthouse))/,'');
    label(`${short} y${p.y.toFixed(2)}`, [p.x, p.y, p.z]);
  });
  return found.length;
}
