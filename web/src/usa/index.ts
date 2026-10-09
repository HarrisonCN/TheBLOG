/**
 * Motionary 组件按需加载：扫描页面里的 <usa-*> 标签，只 import 用到的那一类。
 * （motionary/components 的全部组件约 158 KB gzip；这里按类别拆成多个小块。）
 */
type Loader = () => Promise<unknown>;
const text: Loader = () => import('./text');
const click: Loader = () => import('./click');
const feedback: Loader = () => import('./feedback');
const reveal: Loader = () => import('./reveal');
const page: Loader = () => import('./page');
const ui: Loader = () => import('./ui');
const svg: Loader = () => import('./svg');
const background: Loader = () => import('./background');
const fx: Loader = () => import('./fx');
const widgets: Loader = () => import('./widgets');

const MAP: Record<string, Loader> = {
  'usa-typewriter': text, 'usa-shimmer-text': text, 'usa-text-rotate': text, 'usa-gradient-text': text,
  'usa-button': click, 'usa-like': click, 'usa-double-tap': click, 'usa-hold': click, 'usa-icon-morph': click,
  'usa-spinner': feedback, 'usa-skeleton': feedback, 'usa-check': feedback, 'usa-toaster': feedback,
  'usa-scroll-progress': reveal,
  'usa-splash': page, 'usa-motion-switch': page,
  'usa-avatar-stack': ui,
  'usa-anim-icon': svg,
  'usa-blobs': background,
  'usa-fx': fx, 'usa-gesture-fx': fx,
};
const WIDGETS = 'route-transition nav-morph pagination presence dock pull-cord theme-switcher pause-all switch chapter-nav date-picker disclosure field otp upload-progress voice-button sticky-wall swipe-deck spatial-card native-preview plugin-card scroll-scene festival-banner'.split(' ');
for (const w of WIDGETS) MAP[`usa-${w}`] = widgets;

const loaded = new Map<Loader, Promise<unknown>>();
const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1200 }) : setTimeout(fn, 300));
function load(l: Loader): Promise<unknown> {
  let p = loaded.get(l);
  if (!p) {
    // widgets 块较大（约 150 KB gzip）：等首屏空闲后再加载，预渲染的内容先可读
    const start = l === widgets ? new Promise<void>((r) => idle(() => r())).then(l) : l();
    p = start.catch((e) => {
      loaded.delete(l);
      console.warn('[motionary] 组件加载失败', e);
    });
    loaded.set(l, p);
  }
  return p;
}

/** 注册 root 下所有用到的 <usa-*>；返回全部定义完成的 Promise。 */
export function defineUsed(root: ParentNode = document): Promise<unknown> {
  const need = new Set<Loader>();
  for (const el of root.querySelectorAll('*')) {
    const tag = el.localName;
    if (tag.startsWith('usa-') && !customElements.get(tag)) {
      const l = MAP[tag];
      if (l) need.add(l);
    }
  }
  return Promise.all([...need].map(load));
}

export const loadFx = () => load(fx) as Promise<typeof import('./fx')>;
export const loadFeedback = () => load(feedback) as Promise<typeof import('./feedback')>;
export const loadPage = () => load(page) as Promise<typeof import('./page')>;
