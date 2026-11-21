#!/usr/bin/env node
// 包一层 game/scripts/lib/glb-audit.mjs（不改 game/）：给它的 GLTFLoader 打一个 KTX2 桩，
// 让带 KHR_texture_basisu 的 GLB 也能走完「按游戏方式加载」那一步。
// 原因：game 的 verify:glb 里 loadLikeGame() 没有 setKTX2Loader，KTX2 GLB 会直接报
//   “setKTX2Loader must be called before loading KTX2 textures”。游戏本体 AssetLoader 是设了的。
// 用法：node art/tools/verify-glb-ktx2.mjs a.glb b.glb ...（规则、输出与 npm run verify:glb 完全一致）
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../game');
const req = (p) => import(pathToFileURL(path.join(GAME, p)).href);
const { GLTFLoader } = await req('node_modules/three/examples/jsm/loaders/GLTFLoader.js');
const THREE = await req('node_modules/three/build/three.module.js');
const stub = { load(url, onLoad) { const t = new THREE.Texture(); t.userData.ktx2 = url; setTimeout(() => onLoad(t)); }, };
const orig = GLTFLoader.prototype.parse;
GLTFLoader.prototype.parse = function (...a) { if (!this.ktx2Loader) this.setKTX2Loader(stub); return orig.apply(this, a); };
const { auditGlb, printReport } = await req('scripts/lib/glb-audit.mjs');
let ok = true;
for (const f of process.argv.slice(2)) {
  try { const r = await auditGlb(path.resolve(f)); printReport(r); if (r.errors.length) ok = false; }
  catch (e) { console.log(`✗ ${f} 读取失败：${e.message}`); ok = false; }
}
console.log(ok ? '\n全部通过' : '\n有不通过的文件');
process.exit(ok ? 0 : 1);
