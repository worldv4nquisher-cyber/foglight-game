import type { Game } from '@/core/Game';
import { HarbourPuzzles, QUAY_START } from './harbour';
import { HarbourScene } from './HarbourScene';
import { LighthouseScene } from './LighthouseScene';
import { STAGES, type Point, type Stage, type Travel } from './layout';
import { CableCar, PrismSplitter } from './lighthousePuzzles';
import { MirrorAlleyScene } from './MirrorAlleyScene';
import { MirrorRelay } from './mirrorRelay';

export async function openWhitebox(game: Game, stage: Stage, view: string | null): Promise<void> {
  const harbour = new HarbourPuzzles();
  if (stage !== 's1') harbour.finish();
  const relay = new MirrorRelay(stage === 's3');
  const cable = new CableCar(), prism = new PrismSplitter();
  let arrival: Point | undefined;
  const travel: Travel = (next, spawn) => {
    arrival = spawn;
    void game.scenes.change(`ch2-whitebox-${next}`);
  };
  game.scenes
    .register('ch2-whitebox-s1', (g) => new HarbourScene(g, stage === 's1' ? view : null, arrival ?? QUAY_START, harbour, travel, 'ch2-whitebox-s1', null))
    .register('ch2-whitebox-s2', (g) => new MirrorAlleyScene(g, stage === 's2' ? view : null, arrival ?? STAGES.s2.spawn, relay, travel, 'ch2-whitebox-s2', null))
    .register('ch2-whitebox-s3', (g) => new LighthouseScene(g, stage === 's3' ? view : null, cable, prism, travel, 'ch2-whitebox-s3', null));
  await game.scenes.change(`ch2-whitebox-${stage}`);
}
