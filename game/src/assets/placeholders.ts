import * as THREE from 'three';

/** 占位资源：美术资源未到位或加载失败时使用，保证功能先跑通。 */
export type PlaceholderShape = 'box' | 'capsule' | 'sphere' | 'cylinder';

let checkerTexture: THREE.Texture | null = null;

export function createPlaceholderModel(shape: PlaceholderShape = 'box', color = 0xff00ff): THREE.Mesh {
  let geometry: THREE.BufferGeometry;
  switch (shape) {
    case 'capsule':
      geometry = new THREE.CapsuleGeometry(0.4, 1.0, 6, 16);
      break;
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 24, 16);
      break;
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
      break;
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1);
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = `placeholder-${shape}`;
  return mesh;
}

/** 洋红/黑棋盘格纹理（一眼能看出“缺贴图”），全局共享一份 */
export function createPlaceholderTexture(): THREE.Texture {
  if (checkerTexture) return checkerTexture;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#ff00ff' : '#111111';
        ctx.fillRect(x * 8, y * 8, 8, 8);
      }
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  checkerTexture = tex;
  return tex;
}

/** 程序生成的网格地面纹理（无需外部文件） */
export function createGridTexture(cells = 8, base = '#5b6b5a', line = '#4a584a'): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = line;
    ctx.lineWidth = 2;
    const step = size / cells;
    for (let i = 0; i <= cells; i++) {
      ctx.beginPath();
      ctx.moveTo(i * step, 0);
      ctx.lineTo(i * step, size);
      ctx.moveTo(0, i * step);
      ctx.lineTo(size, i * step);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}
