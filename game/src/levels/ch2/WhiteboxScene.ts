import type { Game } from '@/core/Game';
import { HarbourScene } from './HarbourScene';
import { LighthouseScene } from './LighthouseScene';
import type { Stage } from './layout';
import { MirrorAlleyScene } from './MirrorAlleyScene';

export async function openWhitebox(game: Game, stage: Stage, view: string | null): Promise<void> {
  game.scenes
    .register('ch2-whitebox-s1', (g) => new HarbourScene(g, stage === 's1' ? view : null))
    .register('ch2-whitebox-s2', (g) => new MirrorAlleyScene(g, stage === 's2' ? view : null))
    .register('ch2-whitebox-s3', (g) => new LighthouseScene(g, stage === 's3' ? view : null));
  await game.scenes.change(`ch2-whitebox-${stage}`);
}
