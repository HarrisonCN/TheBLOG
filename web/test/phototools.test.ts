/**
 * L29 / v1.29.0 摄影工具箱：曝光 / 景深 / 黄金·蓝调时刻 / 本地 EXIF 查看器（纯函数，表驱动，对照公认参考值）。
 * 参考值：
 * - 曝光：EV100 = log2(N²/t) − log2(ISO/100)（APEX）；阳光 16 法则 f/16 · 1/125 · ISO100 ≈ EV 15。
 * - 景深：H = f²/(N·c) + f；近点 = s(H−f)/(H+s−2f)，远点 = s(H−f)/(H−s)。50mm f/8 10 m c=0.03 → H 10.47 m，近 5.11 m，远 223 m（DOFMaster 同值）。
 * - 太阳：NOAA 太阳位置算法；对照 api.sunrise-sunset.org（北京、悉尼）与 timeanddate.com（伦敦，2026-10-15 取数）的日出 / 日落 / 民用晨昏（−6°），容差 2 分钟。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APERTURES, CITIES, ISOS, SENSORS, SHUTTERS,
  cocFor, cropFactor, dof, equivalents, ev100, evAt, exifReport, exposureQuery, fmtAperture, fmtDistance, fmtShutterT, ndShutter,
  nearestStop, parseAperture, parseExposureQuery, parseIso, parseShutter, phoneRealFocal, solveAperture, solveIso, solveShutter,
  stopsBetween, sunPosition, sunTimes, tzOffsetMinutes, workExposure,
} from '../src/photo-core';
import { readExif } from '../src/exif';
import { parseRoute, routePath } from '../src/render';
import { findEntry, sectionOf } from '../src/site-map';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/exif/${n}`, import.meta.url)));
const mins = (a: Date | null, iso: string) => Math.abs((a!.getTime() - Date.parse(iso)) / 60000);

describe('曝光：解析', () => {
  it.each([
    ['f/2.8', 2.8], ['F2.8', 2.8], ['ƒ/1.8', 1.8], ['8', 8], ['f/0', null], ['abc', null], ['f/200', null],
  ])('parseAperture(%s) = %s', (s, v) => expect(parseAperture(s)).toBe(v));
  it.each([
    ['1/250', 1 / 250], ['1/250s', 1 / 250], ['2s', 2], ['2"', 2], ['0.5', 0.5], ['30', 30], ['1/0', null], ['', null], ['-1', null], ['1/100000', null],
  ])('parseShutter(%s)', (s, v) => (v === null ? expect(parseShutter(s)).toBeNull() : expect(parseShutter(s)).toBeCloseTo(v as number, 9)));
  it.each([['100', 100], ['ISO 400', 400], ['iso3200', 3200], ['0', null], ['9999999', null]])('parseIso(%s)', (s, v) => expect(parseIso(s)).toBe(v));
});

describe('曝光：EV 与等效', () => {
  it('EV100 参考值', () => {
    expect(ev100(1, 1)).toBeCloseTo(0, 9);
    expect(ev100(16, 1 / 125)).toBeCloseTo(14.97, 2); // 阳光 16
    expect(ev100(2.8, 1 / 60)).toBeCloseTo(8.88, 2);
    expect(evAt(16, 1 / 125, 100)).toBeCloseTo(14.97, 2);
    expect(evAt(16, 1 / 250, 200)).toBeCloseTo(evAt(16, 1 / 125, 100) , 6); // 同一场景
    expect(evAt(1.78, 1 / 120, 80)).toBeCloseTo(8.89, 2); // iPhone 夹具
  });
  it('求解：保持 EV 改一个参数', () => {
    const ev = evAt(8, 1 / 125, 100);
    expect(solveShutter(ev, 5.6, 100)).toBeCloseTo((1 / 125) * (5.6 / 8) ** 2, 9);
    expect(solveAperture(ev, 1 / 500, 100)).toBeCloseTo(4, 6);
    expect(solveIso(ev, 8, 1 / 500)).toBeCloseTo(400, 6);
  });
  it('档位：标准刻度与吸附', () => {
    expect(APERTURES).toContain(5.6);
    expect(SHUTTERS[0]).toBeCloseTo(1 / 8000, 9);
    expect(SHUTTERS.at(-1)).toBe(30);
    expect(ISOS).toEqual(expect.arrayContaining([50, 100, 3200, 25600]));
    expect(nearestStop(1 / 240, SHUTTERS)).toBeCloseTo(1 / 250, 9);
    expect(nearestStop(5.9, APERTURES)).toBe(5.6);
    expect(stopsBetween(1 / 250, 1 / 125)).toBeCloseTo(1, 9);
    expect(stopsBetween(2.8, 4, 'N')).toBeCloseTo(-1, 1); // 收一档光圈 = 少一档光
  });
  it('等效组合：保持 ISO 时每档光圈对应的快门（吸附到 1/3 档）', () => {
    const rows = equivalents({ N: 8, t: 1 / 125, iso: 100 }, 'iso');
    const f4 = rows.find((r) => r.N === 4)!;
    expect(f4.t).toBeCloseTo(1 / 500, 9);
    expect(rows.find((r) => r.N === 16)!.t).toBeCloseTo(1 / 30, 9);
    expect(rows.every((r) => r.iso === 100)).toBe(true);
    // 超出快门范围的组合被标记，不会编造一个不存在的快门
    const dark = equivalents({ N: 1.4, t: 15, iso: 100 }, 'iso');
    expect(dark.find((r) => r.N === 22)!.outOfRange).toBe(true);
    const isoRows = equivalents({ N: 8, t: 1 / 125, iso: 100 }, 'N');
    expect(isoRows.find((r) => r.iso === 400)!.t).toBeCloseTo(1 / 500, 9);
  });
  it('ND 减光镜与格式化', () => {
    expect(ndShutter(1 / 60, 10)).toBeCloseTo(1024 / 60, 6);
    expect(fmtShutterT(1 / 250)).toBe('1/250');
    expect(fmtShutterT(0.5)).toBe('1/2');
    expect(fmtShutterT(2)).toBe('2″');
    expect(fmtShutterT(17.07)).toBe('17″');
    expect(fmtShutterT(125)).toBe('2′5″');
    expect(fmtAperture(5.6)).toBe('f/5.6');
    expect(fmtAperture(11)).toBe('f/11');
  });
  it('网址参数：解析时夹紧，序列化可往返', () => {
    expect(parseExposureQuery('?f=2.8&t=1%2F250&iso=400')).toEqual({ N: 2.8, t: 1 / 250, iso: 400 });
    expect(parseExposureQuery('?f=abc&t=-1&iso=<script>')).toEqual({ N: 8, t: 1 / 125, iso: 100 });
    expect(parseExposureQuery(exposureQuery({ N: 1.8, t: 1 / 120, iso: 80 }))).toEqual({ N: 1.8, t: 1 / 120, iso: 80 });
  });
});

describe('景深 / 超焦距', () => {
  it('弥散圆：画幅对角线 / 1500；裁切系数', () => {
    const ff = SENSORS.find((s) => s.id === 'ff')!;
    expect(cocFor(ff)).toBeCloseTo(0.029, 3);
    expect(cropFactor(ff)).toBeCloseTo(1, 3);
    expect(cropFactor(SENSORS.find((s) => s.id === 'apsc')!)).toBeCloseTo(1.53, 2);
    expect(cropFactor(SENSORS.find((s) => s.id === 'm43')!)).toBeCloseTo(2, 1);
    // 手机传感器都在表里
    for (const id of ['phone-1in', 'phone-1-1.3', 'phone-1-1.56', 'phone-1-2.55']) expect(SENSORS.find((s) => s.id === id), id).toBeTruthy();
  });
  it('DOFMaster 参考：50mm f/8 10m c=0.03', () => {
    const r = dof({ focal: 50, N: 8, distance: 10, coc: 0.03 });
    expect(r.hyperfocal).toBeCloseTo(10.47, 2);
    expect(r.near).toBeCloseTo(5.11, 2);
    expect(r.far).toBeCloseTo(223.2, 0);
    expect(r.total).toBeCloseTo(r.far - r.near, 6);
  });
  it('对焦在超焦距以外：远点无穷大', () => {
    const r = dof({ focal: 24, N: 11, distance: 5, coc: 0.03 });
    expect(r.far).toBe(Infinity);
    expect(r.total).toBe(Infinity);
    expect(r.near).toBeCloseTo(r.hyperfocal * 5 / (r.hyperfocal + 5), 0); // 近似 Hs/(H+s)
  });
  it('手机：35mm 等效焦距换算实际焦距，景深很深', () => {
    const s = SENSORS.find((x) => x.id === 'phone-1-1.3')!;
    const f = phoneRealFocal(24, s);
    expect(f).toBeGreaterThan(5);
    expect(f).toBeLessThan(7.5);
    const r = dof({ focal: f, N: 1.8, distance: 3, coc: cocFor(s) });
    expect(r.hyperfocal).toBeGreaterThan(2);
    expect(r.hyperfocal).toBeLessThan(6);
  });
  it('非法输入抛错', () => {
    expect(() => dof({ focal: 0, N: 8, distance: 10, coc: 0.03 })).toThrow();
    expect(() => dof({ focal: 50, N: 8, distance: 0.01, coc: 0.03 })).toThrow(); // 比焦距还近
  });
  it('距离格式', () => {
    expect(fmtDistance(Infinity)).toBe('∞');
    expect(fmtDistance(0.456)).toBe('46 cm');
    expect(fmtDistance(5.114)).toBe('5.11 m');
    expect(fmtDistance(223.2)).toBe('223 m');
    expect(fmtDistance(1500)).toBe('1.5 km');
  });
});

describe('太阳位置与黄金 / 蓝调时刻（离线计算）', () => {
  it('时区偏移（含夏令时）', () => {
    expect(tzOffsetMinutes('Asia/Shanghai', new Date('2026-06-21T00:00:00Z'))).toBe(480);
    expect(tzOffsetMinutes('Europe/London', new Date('2026-06-21T12:00:00Z'))).toBe(60);
    expect(tzOffsetMinutes('Europe/London', new Date('2026-12-21T12:00:00Z'))).toBe(0);
    expect(tzOffsetMinutes('America/New_York', new Date('2026-12-21T12:00:00Z'))).toBe(-300);
  });
  it('太阳高度角：正午高、半夜低', () => {
    const noon = sunPosition(new Date('2026-06-21T04:16:07Z'), 39.9042, 116.4074);
    expect(noon.elevation).toBeCloseTo(90 - 39.9042 + 23.44, 0);
    expect(noon.azimuth).toBeGreaterThan(170);
    expect(noon.azimuth).toBeLessThan(190);
    expect(sunPosition(new Date('2026-06-21T16:16:00Z'), 39.9042, 116.4074).elevation).toBeLessThan(-20);
  });
  it.each([
    // 北京 夏至
    ['Asia/Shanghai', 39.9042, 116.4074, '2026-06-21', { sunrise: '2026-06-20T20:44:23Z', sunset: '2026-06-21T11:47:51Z', civilDawn: '2026-06-20T20:13:12Z', civilDusk: '2026-06-21T12:19:03Z', noon: '2026-06-21T04:16:07Z' }],
    // 伦敦 冬至：sunrise-sunset.org 在高纬度冬季偏差约 2 分钟，改用 timeanddate.com（含折射，精确到分钟，取该分钟的中点）
    ['Europe/London', 51.5074, -0.1278, '2026-12-21', { sunrise: '2026-12-21T08:03:30Z', sunset: '2026-12-21T15:53:30Z', civilDawn: '2026-12-21T07:23:30Z', civilDusk: '2026-12-21T16:33:30Z', noon: '2026-12-21T11:58:30Z' }],
    // 悉尼 春分（南半球）
    ['Australia/Sydney', -33.8688, 151.2093, '2026-03-20', { sunrise: '2026-03-19T19:56:52Z', sunset: '2026-03-20T08:08:36Z', civilDawn: '2026-03-19T19:33:15Z', civilDusk: '2026-03-20T08:32:14Z', noon: '2026-03-20T02:02:44Z' }],
  ])('%s %s,%s %s 对照 sunrise-sunset.org（±2 分钟）', (tz, lat, lng, ymd, ref) => {
    const s = sunTimes(ymd as string, lat as number, lng as number, tz as string);
    expect(mins(s.sunrise, ref.sunrise)).toBeLessThan(2);
    expect(mins(s.sunset, ref.sunset)).toBeLessThan(2);
    expect(mins(s.solarNoon, ref.noon)).toBeLessThan(2);
    expect(mins(s.blueMorning!.start, ref.civilDawn)).toBeLessThan(2);
    expect(mins(s.blueEvening!.end, ref.civilDusk)).toBeLessThan(2);
    // 顺序：蓝调(-6→-4) → 黄金(-4→+6)，傍晚相反
    expect(s.blueMorning!.end.getTime()).toBe(s.goldenMorning!.start.getTime());
    expect(s.goldenMorning!.start.getTime()).toBeLessThan(s.sunrise!.getTime());
    expect(s.goldenMorning!.end.getTime()).toBeGreaterThan(s.sunrise!.getTime());
    expect(s.goldenEvening!.end.getTime()).toBe(s.blueEvening!.start.getTime());
    expect(s.polar).toBeNull();
  });
  it('极昼 / 极夜：没有日出日落时如实返回', () => {
    const day = sunTimes('2026-06-21', 78.22, 15.65, 'Arctic/Longyearbyen');
    expect(day.polar).toBe('day');
    expect(day.sunrise).toBeNull();
    const night = sunTimes('2026-12-21', 78.22, 15.65, 'Arctic/Longyearbyen');
    expect(night.polar).toBe('night');
    expect(night.sunset).toBeNull();
  });
  it('非法输入抛错；城市表只有粗略坐标（≤2 位小数）和合法时区', () => {
    expect(() => sunTimes('2026-13-01', 0, 0, 'UTC')).toThrow();
    expect(() => sunTimes('2026-06-01', 91, 0, 'UTC')).toThrow();
    expect(() => sunTimes('2026-06-01', 0, 0, 'Not/AZone')).toThrow();
    expect(CITIES.length).toBeGreaterThanOrEqual(12);
    for (const c of CITIES) {
      expect(Math.abs(c.lat * 100 - Math.round(c.lat * 100))).toBeLessThan(1e-6);
      expect(() => tzOffsetMinutes(c.tz, new Date())).not.toThrow();
    }
  });
});

describe('EXIF 报告（本地查看器）与作品曝光', () => {
  it('iPhone 夹具：参数、EV、裁切系数；GPS 只给提示，不出现坐标', () => {
    const rep = exifReport(readExif(fx('iphone-gps.jpg'))!);
    const get = (k: string) => rep.rows.find((r) => r.key === k)?.value;
    expect(get('camera')).toBe('iPhone 15 Pro');
    expect(get('aperture')).toBe('f/1.8');
    expect(get('shutter')).toBe('1/120');
    expect(get('iso')).toBe('80');
    expect(get('focal')).toBe('6.8mm（等效 24mm）');
    expect(get('ev')).toBe('EV 8.9');
    expect(get('crop')).toBe('×3.5');
    expect(rep.hasGps).toBe(true);
    expect(JSON.stringify(rep.rows)).not.toMatch(/25\.27|110\.29/);
    expect(rep.exposure).toEqual({ N: 1.78, t: 1 / 120, iso: 80 });
  });
  it('没有 GPS 的安卓夹具', () => {
    const rep = exifReport(readExif(fx('samsung-nogps.jpg'))!);
    expect(rep.hasGps).toBe(false);
    expect(rep.rows.find((r) => r.key === 'ev')!.value).toMatch(/^EV \d/);
  });
  it('作品：从展示字段算 EV，并生成曝光计算器链接', () => {
    const x = workExposure({ aperture: 'f/2.8', shutter: '1/250s', iso: '400' });
    expect(x!.ev).toBeCloseTo(evAt(2.8, 1 / 250, 400), 9);
    expect(x!.label).toBe('EV 8.9');
    expect(x!.href).toBe('/tools/exposure/?f=2.8&t=1%2F250&iso=400');
    expect(workExposure({ aperture: '', shutter: '1/250s', iso: '400' })).toBeNull();
  });
});

describe('路由与栏目', () => {
  it.each([
    ['/tools/exposure/', 'exposure'], ['/tools/dof/', 'dof'], ['/tools/golden-hour/', 'goldenhour'], ['/tools/exif/', 'exifviewer'],
  ])('%s → %s，属于「工具」栏目', (path, name) => {
    const r = parseRoute(path);
    expect(r.name).toBe(name);
    expect(routePath(r)).toBe(path);
    expect(sectionOf(r.name)?.id).toBe('tools');
    expect(findEntry('tools', r.name)?.href).toBe(path);
  });
});
