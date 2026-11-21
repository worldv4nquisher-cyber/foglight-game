// Run against an idle dev server: PUZZLE_URL=http://localhost:5174 CHROME=… node scripts/verify-puzzle-views.mjs
// PUZZLE_SHOTS optionally saves 1280×720 low-quality art screenshots.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, sleep } from './lib/cdp.mjs';

const base = process.env.PUZZLE_URL ?? 'http://localhost:5173';
const shots = process.env.PUZZLE_SHOTS;
if (shots) mkdirSync(shots, { recursive: true });
const c = await launchChrome();
const key = async (code, key, virtualKey) => {
  await c.send('Input.dispatchKeyEvent', { type: 'keyDown', code, key, windowsVirtualKeyCode: virtualKey });
  await c.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await c.send('Input.dispatchKeyEvent', { type: 'keyUp', code, key, windowsVirtualKeyCode: virtualKey });
  await c.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
};
try {
  await c.setView(1280, 720);
  for (const scene of ['s2', 's3']) {
    await c.send('Page.navigate', { url: `${base}/?smoke=1&debug=1&art=1&scene=${scene}&quality=low` });
    const s = `window.__${scene}`;
    assert.ok(await c.until(`!!${s}?.puzzles && __game.input.context === 'explore' && !${s}.cameraFollow.blending && !${s}.rig.controller.busy`), `${scene} ready`);
    if (scene === 's3') await c.evaluate(`__s3.puzzles.tide.set('low', { instant: true }); __s3.puzzles.beam.sky.alwaysOn = true; __s3.puzzles.beam.solve()`);
    const ix = scene === 's2' ? `${s}.puzzles.gateInteractable` : `${s}.puzzles.mirrorIx.window`;
    await c.evaluate(`(() => {
      const s = ${s}, ix = ${ix};
      const stand = ix.standPoint(s.rig.body.position.clone());
      s.rig.body.teleport(stand.position.clone().setY(stand.position.y + 0.02));
      s.rig.controller.facing = stand.facing;
      s.cameraFollow.yaw = stand.facing + Math.PI;
      s.cameraFollow.pitch = -0.12;
    })()`);
    assert.ok(await c.until(`${s}.interaction.current === ${ix}`), `${scene} real interact-point candidate`);
    assert.equal(await c.evaluate(`${s}.rig.visual.visible`), true);
    await key('KeyE', 'e', 69);
    assert.ok(await c.until(`${s}.interaction.puzzle.active === ${ix}.puzzle`), `${scene} real E entered puzzle`);
    assert.equal(await c.evaluate(`${s}.rig.visual.visible`), false);
    assert.ok(await c.evaluate(`${s}.rig.body.position.distanceTo(${ix}.standPoint(${s}.rig.body.position.clone()).position) < 0.25`), `${scene} Xi remains at normal interact point`);
    if (scene === 's2') {
      await key('KeyD', 'd', 68);
      await key('KeyE', 'e', 69);
      await key('KeyD', 'd', 68);
      assert.deepEqual(await c.evaluate('__s2.puzzles.dials.map(p => p.angles[0])'), [36, 36, 0]);
      assert.equal(await c.evaluate('__s2.interaction.puzzle.active.index'), 1);
    }
    await sleep(2000);
    if (shots) await c.shot(join(shots, `after-${scene}.png`));
    await key('Tab', 'Tab', 9);
    assert.ok(await c.until(`${s}.interaction.puzzle.active === null`));
    assert.equal(await c.evaluate(`${s}.rig.visual.visible`), true);
    // Direct puzzle entry must also be cleaned up when the scene exits / disposes.
    await c.evaluate(`${s}.interaction.puzzle.enter(${ix}.puzzle); ${s}.exit()`);
    assert.equal(await c.evaluate(`${s}.rig.visual.visible`), true);
    assert.equal(await c.evaluate(`${s}.interaction.puzzle.active`), null);
    await c.evaluate(`${s}.interaction.puzzle.enter(${ix}.puzzle); ${s}.dispose()`);
    assert.equal(await c.evaluate('__game.input.context'), 'explore');
    console.log(`PASS ${scene}: real E at normal interact point hides Xi; Tab, scene exit and disposal restore puzzle state`);
  }
  assert.deepEqual(c.errors, []);
  console.log('PASS browser console: no errors');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  c.close();
  process.exit(process.exitCode ?? 0);
}
