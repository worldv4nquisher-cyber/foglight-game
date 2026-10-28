import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EventBus } from '@/core/EventBus';
import { disposeObject3D } from '@/core/dispose';
import { buildLods } from '@/render/lod';
import { entriesForGroup, type AssetEntry } from './manifest';
import { createPlaceholderModel, createPlaceholderTexture } from './placeholders';

const BASE = import.meta.env.BASE_URL;

/**
 * 资源加载器：GLTF/GLB（DRACO + KTX2 + Meshopt）、普通纹理、KTX2 纹理、音频。
 * - 带整体进度（按文件数 + 字节）
 * - 缓存；同 key 只加载一次
 * - 缺失/失败时：optional 资源回退占位，非 optional 记录到 missing 并同样回退，保证游戏能跑
 */
export class AssetLoader {
  private gltf: GLTFLoader;
  private draco: DRACOLoader;
  private ktx2: KTX2Loader;
  private textureLoader: THREE.TextureLoader;
  private audioLoader: THREE.AudioLoader;

  private models = new Map<string, GLTF>();
  private textures = new Map<string, THREE.Texture>();
  private audio = new Map<string, AudioBuffer>();
  private missing = new Set<string>();

  constructor(
    renderer: THREE.WebGLRenderer,
    private events: EventBus,
  ) {
    // three r18x 起 DRACO / Basis(KTX2) 解码器通过 import.meta.url 随包打包（带哈希、可离线），无需手动拷贝或设置路径
    this.draco = new DRACOLoader();
    this.ktx2 = new KTX2Loader().detectSupport(renderer);
    this.gltf = new GLTFLoader().setDRACOLoader(this.draco).setKTX2Loader(this.ktx2).setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader();
    this.audioLoader = new THREE.AudioLoader();
  }

  /** 加载某个分组的所有资源 */
  loadGroup(group: string, onProgress?: (ratio: number) => void): Promise<void> {
    return this.loadEntries(entriesForGroup(group), onProgress);
  }

  async loadEntries(entries: AssetEntry[], onProgress?: (ratio: number) => void): Promise<void> {
    const todo = entries.filter((e) => !this.has(e.key));
    const total = todo.length;
    const fileProgress = new Array<number>(total).fill(0);
    const report = (url?: string): void => {
      const loaded = fileProgress.reduce((a, b) => a + b, 0);
      const ratio = total === 0 ? 1 : loaded / total;
      onProgress?.(ratio);
      this.events.emit('assets:progress', { loaded, total, ratio, ...(url ? { url } : {}) });
    };
    report();

    await Promise.all(
      todo.map(async (entry, i) => {
        try {
          await this.loadOne(entry, (r) => {
            fileProgress[i] = r;
            report(entry.url);
          });
        } catch (err) {
          this.missing.add(entry.key);
          const msg = `[assets] ${entry.optional ? '可选资源缺失，使用占位' : '加载失败'}: ${entry.key} (${entry.url})`;
          if (entry.optional) console.info(msg);
          else console.error(msg, err);
        } finally {
          fileProgress[i] = 1;
          report(entry.url);
        }
      }),
    );
    this.events.emit('assets:complete', { missing: [...this.missing] });
  }

  private async loadOne(entry: AssetEntry, onProgress: (ratio: number) => void): Promise<void> {
    const url = entry.url.startsWith('http') ? entry.url : `${BASE}${entry.url}`;
    const prog = (e: ProgressEvent): void => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    switch (entry.type) {
      case 'gltf': {
        const gltf = await this.gltf.loadAsync(url, prog);
        // 按 `_lodN` 命名组装 THREE.LOD；extras.puzzleCritical（→ userData）的物体只保留 LOD0 并释放低级 LOD
        const lodStats = buildLods(gltf.scene, (o) => disposeObject3D(o));
        if (import.meta.env.DEV && (lodStats.lodGroups || lodStats.criticalGroups)) {
          console.info(
            `[assets] ${entry.key}: LOD ${lodStats.lodGroups} 组，解谜关键(固定 LOD0) ${lodStats.criticalGroups} 个，丢弃低级 LOD ${lodStats.droppedLevels} 个`,
          );
        }
        gltf.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        this.models.set(entry.key, gltf);
        break;
      }
      case 'texture': {
        const tex = await this.textureLoader.loadAsync(url, prog);
        if (entry.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(entry.key, tex);
        break;
      }
      case 'ktx2': {
        const tex = await this.ktx2.loadAsync(url, prog);
        if (entry.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(entry.key, tex);
        break;
      }
      case 'audio': {
        const buf = await this.audioLoader.loadAsync(url, prog);
        this.audio.set(entry.key, buf);
        break;
      }
    }
  }

  has(key: string): boolean {
    return this.models.has(key) || this.textures.has(key) || this.audio.has(key);
  }

  isMissing(key: string): boolean {
    return this.missing.has(key);
  }

  /**
   * 取模型实例（克隆，支持骨骼动画）。没有时返回占位几何体。
   * 克隆共享几何体/材质，场景销毁时不要 dispose 它们（见 sharedResources）。
   */
  getModel(key: string, fallback: Parameters<typeof createPlaceholderModel>[0] = 'box', color?: number): THREE.Object3D {
    const gltf = this.models.get(key);
    if (gltf) return cloneSkinned(gltf.scene);
    return createPlaceholderModel(fallback, color);
  }

  getAnimations(key: string): THREE.AnimationClip[] {
    return this.models.get(key)?.animations ?? [];
  }

  getTexture(key: string): THREE.Texture {
    return this.textures.get(key) ?? createPlaceholderTexture();
  }

  getAudio(key: string): AudioBuffer | undefined {
    return this.audio.get(key);
  }

  /** 缓存中的几何体/材质/纹理集合，场景 dispose 时跳过它们 */
  sharedResources(): Set<unknown> {
    const set = new Set<unknown>();
    for (const g of this.models.values()) {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) set.add(m.geometry);
        if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) set.add(mat);
      });
    }
    for (const t of this.textures.values()) set.add(t);
    return set;
  }

  /** 释放某个 key 的缓存（切关卡时卸载不再需要的资源） */
  unload(key: string): void {
    const g = this.models.get(key);
    if (g) disposeObject3D(g.scene);
    this.textures.get(key)?.dispose();
    this.models.delete(key);
    this.textures.delete(key);
    this.audio.delete(key);
  }

  dispose(): void {
    for (const key of [...this.models.keys(), ...this.textures.keys(), ...this.audio.keys()]) this.unload(key);
    this.draco.dispose();
    this.ktx2.dispose();
  }
}
