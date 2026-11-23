import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { alongDoor, doorAxisYaw, polar, S3, treadSpan, treadTop } from './layout';

type Point = readonly [number, number, number];
type Finish = 'basalt' | 'wetRock' | 'stone' | 'coping' | 'iron' | 'paint' | 'bronze' | 'enamel' | 'oiled' | 'grate';
type Solid = { name: string; at: Point; size: Point; yaw: number };

const palette: Record<Finish, THREE.MeshStandardMaterialParameters> = {
  basalt: { color: 0x39484d, roughness: 0.96, vertexColors: true, flatShading: true },
  wetRock: { color: 0x424848, roughness: 0.86, vertexColors: true, flatShading: true },
  stone: { color: 0x737873, roughness: 0.93 },
  coping: { color: 0x9a9e92, roughness: 0.88 },
  iron: { color: 0x323c41, roughness: 0.67, metalness: 0.35 },
  paint: { color: 0x507e7b, roughness: 0.61, metalness: 0.15 },
  bronze: { color: 0xa38355, roughness: 0.58, metalness: 0.45 },
  enamel: { color: 0xc6d6cc, roughness: 0.65, emissive: 0x819b93, emissiveIntensity: 0.13 },
  oiled: { color: 0x526062, roughness: 0.72 },
  grate: { color: 0x485a59, roughness: 0.91 },
};

const up = new THREE.Vector3(0, 1, 0);
const v = (p: Point) => new THREE.Vector3(...p);
const yawAt = (th: number) => Math.PI / 2 - THREE.MathUtils.degToRad(th);

// Parapets replace the invisible boundary at the edge of the raised tide court.
const terrace = (name: string, s0: number, s1: number, t0: number, t1: number): Solid => ({
  name, at: alongDoor((s0 + s1) / 2, (t0 + t1) / 2, S3.doorPlatform.top + 0.27),
  size: [t1 - t0, 0.54, s1 - s0], yaw: doorAxisYaw,
});
export const tideCourtParapets = [
  terrace('s3-tide-court-left', 4.45, 7.57, -2.4, -2.16),
  terrace('s3-tide-court-right', 4.45, 7.57, 2.16, 2.4),
  terrace('s3-tide-court-return-left', 7.32, 7.57, -2.16, -0.78),
  terrace('s3-tide-court-return-right', 7.32, 7.57, 0.78, 2.16),
];

const oilLine = { radius: 2.935, angle: 75, pipe: 0.058, turnY: 21.695 };

/** Static facility modules share the baked tower's layout without changing its sockets or UVs. */
export function buildS3Facility(art: THREE.Group): void {
  const materials = new Map<Finish, THREE.MeshStandardMaterial>();
  const material = (finish: Finish) => {
    let mat = materials.get(finish);
    if (!mat) materials.set(finish, mat = new THREE.MeshStandardMaterial({ name: `s3-${finish}`, ...palette[finish] }));
    return mat;
  };
  const section = (name: string) => {
    const group = new THREE.Group();
    const runs = new Map<Finish, THREE.BufferGeometry[]>();
    group.name = name;
    art.add(group);
    const put = (finish: Finish, g: THREE.BufferGeometry) => {
      const run = runs.get(finish) ?? [];
      run.push(g);
      runs.set(finish, run);
    };
    const box = (finish: Finish, at: Point, size: Point, yaw = 0) => {
      put(finish, new THREE.BoxGeometry(...size).rotateY(yaw).translate(...at));
    };
    const ring = (finish: Finish, r0: number, r1: number, a: number, b: number, y: number) => {
      const rad = THREE.MathUtils.degToRad;
      put(finish, new THREE.RingGeometry(r0, r1, Math.max(2, Math.ceil((b - a) / 3)), 1, rad(-b), rad(b - a)).rotateX(-Math.PI / 2).translate(0, y, 0));
    };
    const rod = (finish: Finish, a: Point, b: Point, radius: number, sides = 10) => {
      const axis = v(b).sub(v(a));
      const matrix = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.clone().normalize()));
      matrix.setPosition(v(a).addScaledVector(axis, 0.5));
      put(finish, new THREE.CylinderGeometry(radius, radius, axis.length(), sides).applyMatrix4(matrix));
    };
    const pipe = (finish: Finish, points: Point[], radius: number) => {
      put(finish, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v), false, 'centripetal'), 30, radius, 10));
    };
    const daylight = (at: Point, intensity: number, range: number) => {
      const light = new THREE.PointLight(0xc4d7e7, intensity, range);
      light.position.set(...at);
      group.add(light);
    };
    const finish = () => {
      for (const [key, run] of runs) {
        const g = mergeGeometries(run);
        for (const source of run) source.dispose();
        if (!g) throw new Error(`[s3] facility batch failed: ${name}/${key}`);
        const mesh = new THREE.Mesh(g, material(key));
        mesh.name = `${name}-${key}`;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
    };
    return { put, box, ring, rod, pipe, daylight, finish };
  };

  if (art.getObjectByName('env-stone-bridge-s3')) {
    const reef = section('s3-bridge-bedrock');
    const shelf = (s: number, t: number, length: number, width: number, bottom: number, top: number, seed: number) => {
      // Shared rings form a rock platform, not scattered rocks hovering beneath the piers.
      const points: Point[] = [];
      const rings = [{ y: bottom, scale: 0.92 }, { y: top - 0.38, scale: 1 }, { y: top, scale: 0.78 }];
      const sides = 12;
      for (const { y, scale } of rings) {
        for (let i = 0; i < sides; i++) {
          const a = i * Math.PI * 2 / sides;
          const f = scale * (1 + 0.17 * Math.sin(i * 4.1 + seed));
          points.push(alongDoor(s + Math.cos(a) * length * f, t + Math.sin(a) * width * f, y + Math.sin(i * 2.4 + seed) * 0.13));
        }
      }
      const geo = new THREE.BufferGeometry();
      const idx = [];
      for (let r = 0; r < rings.length - 1; r++) {
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides, m = r * sides;
          idx.push(m + i, m + i + sides, m + j, m + j, m + i + sides, m + j + sides);
        }
      }
      for (let i = 1; i < sides - 1; i++) idx.push(2 * sides, 2 * sides + i + 1, 2 * sides + i, 0, i, i + 1);
      geo.setIndex(idx);
      geo.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
      const color = points.flatMap((_, i) => {
        const tone = 0.76 + 0.2 * Math.floor(i / sides) + 0.1 * Math.sin(i * 3.9 + seed);
        return [tone * 0.97, tone, tone * 1.02];
      });
      geo.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
      geo.computeVertexNormals();
      reef.put(bottom < -3 ? 'basalt' : 'wetRock', geo);
    };
    shelf(19, 0.15, 11.9, 3.1, -5.2, -0.24, 5);
    S3.bridge.piers.forEach((s, i) => {
      shelf(s, i % 2 ? 0.42 : -0.35, 2.55, 2.85, -1.15, 0.29 + i * 0.1, 14 + i);
      shelf(s - 0.1, -0.07, 1.9, 2.3, 0.05, 0.74 + i * 0.1, 29 + i);
      shelf(s + 0.15, i % 2 ? 1.42 : -1.66, 1.2, 1.08, 0.23, 1.62 + i * 0.065, 41 + i);
    });
    reef.finish();
  }

  if (art.getObjectByName('env-rock-islet-a')) {
    const court = section('s3-tide-court');
    const blocks = (s: number, t: number, y: number, [w, h, d]: Point, finish: Finish = 'stone') => {
      court.box(finish, alongDoor(s, t, y), [w, h, d], doorAxisYaw);
    };
    // The pad sits on a battered seawall. Keep the treads and original paving as the walking surfaces.
    for (let course = 0; course < 4; course++) {
      const y = -0.06 + 0.6 * course;
      const face = 2.55 - 0.055 * course;
      for (const side of [-1, 1]) {
        for (let j = 0; j < 5; j++) {
          blocks(4.04 + j * 0.75 + (course % 2) * 0.15, side * face, y, [0.4, 0.585, 0.738], course < 2 ? 'oiled' : 'stone');
        }
        for (let j = 0; j < 2; j++) {
          blocks(7.49, side * (1.14 + j * 0.87), y, [0.85, 0.585, 0.48], course < 2 ? 'oiled' : 'stone');
        }
      }
    }
    for (const t of [-2.28, 2.28]) {
      blocks(6.95, t, 1.36, [0.57, 2.06, 0.72]);
      blocks(6.95, t, 2.37, [0.65, 0.055, 0.8], 'coping');
    }
    for (const t of [-0.68, 0.68]) {
      blocks(6, t, S3.doorPlatform.top + 0.014, [0.055, 0.018, 2.85], 'oiled');
    }
    for (const { at, size, yaw } of tideCourtParapets) {
      const [x, y, z] = at, [w, h, d] = size;
      const count = Math.ceil(Math.max(w, d) / 0.55);
      const cap = v([0, 0, 0]);
      for (let j = 0; j < count; j++) {
        const f = (j + 0.5) / count - 0.5;
        cap.set(w > d ? w * f : 0, 0, d > w ? d * f : 0).applyAxisAngle(up, yaw);
        court.box('stone', [x + cap.x, y - 0.06, z + cap.z], [w > d ? w / count - 0.013 : w, h - 0.1, d > w ? d / count - 0.013 : d], yaw);
        court.box('coping', [x + cap.x, y + h / 2 - 0.06, z + cap.z], [w > d ? w / count - 0.008 : w + 0.025, 0.12, d > w ? d / count - 0.008 : d + 0.025], yaw);
      }
    }
    for (const t of [-0.91, 0.91]) {
      const s = 3.925;
      blocks(s, t, 3.0, [0.19, 1.18, 0.19], 'stone');
      blocks(s + 0.016, t, 2.47, [0.23, 0.14, 0.22], 'coping');
      blocks(s + 0.018, t, 3.59, [0.22, 0.095, 0.23], 'coping');
    }
    blocks(3.974, 0, 4.83, [0.88, 0.28, 0.085], 'paint');
    blocks(4.021, 0, 4.83, [0.09, 0.15, 0.013], 'enamel');
    for (const t of [-0.22, 0.22]) blocks(4.021, t, 4.83, [0.25, 0.025, 0.013], 'enamel');
    court.finish();
  }

  if (art.getObjectByName('env-lighthouse-ch1-interior')) {
    const room = section('s3-oil-room');
    const [x, , z] = polar(2.3, 40, 0); // The original tank, now the center of an oil service bay.
    const y = S3.groundFloorY;
    room.ring('grate', 1.59, 2.99, 24, 106, y + 0.012);
    room.ring('bronze', 1.6, 1.65, 24, 106, y + 0.014);
    for (let th = 27; th < 105; th += 3) {
      const edge = th % 9 === 0 ? 1.85 : 1.77;
      room.ring('enamel', 1.68, edge, th, th + 0.55, y + 0.015);
    }
    for (let i = 0; i < 12; i++) {
      const th = 25 + i * 7;
      room.box('oiled', polar(2.998, th, 0.9), [0.355, 1.385, 0.048], yawAt(th));
      room.box('coping', polar(2.973, th, S3.tide.high), [0.365, 0.058, 0.046], yawAt(th));
    }
    room.box('iron', [x, y + 0.05, z], [0.83, 0.1, 0.83], yawAt(40));
    room.rod('paint', [x, 0.38, z], [x, 1.32, z], 0.452, 32);
    for (const h of [0.55, 1.15]) room.rod('bronze', [x, h - 0.032, z], [x, h + 0.032, z], 0.473, 32);
    room.rod('bronze', [x, 1.52, z], [x, 1.58, z], 0.132, 16);
    // Sight glass and its two unions are bolted onto the tank face, toward the floor.
    const [sx, , sz] = polar(1.83, 40, 0);
    room.rod('enamel', [sx, 0.58, sz], [sx, 1.18, sz], 0.019);
    for (const h of [0.55, 1.21]) {
      room.rod('bronze', [sx, h - 0.045, sz], [sx, h + 0.045, sz], 0.035);
      room.rod('iron', [sx, h, sz], polar(1.98, 40, h), 0.035);
    }
    room.box('iron', polar(1.859, 45, 0.885), [0.235, 0.265, 0.026], yawAt(45));
    for (const h of [0.82, 0.88, 0.94]) room.box('enamel', polar(1.841, 45, h), [0.145, 0.016, 0.01], yawAt(45));
    // The wall-side manifold links fill, tank and riser without crowding the valve stand.
    room.pipe('paint', [polar(2.315, 40, 1.53), polar(2.5, 40, 1.65), polar(2.87, 40, 1.72), polar(2.933, 52, 1.72), polar(2.936, 65, 1.72), polar(2.935, 75, 1.72)], 0.056);
    for (const th of [44, 57, 69]) {
      room.rod('bronze', polar(2.9, th - 0.45, 1.72), polar(2.9, th + 0.45, 1.72), 0.073, 12);
      room.box('iron', polar(2.991, th, 1.72), [0.145, 0.19, 0.065], yawAt(th));
    }
    // Feed from the tank into the existing valve casting; the other side feeds the riser.
    room.pipe('paint', [polar(2.48, 44, 1.2), polar(2.63, 47, 1.2), polar(2.89, 54, 1.11), polar(2.92, 64, 0.9), polar(2.94, 70, 0.9)], oilLine.pipe);
    room.pipe('paint', [polar(2.94, 71, 0.9), polar(2.94, 74, 0.9), polar(oilLine.radius, oilLine.angle, 1.04), polar(oilLine.radius, oilLine.angle, 1.26)], oilLine.pipe);
    room.daylight(polar(2.61, 0, 1.96), 12, 5.3);
    room.finish();

    const riser = section('s3-oil-riser');
    const { radius, angle, pipe, turnY } = oilLine;
    riser.rod('paint', polar(radius, angle, 1.22), polar(radius, angle, turnY - 0.21), pipe, 12);
    riser.pipe('paint', [polar(radius, angle, turnY - 0.23), polar(radius, angle, turnY - 0.12), polar(radius - 0.087, angle, turnY), polar(radius - 0.25, angle, turnY)], pipe);
    riser.rod('paint', polar(radius - 0.22, angle, turnY), polar(0.34, angle, turnY), pipe, 12);
    riser.rod('bronze', polar(0.36, angle, turnY - 0.034), polar(0.36, angle, 21.78), 0.057, 12);
    for (const r of [0.62, 1.5, 2.37]) {
      riser.box('iron', polar(r, angle, 21.743), [0.16, 0.047, 0.13], yawAt(angle));
    }
    for (const h of [1.48, 2.2, 4.14, 6.22, 8.1, 10.18, 12, 14.13, 16.14, 18.33, 20.19]) {
      riser.rod('bronze', polar(radius, angle, h - 0.041), polar(radius, angle, h + 0.041), 0.077, 10);
      riser.box('iron', polar(2.98, angle, h), [0.23, 0.19, 0.075], yawAt(angle));
    }
    riser.finish();

    const gauge = section('s3-high-water-gauge');
    const high = S3.tide.high;
    const th = 110, yaw = yawAt(th);
    gauge.box('iron', polar(2.99, th, high - 0.21), [0.22, 1.55, 0.042], yaw);
    for (let i = -6; i <= 3; i++) {
      gauge.box(i === 0 ? 'bronze' : 'enamel', polar(2.966, th, high + i * 0.13),
        [i === 0 ? 0.245 : i % 2 ? 0.09 : 0.145, i === 0 ? 0.04 : 0.018, 0.009], yaw);
    }
    gauge.finish();

    // The flooded lower flight is masonry down to the floor. Higher treads cantilever out of the wall.
    const descent = section('s3-machine-room-stair');
    for (let k = 2; k < S3.stair.landings.door.tread; k++) {
      const [a, b] = treadSpan(k);
      const h = treadTop(k) - y - 0.22;
      const r = S3.stair.r[0], mid = (a + b) / 2;
      descent.box('stone', polar(r + 0.496, mid, y - 0.015 + h / 2), [2 * r * Math.sin(THREE.MathUtils.degToRad((b - a) / 2)), h, 0.985], yawAt(mid));
      descent.box('coping', polar(r + 0.013, mid, treadTop(k) - 0.073), [0.19, 0.043, 0.027], yawAt(mid));
    }
    descent.finish();

    const optics = section('s3-optical-landings');
    const [winX, , winZ] = S3.mirrors.window.socket;
    optics.box('iron', [winX - 0.322, 0.967, winZ], [0.05, 0.061, 0.77]);
    optics.box('bronze', [winX - 0.349, 0.967, winZ], [0.008, 0.017, 0.4]);
    // The inner stringer and step nosings trace the ascent without putting structure across the lightwell.
    for (let k = S3.stair.landings.door.tread; k <= S3.stair.treads; k++) {
      const [a, b] = treadSpan(k), top = treadTop(k);
      const n = Math.ceil((b - a) / 6);
      for (let j = 0; j < n; j++) {
        const low = a + (b - a) * j / n, high = a + (b - a) * (j + 1) / n;
        const mid = (low + high) / 2;
        const chord = 4 * Math.sin(THREE.MathUtils.degToRad((high - low) / 2));
        optics.box(k % 4 === 0 ? 'paint' : 'oiled', polar(2.008, mid, top - 0.152), [chord - 0.005, 0.25, 0.058], yawAt(mid));
        optics.ring('coping', 2.035, 2.117, low + 0.14, high - 0.14, top + 0.009);
      }
      if (k % 6 === 0) {
        const th = (a + b) / 2;
        optics.rod('iron', polar(2.05, th, top - 0.17), polar(2.992, th, top - 0.52), 0.028, 8);
      }
    }
    for (const [k, count] of [[S3.stair.landings.door.tread, 0], [S3.stair.landings.window5m.tread, 0], [S3.stair.landings.A.tread, 1], [S3.stair.landings.B.tread, 2]] as const) {
      const [a, b] = treadSpan(k), top = treadTop(k), mid = (a + b) / 2;
      if (count) {
        optics.ring('grate', 2.115, 2.91, a + 1.2, b - 1.2, top + 0.008);
        optics.ring('bronze', 2.13, 2.86, a + 1.5, a + 2.2, top + 0.009);
        optics.ring('bronze', 2.13, 2.86, b - 2.2, b - 1.5, top + 0.009);
        for (let th = a + 3; th < b - 2; th += 1.5) {
          optics.ring('iron', 2.185, 2.87, th, th + 0.23, top + 0.01);
        }
      }
      for (let th = a + 2; th <= b - 2; th += 3) {
        optics.box('bronze', polar(1.994, th, top - 0.058), [0.105, 0.084, 0.024], yawAt(th));
        optics.box('enamel', polar(1.98, th, top - 0.051), [0.101, 0.025, 0.009], yawAt(th));
      }
      if (k !== S3.stair.landings.door.tread) {
        const opening = S3.stairWindows.find((w) => w.k === k)!;
        // Local cold daylight from the existing openings, not an extra light in the beam chain.
        optics.daylight(polar(2.58, opening.th, opening.y0 + 0.36), count ? 14 : 8, count ? 4.4 : 3.7);
      }
      if (!count) continue; // The five-meter window remains a rest landing, not a station.
      const mirrorTh = count === 1 ? 140 : 350;
      optics.box('paint', polar(1.993, mirrorTh, top - 0.19), [0.47, 0.29, 0.12], yawAt(mirrorTh));
      for (const side of [-1, 1]) {
        const th = mirrorTh + side * 3;
        const end = polar(1.51, th, top + 0.56);
        optics.rod('iron', polar(2.039, th, top - 0.205), end, 0.027);
        optics.rod('iron', polar(2.05, th, top + 0.56), end, 0.026);
      }
      optics.rod('bronze', polar(1.51, mirrorTh - 3, top + 0.56), polar(1.51, mirrorTh + 3, top + 0.56), 0.031);
      for (const side of [-1, 1]) {
        const th = mirrorTh + side * 10.5;
        optics.rod('paint', polar(2.024, th, top - 0.19), polar(2.97, th, top - 0.84), 0.055, 8);
        optics.box('iron', polar(2.973, th, top - 0.76), [0.21, 0.39, 0.063], yawAt(th));
        optics.box('paint', polar(2.977, th, top + 1.24), [0.43, 1.27, 0.075], yawAt(th));
        optics.box('coping', polar(2.928, th, top + 1.69), [0.31, 0.044, 0.023], yawAt(th));
      }
      optics.box('iron', polar(2.975, mid, top + 0.68), [0.55, 0.45, 0.067], yawAt(mid));
      for (let i = 0; i < count; i++) {
        optics.box('enamel', polar(2.932, mid + (i - (count - 1) / 2) * 2.1, top + 0.68), [0.067, 0.28, 0.018], yawAt(mid));
      }
    }
    optics.finish();
  }

  if (art.getObjectByName('env-lamp-room-ch1')) {
    const lamp = section('s3-lamp-machine');
    const y = S3.lampRoom.floorY;
    // The column wears a bolted service casing below the original lens/lever envelope.
    lamp.rod('paint', [0, y + 0.095, 0], [0, y + 0.615, 0], 0.436, 48);
    for (const [h, r, thick] of [[0.072, 0.494, 0.046], [0.55, 0.483, 0.073], [0.662, 0.648, 0.037]]) {
      lamp.rod('bronze', [0, y + h, 0], [0, y + h + thick, 0], r, 48);
    }
    for (let th = 15; th < 360; th += 30) {
      lamp.box('iron', polar(0.419, th, y + 0.335), [0.116, 0.39, 0.075], yawAt(th));
      lamp.box('paint', polar(0.46, th, y + 0.338), [0.076, 0.285, 0.013], yawAt(th));
      lamp.rod('bronze', polar(0.59, th, y + 0.057), polar(0.59, th, y + 0.08), 0.023, 6);
      lamp.ring('grate', 0.62, 0.89, th + 1, th + 28, y + 0.007);
      lamp.ring('bronze', 0.87, 0.89, th + 1, th + 28, y + 0.009);
    }
    for (const th of [122, 241, 315]) {
      lamp.box('iron', polar(0.449, th, y + 0.395), [0.235, 0.213, 0.03], yawAt(th));
      lamp.box('enamel', polar(0.467, th, y + 0.414), [0.14, 0.041, 0.01], yawAt(th));
      lamp.box('bronze', polar(0.469, th, y + 0.355), [0.069, 0.026, 0.018], yawAt(th));
    }
    // The keeper's station stays below the glass, with its journal, chair, and gaze marks untouched.
    lamp.ring('grate', 1.87, 2.976, 297, 333, y + 0.009);
    for (const th of [297, 332.2]) lamp.ring('coping', 1.88, 2.976, th, th + 0.8, y + 0.011);
    lamp.ring('bronze', 1.87, 1.902, 298, 332, y + 0.011);
    for (let th = 295; th < 335; th += 5) {
      lamp.box('paint', polar(2.982, th, y + 0.34), [0.257, 0.66, 0.037], yawAt(th));
      lamp.box('bronze', polar(2.955, th, y + 0.616), [0.259, 0.029, 0.026], yawAt(th));
    }
    const deskAt = (r: number, t: number, h: number): Point => {
      const [x, , z] = polar(r, 315, 0), [dx, , dz] = polar(t, 405, 0);
      return [x + dx, y + h, z + dz];
    };
    lamp.box('paint', deskAt(2.667, 0, 0.355), [0.63, 0.27, 0.116], yawAt(315));
    lamp.box('bronze', deskAt(2.439, 0, 0.641), [0.876, 0.026, 0.018], yawAt(315));
    for (const t of [-0.36, 0.36]) {
      lamp.box('paint', deskAt(2.69, t, 0.477), [0.094, 0.223, 0.436], yawAt(315));
      lamp.box('bronze', deskAt(2.491, t, 0.488), [0.053, 0.027, 0.028], yawAt(315));
    }
    for (const th of [0, 45, 90, 135, 180, 225, 270, 315]) {
      lamp.pipe('oiled', [polar(3.06, th, 24.276), polar(2.63, th, 24.52), polar(1.93, th, 24.68), polar(1.16, th, 24.814), polar(0.48, th, 24.891)], 0.045);
    }
    lamp.daylight(polar(2.53, 305, 23.66), 12, 4.9);
    lamp.daylight(polar(2.65, 130, 23.46), 7, 4.1);
    lamp.finish();
  }
}
