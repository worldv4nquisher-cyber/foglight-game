import { open, sleep, SH10 } from './b10lib.mjs';
const { page, ev, must, url, rec, done } = await open(5481);
for (const q of ['?smoke=1&debug=1&scene=s2&art=1', '?smoke=1&debug=1&scene=s2']) {
  await page.goto(url('?debug=1')); await sleep(1000); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
  await page.goto(url(q));
  await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
  for (const key of ['west', 'east']) {
    const pre = await ev(`(() => { const s = __s2, P = s.puzzles, h = s.interaction.held; if (P.lantern.parent?.name?.includes('socket')) { /* 已在某 socket */ }
      if (h.current?.id !== 'lantern') { try { h.pickUp('lantern', P.lantern); } catch (e) { return 'pickErr ' + e.message; } }
      const it = s.interaction.get('lamp-stand-${key}-s2'); if (!it) return 'no interactable';
      const r = it.standPoint ? it.standPoint(s.rig.body.position.clone()) : null; const f = r?.facing ?? 0; const p = r ? r.position : it.focus;
      s.rig.body.teleport(new s.rig.body.position.constructor(p.x - Math.sin(f) * 0.1, p.y + 0.03, p.z - Math.cos(f) * 0.1)); s.rig.body.velocity.set(0,0,0); s.rig.controller.facing = f; s.cameraFollow.yaw = f + Math.PI; s.cameraFollow.pitch = -0.2;
      return { holding: h.current?.id ?? null, sp: r && [p.x, p.y, p.z, f].map(v => +v.toFixed(3)) }; })()`);
    await sleep(2500);
    const prompt = await ev(`({ prompt: document.querySelector('.hud-prompt')?.textContent ?? null, cur: __s2.interaction.current?.id ?? null })`);
    await page.tap('KeyE');
    const ok = await page.waitFor(`__s2.puzzles.lantern.parent?.name === 'lamp-stand-${key}-s2-socket' && !__s2.interaction.animState`, 120000, 200);
    await sleep(1500);
    const post = await ev(`(() => { const s = __s2, h = s.interaction.held, b = s.puzzles.beam; const l = s.puzzles.lantern; const w = l.getWorldPosition(l.position.clone());
      return { parent: l.parent?.name, holding: h.current?.id ?? null, lp: [w.x, w.y, w.z].map(v => +v.toFixed(3)), paths: (b.paths ?? []).map?.(p => ({ id: p.id, lit: p.lit, end: p.end })) }; })()`).catch(e => String(e));
    await page.screenshot(`${SH10}/s2-stand-${key}-${q.includes('art=1') ? 'art1' : 'art0'}.png`);
    rec('b10-stand', `${q.includes('art=1') ? 'art=1' : 'art=0'} 真按 E 把风灯放到 ${key} 灯台`, ok ? 'PASS' : 'FAIL', { pre, prompt, post });
    // 取回风灯，给下一个灯台
    await ev(`(() => { const s = __s2, h = s.interaction.held; try { h.pickUp('lantern', s.puzzles.lantern); } catch (e) {} return 1; })()`);
  }
}
console.log('errors', JSON.stringify(page.errors)); await done(); console.log('DONE');
