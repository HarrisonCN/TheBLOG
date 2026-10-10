"""Regenerate the EXIF test fixtures (Pillow): python3 make.py"""
from PIL.TiffImagePlugin import IFDRational
from PIL import Image, ImageDraw

def R(n, d=1):
    return IFDRational(n, d)

def dms(v):
    v = abs(v); d = int(v); m = int((v - d) * 60); s = round(((v - d) * 60 - m) * 60, 2)
    return (R(d), R(m), R(int(s * 100), 100))

def img(w, h):
    im = Image.new('RGB', (w, h), (30, 90, 200))
    d = ImageDraw.Draw(im); d.rectangle([0, 0, w // 2, h // 4], fill=(240, 200, 40))  # 左上角黄色块：用来检查方向
    return im

def exif(make, model, dt, lens, focal, f35, fnum, exp, iso, orient=1, gps=None):
    e = Image.Exif()
    e[0x010F] = make; e[0x0110] = model; e[0x0112] = orient; e[0x0132] = dt
    ex = e.get_ifd(0x8769)
    ex[0x9003] = dt; ex[0x829D] = fnum; ex[0x829A] = exp; ex[0x8827] = iso; ex[0x920A] = focal
    if f35: ex[0xA405] = f35
    if lens: ex[0xA434] = lens
    if gps:
        g = e.get_ifd(0x8825)
        g[1] = 'N' if gps[0] >= 0 else 'S'; g[2] = dms(gps[0]); g[3] = 'E' if gps[1] >= 0 else 'W'; g[4] = dms(gps[1])
    return e

iphone = exif('Apple', 'iPhone 15 Pro', '2026:09:12 18:42:07', 'iPhone 15 Pro back triple camera 6.765mm f/1.78', R(6765, 1000), 24, R(178, 100), R(1, 120), 80, 1, (25.2736, 110.2900))
img(64, 48).save('iphone-gps.jpg', quality=90, exif=iphone)
sam = exif('samsung', 'SM-S918B', '2026:08:01 07:05:00', '', R(63, 10), 23, R(17, 10), R(1, 2000), 50)
img(64, 48).save('samsung-nogps.jpg', quality=90, exif=sam)
rot = exif('Xiaomi', '2304FPN6DC', '2025:12:31 23:59:59', '', R(9, 1), 0, R(16, 10), R(1, 2), 1600, 6, (-22.9068, -43.1729))
img(64, 48).save('rotated6-gps.jpg', quality=90, exif=rot)
img(64, 48).save('iphone-gps.webp', quality=90, exif=iphone)
img(64, 48).save('iphone-gps.png', exif=iphone)
img(64, 48).save('plain.jpg', quality=90)
