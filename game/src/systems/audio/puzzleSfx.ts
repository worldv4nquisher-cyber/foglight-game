import type { EventBus } from '@/core/EventBus';
import { PUSH_LOOPS } from '@/systems/audio/loops';

/** 拨盘谜题组（S2 拨盘铁门 S2_IDS.dialGate）：转一格 = sfx-dial-click；其余谜题组都是镜子 */
export const DIAL_GROUPS: ReadonlySet<string> = new Set(['dial-gate-s2']);
/** 镜子微调咔嗒限频（README：连续快速触发时每 60 ms 一次） */
export const MIRROR_FINE_MIN_SEC = 0.06;

/**
 * 032 谜题件单发音（事件 → sfx:play），场景进入时绑定、离开时解绑：
 * - puzzle:partRotated：拨盘 → sfx-dial-click；镜子 → sfx-mirror-click，微调（fine）→ sfx-mirror-click-fine（60 ms 限频）
 * - item:pickup / item:place（提灯）→ sfx-lantern-pickup / sfx-lantern-place
 * - float:state 进入 floating（木筏被潮抬起）→ sfx-raft-float；interact:pushEnd（木筏推到底落位）→ sfx-raft-lock
 * - tide:changing 涨 / 退 → sfx-tide-rise / sfx-tide-fall；tide:recall（落水召回）→ sfx-splash-cold
 * 场景脚本里已直接发的（钟、光感锁、钥匙、铁门、风铃、灯塔门、阀门、油、点火、地窖门、拉杆）不在这里重复。
 */
export function bindPuzzleSfx(events: EventBus, now: () => number = () => performance.now() / 1000): () => void {
  const play = (id: string): void => events.emit('sfx:play', { id });
  let lastFine = -Infinity;
  const floatPrev = new Map<string, string>();
  const offs = [
    events.on('puzzle:partRotated', ({ group, fine }) => {
      if (DIAL_GROUPS.has(group)) return play('sfx-dial-click');
      if (!fine) return play('sfx-mirror-click');
      const t = now();
      if (t - lastFine < MIRROR_FINE_MIN_SEC) return;
      lastFine = t;
      play('sfx-mirror-click-fine');
    }),
    events.on('item:pickup', ({ item }) => {
      if (/lantern/.test(item)) play('sfx-lantern-pickup');
    }),
    events.on('item:place', ({ item }) => {
      if (/lantern/.test(item)) play('sfx-lantern-place');
    }),
    events.on('float:state', ({ id, state }) => {
      const prev = floatPrev.get(id) ?? 'grounded';
      floatPrev.set(id, state);
      if (/raft/.test(id) && prev === 'grounded' && state === 'floating') play('sfx-raft-float');
    }),
    events.on('interact:pushEnd', ({ id }) => {
      if (PUSH_LOOPS[id] && /raft/.test(id)) play('sfx-raft-lock');
    }),
    events.on('tide:changing', ({ state }) => play(state === 'high' ? 'sfx-tide-rise' : 'sfx-tide-fall')),
    events.on('tide:recall', () => play('sfx-splash-cold')),
  ];
  return () => {
    for (const f of offs) f();
  };
}
