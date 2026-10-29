// GLB 交付自检（node scripts/verify-lod.mjs <文件...>）。规则来自 docs/tasks/v0.1-index.md §5 与 art/style/style-guide.md §8。
//
// 两步：
//  1. 直接读 GLB 的 JSON 块（不解压）：节点树（一律按默认场景 scene.nodes 往下遍历，和 GLTFLoader 的 gltf.scene 一致；
//     只在 nodes 数组里、没挂在场景树上的节点加载后拿不到，不算数，BUG-001）、LOD 层级、各级三角面（accessor.count，Meshopt 压缩也能数）、
//     puzzleCritical、特殊节点（-collider / -interact / -wall / -cam …）、COLOR_0、材质、贴图尺寸；
//  2. 用游戏同一套 GLTFLoader（+ Meshopt）真正解析一遍，跑 buildLods + prepareOutlineNormals（与 AssetLoader 相同），
//     确认加载后的结果，并抽样校验 COLOR_0 确实是编码后的平滑法线。
// 结果分 ✗ 错误（退出码 1）/ ! 警告 / · 信息。
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { CompressedTexture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { buildLods, parseLodName } from '../../src/render/lod.ts';
import { prepareOutlineNormals } from '../../src/assets/vertexColors.ts';

// ---------------------------------------------------------------- 预算（v0.1-index §5.4 / §5.10、style-guide §8、裁定第 4 条、031）

/** puzzleCritical 单件三角面上限（LOD0，只交 LOD0）。按文件 / 根节点名匹配，其余 15k */
const CRITICAL_BUDGETS = [
  [/^prop-lantern-brass/, 8_000, '风灯 ≤ 8k'],
  [/^prop-tide-bell/, 20_000, '潮汐钟 ≤ 20k'],
  [/^prop-white-stones/, 20_000, '白石组 ≤ 20k'],
  [/^prop-key-/, 3_000, '钥匙 ≤ 3k'],
];
const CRITICAL_DEFAULT = 15_000;
/** 角色每级 LOD 上限 */
const CHAR_BUDGETS = [
  [/^char-xi/, [120_000, 50_000, 25_000], '主角汐 lod0 ≤ 120k / lod1 ≤ 50k / lod2 ≤ 25k（裁定第 4 条）'],
  [/^char-father/, [60_000, 25_000, 25_000], 'NPC 父亲 lod0 ≤ 60k / lod1 ≤ 25k（v0.1-031）'],
  [/^char-/, [60_000, 40_000, 25_000], 'NPC 60k / 40k / 25k（style-guide §8 npcCharTris）'],
];
/** 每个场景静态环境份额（v0.1-index §5.10），单件只做占比参考 */
const ENV_SCENE_SHARE = [4_000_000, 2_300_000, 1_000_000];
/** 每级面数应约减半：下一级 / 上一级 超过这个比例就警告 */
const LOD_RATIO_WARN = 0.65;

const SPECIAL_SUFFIXES = ['collider', 'wall', 'interact', 'cam', 'indoor', 'emitter', 'emitter-dir', 'socket', 'receiver', 'mirror-plane', 'waterline'];
const SPECIAL_RE = new RegExp(`-(${SPECIAL_SUFFIXES.join('|')})(?:\\.\\d+)?$`, 'i');

// ---------------------------------------------------------------- GLB 读取

function readGlb(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('不是 GLB 文件（magic 不是 glTF）');
  const version = buf.readUInt32LE(4);
  if (version !== 2) throw new Error(`glTF 版本 ${version}，只支持 2`);
  let off = 12;
  let json = null;
  let bin = null;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    off += 8 + len;
  }
  if (!json) throw new Error('GLB 里没有 JSON 块');
  return { json, bin };
}

/** 读贴图像素尺寸（PNG / JPEG / WebP / KTX2 文件头） */
function imageSize(b) {
  if (!b || b.length < 32) return null;
  if (b.readUInt32BE(0) === 0x89504e47) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), fmt: 'png' };
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, fmt: 'webp' };
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1, fmt: 'webp' };
    }
    if (chunk === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), fmt: 'webp' };
  }
  if (b[0] === 0xab && b.toString('ascii', 1, 4) === 'KTX') return { w: b.readUInt32LE(20), h: b.readUInt32LE(24), fmt: 'ktx2' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: b.readUInt16BE(i + 7), h: b.readUInt16BE(i + 5), fmt: 'jpeg' };
      i += 2 + len;
    }
  }
  return null;
}

function primTris(json, prim) {
  const mode = prim.mode ?? 4;
  const count = prim.indices !== undefined ? json.accessors[prim.indices].count : json.accessors[prim.attributes.POSITION]?.count ?? 0;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0; // 点 / 线不算三角面
}

const flagOn = (v) => v === true || v === 1 || v === 'true';
const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n));
const stripDup = (name) => (name ?? '').replace(/\.\d+$/, '');

// ---------------------------------------------------------------- 审核

/**
 * @param {string} file GLB 路径
 * @param {{ budget?: number }} [opts] budget：手动指定 LOD0 三角面上限（覆盖按名字推断的预算）
 * @returns {Promise<{ file, errors: string[], warnings: string[], info: string[], summary: object }>}
 */
export async function auditGlb(file, opts = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  const buf = readFileSync(file);
  const { json, bin } = readGlb(buf);
  const nodes = json.nodes ?? [];
  const meshes = json.meshes ?? [];
  const assetName = basename(file).replace(/\.glb$/i, '');

  // 父子关系
  const parent = new Array(nodes.length).fill(-1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const sceneRootIdx = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const sceneRoots = sceneRootIdx.map((i) => nodes[i]?.name ?? `#${i}`);
  // 场景树：从默认场景的根节点往下遍历（BUG-001：只在 nodes 数组里、不在树上的节点加载后不存在）
  const inScene = new Array(nodes.length).fill(false);
  const stack = [...sceneRootIdx];
  while (stack.length) {
    const i = stack.pop();
    if (!nodes[i] || inScene[i]) continue;
    inScene[i] = true;
    stack.push(...(nodes[i].children ?? []));
  }
  const nodeName = (i) => nodes[i]?.name ?? `#${i}`;
  /** 最靠上的 puzzleCritical 祖先（含自己），没有返回 -1；只对场景树上的节点有意义 */
  const critRootOf = (i) => {
    let root = -1;
    for (let p = i; p >= 0; p = parent[p]) if (flagOn(nodes[p].extras?.puzzleCritical)) root = p;
    return root;
  };
  const critOf = (i) => critRootOf(i) >= 0;
  const orphans = nodes.map((_, i) => i).filter((i) => !inScene[i]);
  // puzzleCritical 根：场景树上标了 puzzleCritical、且上面没有别的 puzzleCritical 祖先的节点
  const critRoots = nodes.map((_, i) => i).filter((i) => inScene[i] && critRootOf(i) === i);
  const criticalNodes = critRoots.map(nodeName);
  const orphanCritical = orphans.filter((i) => flagOn(nodes[i].extras?.puzzleCritical));
  const isCritical = criticalNodes.length > 0;
  const isChar = /^char-/.test(assetName) || nodes.some((n) => n.skin !== undefined);

  info.push(`扩展：${(json.extensionsUsed ?? []).join(', ') || '无'}${json.extensionsRequired?.length ? `（必需：${json.extensionsRequired.join(', ')}）` : ''}`);
  // extras.pivot：three r18x 的 GLTFLoader 把带 userData.pivot 的节点当成 GLTFExporter 的「枢轴容器」重建
  // （node.pivot = fromArray(pivot)、位置减 pivot、第一个子节点归零），美术随手填的 pivot 会让位置变成 NaN / 子节点错位。
  // 美术约定改用 originAt；任何节点 extras 出现 pivot 键一律报错（不论有没有子节点）。
  nodes.forEach((n, i) => {
    const ex = n.extras;
    if (ex && typeof ex === 'object' && !Array.isArray(ex) && Object.prototype.hasOwnProperty.call(ex, 'pivot'))
      errors.push(`${nodeName(i)}：节点 extras 里有键 pivot（${JSON.stringify(ex.pivot)}），GLTFLoader 会把它当枢轴容器、位置可能变成 NaN；改用 originAt`);
  });
  if (orphanCritical.length) errors.push(`标了 puzzleCritical 但不在场景树上（加载后不存在）：${orphanCritical.map(nodeName).join(', ')}`);
  if (!(json.extensionsUsed ?? []).includes('EXT_meshopt_compression')) warnings.push('没用 Meshopt 压缩（§5.7：GLB 用 Meshopt）');
  info.push(`场景根节点：${sceneRoots.join(', ') || '（无）'}；节点 ${nodes.length}，网格 ${meshes.length}，材质 ${(json.materials ?? []).length}，蒙皮 ${(json.skins ?? []).length}，动画 ${(json.animations ?? []).length}`);

  // ---- 特殊节点（只数场景树上的；不在树上的报错，BUG-001）
  const special = {};
  nodes.forEach((n, i) => {
    const m = SPECIAL_RE.exec(n.name ?? '');
    if (!m) return;
    const kind = m[1].toLowerCase();
    if (!inScene[i]) {
      errors.push(`${n.name}：-${kind} 节点在 nodes 列表里但没挂在场景树上（不在任何父节点 children / scene.nodes 里），加载后拿不到`);
      return;
    }
    (special[kind] ??= []).push({ i, name: n.name, hasMesh: n.mesh !== undefined, critRoot: critRootOf(i) });
  });
  const colliders = special.collider ?? [];
  const interacts = special.interact ?? [];
  const specialLine = Object.entries(special).map(([kind, list]) => `-${kind}×${list.length}`).join('  ');
  info.push(`特殊节点（场景树上）：${specialLine || '无'}`);
  const orphanMeshes = orphans.filter((i) => nodes[i].mesh !== undefined && !SPECIAL_RE.test(nodes[i].name ?? ''));
  if (orphanMeshes.length) warnings.push(`不在场景树上的网格节点（加载后不存在，白占包体）：${orphanMeshes.map(nodeName).join(', ')}`);
  for (const c of colliders) if (!c.hasMesh) errors.push(`${c.name}：-collider 节点没有网格`);
  for (const c of special.wall ?? []) if (!c.hasMesh) errors.push(`${c.name}：-wall 节点没有网格`);
  for (const c of interacts) if (c.hasMesh) warnings.push(`${c.name}：-interact 应是空节点（只要位置和朝向），却带了网格，会被渲染`);

  // ---- 渲染网格：按 LOD 层级统计三角面、COLOR_0
  const renderNodes = []; // { i, name, tris, level, base, colorPrims, prims }
  nodes.forEach((n, i) => {
    if (!inScene[i] || n.mesh === undefined || SPECIAL_RE.test(n.name ?? '')) return;
    const mesh = meshes[n.mesh];
    let tris = 0;
    let colorPrims = 0;
    for (const p of mesh.primitives) {
      tris += primTris(json, p);
      if (p.attributes.COLOR_0 !== undefined) colorPrims++;
    }
    // 节点本身不带 _lodN 时看祖先（LOD 父空物体下挂子网格的写法）
    let lod = null;
    for (let p = i; p >= 0 && !lod; p = parent[p]) lod = parseLodName(nodes[p].name ?? '');
    renderNodes.push({ i, name: n.name ?? `#${i}`, tris, level: lod?.level ?? null, base: lod?.base ?? null, colorPrims, prims: mesh.primitives.length });
  });

  const groups = new Map(); // base → Map(level → tris)
  let unlodded = 0;
  for (const r of renderNodes) {
    if (r.level === null) {
      unlodded += r.tris;
      continue;
    }
    const g = groups.get(r.base) ?? new Map();
    g.set(r.level, (g.get(r.level) ?? 0) + r.tris);
    groups.set(r.base, g);
  }
  // 每一级的全资产总面数（多组 LOD 时相加；没有 LOD 命名的网格算进每一级）
  const maxLevel = Math.max(-1, ...[...groups.values()].flatMap((g) => [...g.keys()]));
  const levelTotals = [];
  for (let l = 0; l <= Math.max(0, maxLevel); l++) {
    let t = unlodded;
    for (const g of groups.values()) {
      // 某组缺这一级时用它最低的一级（与运行时 THREE.LOD 行为一致）
      const levels = [...g.keys()].sort((a, b) => a - b);
      const use = levels.filter((x) => x <= l).pop() ?? levels[0];
      t += g.get(use) ?? 0;
    }
    levelTotals.push(t);
  }

  if (groups.size === 0) info.push(`LOD：无 _lodN 命名，渲染网格共 ${k(unlodded)} 三角面（当作单级 LOD0）`);
  for (const [base, g] of groups) {
    const levels = [...g.keys()].sort((a, b) => a - b);
    info.push(`LOD 组 ${base}：${levels.map((l) => `lod${l} ${k(g.get(l))}`).join(' / ')}`);
    if (levels[0] !== 0) errors.push(`LOD 组 ${base} 缺 _lod0`);
    levels.forEach((l, idx) => {
      if (idx > 0 && l !== levels[idx - 1] + 1) warnings.push(`LOD 组 ${base}：层级不连续（lod${levels[idx - 1]} → lod${l}）`);
      if (idx > 0) {
        const ratio = g.get(l) / Math.max(1, g.get(levels[idx - 1]));
        if (ratio > LOD_RATIO_WARN) warnings.push(`LOD 组 ${base}：lod${l}/lod${levels[idx - 1]} = ${(ratio * 100).toFixed(0)}%，约定每级约减半`);
      }
    });
  }
  if (unlodded && groups.size) info.push(`另有不带 LOD 命名的渲染网格 ${k(unlodded)} 三角面（各级都显示）`);
  info.push(`各级总三角面：${levelTotals.map((t, l) => `lod${l} ${t.toLocaleString('en-US')}`).join(' / ')}`);

  // ---- puzzleCritical
  let budgetLine;
  if (isCritical) {
    info.push(`puzzleCritical：${criticalNodes.join(', ')}（加载后整棵子树固定 LOD0）`);
    if (!criticalNodes.some((n) => sceneRoots.includes(n))) warnings.push('puzzleCritical 没设在场景根节点上（§5.4 约定设在根节点）');
    const extraLevels = renderNodes.filter((r) => r.level !== null && r.level > 0 && critOf(r.i));
    if (extraLevels.length) warnings.push(`puzzleCritical 物体只交 LOD0（§5.4），带了 ${extraLevels.map((r) => r.name).join(', ')}：加载时会被丢弃，白占包体`);
    // -collider / -interact 必须在 puzzleCritical 根节点的子树里（BUG-001：挂在树外 / 别的根下都不算）
    for (const c of [...colliders, ...interacts]) {
      if (c.critRoot < 0) errors.push(`${c.name}：不在任何 puzzleCritical 根节点（${criticalNodes.join(', ')}）的子树里，不算这件关键物体的${c.name.match(SPECIAL_RE)?.[1] === 'collider' ? '碰撞体' : '交互点'}`);
    }
    const multi = critRoots.length > 1;
    for (const r of critRoots) {
      const label = multi ? `puzzleCritical 物体 ${nodeName(r)} ` : 'puzzleCritical 物体';
      if (!colliders.some((c) => c.critRoot === r)) errors.push(`${label}缺 -collider（§5.4 必须）`);
      if (!interacts.some((c) => c.critRoot === r)) {
        // 白石组按 021 只给大块碰撞、本身不是交互物，-interact 不强制
        if (/^prop-white-stones/.test(assetName)) warnings.push(`${multi ? `${nodeName(r)} ` : ''}没有 -interact（白石组按 021 可以不做交互点，确认即可）`);
        else errors.push(`${label}缺 -interact 交互点（§5.4 必须）`);
      }
    }
  } else {
    info.push('puzzleCritical：无（按画质档位正常切 LOD）');
  }

  // ---- 三角面预算
  const lod0 = levelTotals[0] ?? 0;
  if (opts.budget) {
    budgetLine = `LOD0 ≤ ${k(opts.budget)}（--budget 指定）`;
    if (lod0 > opts.budget) errors.push(`LOD0 三角面 ${lod0.toLocaleString('en-US')} 超出预算 ${opts.budget.toLocaleString('en-US')}`);
  } else if (isCritical) {
    const hit = CRITICAL_BUDGETS.find(([re]) => re.test(assetName) || criticalNodes.some((n) => re.test(n)));
    const cap = hit?.[1] ?? CRITICAL_DEFAULT;
    budgetLine = hit ? hit[2] : `puzzleCritical 单件 ≤ ${k(CRITICAL_DEFAULT)}`;
    if (lod0 > cap) errors.push(`三角面 ${lod0.toLocaleString('en-US')} 超出预算（${budgetLine}）`);
  } else if (isChar) {
    const hit = CHAR_BUDGETS.find(([re]) => re.test(assetName));
    if (hit) {
      budgetLine = hit[2];
      hit[1].forEach((cap, l) => {
        if (levelTotals[l] !== undefined && levelTotals[l] > cap) errors.push(`lod${l} 三角面 ${levelTotals[l].toLocaleString('en-US')} 超出 ${k(cap)}（${hit[2]}）`);
      });
      if (levelTotals.length < 3) warnings.push(`角色只有 ${levelTotals.length} 级 LOD（style-guide §8 每个模型做 LOD0–LOD2）`);
    }
  } else {
    budgetLine = `无单件上限；占场景静态环境份额 ${levelTotals
      .slice(0, 3)
      .map((t, l) => `lod${l} ${((t / ENV_SCENE_SHARE[l]) * 100).toFixed(2)}%`)
      .join(' / ')}（§5.10：LOD0 ≤ 4M、LOD1 ≤ 2.3M、LOD2 ≤ 1M）`;
    if (groups.size === 0 && lod0 > 2000) warnings.push('非关键物体没有 LOD1/LOD2（style-guide §8 每个模型做 LOD0–LOD2）');
  }
  info.push(`预算：${budgetLine}`);

  // ---- COLOR_0（描边平滑法线）
  const noColor = renderNodes.filter((r) => r.colorPrims < r.prims);
  const withColor = renderNodes.filter((r) => r.colorPrims > 0).length;
  info.push(`COLOR_0：${withColor}/${renderNodes.length} 个渲染网格带（约定 = 外扩描边平滑法线，加载后关 vertexColors）`);
  if (noColor.length) {
    const msg = `缺 COLOR_0 平滑法线：${noColor.map((r) => r.name).join(', ')}`;
    if (isCritical) errors.push(`${msg}（puzzleCritical 物体必须带，§5.4）`);
    else if (isChar || /^prop-/.test(assetName)) warnings.push(`${msg}（角色 / 道具要描边）`);
    else info.push(`${msg}（环境物体按 outlineHull 分档，可不描边）`);
  }

  // ---- 材质
  const mats = json.materials ?? [];
  if (mats.length > 3) warnings.push(`材质 ${mats.length} 个（§5.8 每件 ≤ 3）`);
  const badMat = mats.map((m) => m.name ?? '').filter((n) => !/^mat-(char|env|prop)-[a-z0-9-]+$/.test(n));
  if (badMat.length) warnings.push(`材质命名不符合 mat-char-* / mat-env-* / mat-prop-*：${badMat.join(', ')}`);

  // ---- 贴图
  const texCap = isChar ? 4096 : 2048; // §5.4 puzzleCritical 2048；§5.7 角色 4096、环境 ≤ 2048
  for (const [idx, img] of (json.images ?? []).entries()) {
    const label = img.name ?? img.uri ?? `#${idx}`;
    let size = null;
    if (img.bufferView !== undefined && bin) {
      const bv = json.bufferViews[img.bufferView];
      size = imageSize(bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength));
    }
    if (!size) {
      info.push(`贴图 ${label}：${img.mimeType ?? '外部文件'}（未读到尺寸）`);
      continue;
    }
    info.push(`贴图 ${label}：${size.w}×${size.h} ${size.fmt}`);
    if (Math.max(size.w, size.h) > texCap) errors.push(`贴图 ${label} ${size.w}×${size.h} 超过 ${texCap}`);
    if (size.fmt !== 'ktx2') warnings.push(`贴图 ${label} 是 ${size.fmt}，正式交付要 KTX2（§5.7）`);
  }

  // ---- 2. 用游戏的加载流程真正解析一遍
  const runtime = await loadLikeGame(buf);
  info.push(
    `加载器：buildLods → THREE.LOD ${runtime.lod.lodGroups} 个，固定 LOD0 ${runtime.lod.criticalGroups} 个，丢弃低级 LOD ${runtime.lod.droppedLevels} 个；` +
      `COLOR_0 网格 ${runtime.vc.meshes} 个，关掉 vertexColors 的材质 ${runtime.vc.materialsFixed} 个；加载后渲染三角面 ${runtime.renderTris.toLocaleString('en-US')}`,
  );
  for (const [mesh, reason] of runtime.vc.invalid) errors.push(`COLOR_0 数据不像平滑法线：${mesh}（${reason}）`);
  if (runtime.vertexColorsLeft.length) errors.push(`加载后仍有材质开着 vertexColors：${runtime.vertexColorsLeft.join(', ')}`);
  if (isCritical && runtime.lodLeft.length) errors.push(`puzzleCritical 子树加载后仍是 THREE.LOD：${runtime.lodLeft.join(', ')}`);
  if (runtime.nanNodes.length) errors.push(`加载后位置 / 旋转 / 缩放含 NaN：${runtime.nanNodes.join(', ')}`);
  for (const w of runtime.loaderWarnings) warnings.push(`GLTFLoader：${w}`);

  return {
    file,
    errors,
    warnings,
    info,
    summary: { asset: assetName, puzzleCritical: isCritical, levels: levelTotals, colliders: colliders.length, interacts: interacts.length },
  };
}

/** Node 里用 GLTFLoader 解析：贴图解码打桩（只关心几何 / 节点 / 材质开关），其余与 AssetLoader 一致 */
async function loadLikeGame(buf) {
  globalThis.self ??= globalThis; // GLTFLoader 用 self.URL 创建贴图 blob URL
  const realCIB = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
  const loaderWarnings = [];
  const realWarn = console.warn;
  console.warn = (...a) => loaderWarnings.push(a.map(String).join(' '));
  try {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    // KTX2（KHR_texture_basisu）贴图在 Node 里不转码，给一个只回空压缩纹理的 loader（只关心几何 / 节点 / 材质开关；尺寸已从文件头读）
    const ktx2Stub = { load: (_url, onLoad) => onLoad(new CompressedTexture([], 1, 1)) };
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Stub).parseAsync(ab, '');
    const lod = buildLods(gltf.scene, () => {});
    const vc = prepareOutlineNormals(gltf.scene, true);
    // 加载后实际渲染的三角面：THREE.LOD 只数第 0 级，碰撞体 / 空气墙不算
    const skip = new Set();
    gltf.scene.traverse((o) => {
      if (o.isLOD) for (const l of o.levels.slice(1)) l.object.traverse((c) => skip.add(c));
    });
    const isHelper = (o) => o && /-(collider|wall)$/.test(stripDup(o.userData.name ?? o.name));
    let renderTris = 0;
    const vertexColorsLeft = [];
    const lodLeft = [];
    gltf.scene.traverse((o) => {
      if (o.isLOD && o.userData.puzzleCritical) lodLeft.push(o.name);
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.vertexColors) vertexColorsLeft.push(m.name || o.name);
      if (skip.has(o) || isHelper(o) || isHelper(o.parent)) return;
      renderTris += triCount(o.geometry);
    });
    const nanNodes = [];
    gltf.scene.traverse((o) => {
      const v = [...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray()];
      if (v.some((x) => !Number.isFinite(x))) nanNodes.push(o.name || '(无名)');
    });
    return { lod, vc, renderTris, nanNodes, vertexColorsLeft: [...new Set(vertexColorsLeft)], lodLeft, loaderWarnings };
  } finally {
    console.warn = realWarn;
    if (realCIB) globalThis.createImageBitmap = realCIB;
    else delete globalThis.createImageBitmap;
  }
}

function triCount(g) {
  return Math.floor((g.index ? g.index.count : g.attributes.position.count) / 3);
}

/** 打印一份报告，返回是否通过 */
export function printReport(r) {
  console.log(`\n■ ${r.file}`);
  for (const l of r.info) console.log(`  · ${l}`);
  for (const l of r.warnings) console.log(`  ! ${l}`);
  for (const l of r.errors) console.log(`  ✗ ${l}`);
  const ok = r.errors.length === 0;
  console.log(`  ${ok ? '✓ 通过' : '✗ 不通过'}（错误 ${r.errors.length}，警告 ${r.warnings.length}）`);
  return ok;
}
