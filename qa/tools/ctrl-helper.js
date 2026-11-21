window.__ctl = {
  tb: () => window.__testbed,
  body: () => window.__testbed.rig.body,
  pos: () => window.__testbed.rig.body.position,
  async tp(x, y, z) {
    const tb = window.__testbed;
    tb.rig.body.teleport(tb.rig.body.position.clone().set(x, y, z));
    tb.cameraFollow.yaw = 0;
    await __qa.until(() => tb.rig.body.onGround, 5000);
    await __qa.sleep(300);
  },
  // 按住若干键，持续 sec 秒（固定步长时间），每帧采样
  async hold(codes, sec, onFrame) {
    const g = __game, inp = g.input;
    for (const c of codes) inp.setRaw('qa', c, true);
    const t0 = __qa.ft();
    const out = [];
    await new Promise((res) => {
      const f = () => {
        const p = window.__testbed.rig.body.position;
        out.push({ t: __qa.ft() - t0, x: p.x, y: p.y, z: p.z, g: window.__testbed.rig.body.onGround });
        if (onFrame) onFrame();
        if (__qa.ft() - t0 < sec) requestAnimationFrame(f); else res();
      };
      requestAnimationFrame(f);
    });
    for (const c of codes) inp.setRaw('qa', c, false);
    await __qa.sleep(300);
    return out;
  },
};
