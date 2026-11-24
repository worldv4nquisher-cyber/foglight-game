import * as THREE from 'three';
import type { ColliderKind, PhysicsSystem } from '@/systems/PhysicsSystem';
import type { Point } from './layout';

export const v = (p: Point): THREE.Vector3 => new THREE.Vector3(...p);
const UP = new THREE.Vector3(0, 1, 0);

export class Whitebox {
  readonly root = new THREE.Group();
  private readonly cube = new THREE.BoxGeometry(1, 1, 1);
  private readonly batches = new Map<THREE.BufferGeometry, Map<number, THREE.Matrix4[]>>();
  private readonly physics: PhysicsSystem;

  constructor(physics: PhysicsSystem) {
    this.physics = physics;
  }

  group(parent = this.root): THREE.Group {
    const group = new THREE.Group();
    parent.add(group);
    return group;
  }

  shape(parent: THREE.Group, geometry: THREE.BufferGeometry, color: number, position: Point,
    size: Point = [1, 1, 1], solid = false, rotation = new THREE.Quaternion()): void {
    parent.updateWorldMatrix(true, false);
    const matrix = new THREE.Matrix4().compose(v(position), rotation, v(size)).premultiply(parent.matrixWorld);
    let colors = this.batches.get(geometry);
    if (!colors) this.batches.set(geometry, colors = new Map<number, THREE.Matrix4[]>());
    let transforms = colors.get(color);
    if (!transforms) colors.set(color, transforms = []);
    transforms.push(matrix);
    if (solid) this.addCollider(geometry, matrix, 'collider');
  }

  private addCollider(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, kind: ColliderKind): void {
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.matrixWorldNeedsUpdate = true;
    this.physics.addMesh(mesh, { kind });
    material.dispose();
  }

  box(parent: THREE.Group, p: Point, size: Point, color: number, solid = false): void {
    this.shape(parent, this.cube, color, p, size, solid);
  }

  orientedBox(parent: THREE.Group, p: Point, size: Point, color: number, rotation: THREE.Quaternion): void {
    this.shape(parent, this.cube, color, p, size, false, rotation);
  }

  floor(parent: THREE.Group, p: Point, width: number, length: number, color: number): void {
    this.box(parent, [p[0], p[1] - 0.18, p[2]], [width, 0.36, length], color, true);
  }

  beam(parent: THREE.Group, a: Point, b: Point, width: number, color: number, depth = width): void {
    const axis = v(b).sub(v(a));
    const middle = v(a).addScaledVector(axis, 0.5);
    const rotation = new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize());
    this.shape(parent, this.cube, color, middle.toArray(), [width, axis.length(), depth], false, rotation);
  }

  rail(parent: THREE.Group, a: Point, b: Point, color: number): void {
    const axis = v(b).sub(v(a));
    for (let i = 0, n = Math.ceil(axis.length() / 2.1); i <= n; i++) {
      const p = v(a).addScaledVector(axis, i / n);
      this.box(parent, [p.x, p.y + 0.48, p.z], [0.11, 0.96, 0.11], color);
    }
    this.beam(parent, [a[0], a[1] + 0.92, a[2]], [b[0], b[1] + 0.92, b[2]], 0.12, color);
    const wall = new THREE.BufferGeometry();
    wall.setAttribute('position', new THREE.Float32BufferAttribute([
      ...a, ...b, b[0], b[1] + 0.98, b[2], a[0], a[1] + 0.98, a[2],
    ], 3));
    wall.setIndex([0, 1, 2, 0, 2, 3]);
    parent.updateWorldMatrix(true, false);
    this.addCollider(wall, parent.matrixWorld, 'wall');
    wall.dispose();
  }

  stairs(parent: THREE.Group, a: Point, b: Point, width: number, color: number): void {
    const delta = v(b).sub(v(a));
    const run = Math.hypot(delta.x, delta.z);
    const stair = this.group(parent);
    stair.position.copy(v(a));
    stair.rotation.y = Math.atan2(delta.x, delta.z);
    const count = Math.ceil(delta.y / 0.25);
    for (let i = 0; i < count; i++) {
      this.box(stair, [0, delta.y * (i + 1) / count - 0.12, run * (i + 0.5) / count],
        [width, 0.24, run / count + 0.015], color);
    }
    const ramp = new THREE.PlaneGeometry(width, delta.length());
    ramp.rotateX(-Math.PI / 2 + Math.atan2(-delta.y, run));
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(ramp, material);
    mesh.position.set(0, delta.y / 2, run / 2);
    stair.add(mesh);
    this.physics.addMesh(mesh);
    stair.remove(mesh);
    ramp.dispose();
    material.dispose();
    const edge = width / 2 - 0.05;
    this.rail(stair, [-edge, 0, 0], [-edge, delta.y, run], 0x4c4640);
    this.rail(stair, [edge, 0, 0], [edge, delta.y, run], 0x4c4640);
  }

  finish(): void {
    for (const [geometry, colors] of this.batches) {
      for (const [color, transforms] of colors) {
        const material = new THREE.MeshStandardMaterial({
          color, roughness: 0.85, side: geometry.userData.twoSided ? THREE.DoubleSide : THREE.FrontSide,
        });
        const instances = new THREE.InstancedMesh(geometry, material, transforms.length);
        transforms.forEach((matrix, i) => instances.setMatrixAt(i, matrix));
        this.root.add(instances);
      }
    }
  }
}
