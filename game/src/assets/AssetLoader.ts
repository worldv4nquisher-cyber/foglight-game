import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EventBus } from '@/core/EventBus';
import { disposeObject3D } from '@/core/dispose';
import { gameConfig } from '@/config/gameConfig';
import { artEnabled } from '@/config/debug';
import { applyExtrasVisibility } from './extrasVisibility';
import { applyMaterialHints } from '@/render/materialHints';
import { buildLods } from '@/render/lod';
import { prepareOutlineNormals } from './vertexColors';
import { pendingArtPresent } from './artPresent';
import { fontStats, forgetFont, loadFontOnce } from './fontLoader';
import { ImageCache } from './imageCache';
import { entriesForGroup, manifest, type AssetEntry, type AssetGroup } from './manifest';
import { createPlaceholderModel, createPlaceholderTexture, createMissingTexture } from './placeholders';
import { assetStats, createSharedKtx2, loadWithRetry, shareInflight, stripFallbackTextures } from './loadRetry';

const BASE = import.meta.env.BASE_URL;

/** 一个资源组的加载状态（同一组只加载一次；预加载中途再请求就挂上进度回调一起等） */
interface GroupState {
  promise: Promise<void>;
  ratio: number;
  done: boolean;
  listeners: Set<(ratio: number) => void>;
}

/**
 * `?slowLoad=毫秒`：模拟慢网速（开发 / 冒烟测试用，v0.1-010）。boot / menu 以外的每个组至少花这么久才算加载完，
 * 进度按时间线性走。用来看场景切换黑场里的细线进度，也可以用 DevTools 网络限速代替。
 */
export function parseSlowLoad(search: string): number {
  const v = Number(new URLSearchParams(search).get('slowLoad'));
  return Number.isFinite(v) && v > 0 ? Math.min(v, 60000) : 0;
}

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
  /** GLB 外部 KTX2 共享缓存（解析后的绝对 URL → 纹理） */
  private ktx2Cache = new Map<string, Promise<THREE.Texture>>();
  private textureLoader: THREE.TextureLoader;
  private audioLoader: THREE.AudioLoader;

  private models = new Map<string, GLTF>();
  private textures = new Map<string, THREE.Texture>();
  private audio = new Map<string, AudioBuffer>();
  private fonts = new Map<string, FontFace>();
  private fontUrls = new Map<string, string>();
  /** 030 UI 图片：key → 已下载并解码的 URL（CSS / <img> 直接用，浏览器缓存命中） */
  private images = new ImageCache({
    lookup: (key) => {
      const e = manifest.find((x) => x.key === key && x.type === 'image');
      return e ? { url: e.url.startsWith('http') ? e.url : `${BASE}${e.url}`, art: e.art } : null;
    },
    artEnabled: () => this.artEnabled,
    fetchImage: (url) => this.fetchImage(url),
    onLoaded: (key) => this.missing.delete(key),
    onFailed: (key, url, err) => {
      this.missing.add(key);
      // text-ok: 只进控制台日志
      console.info(`[assets] UI 图片缺失，退回纯色底：${key} (${url})`, err);
    },
  });
  /** 字体加载记录（每个 URL 的 fetch 次数 / 是否成功）：smoke 断言每个字体只请求一次，QA 可在控制台查 __game.assets.fontStats */
  get fontStats(): { url: string; family: string; attempts: number; ok: boolean; error?: string }[] {
    return [...fontStats.values()].map((s) => ({ ...s }));
  }
  /** GLB / 外部 KTX2 的加载记录（次数 / 是否成功 / 是否用了占位），BUG-012：__game.assets.loadStats */
  get loadStats(): { url: string; kind: string; attempts: number; ok: boolean; done: boolean; fallback?: boolean; error?: string }[] {
    return [...assetStats.values()].map((s) => ({ ...s }));
  }
  /** 同一 GLB URL 只有一条在飞的下载 */
  private gltfInflight = new Map<string, Promise<GLTF>>();
  private missing = new Set<string>();
  private groups = new Map<string, GroupState>();
  /** 模拟慢网速（?slowLoad=ms），见 parseSlowLoad */
  /** 是否加载清单里 art: true 的美术资源（v0.1-013，?art=0 / 冒烟测试默认关） */
  artEnabled: boolean = artEnabled;
  simulateLoadMs = typeof location === 'undefined' ? 0 : parseSlowLoad(location.search);

  constructor(
    renderer: THREE.WebGLRenderer,
    private events: EventBus,
  ) {
    // three r18x 起 DRACO / Basis(KTX2) 解码器通过 import.meta.url 随包打包（带哈希、可离线），无需手动拷贝。
    // DRACO 只用 glTF 专用的 wasm 解码器（192KB，比通用版 286KB 小，且只支持 glTF 用到的属性）；
    // 不再保留纯 JS 回退（719KB）：游戏要求 WebGL2，而支持 WebGL2 的浏览器都支持 WebAssembly。
    // 构建时 vite.config.ts 的 threeDecodersWasmOnly 插件会把用不到的通用版/JS 回退从 dist 里去掉。
    this.draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    this.ktx2 = new KTX2Loader().detectSupport(renderer);
    // 外部 KTX2（v0.1-013）：美术 GLB 的 images.uri = ../../textures/tex-*.ktx2，GLTFLoader 相对 GLB URL 解析后交给这里。
    // 同一张贴图被多个 GLB 引用（岩石 a–f + 主岛共用 tex-rock-shore-*）：按解析后的 URL 只下载 / 转码 / 上传一次。
    // BUG-012：网络失败 / 被浏览器取消时重试（loadRetry.ts），最终失败用棋盘格占位并记日志
    const ktx2 = this.ktx2;
    const shared = createSharedKtx2(this.ktx2Cache, {
      load: (url, onProgress) => ktx2.loadAsync(url, onProgress),
      resolve: (url) => new URL(url, typeof location === 'undefined' ? 'http://x/' : location.href).href,
      fallback: (url, err) => {
        this.degraded(url, 'ktx2', err);
        return createMissingTexture();
      },
    }) as unknown as KTX2Loader;
    this.gltf = new GLTFLoader().setDRACOLoader(this.draco).setKTX2Loader(shared).setMeshoptDecoder(MeshoptDecoder);
    this.textureLoader = new THREE.TextureLoader();
    this.audioLoader = new THREE.AudioLoader();
  }

  /**
   * 加载某个分组的所有资源。同一组只加载一次：已在加载（比如后台预加载）就挂上进度回调等它完成；
   * 已加载完立即 resolve（进度回调收到 1）。
   */
  loadGroup(group: AssetGroup, onProgress?: (ratio: number) => void): Promise<void> {
    let g = this.groups.get(group);
    if (!g) {
      const state: GroupState = { promise: Promise.resolve(), ratio: 0, done: false, listeners: new Set() };
      const emit = (r: number): void => {
        state.ratio = Math.max(state.ratio, Math.min(1, r));
        for (const l of state.listeners) l(state.ratio);
      };
      const slow = group === 'boot' || group === 'menu' ? 0 : this.simulateLoadMs;
      state.promise = (async () => {
        const t0 = performance.now();
        let fileRatio = 0;
        const timeRatio = (): number => (slow ? Math.min(1, (performance.now() - t0) / slow) : 1);
        await this.loadEntries(entriesForGroup(group), (r) => {
          fileRatio = r;
          emit(Math.min(fileRatio, timeRatio()));
        });
        while (timeRatio() < 1) {
          emit(Math.min(fileRatio, timeRatio()));
          await new Promise((r) => setTimeout(r, 50));
        }
        state.done = true;
        emit(1);
      })();
      this.groups.set(group, state);
      g = state;
    }
    if (onProgress) {
      const state = g;
      state.listeners.add(onProgress);
      onProgress(state.ratio);
      void state.promise.finally(() => state.listeners.delete(onProgress));
    }
    return g.promise;
  }

  /** 依次（并发）加载多个组，进度按组数平均（加载页：common + 场景组） */
  async loadGroups(groups: readonly AssetGroup[], onProgress?: (ratio: number) => void): Promise<void> {
    const ratios = groups.map(() => 0);
    const report = (): void => onProgress?.(ratios.reduce((a, b) => a + b, 0) / Math.max(1, groups.length));
    await Promise.all(
      groups.map((grp, i) =>
        this.loadGroup(grp, (r) => {
          ratios[i] = r;
          report();
        }),
      ),
    );
    onProgress?.(1);
  }

  /** 组是否已加载完 */
  isGroupLoaded(group: AssetGroup): boolean {
    return this.groups.get(group)?.done ?? false;
  }

  /** 组的加载进度（0–1；没开始为 0） */
  groupProgress(group: AssetGroup): number {
    return this.groups.get(group)?.ratio ?? 0;
  }

  /** 已加载完的组（冒烟测试 / 调试面板） */
  get loadedGroups(): string[] {
    return [...this.groups.entries()].filter(([, g]) => g.done).map(([k]) => k);
  }

  /**
   * 释放一个组的全部资源（离开场景后，v0.1-010）。场景对象应已先 dispose（场景 dispose 会跳过缓存里的共享资源，
   * 这里才真正释放）。组还在加载中：等加载完再释放（除非期间又被重新请求）。
   */
  unloadGroup(group: AssetGroup): void {
    const g = this.groups.get(group);
    if (!g) return;
    this.groups.delete(group);
    const release = (): void => {
      if (this.groups.has(group)) return; // 期间又被重新请求了
      for (const e of entriesForGroup(group)) {
        this.unload(e.key);
        this.missing.delete(e.key);
      }
    };
    if (g.done) release();
    else void g.promise.then(release);
  }

  async loadEntries(entries: AssetEntry[], onProgress?: (ratio: number) => void): Promise<void> {
    const todo = entries.filter((e) => {
      if (this.has(e.key)) return false;
      if (e.lazy) return false; // 030：懒加载图片不随组下载（loadImage 用到时再取）
      if (e.art && !this.artEnabled) {
        this.missing.add(e.key); // ?art=0：当作没交付，场景用白盒
        return false;
      }
      if (e.pending && !pendingArtPresent(e.url)) {
        this.missing.add(e.key); // 约定文件还没交付：不发请求（不 404），场景用白盒
        return false;
      }
      return true;
    });
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
          if (entry.type === 'gltf' && !entry.optional) {
            if (typeof document !== 'undefined') document.documentElement.classList.add('assets-fallback');
            this.events.emit('assets:fallback', { url: entry.url, kind: 'glb' });
          }
          const attempts = assetStats.get(entry.url.startsWith('http') ? entry.url : `${BASE}${entry.url}`)?.attempts;
          // text-ok: 只进控制台日志
          const msg = `[assets] ${entry.optional ? '可选资源缺失，使用占位' : '加载失败'}: ${entry.key} (${entry.url})${attempts && attempts > 1 ? `，已重试 ${attempts - 1} 次` : ''}`;
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
        let gltf: GLTF;
        try {
          gltf = await shareInflight(this.gltfInflight, url, () => loadWithRetry(url, 'glb', () => this.gltf.loadAsync(url, prog)));
        } finally {
          this.gltfInflight.delete(url);
        }
        // 贴图最终失败的占位只留在颜色槽（法线 / 粗糙度槽清掉）
        stripFallbackTextures(gltf.scene);
        // 按 `_lodN` 命名组装 THREE.LOD；extras.puzzleCritical（→ userData）的物体只保留 LOD0 并释放低级 LOD
        const lodStats = buildLods(gltf.scene, (o) => disposeObject3D(o));
        if (import.meta.env.DEV && (lodStats.lodGroups || lodStats.criticalGroups || lodStats.forcedGroups)) {
          console.info(
            `[assets] ${entry.key}: LOD ${lodStats.lodGroups} 组，解谜关键(固定 LOD0) ${lodStats.criticalGroups} 个，forceLod0 ${lodStats.forcedGroups} 个，丢弃低级 LOD ${lodStats.droppedLevels} 个`,
          );
        }
        // COLOR_0 = 描边平滑法线（v0.1-index §5.4）：关掉材质 vertexColors，几何 color 属性保留给 023 描边读
        const asOutline = entry.vertexColors ? entry.vertexColors === 'outline' : gameConfig.assets.vertexColorsAreOutlineNormals;
        const vc = prepareOutlineNormals(gltf.scene, asOutline);
        for (const [mesh, reason] of vc.invalid) {
          console.warn(`[assets] ${entry.key}: 网格 ${mesh} 的 COLOR_0 不像平滑法线（${reason}），描边可能出错；真是顶点色请在 manifest 写 vertexColors: 'color'`);
        }
        if (import.meta.env.DEV && vc.meshes) {
          console.info(`[assets] ${entry.key}: COLOR_0 作描边平滑法线 ${vc.meshes} 个网格，关掉 vertexColors 的材质 ${vc.materialsFixed} 个`);
        }
        // 材质提示（v0.1-013：渔网 alphaHint = alphaHash）
        applyMaterialHints(gltf.scene);
        // extras 里的默认隐藏（defaultVisible: false / visible: false / hidden: true；美术 1030 船绳 -rope-low）
        applyExtrasVisibility(gltf.scene);
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
        const tex = await loadWithRetry(url, 'ktx2', () => this.ktx2.loadAsync(url, prog));
        if (entry.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
        this.textures.set(entry.key, tex);
        break;
      }
      case 'audio': {
        const buf = await this.audioLoader.loadAsync(url, prog);
        this.audio.set(entry.key, buf);
        break;
      }
      case 'image': {
        this.images.set(entry.key, await this.fetchImage(url));
        onProgress(1);
        break;
      }
      case 'font': {
        // 字体子集（WOFF2）：注册为 FontFace，CSS 的 --ui-font / --ui-serif 里排在最前；不支持 FontFace 的环境跳过
        if (typeof FontFace === 'undefined' || typeof document === 'undefined') break;
        // 唯一下载路径（见 fontLoader.ts）：同 URL 共用一次请求，网络层失败重试，全部失败回退系统字体（不算加载失败）
        const face = await loadFontOnce(url, entry.family ?? entry.key, {
          fetch: (u, init) => fetch(u, init),
          makeFace: async (family, bytes) => {
            const f = new FontFace(family, bytes, { display: 'swap' });
            await f.load();
            return f;
          },
          addFace: (f) => document.fonts.add(f),
          onFallback: (family, err) => {
            document.documentElement.classList.add('fonts-fallback');
            // text-ok: 只进控制台日志
            console.warn(`[assets] 字体 ${family} 加载失败，回退系统字体`, err);
          },
        });
        if (!face) {
          this.missing.add(entry.key);
          onProgress(1);
          break;
        }
        this.fonts.set(entry.key, face);
        this.fontUrls.set(entry.key, url);
        onProgress(1);
        break;
      }
    }
  }

  /** 重试后仍失败：日志 + 可见降级标记（GLB 由 loadEntries 换占位模型） */
  private degraded(url: string, kind: 'glb' | 'ktx2', err: unknown): void {
    const st = assetStats.get(url);
    // text-ok: 只进控制台日志
    console.error(`[assets] ${kind === 'ktx2' ? '贴图' : '模型'}加载失败（${st?.attempts ?? '?'} 次），使用占位：${url}`, err);
    if (typeof document !== 'undefined') document.documentElement.classList.add('assets-fallback');
    this.events.emit('assets:fallback', { url, kind });
  }

  has(key: string): boolean {
    return this.models.has(key) || this.textures.has(key) || this.audio.has(key) || this.fonts.has(key) || this.images.has(key);
  }

  /** 030 UI 图片：下载（网络失败 / 5xx 重试，同 GLB）+ 解码，成功返回 URL；之后 CSS / <img> 用同一 URL 命中缓存 */
  private async fetchImage(url: string): Promise<string> {
    await loadWithRetry(url, 'img', async () => {
      const r = await fetch(url);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { response: { status: r.status } });
      await r.arrayBuffer();
    });
    if (typeof Image !== 'undefined') {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
    }
    return url;
  }

  /** 已加载的 UI 图片 URL（没有 / 没交付 / ?art=0 → null） */
  imageUrl(key: string): string | null {
    return this.images.get(key);
  }

  /**
   * 懒加载一张 UI 图片（030：阅读纸张、结尾插画、菜单兜底背景）。同 key 只下载一次（并发共享）；
   * ?art=0 / 文件缺失 / 解码失败 → null（调用方退回纯色底），失败的下次再请求会重试。
   */
  loadImage(key: string): Promise<string | null> {
    return this.images.load(key);
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

  /** 卸载模型后：丢掉不再被任何已缓存模型引用的共享 KTX2 */
  private pruneKtx2Cache(): void {
    const used = new Set<unknown>();
    for (const g of this.models.values())
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.material) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) for (const v of Object.values(mat)) if (v instanceof THREE.Texture) used.add(v);
      });
    for (const [url, p] of this.ktx2Cache)
      void p.then((t) => {
        if (!used.has(t) && this.ktx2Cache.get(url) === p) this.ktx2Cache.delete(url);
      });
  }

  /** 共享 KTX2 缓存条数（smoke 读） */
  get sharedKtx2Count(): number {
    return this.ktx2Cache.size;
  }

  /** 缓存中的几何体/材质/纹理集合，场景 dispose 时跳过它们 */
  sharedResources(): Set<unknown> {
    const set = new Set<unknown>();
    for (const g of this.models.values()) {
      g.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) set.add(m.geometry);
        if (m.material)
          for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
            set.add(mat);
            // 材质里的纹理也是缓存共享的：场景克隆材质（按物体雾等）后 dispose 克隆体时不能连带释放（v0.1-013）
            for (const v of Object.values(mat)) if (v instanceof THREE.Texture) set.add(v);
          }
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
    this.images.delete(key);
    if (g) this.pruneKtx2Cache();
    this.audio.delete(key);
    const face = this.fonts.get(key);
    if (face) document.fonts.delete(face);
    const fontUrl = this.fontUrls.get(key);
    if (fontUrl) forgetFont(fontUrl);
    this.fonts.delete(key);
    this.fontUrls.delete(key);
  }

  dispose(): void {
    for (const key of [...this.models.keys(), ...this.textures.keys(), ...this.audio.keys(), ...this.fonts.keys()]) this.unload(key);
    this.groups.clear();
    this.draco.dispose();
    this.ktx2.dispose();
  }
}
