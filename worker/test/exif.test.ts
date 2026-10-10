import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_TOKEN, call, disposeEnv, login, setupEnv } from './helpers';
import type { Env } from '../src/env';
import { hasGps, readExif } from '../src/exif';
import { sectionSchemas } from '../src/schema';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../../web/test/fixtures/exif/${n}`, import.meta.url)));

let env: Env;
let admin: { cookie: string; csrf: string };
beforeAll(async () => {
  env = await setupEnv();
  admin = await login(env, '10.113.0.1');
});
afterAll(disposeEnv);

const work = (o: Record<string, unknown>) => ({ id: 'p-20260912', title: '漓江夜色', url: '/api/images/2026/10/x.jpg', ...o });

describe('作品集 EXIF 字段校验（workSchema）', () => {
  it('接受上传时预填的格式，坐标粗化到 0.1°', () => {
    const r = sectionSchemas.works.safeParse([work({ date: '2026-09-12 18:42', camera: 'iPhone 15 Pro', lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78', focal: '24mm', aperture: 'f/1.8', shutter: '1/120s', iso: '80', geo: 'on', lat: '25.2736', lng: '110.29' })]);
    expect(r.success).toBe(true);
    expect(r.data![0]).toMatchObject({ lat: '25.3', lng: '110.3', shutter: '1/120s' });
    expect(sectionSchemas.works.safeParse([work({ date: '2026-09', shutter: '2s', focal: '6.77mm' })]).success).toBe(true);
  });

  it('拒绝格式不对、超长或带控制字符 / 尖括号的值', () => {
    const bad: Record<string, unknown>[] = [
      { date: '12/09/2026' }, { date: '2026-09-12T18:42:00Z' }, { aperture: '1.8' }, { shutter: 'fast' }, { iso: 'auto' }, { iso: '1234567' },
      { focal: '24' }, { camera: '<script>' }, { lens: 'a\u0007b' }, { camera: 'x'.repeat(41) }, { lens: 'y'.repeat(61) }, { lat: '91' }, { lng: '200.1' },
    ];
    for (const b of bad) expect(sectionSchemas.works.safeParse([work(b)]).success, JSON.stringify(b)).toBe(false);
  });

  it('PUT /api/admin/content/works 走同一套校验', async () => {
    const put = (items: unknown[]) => call(env, '/api/admin/content/works', { method: 'PUT', body: { items }, cookie: admin.cookie, csrf: admin.csrf });
    expect((await put([work({ aperture: 'f/1.8', iso: '80' })])).status).toBe(200);
    expect((await put([work({ aperture: 'wide open' })])).status).toBe(400);
  });
});

describe('存图时兜底去掉 EXIF / GPS', () => {
  it('带 GPS 的手机 JPEG 上传后，取回的文件没有 GPS 和机身信息；旋转照片保留方向', async () => {
    for (const [name, orientation] of [['iphone-gps.jpg', 0], ['rotated6-gps.jpg', 6]] as const) {
      const src = fx(name);
      expect(hasGps(src)).toBe(true);
      const up = await call(env, '/api/admin/images?alt=p', { token: API_TOKEN, raw: src, headers: { 'content-type': 'image/jpeg' } });
      expect(up.status).toBe(201);
      const { url, size } = (await up.json()) as { url: string; size: number };
      expect(size).toBeLessThan(src.length);
      const got = new Uint8Array(await (await call(env, url)).arrayBuffer());
      expect(hasGps(got)).toBe(false);
      expect(new TextDecoder('latin1').decode(got)).not.toMatch(/iPhone|Xiaomi/);
      expect(readExif(got)?.orientation ?? 0).toBe(orientation);
    }
  });

  it('WebP / PNG 同样去掉', async () => {
    for (const [name, type] of [['iphone-gps.webp', 'image/webp'], ['iphone-gps.png', 'image/png']] as const) {
      const up = await call(env, '/api/admin/images', { token: API_TOKEN, raw: fx(name), headers: { 'content-type': type } });
      expect(up.status).toBe(201);
      const got = new Uint8Array(await (await call(env, ((await up.json()) as { url: string }).url)).arrayBuffer());
      expect(hasGps(got)).toBe(false);
    }
  });
});
