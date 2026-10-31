import type { Game } from '@/core/Game';
import { SAVE_KEY } from '@/systems/save/SaveSystem';

/**
 * M7 QA 钩子（控制台）：`__qa.puzzles()` 当前场景每道谜题的状态快照（只含确定性的字段，可直接 JSON 比较），
 * `__qa.save()` localStorage 里的存档原文解析、`__qa.saveData()` 存档系统内存里最近一次写入的存档、
 * `__qa.diff(a, b)` 两份快照的差异（相同返回 []）、`__qa.scene()` 当前场景名 / 输入上下文 / 目标 / 玩家位置。
 * 只在 dev 或 ?smoke=1 下挂（和 __game / __perfSpot 一样），不进正式玩家路径。返回值只给控制台，不上屏。
 */
type Num3 = [number, number, number];
interface Part {
  angles: number[];
}
interface Vec {
  x: number;
  y: number;
  z: number;
}
interface LevelLike {
  name: string;
  puzzles?: Record<string, unknown>;
  rig?: { body: { position: Vec } };
  interaction?: { held?: { current?: { id: string } | null } };
  physics?: { colliders?: Array<{ name: string; enabled: boolean }> };
}

const r2 = (v: number): number => Math.round(v * 100) / 100;
const ang = (p: unknown): number[] => ((p as Part | undefined)?.angles ?? []).map(r2);
const get = <T>(o: unknown, ...path: string[]): T | undefined => {
  let cur: unknown = o;
  for (const k of path) cur = cur == null ? undefined : (cur as Record<string, unknown>)[k];
  return cur as T | undefined;
};

function puzzlesOf(s: LevelLike): Record<string, unknown> | null {
  const p = s.puzzles;
  if (!p) return null;
  const tide = (z: unknown): Record<string, unknown> => ({ state: get(z, 'state'), level: r2(get<number>(z, 'level') ?? 0) });
  if (s.name.startsWith('s1')) {
    return {
      tide: tide(p.tide),
      bellRings: get(p, 'bell', 'rings'),
      raft: get(p, 'raft', 'state'),
      raftMoved: p.raftMoved,
      p1Solved: p.p1Solved,
      p2Solved: p.p2Solved,
      reefGate: s.physics?.colliders?.find((c) => c.name === 's1-reef-gate-wall')?.enabled ?? null,
    };
  }
  if (s.name.startsWith('s2')) {
    const st = { ...(p.state as Record<string, unknown>) };
    delete st.keyAttachT;
    st.doorOpen = r2(st.doorOpen as number);
    return {
      ...st,
      holding: s.interaction?.held?.current?.id ?? null,
      mirrorA: ang(get(p, 'beam', 'mirrorA', 'part')),
      mirrorB: ang(get(p, 'beam', 'mirrorB', 'part')),
      lock: get(p, 'beam', 'lock', 'state'),
      dials: ((p.dials as Part[] | undefined) ?? []).map((d) => Math.round((d.angles[0] ?? 0) / 36) % 10).join(''),
    };
  }
  if (s.name.startsWith('s3')) {
    const st = p.state as Record<string, unknown>;
    const mirrors = (get<Record<string, unknown>>(p, 'beam', 'mirrors') ?? {}) as Record<string, { part: Part }>;
    return {
      tide: tide(p.tide),
      bellRings: get(p, 'bell', 'rings'),
      doorOpen: r2(st.doorOpen as number),
      valveOpen: st.valveOpen,
      reached: st.reached,
      igniting: st.igniting,
      ignited: st.ignited,
      igniter: get(p, 'beam', 'igniter', 'state'),
      mirrors: Object.fromEntries(Object.entries(mirrors).map(([k, m]) => [k, ang(m.part)])),
    };
  }
  return null;
}

function diff(a: unknown, b: unknown, path = ''): string[] {
  if (Object.is(a, b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k));
  }
  return [`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`];
}

export function installQaHooks(game: Game): void {
  const cur = (): LevelLike | null => (game.scenes.current) ?? null;
  const qa = {
    puzzles: (): Record<string, unknown> | null => {
      const s = cur();
      return s ? puzzlesOf(s) : null;
    },
    save: (): unknown => {
      try {
        return JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null') as unknown;
      } catch {
        return 'unparsable';
      }
    },
    saveData: (): unknown => game.save.lastSave,
    scene: (): Record<string, unknown> => {
      const s = cur();
      const b = s?.rig?.body.position;
      return {
        scene: s?.name ?? null,
        context: game.input.context,
        goal: game.narrative.goal,
        readDocs: [...game.narrative.readDocs],
        pos: b ? ([r2(b.x), r2(b.y), r2(b.z)] as Num3) : null,
      };
    },
    diff: (a: unknown, b: unknown): string[] => diff(a, b),
  };
  (window as unknown as { __qa: typeof qa }).__qa = qa;
}
