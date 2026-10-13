/** 内联 SVG 图标（24×24，描边风格，本仓库原创绘制）。 */
const P: Record<string, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/>',
  box: '<path d="m12 3 8.5 4.5v9L12 21l-8.5-4.5v-9z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5"/><path d="M12 12v9"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9.5" r="1.8"/><path d="m21 16-5-5-9 9"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  message: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3.6-3.6a4 4 0 0 0-5.7-5.7L12 6.3"/><path d="M14 10a4 4 0 0 0-5.7 0l-3.6 3.6a4 4 0 0 0 5.7 5.7l1.6-1.6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5"/>',
  sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  arrowUp: '<path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/>',
  arrowDown: '<path d="M12 5v14M5.5 12.5 12 19l6.5-6.5"/>',
  arrowLeft: '<path d="M19 12H5M11.5 5.5 5 12l6.5 6.5"/>',
  arrowRight: '<path d="M5 12h14M12.5 5.5 19 12l-6.5 6.5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.6L4 8"/><path d="M4 3.5V8h4.5"/><path d="M4 13a8 8 0 0 0 14.3 4.6L20 16"/><path d="M20 20.5V16h-4.5"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  file: '<path d="M6 3h8l4.5 4.5V21H6z"/><path d="M14 3v4.5h4.5M9 12.5h6M9 16h6"/>',
  pin: '<path d="M9 3h6l-1 6 3.5 3.5v1.5h-11V12.5L10 9z"/><path d="M12 14v7"/>',
  megaphone: '<path d="M4 10v4a1 1 0 0 0 1 1h2l6 4V5L7 9H5a1 1 0 0 0-1 1z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5"/><path d="M3.5 3.5v5h5"/><path d="M12 7.5V12l3 2"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="2"/><path d="M15.5 8.5V5a1.5 1.5 0 0 0-1.5-1.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5"/>',
  shuffle: '<path d="M3 7h3.5c3.5 0 4.5 10 8 10H21"/><path d="M3 17h3.5c1.4 0 2.4-1.6 3.2-3.5M14.5 7H21"/><path d="m18 4 3 3-3 3M18 14l3 3-3 3"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  mapPin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  heart: '<path d="M12 20s-8-4.8-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6.2-8 11-8 11z"/>',
  github: '<path d="M9 19c-4.5 1.4-4.5-2.2-6.3-2.7m12.6 5.4v-3.5a3 3 0 0 0-.9-2.4c2.9-.3 6-1.4 6-6.4a5 5 0 0 0-1.4-3.5 4.6 4.6 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12.3 12.3 0 0 0-6.6 0C6.2 2.6 5.1 3 5.1 3a4.6 4.6 0 0 0-.1 3.5 5 5 0 0 0-1.4 3.5c0 5 3.1 6.1 6 6.4a3 3 0 0 0-.9 2.4v3.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
  rss: '<path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="5.5" cy="18.5" r="1.5"/>',
  tv: '<rect x="3" y="6.5" width="18" height="13" rx="2.5"/><path d="m8 3 3 3.5M16 3l-3 3.5M9 12v2M15 12v2"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 3.5 5.5 3.5 8.5s-1 6-3.5 8.5c-2.5-2.5-3.5-5.5-3.5-8.5s1-6 3.5-8.5z"/>',
  camera: '<path d="M4 8h3l1.5-2.5h7L17 8h3a1 1 0 0 1 1 1v9.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
  play: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3z"/>',
  xLogo: '<path d="M4 4l16 16M20 4 4 20"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  dashboard: '<rect x="3.5" y="3.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.5"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16.5 14.5 12 10 7.5M14.5 12H4"/>',
  upload: '<path d="M12 16V4M7 8.5 12 4l5 4.5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  sparkles: '<path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7l-1.6-5.5L5 10.6 10.4 9z"/><path d="M18.5 3v3M17 4.5h3M5.5 17v3M4 18.5h3"/>',
  lantern: '<path d="M12 2.5v2.5"/><path d="M9 5h6"/><path d="M8.5 5.5C5 7.5 5 15.5 8.5 17.5h7c3.5-2 3.5-10 0-12z"/><path d="M12 5.5v12M9.5 17.5V19h5v-1.5M12 19v2.5"/>',
  firework: '<path d="M12 12v9"/><path d="M12 3v3M12 12 7 7M12 12l5-5M3.5 12h3M17.5 12h3M5.5 18l2-2M18.5 18l-2-2M12 12 6 9.5M12 12l6-2.5"/>',
  tree: '<path d="m12 2.5 5 6h-2.5l4 5H16l3.5 4.5h-15L8 13.5H5.5l4-5H7z"/><path d="M12 18v3.5"/>',
  pumpkin: '<path d="M12 6.5c-1.5-3 0-4 2-4"/><ellipse cx="12" cy="14" rx="8.5" ry="6.5"/><path d="M12 7.5c-2.5 0-3.5 3-3.5 6.5s1 6.5 3.5 6.5 3.5-3 3.5-6.5-1-6.5-3.5-6.5z"/>',
  mooncake: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 3.5v4M12 16.5v4M3.5 12h4M16.5 12h4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4.5h12.5l-2.5 4 2.5 4H5"/><path d="m9.5 7.2.5 1 1.1.1-.8.8.2 1.1-1-.5-1 .5.2-1.1-.8-.8 1.1-.1z"/>',
  dragon: '<path d="M3 15c3-4 6 2 9-2s6 2 9-2"/><path d="M3 19c3-4 6 2 9-2s6 2 9-2"/><path d="M16 6.5a3 3 0 1 1 3 3"/>',
  envelope: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M5 8.5c4 3 10 3 14 0"/><circle cx="12" cy="11.5" r="2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  playTri: '<path d="M7.5 5.5v13l11-6.5z"/>',
  skipBack: '<path d="M18 6v12l-8.5-6z"/><path d="M6 6v12"/>',
  skipForward: '<path d="M6 6v12l8.5-6z"/><path d="M18 6v12"/>',
  volume: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  volumeMute: '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
  music: '<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
  gamepad: '<path d="M7 7h10a5 5 0 0 1 4.9 6l-.7 3.5a2.5 2.5 0 0 1-4.3 1.2L14.5 15h-5l-2.4 2.7a2.5 2.5 0 0 1-4.3-1.2L2.1 13A5 5 0 0 1 7 7z"/><path d="M7.5 10v3M6 11.5h3"/><circle cx="16" cy="10.5" r=".6"/><circle cx="17.5" cy="12.5" r=".6"/>',
  aperture: '<circle cx="12" cy="12" r="8.5"/><path d="m14.3 3.8-4.6 8M20.2 10.2h-9.2M17.6 18.6l-4.6-8M9.7 20.2l4.6-8M3.8 13.8h9.2M6.4 5.4l4.6 8"/>',
  library: '<path d="M4 4h4v16H4zM10 4h4v16h-4z"/><path d="m16 5.2 3.8-1 3.2 15.2-3.8 1z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M3 12.5h18"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  fork: '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 11.5V17"/>',
  // L23 栏目整理：工具 / 全部栏目 / 账号与安全 / 社区
  tool: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3l7.5-7.5"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  shield: '<path d="M12 3.5 19 6v5.5c0 4.3-3 7.7-7 9-4-1.3-7-4.7-7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.5-4.5M11 8v6M8 11h6"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2H4.5z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  userPlus: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
  bookmark: '<path d="M6.5 3.5h11a1 1 0 0 1 1 1V21L12 16.8 5.5 21V4.5a1 1 0 0 1 1-1z"/>',
  send: '<path d="M21 3.5 10.5 14"/><path d="M21 3.5 14.5 21l-4-7-7-4z"/>',
  flame: '<path d="M12 21.5c-4 0-7-2.8-7-6.6 0-3.4 2.4-5.4 3.6-8 .6 1.6 1.5 2.6 2.6 3C11 6.6 12.6 4 15 2.5c-.2 3 1.1 4.6 2.5 6.3 1.2 1.5 1.5 3 1.5 4.6 0 4.4-3 8.1-7 8.1z"/>',
  verified: '<path d="m12 2.5 2.3 1.6 2.8-.1.9 2.7 2.3 1.6-.9 2.7.9 2.7-2.3 1.6-.9 2.7-2.8-.1L12 21.5l-2.3-1.6-2.8.1-.9-2.7-2.3-1.6.9-2.7-.9-2.7 2.3-1.6.9-2.7 2.8.1z"/><path d="m8.5 12 2.4 2.4 4.6-4.8"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  wechat: '<path d="M9.5 4C5.4 4 2.5 6.6 2.5 9.8c0 1.8 1 3.4 2.5 4.5l-.6 2.2 2.6-1.3c.8.2 1.6.3 2.5.3"/><path d="M15 9.5c3.6 0 6.5 2.4 6.5 5.2 0 1.5-.8 2.9-2.1 3.8l.5 2-2.3-1.1c-.8.3-1.7.4-2.6.4-3.6 0-6.5-2.3-6.5-5.1s2.9-5.2 6.5-5.2z"/><circle cx="7" cy="8.5" r=".6"/><circle cx="12" cy="8.5" r=".6"/>',
  weibo: '<path d="M10.5 9.5c4-1.8 7.2-.8 6.8 2 .5 0 3.2.9 2 3.6C17.8 18 13.8 20 9.5 20 5.6 20 2.5 18 2.5 15.2c0-2.4 3.7-5.2 8-5.7z"/><ellipse cx="9.8" cy="15.3" rx="3.3" ry="2.4"/><path d="M15.5 4.5a4.5 4.5 0 0 1 5 5.5M15.5 7.2a1.9 1.9 0 0 1 2.3 2.4"/>',
  xiaohongshu: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M7.5 9v6M10 9v6M7.5 12H10M13 9h3.5v6H13zM13 12h3.5"/>',
};

export type IconName = keyof typeof P;

/**
 * 描边图标会动（见 icon-motion.ts）：每条描边带 pathLength="1"，出现时 CSS 描入，悬停 / 聚焦时播放一小段动作。
 * 统一 stroke-width 1.8 + currentColor，深色模式自动跟随文字颜色。无 JS / 减少动态效果时就是静态图标。
 */
const DRAWABLE = /<(path|circle|rect|ellipse|line|polyline|polygon)\b/g;
const BODY: Record<string, string> = {};
function drawable(name: string): string {
  const key = P[name] ? name : 'link';
  return (BODY[key] ??= P[key]!.replace(DRAWABLE, '<$1 pathLength="1"'));
}

export function icon(name: string, cls = ''): string {
  const key = P[name] ? name : 'link';
  return `<svg class="icon si${cls ? ` ${cls}` : ''}" data-i="${key}" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${drawable(key)}</svg>`;
}

export const SOCIAL_ICON: Record<string, string> = {
  github: 'github',
  bilibili: 'tv',
  weibo: 'weibo',
  wechat: 'wechat',
  xiaohongshu: 'xiaohongshu',
  zhihu: 'book',
  instagram: 'camera',
  x: 'xLogo',
  youtube: 'play',
  email: 'mail',
  rss: 'rss',
  link: 'link',
};

/** 节日 → 图标（不用 emoji：很多系统缺彩色 emoji 字体，会显示成方块）。 */
const FESTIVAL_ICON: Record<string, string> = {
  'new-year': 'firework', valentine: 'heart', spring: 'envelope', lantern: 'lantern', labour: 'sun', 'dragon-boat': 'dragon',
  qixi: 'sparkles', 'mid-autumn': 'mooncake', national: 'flag', halloween: 'pumpkin', christmas: 'tree',
};
const THEME_ICON: Record<string, string> = { lunar: 'lantern', xmas: 'tree', halloween: 'pumpkin', fireworks: 'firework' };

export function festivalIcon(id: string, theme: string): string {
  const base = id.replace(/-\d{4}$/, '');
  return icon(FESTIVAL_ICON[base] ?? THEME_ICON[theme] ?? 'sparkles', 'fest-ico');
}

/** 去掉文字里的 emoji / 国旗 / 变体选择符，留给 SVG 图标表达。 */
export function stripEmoji(text: string): string {
  return text
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u{FE0F}\u{200D}\u{20E3}\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
