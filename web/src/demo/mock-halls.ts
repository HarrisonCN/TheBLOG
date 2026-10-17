/**
 * L35 / v1.35.0 沉浸式展厅（演示 mock，与 Worker 同形状）：
 * GET /api/halls（已发布展厅摘要，日期倒序）· GET /api/halls/:slug（已发布展厅全文）·
 * GET /api/admin/halls（含草稿）· GET / PUT / DELETE /api/admin/halls/:slug（校验后写入）。
 * 示例展厅用的是站内已有的示例照片（Wikimedia Commons 开放授权，署名见 demo-assets/photos/credits.json）；展厅本身和文字都是虚构的示例。
 */
import { hallSummary, sortHalls, validateHall, type Exhibit, type Hall, type Wall } from '../gallery-core';
import { SocialError } from './mock-social';

export interface HallsState {
  halls: Hall[];
}
interface Host {
  state(): HallsState;
  commit(mutate: (s: HallsState) => void): void;
}
interface Res {
  status: number;
  body: unknown;
}

/** 示例照片的 1280 宽版本尺寸与署名（来自 credits.json） */
const PHOTO: Record<string, [number, number, string]> = {
  himalayas: [1280, 854, 'Vyacheslav Argenberg · CC BY 4.0'],
  'hero-lake': [1280, 593, 'Michal Klajban · CC BY-SA 4.0'],
  'montriond-lake': [1280, 853, 'Krzysztof Golik · CC BY-SA 4.0'],
  'snina-winter': [1280, 853, 'Milan Bališin · CC BY-SA 4.0'],
  'baltic-view': [1280, 850, 'Radomianin · CC BY-SA 4.0'],
  'porto-covo': [1280, 863, 'Alvesgaspar · CC BY-SA 4.0'],
  'beach-parasols': [1280, 852, 'Jebulon · CC0'],
  'palm-sunset': [1280, 871, 'Michal Klajban · CC BY-SA 4.0'],
  'harbour-night': [1280, 748, 'Wilfredor · CC0'],
  'pudong-night': [1280, 640, 'King of Hearts · CC BY-SA 4.0'],
  'street-tricycle': [1280, 960, 'Ermell · CC BY-SA 4.0'],
  'harbour-castle': [1280, 781, 'Jebulon · CC0'],
  'guilin-pagodas': [1280, 854, 'King of Hearts · CC BY-SA 4.0'],
};

export function hallsSeed(base = '/'): HallsState {
  const b = `${base.endsWith('/') ? base : `${base}/`}demo/photos/`;
  const ex = (name: string, wall: Wall, title: string, alt: string, caption: string): Exhibit => {
    const [w, h, by] = PHOTO[name]!;
    return { id: name, title, wall, image: { src: `${b}${name}-1280.webp`, alt, w, h }, caption, credit: `照片：${by}（Wikimedia Commons）` };
  };
  const halls: Hall[] = [
    {
      slug: 'hills-and-sea',
      title: '示例展厅：山与海',
      summary: '八张风光照片挂在四面墙上：北墙是山，东墙是湖与雪，南墙是海岸，西墙是傍晚的海滩。',
      intro: '这是一间虚构的示例展厅。可以切换到立体视图，用方向键在四面墙之间走一圈；也可以一直留在平面列表里看。',
      date: '2026-10-16',
      status: 'published',
      exhibits: [
        ex('himalayas', 'north', '雪线之上', '云层之上连绵的雪山山脊', '北墙第一件：清晨的雪山，云在山腰。'),
        ex('hero-lake', 'north', '日出湖面', '日出时分的高山湖，水面倒映着橙色的天空', '湖面没有风，倒影几乎和天空一样清楚。'),
        ex('montriond-lake', 'east', '林间湖', '被森林环绕的湖，水色碧绿', '东墙：湖边的树一直长到水边。'),
        ex('snina-winter', 'east', '冬日山岩', '冬天覆雪的山顶岩石和光秃的树', '雪后的山顶，岩石露出一点灰色。'),
        ex('baltic-view', 'south', '海边高地', '从山丘上望向大海，近处是草地和小路', '南墙：从高处看海，海平线很低。'),
        ex('porto-covo', 'south', '礁石海岸', '金色悬崖下的礁石和蓝绿色海水', '退潮时礁石露出水面。'),
        ex('beach-parasols', 'west', '傍晚的遮阳伞', '傍晚海滩上一排收起的遮阳伞', '西墙：游客散去后的海滩。'),
        ex('palm-sunset', 'west', '三棵棕榈', '日落时分剪影般的三棵棕榈树', '最后一件：太阳落到海面以下。'),
      ],
    },
    {
      slug: 'city-lights',
      title: '示例展厅：城市灯火',
      summary: '五张城市照片：夜里的港口和天际线、白天的街巷和古堡。南墙特意留空，演示「换墙」会跳过空墙。',
      date: '2026-10-12',
      status: 'published',
      exhibits: [
        ex('harbour-night', 'north', '港口夜色', '夜晚港湾对岸灯火通明的摩天大楼', '北墙：港口两岸的灯光落在水里。'),
        ex('pudong-night', 'north', '江边天际线', '江对岸高楼林立的城市天际线全景', '全景照片，适合在立体视图里看。'),
        ex('street-tricycle', 'east', '街巷三轮车', '街边一辆装满回收纸板的三轮车', '东墙：白天的小巷。'),
        ex('harbour-castle', 'west', '港口古堡', '小港口里一座石砌的小城堡，前面停着渔船', '西墙：港口和古堡。'),
        ex('guilin-pagodas', 'west', '日月双塔', '夜里湖面上两座亮灯的塔和它们的倒影', '最后一件：多等五秒，水面安静下来。'),
      ],
    },
  ];
  return { halls };
}

const bad = (details: { path: string; message: string }[]) => new SocialError(400, 'validation_error', '参数校验失败', details);
const notFound = () => new SocialError(404, 'not_found', '展厅不存在');
const SLUG_PATH = /^\/halls\/([a-z0-9-]{1,40})$/;

export class MockHalls {
  constructor(private h: Host) {}

  routePublic(m: string, path: string): Res | null {
    if (m !== 'GET') return null;
    if (path === '/api/halls') return { status: 200, body: { halls: sortHalls(this.h.state().halls.filter((x) => x.status === 'published')).map(hallSummary) } };
    const mt = /^\/api\/halls\/([^/]+)$/.exec(path);
    if (mt) {
      const hall = this.h.state().halls.find((x) => x.slug === mt[1] && x.status === 'published');
      if (!hall) throw notFound();
      return { status: 200, body: { hall } };
    }
    if (path.startsWith('/api/halls/')) throw notFound();
    return null;
  }

  routeAdmin(m: string, sub: string, body: unknown): Res | null {
    if (sub === '/halls' && m === 'GET') return { status: 200, body: { halls: sortHalls(this.h.state().halls).map(hallSummary) } };
    const mt = SLUG_PATH.exec(sub);
    if (!mt) return null;
    const slug = mt[1]!;
    if (m === 'GET') {
      const hall = this.h.state().halls.find((x) => x.slug === slug);
      if (!hall) throw notFound();
      return { status: 200, body: { hall } };
    }
    if (m === 'PUT') {
      const r = validateHall(body);
      if (!r.hall) throw bad(r.issues);
      if (r.hall.slug !== slug) throw bad([{ path: 'slug', message: '地址与网址不一致' }]);
      this.h.commit((s) => {
        s.halls = [...s.halls.filter((x) => x.slug !== slug), r.hall!];
      });
      return { status: 200, body: { hall: r.hall } };
    }
    if (m === 'DELETE') {
      if (!this.h.state().halls.some((x) => x.slug === slug)) throw notFound();
      this.h.commit((s) => {
        s.halls = s.halls.filter((x) => x.slug !== slug);
      });
      return { status: 200, body: { ok: true } };
    }
    return null;
  }
}
