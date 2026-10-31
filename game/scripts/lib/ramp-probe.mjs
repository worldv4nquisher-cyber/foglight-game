// BUG-030：页面里探 4 张 ramp 的实际上传格式 + 用原生 WebGL 把 ramp 采样 4 个点（u = 1/8…7/8）画到 4×1 RGBA8 → readPixels。
// 修前（?rampfix=0）桌面走 BC7：纹理不完整，采样恒为 (0,0,0,255)；修后 RGBA8 → 真实 ramp 值。用完删 GL 对象并 renderer.resetState()。
export const RAMP_PROBE = `(() => {
  const g = __game, r = g.renderer, gl = r.getContext(); const out = {};
  const names = { 36492: 'RGBA_BPTC(BC7)', 33779: 'RGBA_S3TC_DXT5(BC3)', 33776: 'RGB_S3TC_DXT1', 37808: 'RGBA_ASTC_4x4', 37496: 'RGBA8_ETC2_EAC', 1023: 'RGBA(未压缩)' };
  const vs = 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
  const fs = 'precision highp float; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vec2((gl_FragCoord.x) / 4.0, 0.5)); }';
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram(); const v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs); gl.attachShader(prog, v); gl.attachShader(prog, f); gl.bindAttribLocation(prog, 0, 'p'); gl.linkProgram(prog);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const dst = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, dst); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, dst, 0);
  for (const k of ['tex-xi-ramp', 'tex-ramp-char', 'tex-ramp-env', 'tex-ramp-metal-wet']) {
    if (!g.assets.has(k)) { out[k] = null; continue; }
    const t = g.assets.getTexture(k); r.initTexture(t); const wt = r.properties.get(t).__webglTexture;
    while (gl.getError()) {}
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, 4, 1); gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.CULL_FACE); gl.colorMask(true, true, true, true);
    gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, buf); for (let i = 1; i < 8; i++) gl.disableVertexAttribArray(i); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (gl.bindVertexArray) gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, wt); if (gl.bindSampler) gl.bindSampler(0, null); gl.uniform1i(gl.getUniformLocation(prog, 't'), 0);
    gl.clearColor(1, 0, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const px = new Uint8Array(16); gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const sum = [0, 1, 2, 3].map((i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2], px[i * 4 + 3]]);
    out[k] = { format: names[t.format] ?? t.format, mips: t.mipmaps?.length ?? null, uncompressed: !!t.userData.ktx2Uncompressed, minFilter: t.minFilter, size: [t.image?.width, t.image?.height],
      samples: sum, allZeroRGB: sum.every((s) => s[0] === 0 && s[1] === 0 && s[2] === 0), glErr: gl.getError() };
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(dst); gl.deleteBuffer(buf); gl.deleteProgram(prog); gl.deleteShader(v); gl.deleteShader(f);
  r.resetState();
  return out; })()`;
