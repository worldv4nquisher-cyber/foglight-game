import { open, sleep, SH10 } from './b10lib.mjs';
const { page, ev, must, url, rec, done } = await open(5471);
await page.goto(url('?debug=1')); await sleep(1500); await ev(`localStorage.removeItem('foglight.save.v1'); 1`);
await page.goto(url('?smoke=1&debug=1&scene=s2&art=1'));
await must(`!!window.__s2?.puzzles && __game.input.context === 'explore' && !__s2.rig.controller.busy`, 400000, 'S2');
const r = await ev(`(() => { const s = __s2, P = s.puzzles, h = s.interaction.held; const sock = s.scene.getObjectByName('desk-lantern-s2-socket');
  if (!h.isHolding?.('lantern')) { try { h.pickUp('lantern', P.lantern); } catch (e) {} }
  const placed = h.place(sock); P.lantern.updateMatrixWorld(true);
  let minY = Infinity, minYc = null; P.lantern.traverse((o) => { if (o.isMesh && o.geometry) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); if (o.visible && bb.min.y < minY) minY = bb.min.y; if (/collider/.test(o.name)) minYc = bb.min.y; } });
  const w = sock.getWorldPosition(sock.position.clone());
  return { placed: !!placed, parent: P.lantern.parent?.name, socketY: +w.y.toFixed(3), meshBottom: +minY.toFixed(3), colliderBottom: minYc === null ? null : +minYc.toFixed(3) }; })()`);
await sleep(1500);
await page.screenshot(`${SH10}/s2-lantern-desk.png`);
rec('b10-desk', 'art=1 风灯放书桌：灯底落在桌面 3.75（±0.02）', r.parent === 'desk-lantern-s2-socket' && Math.abs(r.meshBottom - 3.75) <= 0.02 ? 'PASS' : 'FAIL', { ...r, errs: page.errors });
await done(); console.log('DONE');
