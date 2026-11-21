import { launch } from './cdp.mjs';
import { startDev } from './server.mjs';
const dev = await startDev(5224);
const { page, close } = await launch();
await page.goto(dev.url + '/?scene=testbed');
await page.waitFor(`window.__game?.scenes.current?.name === 'testbed'`, 120000, 250);
const r = await page.evaluate(`(async () => {
  const a = __game.assets;
  await a.loadEntries([
    { key: 'qa-lantern', type: 'gltf', url: 'qa/prop-lantern-brass.glb', group: 'qa' },
    { key: 'qa-xi', type: 'gltf', url: 'qa/char-xi.glb', group: 'qa' },
    { key: 'qa-orphan', type: 'gltf', url: 'qa/lantern-no-collider.glb', group: 'qa' }]);
  const res = {};
  for (const k of ['qa-lantern', 'qa-xi', 'qa-orphan']) {
    const g = a.models.get(k); const mats = []; const names = [];
    let meshes = 0, withColor = 0;
    g.scene.traverse(o => { names.push(o.name); if (!o.isMesh) return; meshes++; if (o.geometry.attributes.color) withColor++;
      for (const m of [].concat(o.material)) mats.push({ name: m.name, vc: m.vertexColors }); });
    res[k] = { meshes, withColor, mats: [...new Map(mats.map(m => [m.name, m])).values()], vcTrue: mats.filter(m => m.vc).length,
      colliderInScene: names.filter(n => /-collider/.test(n)), jsonNodes: g.parser.json.nodes.map(n => n.name).filter(n => /-collider|-interact|-emitter/.test(n ?? '')) };
  }
  // 对照：直接用 three 的 GLTFLoader（不经 AssetLoader）加载同一文件
  const { GLTFLoader } = await import('/node_modules/.vite/deps/three_examples_jsm_loaders_GLTFLoader__js.js');
  let raw = null; try { const L = new GLTFLoader(); try { const { MeshoptDecoder } = await import('/node_modules/.vite/deps/three_examples_jsm_libs_meshopt___decoder__module__js.js'); L.setMeshoptDecoder(MeshoptDecoder); } catch (e) { res.rawErr1 = String(e); }
  raw = await L.loadAsync('/qa/prop-lantern-brass.glb'); } catch (e) { res.rawErr = String(e).slice(0, 200); }
  const rm = []; raw?.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) rm.push({ name: m.name, vc: m.vertexColors }); });
  res.rawGLTFLoader = rm;
  return res; })()`);
console.log(JSON.stringify(r, null, 1));
console.log('ERRORS', JSON.stringify(page.errors));
close(); await dev.close(); process.exit(0);
