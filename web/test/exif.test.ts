import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cameraName, exifToFields, formatShutter, hasGps, imageKind, orientedSize, readExif, stripMetadata } from '../src/exif';
import { coarseCoord, validateSection } from '../src/sections';
import { gpsForSave } from '../src/photo-upload';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/exif/${n}`, import.meta.url)));

describe('readExif (fixtures from fixtures/exif/make.py)', () => {
  it('iPhone JPEG with GPS: camera, date, lens, 35mm focal, aperture, shutter, ISO, coords', () => {
    const x = readExif(fx('iphone-gps.jpg'))!;
    expect(x.make).toBe('Apple');
    expect(x.model).toBe('iPhone 15 Pro');
    expect(x.dateTime).toBe('2026-09-12 18:42');
    expect(x.orientation).toBe(1);
    expect(x.gps!.lat).toBeCloseTo(25.2736, 3);
    expect(x.gps!.lng).toBeCloseTo(110.29, 3);
    expect(exifToFields(x)).toEqual({ date: '2026-09-12 18:42', camera: 'iPhone 15 Pro', lens: 'iPhone 15 Pro back triple camera 6.765mm f/1.78', focal: '24mm', aperture: 'f/1.8', shutter: '1/120s', iso: '80' });
  });

  it('Android JPEG without GPS', () => {
    const x = readExif(fx('samsung-nogps.jpg'))!;
    expect(x.gps).toBeNull();
    expect(exifToFields(x)).toMatchObject({ camera: 'Samsung SM-S918B', focal: '23mm', aperture: 'f/1.7', shutter: '1/2000s', iso: '50', date: '2026-08-01 07:05' });
    expect(hasGps(fx('samsung-nogps.jpg'))).toBe(false);
  });

  it('rotated (orientation 6) JPEG, southern / western hemisphere', () => {
    const x = readExif(fx('rotated6-gps.jpg'))!;
    expect(x.orientation).toBe(6);
    expect(x.gps!.lat).toBeCloseTo(-22.9068, 3);
    expect(x.gps!.lng).toBeCloseTo(-43.1729, 3);
    expect(orientedSize(64, 48, x.orientation)).toEqual({ width: 48, height: 64 });
    expect(exifToFields(x)).toMatchObject({ camera: 'Xiaomi 2304FPN6DC', focal: '9mm', shutter: '0.5s', iso: '1600' });
  });

  it('WebP and PNG carry the same EXIF', () => {
    for (const f of ['iphone-gps.webp', 'iphone-gps.png']) {
      const x = readExif(fx(f))!;
      expect(x.model).toBe('iPhone 15 Pro');
      expect(x.gps!.lat).toBeCloseTo(25.27, 2);
    }
  });

  it('HEIC: finds the Exif item inside the ISO-BMFF container', () => {
    const jpg = fx('iphone-gps.jpg');
    const at = jpg.findIndex((_, i) => jpg[i] === 0x45 && jpg[i + 1] === 0x78 && jpg[i + 2] === 0x69 && jpg[i + 3] === 0x66);
    const exifItem = jpg.subarray(at, at + 900);
    const ftyp = new Uint8Array([0, 0, 0, 24, ...'ftypheic'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...'mif1heic'.split('').map((c) => c.charCodeAt(0))]);
    const heic = new Uint8Array([...ftyp, 0, 0, 0, 6, ...exifItem]);
    expect(imageKind(heic)).toBe('heic');
    expect(readExif(heic)?.model).toBe('iPhone 15 Pro');
  });

  it('no EXIF → null; garbage never throws', () => {
    expect(readExif(fx('plain.jpg'))).toBeNull();
    expect(readExif(new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2]))).toBeNull();
    const broken = fx('iphone-gps.jpg').slice(0, 200);
    expect(() => readExif(broken)).not.toThrow();
  });
});

describe('stripMetadata', () => {
  it('JPEG: no GPS / camera left, image data untouched, orientation 1 → no EXIF at all', () => {
    const src = fx('iphone-gps.jpg');
    const r = stripMetadata(src);
    expect(r.changed).toBe(true);
    expect(hasGps(r.bytes)).toBe(false);
    expect(readExif(r.bytes)).toBeNull();
    const text = new TextDecoder('latin1').decode(r.bytes);
    expect(text).not.toContain('iPhone');
    // 扫描数据（SOS 之后）逐字节相同
    const sos = (b: Uint8Array) => b.findIndex((_, i) => b[i] === 0xff && b[i + 1] === 0xda);
    expect(r.bytes.subarray(sos(r.bytes))).toEqual(src.subarray(sos(src)));
  });

  it('JPEG rotated: keeps only Orientation so it still displays upright', () => {
    const r = stripMetadata(fx('rotated6-gps.jpg'));
    expect(hasGps(r.bytes)).toBe(false);
    const x = readExif(r.bytes)!;
    expect(x.orientation).toBe(6);
    expect(x.make + x.model + x.dateTime).toBe('');
  });

  it('WebP and PNG: EXIF chunks removed, container stays valid', () => {
    const w = stripMetadata(fx('iphone-gps.webp'));
    expect(hasGps(w.bytes)).toBe(false);
    expect(readExif(w.bytes)).toBeNull();
    const riff = new DataView(w.bytes.buffer, w.bytes.byteOffset).getUint32(4, true);
    expect(riff).toBe(w.bytes.length - 8);
    const p = stripMetadata(fx('iphone-gps.png'));
    expect(hasGps(p.bytes)).toBe(false);
    expect(new TextDecoder('latin1').decode(p.bytes.subarray(p.bytes.length - 8, p.bytes.length - 4))).toBe('IEND');
  });

  it('files without metadata are returned as-is', () => {
    const src = fx('plain.jpg');
    const r = stripMetadata(src);
    expect(r.changed).toBe(false);
    expect(r.bytes).toBe(src);
  });
});

describe('formatting + location privacy', () => {
  it('shutter / camera helpers', () => {
    expect(formatShutter(1 / 60)).toBe('1/60s');
    expect(formatShutter(2)).toBe('2s');
    expect(formatShutter(0)).toBe('');
    expect(cameraName('OPPO', 'PHN110')).toBe('OPPO PHN110');
    expect(cameraName('Google', 'Pixel 9')).toBe('Pixel 9');
    expect(cameraName('HUAWEI', 'HUAWEI Mate 60 Pro')).toBe('HUAWEI Mate 60 Pro');
  });

  it('GPS is only saved when the toggle is on, and only rounded to 0.1°', () => {
    const gps = { lat: 25.2736, lng: 110.29 };
    expect(gpsForSave(gps, false)).toEqual({ geo: 'off', lat: '', lng: '' });
    expect(gpsForSave(gps, true)).toEqual({ geo: 'on', lat: '25.3', lng: '110.3' });
    expect(gpsForSave(null, true)).toEqual({ geo: 'off', lat: '', lng: '' });
    expect(coarseCoord('25.2736', 90)).toBe('25.3');
  });

  it('prefilled fields pass the works validator; malformed EXIF strings are rejected', () => {
    const f = exifToFields(readExif(fx('iphone-gps.jpg'))!);
    const ok = validateSection('works', [{ id: 'p1', title: '夜', url: '/api/images/2026/10/x.jpg', ...f }]);
    expect(ok.issues).toEqual([]);
    const bad = validateSection('works', [{ id: 'p1', title: '夜', url: '/x.jpg', date: '12/09/2026', aperture: '1.8', shutter: 'fast', iso: 'auto', focal: '24', camera: 'a<b' }]);
    expect(bad.issues.map((i) => i.path).sort()).toEqual(['items.0.aperture', 'items.0.camera', 'items.0.date', 'items.0.focal', 'items.0.iso', 'items.0.shutter']);
  });
});
