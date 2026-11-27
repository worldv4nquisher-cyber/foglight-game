import { HarbourPuzzles } from './harbour';
import { CableCar, PrismSplitter } from './lighthousePuzzles';
import { MirrorRelay } from './mirrorRelay';

export type Ch2Stage = 's1' | 's2' | 's3';

/** 第二章三个场景共享的运行时谜题状态（跨场景往返时保留，读档 / 新开时按入口重置） */
export class Ch2State {
  harbour = new HarbourPuzzles();
  relay = new MirrorRelay(false);
  cable = new CableCar();
  prism = new PrismSplitter();

  resetFor(stage: Ch2Stage = 's1'): void {
    this.harbour = new HarbourPuzzles();
    if (stage !== 's1') this.harbour.finish();
    this.relay = new MirrorRelay(stage === 's3');
    this.cable = new CableCar();
    this.prism = new PrismSplitter();
  }
}
