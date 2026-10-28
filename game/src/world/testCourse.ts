import * as THREE from 'three';

/**
 * 角色控制器测试场地（v0.1-002 验收用，灰盒）。纯 three，不依赖 DOM：
 * Node 校验脚本（scripts/verify-physics.mjs）和浏览器里的 TestbedScene 用的是同一份几何。
 *
 * 场地原点在地面中心（顶面 y = 0），所有碰撞网格都以 `-collider` / `-wall` 命名，
 * 走的是与美术模型相同的 addFromModel() 路径。anchors 是测试用的关键点。
 */
export interface TestCourse {
  root: THREE.Group;
  /** 动态碰撞体（可开关的闸门） */
  gate: THREE.Mesh;
  /** 会升降的平台（动态碰撞体，测试「带着走」） */
  lift: THREE.Mesh;
  anchors: {
    spawn: THREE.Vector3;
    ramp30: { foot: THREE.Vector3; dir: THREE.Vector3; top: number };
    ramp45: { foot: THREE.Vector3; dir: THREE.Vector3 };
    step25: { before: THREE.Vector3; dir: THREE.Vector3; height: number };
    step40: { before: THREE.Vector3; dir: THREE.Vector3; height: number };
    spiral: { center: THREE.Vector3; radius: number; riser: number; steps: number; stepAngle: number; walkRadius: number };
    wall: { z: number; start: THREE.Vector3 };
    gate: { before: THREE.Vector3; after: THREE.Vector3 };
    lift: { center: THREE.Vector3 };
    link: { start: THREE.Vector3; end: THREE.Vector3; mid: THREE.Vector3 };
  };
}

/** 楔形（三棱柱）：沿 +z 方向从 0 升到 rise，宽 width（x 居中） */
export function wedgeGeometry(width: number, run: number, rise: number): THREE.BufferGeometry {
  const w = width / 2;
  // 6 个顶点：底面四角 + 高端两点
  const v = [
    [-w, 0, 0], [w, 0, 0], [w, 0, run], [-w, 0, run],
    [-w, rise, run], [w, rise, run],
  ];
  const tris = [
    [0, 2, 1], [0, 3, 2], // 底
    [0, 1, 5], [0, 5, 4], // 斜面
    [3, 4, 5], [3, 5, 2], // 高端竖直面
    [0, 4, 3], // 左侧
    [1, 2, 5], // 右侧
  ];
  const pos: number[] = [];
  for (const t of tris) for (const i of t) pos.push(...(v[i] ?? [0, 0, 0]));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function buildTestCourse(material: THREE.Material = new THREE.MeshStandardMaterial({ color: 0x7a7f80 })): TestCourse {
  const root = new THREE.Group();
  root.name = 'test-course';
  const box = (name: string, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    m.name = name;
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };

  // 地面 40 × 40（顶面 y = 0）
  box('ground-collider', 40, 1, 40, 0, -0.5, 0);

  // 30° / 45° 坡：沿 +z 上升，跑 4 m
  const tan30 = Math.tan(Math.PI / 6);
  const r30 = new THREE.Mesh(wedgeGeometry(2, 4, 4 * tan30), material);
  r30.name = 'ramp30-collider';
  r30.position.set(-10, 0, -4);
  root.add(r30);
  box('ramp30-top-collider', 2, 4 * tan30, 2, -10, (4 * tan30) / 2, 1);
  const r45 = new THREE.Mesh(wedgeGeometry(2, 3, 3), material);
  r45.name = 'ramp45-collider';
  r45.position.set(-6, 0, -4);
  root.add(r45);

  // 台阶：0.25 m（能迈上）与 0.4 m（挡住）
  box('step25-collider', 2, 0.25, 2, -2, 0.125, -2);
  box('step40-collider', 2, 0.4, 2, 1, 0.2, -2);

  // 螺旋楼梯：半径 2.5，每级 0.2 m，每级 18°，20 级（一整圈 4 m 高）
  const spiralCenter = new THREE.Vector3(9, 0, -7);
  const steps = 20;
  const stepAngle = (Math.PI * 2) / steps;
  const riser = 0.2;
  const R = 2.5;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, steps * riser + 1.6, 12), material);
  column.name = 'spiral-column-collider';
  column.position.set(spiralCenter.x, (steps * riser + 1.6) / 2, spiralCenter.z);
  root.add(column);
  for (let i = 0; i < steps; i++) {
    const a = i * stepAngle;
    const top = (i + 1) * riser;
    // 外缘弦长略大于角宽，保证相邻两级无缝
    const outerW = 2 * R * Math.tan(stepAngle / 2) * 1.08;
    const g = new THREE.BoxGeometry(R - 0.3, 0.2, outerW);
    g.translate(0.3 + (R - 0.3) / 2, 0, 0);
    const m = new THREE.Mesh(g, material);
    m.name = `spiral-step-collider.${String(i).padStart(3, '0')}`;
    m.position.set(spiralCenter.x, top - 0.1, spiralCenter.z);
    m.rotation.y = -a;
    root.add(m);
  }
  // 楼梯外圈空气墙（开口在第 0 级入口）
  const wallSegs = 24;
  for (let i = 1; i < wallSegs; i++) {
    const a = (i + 0.5) * ((Math.PI * 2) / wallSegs);
    const g = new THREE.BoxGeometry(0.2, steps * riser + 2, 2 * (R + 0.1) * Math.tan(Math.PI / wallSegs) * 1.05);
    const m = new THREE.Mesh(g, material);
    m.name = `spiral-outer-wall.${String(i).padStart(3, '0')}`;
    m.position.set(spiralCenter.x + Math.cos(a) * (R + 0.1), (steps * riser + 2) / 2, spiralCenter.z + Math.sin(a) * (R + 0.1));
    m.rotation.y = -a;
    root.add(m);
  }

  // 长墙：z = -14 处，沿 x 方向（贴墙滑动测试）
  box('long-wall-collider', 14, 2.5, 0.4, -4, 1.25, -14);

  // 闸门（动态碰撞体）：两侧墙 + 中间 2 m 宽的门
  box('gate-side-l-collider', 3, 2.5, 0.3, -4.5, 1.25, 8);
  box('gate-side-r-collider', 3, 2.5, 0.3, 0.5, 1.25, 8);
  const gate = box('gate-collider', 2, 2.5, 0.3, -2, 1.25, 8);
  gate.userData.dynamic = true;

  // 升降台（动态）：1.6 × 0.3 × 1.6
  const lift = box('lift-collider', 1.6, 0.3, 1.6, 6, 0.15, 6);
  lift.userData.dynamic = true;

  // 自动跨越：两块 0.8 m 高的平台，中间 1.6 m 的沟（只能用 TraversalLink 过去）
  box('link-a-collider', 2, 0.8, 2, 10, 0.4, 4);
  box('link-b-collider', 2, 0.8, 2, 10, 0.4, 7.6);
  box('link-pit-wall', 2.4, 3, 1.6, 10, -0.4, 5.8);

  root.updateWorldMatrix(true, true);
  return {
    root,
    gate,
    lift,
    anchors: {
      spawn: new THREE.Vector3(0, 0, 4),
      ramp30: { foot: new THREE.Vector3(-10, 0, -5.5), dir: new THREE.Vector3(0, 0, 1), top: 4 * tan30 },
      ramp45: { foot: new THREE.Vector3(-6, 0, -5.5), dir: new THREE.Vector3(0, 0, 1) },
      step25: { before: new THREE.Vector3(-2, 0, -4.2), dir: new THREE.Vector3(0, 0, 1), height: 0.25 },
      step40: { before: new THREE.Vector3(1, 0, -4.2), dir: new THREE.Vector3(0, 0, 1), height: 0.4 },
      spiral: { center: spiralCenter, radius: R, riser, steps, stepAngle, walkRadius: 1.5 },
      wall: { z: -14, start: new THREE.Vector3(-9, 0, -12) },
      gate: { before: new THREE.Vector3(-2, 0, 10), after: new THREE.Vector3(-2, 0, 6) },
      lift: { center: new THREE.Vector3(6, 0.3, 6) },
      link: { start: new THREE.Vector3(10, 0.8, 4.4), end: new THREE.Vector3(10, 0.8, 7.2), mid: new THREE.Vector3(10, 1.3, 5.8) },
    },
  };
}
