import type { EventBus } from '@/core/EventBus';
import type { AudioSystem } from '@/systems/AudioSystem';
import { SfxBank } from '@/systems/audio/sfxBank';

/**
 * 按钮点击 → UI 音：返回 / 取消（data-act back / cancel）= sfx-ui-back；翻页箭头（prev / next，由 reader:page 出翻页声）、
 * 日志条目（打开阅读器，由 reader:open 出展纸声）不出点击声；其余按钮 = sfx-ui-confirm
 */
export function uiClickSfx(btn: { dataset: { act?: string }; classList: { contains(c: string): boolean } }): string | null {
  const act = btn.dataset.act;
  if (act === 'back' || act === 'cancel') return 'sfx-ui-back';
  if (act === 'prev' || act === 'next' || btn.classList.contains('journal-entry')) return null;
  return 'sfx-ui-confirm';
}

/** UI 事件 → 音：Esc 返回 / 日志打开 / 阅读器打开（展纸）/ 翻页（a–c 随机） */
export const UI_EVENT_SFX = {
  'ui:back': 'sfx-ui-back',
  'journal:open': 'sfx-ui-journal',
  'reader:open': 'sfx-paper-open',
  'reader:page': 'sfx-paper-flip',
} as const;

/**
 * 032 UI 音（全局绑定：主菜单也要响，不走场景里的 sfx:play 桥）：按钮点击在 UI 根节点上捕获委托；
 * 直接 AudioSystem.playBuffer（menu 组文件，带 manifest 增益），文件没加载就不响（UI 不用合成占位）。
 */
export function bindUiSfx(root: HTMLElement, events: EventBus, audio: AudioSystem, getBuffer: (key: string) => AudioBuffer | undefined): () => void {
  const bank = new SfxBank(getBuffer);
  const play = (id: string): void => {
    const r = bank.resolve(id);
    if (r) audio.playBuffer(r.buffer, r.volume);
  };
  const onClick = (e: Event): void => {
    const b = (e.target as Element | null)?.closest?.('button');
    if (!b || b.disabled) return;
    const id = uiClickSfx(b);
    if (id) play(id);
  };
  root.addEventListener('click', onClick, true);
  const offs = (Object.keys(UI_EVENT_SFX) as (keyof typeof UI_EVENT_SFX)[]).map((k) => events.on(k, () => play(UI_EVENT_SFX[k])));
  return () => {
    root.removeEventListener('click', onClick, true);
    for (const f of offs) f();
  };
}
