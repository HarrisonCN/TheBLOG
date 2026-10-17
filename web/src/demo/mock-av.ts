/**
 * L34 / v1.34.0 视频与声音作品（演示 mock，与 Worker 同形状）：
 * GET /api/av（已发布作品摘要，日期倒序）· GET /api/av/:slug（已发布作品全文）· GET /api/av/:slug/captions.vtt（WebVTT）·
 * GET /api/admin/av（含草稿）· PUT /api/admin/av/:slug（校验后写入）· DELETE /api/admin/av/:slug。
 * 示例媒体是用 ffmpeg 合成的（渐变色块画面、棕噪声「海浪」），不是任何真实拍摄或录音；标题都标「示例」。
 */
import { avSummary, sortAvWorks, toVtt, validateAvWork, type AvWork } from '../media-core';
import { SocialError } from './mock-social';

export interface AvState {
  works: AvWork[];
}
interface Host {
  state(): AvState;
  commit(mutate: (s: AvState) => void): void;
}
interface Res {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export function avSeed(base = '/'): AvState {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/av/`;
  const credit = '演示用合成素材（ffmpeg 生成）';
  const works: AvWork[] = [
    {
      slug: 'harbour-dusk',
      kind: 'video',
      title: '示例短片：暮色色带',
      summary: '一段 12 秒的合成短片：深蓝、青绿和橙色的色带缓慢流动，像港口傍晚的天色。用来演示字幕、章节跳转和文字稿。',
      date: '2026-10-14',
      status: 'published',
      duration: 12,
      width: 640,
      height: 360,
      credit,
      poster: { src: `${b}harbour-dusk-poster.webp`, alt: '深蓝底色上一道青绿到橙色的柔和色带，像傍晚的天空', w: 640, h: 360 },
      sources: [
        { src: `${b}harbour-dusk.webm`, type: 'video/webm' },
        { src: `${b}harbour-dusk.mp4`, type: 'video/mp4' },
      ],
      chapters: [
        { t: 0, title: '深蓝' },
        { t: 4, title: '青绿漫开' },
        { t: 8, title: '橙色收尾' },
      ],
      cues: [
        { start: 0, end: 4, text: '（无对白）画面是一片深蓝，边缘有一点青色。' },
        { start: 4, end: 8, text: '青绿色从中间慢慢漫开，像灯光照在水面上。' },
        { start: 8, end: 12, text: '一道暖橙色从角落升起，画面渐渐变亮。' },
      ],
    },
    {
      slug: 'shore-noise',
      kind: 'audio',
      title: '示例声音：合成海浪',
      summary: '20 秒的棕噪声，音量像潮水一样起伏。适合当作阅读时的背景声，也用来演示声音作品的文字稿。',
      date: '2026-10-11',
      status: 'published',
      duration: 20,
      credit,
      sources: [
        { src: `${b}shore-noise.mp3`, type: 'audio/mpeg' },
        { src: `${b}shore-noise.ogg`, type: 'audio/ogg' },
      ],
      chapters: [
        { t: 0, title: '渐入' },
        { t: 10, title: '起伏' },
        { t: 17, title: '渐出' },
      ],
      cues: [
        { start: 0, end: 10, text: '（低沉的沙沙声从无到有，像远处的海浪）' },
        { start: 10, end: 17, text: '（声音一阵强一阵弱，大约每七秒一次起伏）' },
        { start: 17, end: 20, text: '（声音慢慢淡出，直到安静）' },
      ],
    },
  ];
  return { works };
}

const bad = (details: { path: string; message: string }[]) => new SocialError(400, 'validation_error', '参数校验失败', details);
const notFound = () => new SocialError(404, 'not_found', '作品不存在');
const SLUG_PATH = /^\/av\/([a-z0-9-]{1,40})$/;

export class MockAv {
  constructor(private h: Host) {}

  private published(slug: string): AvWork {
    const w = this.h.state().works.find((x) => x.slug === slug && x.status === 'published');
    if (!w) throw notFound();
    return w;
  }

  routePublic(m: string, path: string): Res | null {
    if (m !== 'GET') return null;
    if (path === '/api/av') return { status: 200, body: { works: sortAvWorks(this.h.state().works.filter((w) => w.status === 'published')).map(avSummary) } };
    let mt = /^\/api\/av\/([^/]+)\/captions\.vtt$/.exec(path);
    if (mt) return { status: 200, body: toVtt(this.published(mt[1]!).cues), headers: { 'content-type': 'text/vtt; charset=utf-8' } };
    mt = /^\/api\/av\/([^/]+)$/.exec(path);
    if (mt) return { status: 200, body: { work: this.published(mt[1]!) } };
    if (path.startsWith('/api/av/')) throw notFound();
    return null;
  }

  routeAdmin(m: string, sub: string, body: unknown): Res | null {
    if (sub === '/av' && m === 'GET') return { status: 200, body: { works: sortAvWorks(this.h.state().works).map(avSummary) } };
    const mt = SLUG_PATH.exec(sub);
    if (!mt) return null;
    const slug = mt[1]!;
    if (m === 'GET') {
      const work = this.h.state().works.find((w) => w.slug === slug);
      if (!work) throw notFound();
      return { status: 200, body: { work } };
    }
    if (m === 'PUT') {
      const r = validateAvWork(body);
      if (!r.work) throw bad(r.issues);
      if (r.work.slug !== slug) throw bad([{ path: 'slug', message: '地址与网址不一致' }]);
      this.h.commit((s) => {
        s.works = [...s.works.filter((w) => w.slug !== slug), r.work!];
      });
      return { status: 200, body: { work: r.work } };
    }
    if (m === 'DELETE') {
      if (!this.h.state().works.some((w) => w.slug === slug)) throw notFound();
      this.h.commit((s) => {
        s.works = s.works.filter((w) => w.slug !== slug);
      });
      return { status: 200, body: { ok: true } };
    }
    return null;
  }
}
