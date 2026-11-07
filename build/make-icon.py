# -*- coding: utf-8 -*-
"""
生成应用图标（剑星 Mod 管理器）—— 从插画源图生成。

2026-11-08 起改成「美术稿驱动」：不再用 Pillow 画矢量剑，而是拿
`build/icon-source.png`（护盾 + 剑 + 紫色星环那张，1536×1536）当源图，
统一裁切 / 缩放 / 圆角 / 补边，产出：

    build/icon.png          1024×1024（electron-builder 的源图，Linux/macOS 也用）
    build/icon.ico          多尺寸 16/24/32/48/64/128/256（Windows exe / 快捷方式）
    build/icon-preview.png  16~128 并排的小尺寸可读性检查图

为什么还要脚本、不直接把 png 塞给 electron-builder：
    · exe 图标需要**多尺寸 ico**，单一 256 png 在任务栏/小图标下会被系统硬缩放，糊；
    · 圆角要自己做（源图是满幅深色底，直接当图标显得像张照片）；
    · 小尺寸可读性得看一眼——16px 下能不能认出是块盾，只有缩出来才知道。

用法：
    python build/make-icon.py                 # 用默认源图
    python build/make-icon.py other.png       # 临时换源图

换美术稿：把新图存成 build/icon-source.png（正方形最好，非正方形会居中裁切），再跑一次。
"""
import os
import sys

from PIL import Image, ImageDraw

W = 1024                     # 最终边长
RADIUS_RATIO = 0.185         # 圆角半径 / 边长（Windows 11 应用图标的观感）
SS = 4                       # 圆角遮罩的超采样倍率（不然边缘有锯齿）
# 源图四周留白较多（盾徽只占中间约 6 成），整张塞进 1024 之后 16~32px 会糊成一团。
# 这里按比例裁掉一圈边再放大，让主体在小尺寸下更「满」。
CROP_RATIO = 0.07

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SRC = os.path.join(HERE, 'icon-source.png')


def center_square(im, crop_ratio=0.0):
    """非正方形时居中裁成正方形（宁可切边，也不拉伸变形），再按比例裁掉四周留白。"""
    w, h = im.size
    if w != h:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        im = im.crop((left, top, left + side, top + side))
        w = h = side
    if crop_ratio > 0:
        pad = int(min(w, h) * crop_ratio)
        im = im.crop((pad, pad, w - pad, h - pad))
    return im


def rounded_mask(size, radius):
    """抗锯齿圆角遮罩：先按 SS 倍画，再降采样。"""
    big = size * SS
    m = Image.new('L', (big, big), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius * SS, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SRC
    if not os.path.exists(src):
        raise SystemExit('找不到源图：' + src)
    if os.path.abspath(src) != os.path.abspath(DEFAULT_SRC):
        print('（使用指定源图：' + src + '）')

    im = Image.open(src)
    im = im.convert('RGBA')
    orig = im.size
    im = center_square(im, CROP_RATIO)
    # 源图边缘留一点余地：整体轻微放大不留白，靠圆角把四角切掉
    im = im.resize((W, W), Image.LANCZOS)

    mask = rounded_mask(W, int(W * RADIUS_RATIO))
    out = Image.new('RGBA', (W, W), (0, 0, 0, 0))
    out.paste(im, (0, 0), mask)

    # 极细内描边：深色底 + 紫色主题，加一道很淡的冷光边收口，避免边缘糊进任务栏
    d = ImageDraw.Draw(out)
    inset = max(1, int(W * 0.004))
    d.rounded_rectangle(
        [inset, inset, W - 1 - inset, W - 1 - inset],
        radius=int(W * RADIUS_RATIO) - inset,
        outline=(176, 150, 255, 60),
        width=max(1, int(W * 0.003)),
    )

    png = os.path.join(HERE, 'icon.png')
    out.save(png)
    print('源图 %dx%d → 已写出 %s' % (orig[0], orig[1], png))

    ico = os.path.join(HERE, 'icon.ico')
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    out.save(ico, format='ICO', sizes=sizes)
    print('已写出 %s  尺寸：%s' % (ico, ', '.join('%dx%d' % s for s in sizes)))

    # 小尺寸可读性检查图：把 16/24/32/48/64/128 并排贴出来，用眼睛确认
    strip = Image.new('RGBA', (int(W * 0.62), 148), (16, 22, 36, 255))
    x = 10
    for s in (16, 24, 32, 48, 64, 128):
        thumb = out.resize((s, s), Image.LANCZOS)
        strip.alpha_composite(thumb, (x, 10 + (128 - s) // 2))
        x += s + 10
    prev = os.path.join(HERE, 'icon-preview.png')
    strip.save(prev)
    print('已写出 %s（小尺寸可读性检查）' % prev)


if __name__ == '__main__':
    main()
