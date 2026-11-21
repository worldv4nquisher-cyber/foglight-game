// v0.1-028 大气预览模块（天空云层 / 雾墙 / 岛边地面雾 / 水面法线 + 雨圈 / 雨丝 / LUT）。
// 参数全部来自 /source/atmosphere/atmosphere-028.json；贴图来自 /textures/*.ktx2 与 /textures/lut/*.png。
// env.html / env-s2.html / env-s3.html 带 ?atmo=028 时调用；&rain=028|naive|off  &tier=ultra|high|standard  &preset=overcast-dusk|rain-night|…  &lut=0
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

export async function loadAtmo(THREE, renderer, Q) {
  const P = await (await fetch('/source/atmosphere/atmosphere-028.json')).json();
  const ktx = new KTX2Loader().setTranscoderPath('/three/examples/jsm/libs/basis/').detectSupport(renderer);
  const cache = new Map();
  const tex = (key, repeat = true) => {
    if (!cache.has(key)) cache.set(key, ktx.loadAsync(`/textures/${key}.ktx2`).then((t) => { if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; }));
    return cache.get(key);
  };
  const lut = (name) => new Promise((ok, err) => new THREE.TextureLoader().load(`/textures/lut/${name}`, (t) => {
    t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; ok(t); }, undefined, err));
  const presetName = Q.get('preset') ?? 'overcast-dusk';
  return { P, tex, lut, preset: P.presets[presetName], presetName, tier: Q.get('tier') ?? 'ultra', rainMode: Q.get('rain') ?? '028', lutOn: Q.get('lut') !== '0' };
}

const C = (THREE, h) => new THREE.Color(h);

// ---------------- 天空：渐变 + 层云贴图（平面投影 uv = dir.xz/(dir.y+0.12)）+ 地平线残余天光
export async function makeSky(THREE, A, radius = 1500) {
  const s = A.preset.sky, cl = s.clouds, db = s.duskBand;
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: C(THREE, s.top) }, mid: { value: C(THREE, s.mid) }, hor: { value: C(THREE, s.horizon) }, elev: { value: new THREE.Vector2(s.midElev, s.topElev) },
      dusk: { value: C(THREE, db?.color ?? '#000') }, duskDir: { value: new THREE.Vector3(...(db?.dir ?? [1, 0, 0])).normalize() }, duskK: { value: new THREE.Vector3(db?.power ?? 1, db?.maxElev ?? 0.1, db ? db.strength : 0) },
      tC: { value: await A.tex(A.P.textures.skyClouds) }, cScale: { value: cl.scale }, cOff: { value: new THREE.Vector2(0.37, 0.61) }, cOpacity: { value: cl.opacity },
      cTint: { value: C(THREE, cl.tint) }, cFade: { value: new THREE.Vector2(...cl.fadeElev) }, cLift: { value: cl.horizonLift },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix*modelViewMatrix*vec4(position,1.0); gl_Position = p.xyww; }`,
    fragmentShader: `varying vec3 vDir; uniform vec3 top, mid, hor, dusk, duskDir, duskK, cTint; uniform vec2 elev, cOff, cFade; uniform float cScale, cOpacity, cLift; uniform sampler2D tC;
      void main(){
        vec3 d = normalize(vDir); float e = max(d.y, 0.0);
        vec3 c = mix(hor, mid, smoothstep(0.0, elev.x, e)); c = mix(c, top, smoothstep(elev.x, elev.y, e));
        vec2 uv = d.xz / (d.y + 0.12) * cScale + cOff;
        vec4 cl = texture2D(tC, uv);
        vec3 cc = mix(hor, cl.rgb * cTint, smoothstep(0.0, 0.22, e));            // 近地平线的云往地平线色收（空气透视）
        cc = mix(cc, hor, cLift * (1.0 - smoothstep(0.0, 0.3, e)));
        c = mix(c, cc, cl.a * cOpacity * smoothstep(cFade.x, cFade.y, e));
        float az = max(dot(normalize(vec3(d.x, 0.0, d.z)), duskDir), 0.0);
        c = mix(c, dusk, pow(az, duskK.x) * (1.0 - smoothstep(0.0, duskK.y, e)) * duskK.z * (0.75 + 0.25 * (1.0 - cl.a)));
        c = mix(c, hor, 1.0 - smoothstep(0.0, 0.04, e));
        gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 64, 32), mat); sky.renderOrder = -10; sky.frustumCulled = false; return sky;
}

// 软边：沿 uv.x 两端淡出（弧段端 / 雾片左右）+ 近相机淡出（防止贴脸硬边）。程序接入时同逻辑写进雾片 shader。
function soft(mat, { edge = 0.15, near = [6, 18] } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying float vEdgeU; varying float vViewD;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvEdgeU = uv.x; vViewD = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdgeU; varying float vViewD;')
      .replace('#include <alphamap_fragment>', `#include <alphamap_fragment>
      diffuseColor.a *= smoothstep(0.0, ${edge.toFixed(3)}, vEdgeU) * smoothstep(1.0, ${(1 - edge).toFixed(3)}, vEdgeU) * smoothstep(${near[0].toFixed(1)}, ${near[1].toFixed(1)}, vViewD);`);
  };
  mat.customProgramCacheKey = () => `soft${edge}_${near}`; return mat;
}
// ---------------- 雾：弧形雾墙（圆柱段，内表面朝 center）、岛边地面雾环、雾团、贴水薄雾
function arcCard(THREE, map, { center, radius, height, y, arcDeg, opacity, tint, tileW, fog }) {
  const a0 = arcDeg[0], a1 = arcDeg[1], len = (a1 - a0) * Math.PI / 180;
  const g = new THREE.CylinderGeometry(radius, radius, height, Math.max(8, Math.round(len * radius / 6)), 1, true, (90 - a1) * Math.PI / 180, len);
  const m = map.clone(); m.needsUpdate = true; m.repeat.set(Math.max(1, Math.round(len * radius / tileW)), 1); m.wrapT = THREE.ClampToEdgeWrapping;
  const mesh = new THREE.Mesh(g, soft(new THREE.MeshBasicMaterial({ map: m, color: tint, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog }), { edge: arcDeg[1] - arcDeg[0] >= 360 ? 0 : 0.12, near: [20, 60] }));
  mesh.position.set(center[0], y + height / 2, center[2]); mesh.renderOrder = 2; return mesh;
}
// 雾墙颜色 = 预设 fog.farWallTint × (该层 tint / 基准 #C9D0D4)：层间明暗关系固定，整体随预设（夜里不出亮带）
function wallTint(THREE, A, t) { const b = C(THREE, '#C9D0D4'), c = C(THREE, t), p = C(THREE, A.preset.fog.farWallTint ?? '#C9D0D4'); return new THREE.Color(p.r * c.r / b.r, p.g * c.g / b.g, p.b * c.b / b.b); }
function followCam(o) { o.userData.followCam = true; return o; }   // 远景雾墙跟随相机 xz（同天空盒），不随 y / 旋转
export async function addS1Fog(THREE, scene, A, { tide = 0, wallsOnly = false, center } = {}) {
  const S = A.P.s1, T = A.P.textures.fogCards, tier = A.P.fogTiers[A.tier] ?? A.P.fogTiers.ultra;
  const wall = await A.tex(T.wall), ground = await A.tex(T.ground), puff = await A.tex(T.puff, false);
  const group = new THREE.Group(); group.name = 'atmo028-fog';
  S.farWalls.slice(0, tier.farLayers).forEach((w) => group.add(followCam(arcCard(THREE, wall, { center: center ?? S.center, radius: w.radius, height: w.height, y: w.y, arcDeg: center ? [-180, 180] : w.arcDeg, opacity: w.opacity, tint: wallTint(THREE, A, w.tint), tileW: w.height * w.tileAspect, fog: false }))));
  if (!wallsOnly) {
    const gf = S.groundFog, gm = tier.groundFogOpacityMul ?? 1;
    for (const [ri, r] of gf.island.rings.entries()) for (let k = 0; k < r.count; k++) {          // 岛边雾：围绕岛的面向相机雾片
      const a = (k + 0.5 * ri) / r.count * Math.PI * 2, g2 = ground.clone(); g2.needsUpdate = true; g2.offset.x = (k * 0.37 + ri * 0.21) % 1; g2.repeat.x = r.width / (r.height * 4);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(r.width, r.height), soft(new THREE.MeshBasicMaterial({ map: g2, transparent: true, opacity: r.opacity * gm, depthWrite: false, fog: true }), { edge: 0.22, near: [8, 25] }));
      m.position.set(gf.island.center[0] + Math.cos(a) * r.radius, r.y + Math.max(tide, 0) + r.height * 0.5, gf.island.center[2] + Math.sin(a) * r.radius); m.userData.billboard = true; m.renderOrder = 2; group.add(m); }
    for (const p of gf.island.puffs) { const m = new THREE.Mesh(new THREE.PlaneGeometry(...p.size), soft(new THREE.MeshBasicMaterial({ map: puff, transparent: true, opacity: p.opacity * gm, depthWrite: false, fog: true }), { edge: 0.22, near: [8, 25] }));
      m.position.set(p.pos[0], p.pos[1] + Math.max(tide, 0) + p.size[1] * 0.3, p.pos[2]); m.userData.billboard = true; m.renderOrder = 2; group.add(m); }
    const nw = gf.nearWater; let s = nw.seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < nw.count; i++) {
      const d = nw.distance[0] + R() * (nw.distance[1] - nw.distance[0]), a = (nw.arcDeg[0] + R() * (nw.arcDeg[1] - nw.arcDeg[0])) * Math.PI / 180;
      const w = nw.width[0] + R() * (nw.width[1] - nw.width[0]), h = nw.height[0] + R() * (nw.height[1] - nw.height[0]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), soft(new THREE.MeshBasicMaterial({ map: ground, transparent: true, opacity: (nw.opacity[0] + R() * (nw.opacity[1] - nw.opacity[0])) * gm, depthWrite: false, fog: true }), { edge: 0.22, near: [8, 25] }));
      m.position.set(S.center[0] + Math.cos(a) * d, Math.max(tide, 0) + h * 0.32 - 0.4, S.center[2] + Math.sin(a) * d); m.userData.billboard = true; m.renderOrder = 2; group.add(m);
    }
  }
  scene.add(group); return group;
}
export function faceCamera(group, cam) { group.traverse((o) => { if (o.userData.billboard) o.lookAt(cam.position.x, o.position.y, cam.position.z); if (o.userData.followCam) o.position.set(cam.position.x, o.position.y, cam.position.z); }); }

// ---------------- 水面：Reflector 着色器（两层法线 + 雨圈 flipbook + 菲涅尔 + 自算雾）
export async function waterShader(THREE, A, fogCol, fogD, time = 1.3) {
  const w = A.preset.water, N = A.P.water, rip = A.P.rainTiers[A.tier]?.ripples;
  const tN = await A.tex(A.P.textures.waterNormal), tR = await A.tex(A.P.textures.rainRipple);
  const L = N.normal.layers; const frame = Math.floor(time * N.ripple.fps) % N.ripple.frames;
  return {
    name: 'Water028',
    uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, wcol: { value: C(THREE, w.color) }, fogCol: { value: fogCol.clone() }, fogD: { value: fogD },
      tN: { value: tN }, tR: { value: tR }, l0: { value: new THREE.Vector4(1 / L[0].tileM, 1 / L[0].tileM, L[0].scroll[0] * time / L[0].tileM, L[0].scroll[1] * time / L[0].tileM) },
      l1: { value: new THREE.Vector4(1 / L[1].tileM, 1 / L[1].tileM, L[1].scroll[0] * time / L[1].tileM, L[1].scroll[1] * time / L[1].tileM) },
      nScale: { value: w.normalScale }, ripK: { value: (A.preset.rain.enabled && rip?.enabled) ? N.normal.rippleMix * rip.strength : 0.0 }, ripL2: { value: rip?.layers > 1 ? 1 : 0 }, ripTile: { value: 1 / (rip?.tileM ?? 1.5) },
      frame: { value: new THREE.Vector2(frame % N.ripple.grid, Math.floor(frame / N.ripple.grid)) }, fres: { value: new THREE.Vector2(...w.fresnel) }, distort: { value: w.reflectDistort } },
    vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW; void main(){ vUv = textureMatrix*vec4(position,1.0); vW = (modelMatrix*vec4(position,1.0)).xyz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tN, tR; uniform vec3 wcol, fogCol; uniform float fogD, nScale, ripK, ripTile, distort, ripL2; uniform vec4 l0, l1; uniform vec2 frame, fres; varying vec4 vUv; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW); float dist = length(cameraPosition - vW);
        vec2 n = (texture2D(tN, vW.xz * l0.xy + l0.zw).xy * 2.0 - 1.0) + (texture2D(tN, vW.xz * l1.xy + l1.zw).xy * 2.0 - 1.0);
        n *= nScale;
        vec2 ru = vW.xz * ripTile; vec2 fu = (frame + fract(ru)) / 8.0;
        vec2 rn = textureGrad(tR, fu, dFdx(ru) / 8.0, dFdy(ru) / 8.0).xy * 2.0 - 1.0;
        if (ripL2 > 0.5) { vec2 r2 = mat2(0.8, -0.6, 0.6, 0.8) * vW.xz * ripTile * 1.37 + 0.31; vec2 f2 = mod(frame + vec2(4.0, 4.0), 8.0); rn += textureGrad(tR, (f2 + fract(r2)) / 8.0, dFdx(r2) / 8.0, dFdy(r2) / 8.0).xy * 2.0 - 1.0; rn *= 0.7; }   // 第二层：旋转 + 错帧，打散平铺
        n += rn * ripK * (1.0 - smoothstep(12.0, 30.0, dist));
        vec3 Nw = normalize(vec3(n.x, 1.0, n.y));
        vec4 uv = vUv; uv.xy += n * distort * uv.w / (1.0 + dist * 0.05);
        vec3 refl = texture2DProj(tDiffuse, uv).rgb;
        float fr = mix(fres.x, fres.y, pow(1.0 - max(dot(V, Nw), 0.0), 4.0));
        vec3 c = mix(wcol, refl * 0.9, fr);
        float f = 1.0 - exp(-pow(fogD * dist, 2.0)); c = mix(c, fogCol, f);
        gl_FragColor = vec4(c, mix(0.72, 0.97, fr)); }`,
  };
}

// ---------------- 泡沫（替换 env.html 的占位白沫贴图：泡沫 map × 环形遮罩 alphaMap）
export async function foamMaterial(THREE, A) {
  const map = await A.tex(A.P.textures.waterFoam); const m = map.clone(); m.needsUpdate = true; m.repeat.set(2, 2);
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d'); const img = x.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const u = i / N * 2 - 1, v = j / N * 2 - 1, r = Math.hypot(u, v);
    const ring = Math.max(0, Math.min(1, Math.exp(-(((r - 0.66) / 0.2) ** 2)) * 1.3)) * (r < 1 ? 1 : 0); const k = (j * N + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = ring * 255; img.data[k + 3] = 255; }
  x.putImageData(img, 0, 0); const am = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ map: m, alphaMap: am, transparent: true, opacity: A.P.s1.waterFoam.opacity, depthWrite: false, depthTest: true, fog: true, polygonOffset: true, polygonOffsetFactor: -2 });
}

// ---------------- 雨：quad（028 推荐，ultra/high）或 line（standard / 现状），静帧
export async function makeRain(THREE, A, cam, viewH, { mode, tier, seed = 11, time = 0.37 } = {}) {
  const T = A.P.rainTiers[tier ?? A.tier]; const pr = A.preset.rain;
  let cfg;
  if (mode === 'naive') cfg = { count: 30000, mode: 'line', lenMin: 0.35, lenMax: 0.8, opacity: 0.22, fadeNear: [0.6, 2.0], fadeFar: [3.0, 23.0], color: '#9FB0C0', area: [46, 26] };
  else if (mode === 'current') cfg = { count: 6000, mode: 'line', lenMin: 0.35, lenMax: 0.8, opacity: 0.22, fadeNear: [0.6, 2.0], fadeFar: [3.0, 23.0], color: '#9FB0C0', area: [46, 26] };
  else cfg = { ...T, color: pr.color };
  let s = seed; const R = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const [S, H] = cfg.area; const n = cfg.count; const seeds = new Float32Array(n * 4); const vari = new Float32Array(n);
  for (let i = 0; i < n; i++) { seeds.set([R() * S, R() * H, R() * S, cfg.lenMin + R() * (cfg.lenMax - cfg.lenMin)], i * 4); vari[i] = Math.floor(R() * 4); }
  const boost = (cfg.depthBoost ?? [[0, 1], [10, 1], [20, 1], [30, 1], [40, 1]]).slice(0, 5); while (boost.length < 5) boost.push(boost[boost.length - 1]);
  const uniforms = { uTime: { value: time }, uCenter: { value: cam.position.clone() }, uSpeed: { value: pr.speed ?? 22 }, uArea: { value: new THREE.Vector2(S, H) }, uTilt: { value: pr.windTilt ?? 0.25 },
    uColor: { value: C(THREE, cfg.color).multiplyScalar(pr.brightness ?? 1) }, uOpacity: { value: cfg.opacity }, uFade: { value: new THREE.Vector4(...cfg.fadeNear, ...cfg.fadeFar) },
    uBoost: { value: boost.map(([d, k]) => new THREE.Vector2(d, k)) }, uW: { value: new THREE.Vector3(cfg.widthM ?? 0, cfg.minPx ?? 1, cfg.maxPx ?? 1) }, uViewH: { value: viewH },
    map: { value: cfg.mode === 'quad' ? await A.tex(A.P.textures.rainStreak, false) : null } };
  const common = `uniform float uTime, uSpeed, uTilt; uniform vec3 uCenter; uniform vec2 uArea; uniform vec4 uFade; uniform vec2 uBoost[5];
    vec3 dropPos(vec4 sd, float w){ float S = uArea.x, H = uArea.y; vec3 p;
      p.x = mod(sd.x - uCenter.x, S) - S * 0.5 + uCenter.x; p.z = mod(sd.z - uCenter.z, S) - S * 0.5 + uCenter.z; p.y = mod(sd.y - uTime * uSpeed, H) + uCenter.y - H * 0.4;
      p.x += w * uTilt; p.y -= w; return p; }
    float boostAt(float d){ float k = uBoost[4].y; for (int i = 3; i >= 0; i--) { if (d < uBoost[i + 1].x) k = mix(uBoost[i].y, uBoost[i + 1].y, clamp((d - uBoost[i].x) / max(uBoost[i + 1].x - uBoost[i].x, 1e-3), 0.0, 1.0)); } return k; }
    float fadeAt(float d){ return smoothstep(uFade.w, uFade.z, d) * smoothstep(uFade.x, uFade.y, d) * boostAt(d); }`;
  if (cfg.mode === 'line') {
    const g = new THREE.BufferGeometry(); const sd2 = new Float32Array(n * 8);
    for (let i = 0; i < n; i++) { sd2.set([seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2], 0], i * 8); sd2.set([seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2], seeds[i * 4 + 3]], i * 8 + 4); }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3)); g.setAttribute('seed', new THREE.BufferAttribute(sd2, 4));
    const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms,
      vertexShader: `attribute vec4 seed; varying float vF; ${common}
        void main(){ vec3 p = dropPos(seed, seed.w); vec4 mv = modelViewMatrix * vec4(p, 1.0); vF = fadeAt(length(mv.xyz)); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vF; void main(){ gl_FragColor = vec4(uColor, uOpacity * vF); }` });
    const l = new THREE.LineSegments(g, m); l.frustumCulled = false; l.renderOrder = 8; return l;
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3)); g.setIndex([0, 2, 1, 1, 2, 3]);
  g.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4)); g.setAttribute('vari', new THREE.InstancedBufferAttribute(vari, 1)); g.instanceCount = n;
  const m = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, fog: false, uniforms,
    vertexShader: `attribute vec4 seed; attribute float vari; uniform vec3 uW; uniform float uViewH; varying float vF; varying vec2 vUv; ${common}
      void main(){
        vec3 p0 = (modelViewMatrix * vec4(dropPos(seed, 0.0), 1.0)).xyz, p1 = (modelViewMatrix * vec4(dropPos(seed, seed.w), 1.0)).xyz;
        vec3 mid = mix(p0, p1, position.y); float depth = max(-mid.z, 0.05);
        float Fp = projectionMatrix[1][1] * uViewH * 0.5;          // 1 m 在 depth=1 处的像素数
        float wpx = uW.x * Fp / depth, wc = clamp(wpx, uW.y, uW.z);   // 屏幕宽度夹在 [minPx, maxPx]
        vec2 dir = p1.xy - p0.xy; vec3 side = normalize(vec3(-dir.y, dir.x, 0.0) + 1e-5);
        vec3 pos = mid + side * position.x * wc * depth / Fp;
        vF = fadeAt(length(mix(p0, p1, 0.5))) * min(wpx / wc, 1.0);  // 不足 minPx 的按覆盖率降 alpha
        vUv = vec2((vari + position.x + 0.5) / 4.0, position.y);
        gl_Position = projectionMatrix * vec4(pos, 1.0); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 uColor; uniform float uOpacity; varying float vF; varying vec2 vUv;
      void main(){ vec4 t = texture2D(map, vUv); float l = dot(t.rgb, vec3(0.2126, 0.7152, 0.0722)); gl_FragColor = vec4(uColor * mix(0.9, 1.12, l), t.a * uOpacity * vF); }` });
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.renderOrder = 8; return mesh;
}

// ---------------- LUT（后处理，sRGB 输出之后）
export const LUT_GLSL = `uniform sampler2D tLut; uniform float lutOn;
  vec3 applyLut(vec3 c){ c = clamp(c, 0.0, 1.0); float b = c.b * 31.0; float b0 = floor(b), b1 = min(b0 + 1.0, 31.0);
    vec2 q = vec2(c.r * 31.0 + 0.5, c.g * 31.0 + 0.5);
    vec3 a0 = texture2D(tLut, vec2((b0 * 32.0 + q.x) / 1024.0, q.y / 32.0)).rgb, a1 = texture2D(tLut, vec2((b1 * 32.0 + q.x) / 1024.0, q.y / 32.0)).rgb;
    return mix(a0, a1, b - b0); }`;
