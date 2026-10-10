import type { NoteStyle } from '../note-style';
import type { BadgeDesign } from '../badge-design';
/** 社区功能（好朋友、上传、语音、便利贴、节日、徽章）的数据类型：前端、演示 mock 与 Worker 保持一致。 */
export type BadgeStyle = 'pearlescent' | 'brushed-metal';
export interface Badge {
  /** 刻在徽章上的自定义编号，例如 FRIEND-0001 */
  code: string;
  label: string;
  style: BadgeStyle;
  /** DIY 设计（白名单校验；旧数据没有 → 按 style 显示预设） */
  design?: BadgeDesign;
  grantedAt: string;
}
export interface Member {
  id: number;
  email: string;
  name: string;
  avatarUrl: string;
  bio: string;
  website: string;
  badges: Badge[];
  joinedAt: string;
  provider: 'email' | 'google';
}
export type PublicMember = Omit<Member, 'email'>;
export interface Festival {
  id: string;
  name: string;
  /** MM-DD（每年）或 YYYY-MM-DD（农历节日等只在那一年） */
  date: string;
  days: number;
  theme: 'lunar' | 'xmas' | 'halloween' | 'fireworks';
  message: string;
}
export interface Project {
  name: string;
  title: string;
  version: string;
  author: string;
  engine: string;
  downloads: number;
  url: string;
  description: string;
}
export interface GuestbookItem {
  id: number;
  name: string;
  content: string;
  website: string;
  status: 'pending' | 'approved' | 'hidden';
  createdAt: string;
}
export interface StickyNote {
  id: number;
  name: string;
  content: string;
  color: 'yellow' | 'pink' | 'blue' | 'green';
  /** 发帖人 DIY 的文字样式（严格校验过的对象；旧便签为 null → 默认样式）。 */
  style?: NoteStyle | null;
  reports: number;
  hidden: boolean;
  createdAt: string;
}
export interface UploadedFile {
  id: number;
  memberId: number;
  memberName: string;
  name: string;
  size: number;
  contentType: string;
  note: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  /** 演示模式：小文件以 data URL 保存在本地 */
  dataUrl?: string;
  /** 正式站：站长下载地址（/api/admin/inbox/files/:id/raw） */
  url?: string;
}
export interface VoiceMessage {
  id: number;
  name: string;
  durationMs: number;
  size: number;
  contentType: string;
  createdAt: string;
  read: boolean;
  dataUrl?: string;
  /** 正式站：站长试听地址（/api/admin/inbox/voice/:id/raw） */
  url?: string;
}
export interface Viewer {
  sid: string;
  name: string;
  avatar: string;
  member: boolean;
  page: string;
}

/** 某天是否在节日范围内（date 为 MM-DD 或 YYYY-MM-DD，持续 days 天）。 */
export function activeFestival(list: Festival[], now: Date): Festival | null {
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const f of list) {
    const years = /^\d{4}-/.test(f.date) ? [Number(f.date.slice(0, 4))] : [today.getFullYear() - 1, today.getFullYear()];
    for (const y of years) {
      const md = /^\d{4}-/.test(f.date) ? f.date.slice(5) : f.date;
      const [m, d] = md.split('-').map(Number);
      if (!m || !d) continue;
      const start = new Date(y, m - 1, d);
      const end = new Date(y, m - 1, d + Math.max(1, f.days));
      if (today >= start && today < end) return f;
    }
  }
  void ymd;
  return null;
}
