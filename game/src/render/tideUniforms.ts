import type * as THREE from 'three';

/**
 * 全局潮位 uniform（v0.1-011，style-guide §7.5「水面由 tideLevel 统一驱动」）。
 * 所有材质共用同一个对象：TideSet 每个物理步把当前场景主潮汐区的 level（世界 y，m）写进 uTideLevel.value，
 * 水面、湿痕线、岸边泡沫（025）直接在着色器里声明 `uniform float uTideLevel;` 读取，不用逐个材质更新。
 */
export const tideUniforms = {
  uTideLevel: { value: 0 },
};

/**
 * 给材质挂上 uTideLevel（onBeforeCompile 注入）：片元着色器里可用 `uTideLevel` 和世界高度 `vTideWorldY`。
 * fragment 是插在 `#include <color_fragment>` 之后的 GLSL，可以改 diffuseColor（白盒湿痕线 / 测试材质用）。
 * 025 的正式湿痕线材质也走这里。
 */
export function withTideLevel<T extends THREE.Material>(material: T, fragment: string): T {
  const prev = material.onBeforeCompile.bind(material);
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uTideLevel = tideUniforms.uTideLevel;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vTideWorldY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvTideWorldY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;\n#else\nvTideWorldY = (modelMatrix * vec4(transformed, 1.0)).y;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTideLevel;\nvarying float vTideWorldY;')
      .replace('#include <color_fragment>', `#include <color_fragment>\n${fragment}`);
    material.userData.tideShader = shader;
  };
  // 串上之前的 key（013：和按物体雾 withObjectFog 叠用时两者都要进程序缓存键）
  material.customProgramCacheKey = () => `${prevKey()}|tide:${fragment.length}:${fragment.slice(0, 24)}`;
  material.needsUpdate = true;
  return material;
}

/**
 * 白盒湿痕线：水面以下的部分压暗偏冷，水线往上 0.25 m 内是一道渐淡的湿痕（025 换成正式材质）。
 * 测试材质「随水位变色」就用它（测试场地潮汐区的刻度柱）。
 */
export const WET_LINE_GLSL = /* glsl */ `
  float tideDepth = uTideLevel - vTideWorldY;
  float under = step(0.0, tideDepth);
  float wet = (1.0 - under) * (1.0 - smoothstep(0.0, 0.25, -tideDepth));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.42, 0.5, 0.56), under);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.62, wet);
`;
