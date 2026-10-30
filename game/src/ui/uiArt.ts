import type { AssetLoader } from '@/assets/AssetLoader';

/**
 * 030 UI 美术接入（art/ui/README-030）：把已加载的 UI 图片写成 <html> 上的 CSS 变量（绝对 URL，styles.css 用 var() 引用），
 * 每张到位的图在 <html> 上加 `ui-art-<名>` 类；没交付 / ?art=0 / 加载失败时不写，styles.css 的纯色 / 细线样式兜底。
 * 位图都是 2x（GDD §12.2），尺寸按 css px 写在 styles.css 里。
 */

/** 随主菜单包预加载的图片 → CSS 变量名 */
export const UI_CSS_VARS: Readonly<Record<string, string>> = {
  'ui-title-logo-svg': '--ui-img-logo-svg',
  'ui-panel-frame': '--ui-img-panel-frame',
  'ui-button-primary': '--ui-img-button-primary',
  'ui-button-secondary': '--ui-img-button-secondary',
  'ui-icon-interact': '--ui-img-icon-interact',
  'ui-icon-hint-lantern': '--ui-img-icon-hint-lantern',
  'ui-icon-journal': '--ui-img-icon-journal',
  'ui-icon-read': '--ui-img-icon-read',
  'ui-icon-settings': '--ui-img-icon-settings',
  'ui-illust-loading': '--ui-img-illust-loading',
};

/** 5 个图标都到了才切到图标显示（一致性：不出现一半新图标一半旧占位） */
export const UI_ICON_KEYS = ['ui-icon-interact', 'ui-icon-hint-lantern', 'ui-icon-journal', 'ui-icon-read', 'ui-icon-settings'] as const;

/**
 * 阅读纸张（README-030 §2.2，用户 18:01 定方案 1）：划线信纸只给没寄出的信；阿岩、汐、灯室三张纸条用无划线的 note。
 * 没列出的文档用纯色纸底。
 */
export const PAPER_FOR_DOC: Readonly<Record<string, string>> = {
  'ch1.s2.journal.doc': 'ui-paper-journal',
  'ch1.s2.reply_draft.doc': 'ui-paper-letter',
  'ch1.s1.neighbor_note.doc': 'ui-paper-note',
  'ch1.s2.xi_note.doc': 'ui-paper-note',
  'ch1.s3.ignition_note.doc': 'ui-paper-note',
  'ch1.s2.sketch.doc': 'ui-paper-sketch',
  'ch1.s1.notice.doc': 'ui-paper-notice',
  'ch1.s3.logbook.doc': 'ui-paper-logbook',
};

export function paperForDoc(docId: string): string | null {
  return PAPER_FOR_DOC[docId] ?? null;
}

/** 绝对 URL 的 CSS url()（自定义属性里的相对 URL 各浏览器解析基准不一致，一律转绝对） */
export function cssUrl(url: string): string {
  const abs = typeof location === 'undefined' ? url : new URL(url, location.href).href;
  return `url("${abs.replace(/["\\\n]/g, (c) => '\\' + c)}")`;
}

/** 懒加载图片的取法（AssetLoader.loadImage；测试里可注入） */
export type UiImageLoader = (key: string) => Promise<string | null>;

/**
 * 启动（boot + menu 组加载完）后调用一次：写 CSS 变量、加 ui-art-* 类、换 favicon / 应用图标。返回实际用上的 key。
 */
export function applyUiArt(assets: Pick<AssetLoader, 'imageUrl'>, root: HTMLElement = document.documentElement): string[] {
  const used: string[] = [];
  for (const [key, name] of Object.entries(UI_CSS_VARS)) {
    const url = assets.imageUrl(key);
    root.classList.toggle(`ui-art-${key.replace(/^ui-/, '')}`, !!url);
    if (url) {
      root.style.setProperty(name, cssUrl(url));
      used.push(key);
    } else root.style.removeProperty(name);
  }
  root.classList.toggle('ui-art-icons', UI_ICON_KEYS.every((k) => !!assets.imageUrl(k)));
  const app = assets.imageUrl('ui-icon-app-512');
  if (app && typeof document !== 'undefined') {
    setIcon('icon', app);
    setIcon('apple-touch-icon', app);
    used.push('ui-icon-app-512');
  }
  return used;
}

function setIcon(rel: string, url: string): void {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.type = 'image/png';
  link.setAttribute('sizes', '512x512');
  link.href = url;
}
