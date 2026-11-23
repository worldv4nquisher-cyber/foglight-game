import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { alongDoor, doorAxisYaw, polar, S3, treadSpan, treadTop } from './layout';

type Point = readonly [number, number, number];
type Finish = 'basalt' | 'wetRock' | 'stone' | 'coping' | 'iron' | 'paint' | 'bronze' | 'enamel';
type Solid = { name: string; at: Point; size: Point; yaw: number };

const palette: Record<Finish, THREE.MeshStandardMaterialParameters> = {
  basalt: { color: 0x39484d, roughness: 0.96, vertexColors: true, flatShading: true },
  wetRock: { color: 0x424848, roughness: 0.86, vertexColors: true, flatShading: true },
  stone: { color: 0x737873, roughness: 0.93 },
  coping: { color: 0x9a9e92, roughness: 0.88 },
  iron: { color: 0x323c41, roughness: 0.67, metalness: 0.35 },
  paint: { color: 0x527a7e, roughness: 0.61, metalness: 0.15 },
  bronze: { color: 0xa38355, roughness: 0.58, metalness: 0.45 },
  enamel: { color: 0xc6d6cc, roughness: 0.65, emissive: 0x819b93, emissiveIntensity: 0.13 },
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

const oilLine = { radius: 2.935, angle: 75, pipe: 0.044, turnY: 21.695 };

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
    return { put, box, rod, pipe, daylight, finish };
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
    for (const { at, size, yaw } of tideCourtParapets) {
      const [x, y, z] = at, [w, h, d] = size;
      court.box('stone', [x, y - 0.06, z], [w, h - 0.1, d], yaw);
      const count = Math.ceil(Math.max(w, d) / 0.55);
      const cap = v([0, 0, 0]);
      for (let j = 0; j < count; j++) {
        const f = (j + 0.5) / count - 0.5;
        cap.set(w > d ? w * f : 0, 0, d > w ? d * f : 0).applyAxisAngle(up, yaw);
        court.box('coping', [x + cap.x, y + h / 2 - 0.06, z + cap.z], [w > d ? w / count - 0.008 : w + 0.025, 0.12, d > w ? d / count - 0.008 : d + 0.025], yaw);
      }
    }
    court.finish();
  }

  if (art.getObjectByName('env-lighthouse-ch1-interior')) {
    const room = section('s3-oil-room');
    const [x, , z] = polar(2.3, 40, 0); // The original tank, now the center of an oil service bay.
    const y = S3.groundFloorY;
    room.box('iron', [x, y + 0.05, z], [0.78, 0.1, 0.78]);
    room.rod('paint', [x, 0.38, z], [x, 1.32, z], 0.452, 32);
    for (const h of [0.55, 1.15]) room.rod('iron', [x, h - 0.032, z], [x, h + 0.032, z], 0.473, 32);
    room.rod('bronze', [x, 1.52, z], [x, 1.58, z], 0.132, 16);
    // Sight glass and its two unions are bolted onto the tank face, toward the floor.
    const [sx, , sz] = polar(1.83, 40, 0);
    room.rod('enamel', [sx, 0.58, sz], [sx, 1.18, sz], 0.019);
    for (const h of [0.55, 1.21]) {
      room.rod('bronze', [sx, h - 0.045, sz], [sx, h + 0.045, sz], 0.035);
      room.rod('iron', [sx, h, sz], polar(1.98, 40, h), 0.035);
    }
    // Feed from the tank into the existing valve casting; the other side feeds the riser.
    room.pipe('paint', [polar(2.48, 44, 1.2), polar(2.63, 47, 1.2), polar(2.89, 54, 1.11), polar(2.92, 64, 0.9), polar(2.94, 70, 0.9)], oilLine.pipe);
    room.pipe('paint', [polar(2.94, 71, 0.9), polar(2.94, 74, 0.9), polar(oilLine.radius, oilLine.angle, 1.04), polar(oilLine.radius, oilLine.angle, 1.26)], oilLine.pipe);
    room.daylight(polar(2.82, 0, 1.94), 9, 4.9);
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
      riser.rod('bronze', polar(radius, angle, h - 0.032), polar(radius, angle, h + 0.032), 0.055, 10);
      riser.box('iron', polar(2.98, angle, h), [0.16, 0.16, 0.075], yawAt(angle));
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
    for (const [k, count] of [[S3.stair.landings.door.tread, 0], [S3.stair.landings.window5m.tread, 0], [S3.stair.landings.A.tread, 1], [S3.stair.landings.B.tread, 2]] as const) {
      const [a, b] = treadSpan(k), top = treadTop(k), mid = (a + b) / 2;
      for (let th = a + 2; th <= b - 2; th += 3) {
        optics.box('bronze', polar(1.994, th, top - 0.058), [0.105, 0.084, 0.024], yawAt(th));
        optics.box('enamel', polar(1.98, th, top - 0.051), [0.101, 0.025, 0.009], yawAt(th));
      }
      if (k !== S3.stair.landings.door.tread) {
        const opening = S3.stairWindows.find((w) => w.k === k)!;
        // Local cold daylight from the existing openings, not an extra light in the beam chain.
        optics.daylight(polar(2.74, opening.th, opening.y0 + 0.25), 8, 3.7);
      }
      if (!count) continue; // The five-meter window remains a rest landing, not a station.
      const mirrorTh = count === 1 ? 140 : 350;
      optics.box('iron', polar(1.993, mirrorTh, top - 0.19), [0.31, 0.19, 0.11], yawAt(mirrorTh));
      for (const side of [-1, 1]) {
        const th = mirrorTh + side * 3;
        const end = polar(1.51, th, top + 0.56);
        optics.rod('iron', polar(2.039, th, top - 0.205), end, 0.027);
        optics.rod('iron', polar(2.05, th, top + 0.56), end, 0.026);
      }
      optics.rod('bronze', polar(1.51, mirrorTh - 3, top + 0.56), polar(1.51, mirrorTh + 3, top + 0.56), 0.031);
      optics.box('iron', polar(2.98, mid, top + 1.22), [0.33, 0.34, 0.063], yawAt(mid));
      for (let i = 0; i < count; i++) {
        optics.box('enamel', polar(2.943, mid + (i - (count - 1) / 2) * 1.5, top + 1.22), [0.045, 0.19, 0.014], yawAt(mid));
      }
    }
    optics.finish();
  }

  if (art.getObjectByName('env-lamp-room-ch1')) {
    const lamp = section('s3-lamp-machine');
    const y = S3.lampRoom.floorY;
    lamp.rod('paint', [0, y + 0.15, 0], [0, y + 0.48, 0], 0.343, 32);
    for (const h of [0.14, 0.48, 0.66]) {
      const r = h > 0.6 ? 0.642 : 0.352;
      lamp.rod('bronze', [0, y + h, 0], [0, y + h + 0.035, 0], r, 40);
    }
    for (let th = 15; th < 360; th += 30) {
      lamp.rod('iron', polar(0.59, th, y + 0.058), polar(0.59, th, y + 0.083), 0.023, 6);
    }
    lamp.finish();
  }
}
