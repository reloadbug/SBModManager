# -*- coding: utf-8 -*-
"""
生成应用图标（剑星 Mod 管理器）。

设计：深蓝渐变圆角方块 + 斜置银白剑刃 + 金色四角星（呼应「剑星 / Stellar Blade」）。
纯 Pillow 矢量绘制，4 倍超采样后降采样，保证 16px 下依然清晰。

用法：
    python build/make-icon.py
产出：
    build/icon.png   1024x1024（Linux/macOS 与 electron-builder 的源图）
    build/icon.ico   多尺寸（16/24/32/48/64/128/256），Windows 用
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter

S = 4                    # 超采样倍率
W = 1024                 # 最终边长
C = W * S                # 画布边长

HERE = os.path.dirname(os.path.abspath(__file__))


def px(x, y):
    """把 0~1 的相对坐标转成画布像素坐标。"""
    return (x * C, y * C)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def rounded_mask(size, radius):
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def vgradient(size, top, bottom):
    g = Image.new('RGB', (1, size))
    for y in range(size):
        g.putpixel((0, y), lerp(top, bottom, y / max(1, size - 1)))
    return g.resize((size, size))


def blade_polygon(base, tip, half_w, belly=0.98):
    """
    剑刃多边形：根部宽度 = 2*half_w，向尖端线性收成一个点。

    ⚠️ `t` 的方向必须是 **0 = 根部、1 = 尖端**。
       曾经写反过一次（把 t=1.0 当根部用），结果「根部那两个角」被算到了尖端上，
       多边形变成沿刃身斜劈的一条对角线 —— 渲染出来剑身裂成好几片碎屑。
    """
    bx, by = base
    tx, ty = tip
    dx, dy = tx - bx, ty - by
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux                       # 法线

    def width(t):
        # 剑身轮廓：前 70% 保持满宽（平行刃），最后 30% 收锋成尖。
        # 若整段线性收缩就成了一个三角形（像根钉子），不像剑。
        a = 0.70
        return 1.0 if t <= a else max(0.0, (1.0 - t) / (1.0 - a))

    def at(t, k):
        w = half_w * width(t) * k
        return px(bx + ux * L * t + nx * w, by + uy * L * t + ny * w)

    return [
        at(1.0, 1.0),        # 尖端
        at(0.70, 1.0),       # 收锋起点（肩）
        at(0.34, belly),     # 一侧腹部
        at(0.0, 1.0),        # 该侧根部
        at(0.0, -1.0),       # 另一侧根部
        at(0.34, -belly),    # 另一侧腹部
    ]


def rotated_rect(center, along, length, thick):
    """以 center 为中心、沿 along 方向长 length、厚 thick 的矩形四角。"""
    cx, cy = center
    ax, ay = along
    L = math.hypot(ax, ay)
    ux, uy = ax / L, ay / L
    nx, ny = -uy, ux
    hl, ht = length / 2, thick / 2
    return [
        px(cx + ux * hl + nx * ht, cy + uy * hl + ny * ht),
        px(cx - ux * hl + nx * ht, cy - uy * hl + ny * ht),
        px(cx - ux * hl - nx * ht, cy - uy * hl - ny * ht),
        px(cx + ux * hl - nx * ht, cy + uy * hl - ny * ht),
    ]


def star_polygon(cx, cy, r_out, r_in, points=4, rot=-math.pi / 2):
    pts = []
    for i in range(points * 2):
        r = r_out if i % 2 == 0 else r_in
        a = rot + i * math.pi / points
        pts.append(px(cx + math.cos(a) * r, cy + math.sin(a) * r))
    return pts


def main():
    # ---------- 1. 圆角底 ----------
    base = vgradient(C, (36, 52, 82), (12, 18, 32))     # 深蓝 → 近黑
    img = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    img.paste(base, (0, 0), rounded_mask(C, int(C * 0.215)))

    draw = ImageDraw.Draw(img)

    # ---------- 2. 中央青色辉光（让剑刃有「发光」感） ----------
    glow = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([C * 0.16, C * 0.20, C * 0.86, C * 0.86], fill=(64, 190, 235, 62))
    glow = glow.filter(ImageFilter.GaussianBlur(C * 0.075))
    img.alpha_composite(Image.composite(glow, Image.new('RGBA', (C, C), (0, 0, 0, 0)),
                                        rounded_mask(C, int(C * 0.215))))

    draw = ImageDraw.Draw(img)

    # ---------- 3. 剑刃 ----------
    #
    # 竖剑构图。之前试过斜置的细长剑刃，但尖端半角只有 6° 左右，
    # 缩到 16px 就是一根针，认不出是把剑 —— 竖直、加宽、缩短才读得出来。
    base_pt, tip_pt = (0.487, 0.730), (0.535, 0.148)
    hw = 0.078
    dx, dy = tip_pt[0] - base_pt[0], tip_pt[1] - base_pt[1]
    L = math.hypot(dx, dy)
    ux, uy = dx / L, dy / L
    nx, ny = -uy, ux

    # 衬底刃形：比本体略大一圈，做出「刃身发亮」的边缘感。
    # ⚠️ 不要用 polygon(outline=..., width=...) 描边 —— 刃尖角度极锐，
    #    描边会按斜接（miter）外延出长长的尖刺，看着像碎屑。
    draw.polygon(blade_polygon(base_pt, tip_pt, hw * 1.10, belly=0.98), fill=(150, 192, 236, 86))

    # 剑刃主体：从亮银到冷灰的竖向渐变
    blade_layer = Image.new('RGBA', (C, C), (0, 0, 0, 0))
    bmask = Image.new('L', (C, C), 0)
    ImageDraw.Draw(bmask).polygon(blade_polygon(base_pt, tip_pt, hw, belly=0.98), fill=255)
    blade_layer.paste(vgradient(C, (248, 252, 255), (146, 168, 198)).convert('RGBA'),
                      (0, 0), bmask)
    img.alpha_composite(blade_layer)
    draw = ImageDraw.Draw(img)

    # 刃口高光 / 背光：沿法线偏移出更窄的一小条，做出斜面反光。
    # ⚠️ 尖端必须**收敛到真正的刃尖**（偏移量在尖端归零），否则窄条的宽度在刃尖处
    #    不会收成 0，会从刃身两侧戳出来，看着像碎屑。
    hi = (base_pt[0] + nx * hw * 0.36, base_pt[1] + ny * hw * 0.36)
    draw.polygon(blade_polygon(hi, tip_pt, hw * 0.32, belly=0.98), fill=(255, 255, 255, 242))

    lo = (base_pt[0] - nx * hw * 0.44, base_pt[1] - ny * hw * 0.44)
    draw.polygon(blade_polygon(lo, tip_pt, hw * 0.30, belly=0.98), fill=(124, 147, 178, 190))

    # 中脊（血槽）：沿中线一条细窄的冷色条，让刃身有立体感
    ridge = (base_pt[0] + nx * hw * 0.02, base_pt[1] + ny * hw * 0.02)
    draw.polygon(blade_polygon(ridge, (base_pt[0] + ux * L * 0.70, base_pt[1] + uy * L * 0.70),
                               hw * 0.075, belly=1.0), fill=(176, 198, 224, 165))

    # ---------- 4. 护手 + 握柄 ----------
    guard_c = (base_pt[0] + ux * 0.008, base_pt[1] + uy * 0.008)
    draw.polygon(rotated_rect(guard_c, (nx, ny), 0.300, 0.046), fill=(176, 138, 62, 255))
    draw.polygon(rotated_rect(guard_c, (nx, ny), 0.300, 0.021), fill=(234, 199, 116, 255))

    grip_c = (base_pt[0] - ux * 0.080, base_pt[1] - uy * 0.080)
    draw.polygon(rotated_rect(grip_c, (ux, uy), 0.150, 0.052), fill=(28, 38, 58, 255))
    for k in (-0.030, 0.030):
        rc = (grip_c[0] + ux * k, grip_c[1] + uy * k)
        draw.polygon(rotated_rect(rc, (ux, uy), 0.012, 0.056), fill=(196, 156, 74, 255))

    # 剑首（握柄末端的小金帽，避免柄部看起来被截断）
    pommel = (grip_c[0] - ux * 0.086, grip_c[1] - uy * 0.086)
    draw.polygon(rotated_rect(pommel, (ux, uy), 0.032, 0.070), fill=(196, 156, 74, 255))

    # ---------- 5. 金色四角星 ----------
    star_c = (0.778, 0.258)
    draw.polygon(star_polygon(star_c[0], star_c[1], 0.115, 0.031), fill=(255, 199, 90, 255))
    draw.polygon(star_polygon(star_c[0], star_c[1], 0.047, 0.013), fill=(255, 246, 216, 255))

    # 小星（平衡构图）
    draw.polygon(star_polygon(0.243, 0.360, 0.052, 0.014), fill=(255, 205, 110, 200))

    # ---------- 6. 内侧描边（收边，避免边缘发虚） ----------
    draw.rounded_rectangle([int(C * 0.006), int(C * 0.006), C - int(C * 0.006), C - int(C * 0.006)],
                           radius=int(C * 0.209), outline=(130, 195, 245, 70), width=int(C * 0.005))

    # ---------- 7. 降采样 + 输出 ----------
    img = img.resize((W, W), Image.LANCZOS)
    png = os.path.join(HERE, 'icon.png')
    img.save(png)
    print('已写出 ' + png)

    ico = os.path.join(HERE, 'icon.ico')
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico, format='ICO', sizes=sizes)
    print('已写出 ' + ico + '  尺寸：' + ', '.join('%dx%d' % s for s in sizes))

    # 小尺寸可读性检查图：把 16/24/32/48/64/128 并排贴出来，用眼睛确认
    strip = Image.new('RGBA', (int(W * 0.62), 148), (16, 22, 36, 255))
    x = 10
    for s in (16, 24, 32, 48, 64, 128):
        thumb = img.resize((s, s), Image.LANCZOS)
        strip.alpha_composite(thumb, (x, 10 + (128 - s) // 2))
        x += s + 10
    prev = os.path.join(HERE, 'icon-preview.png')
    strip.save(prev)
    print('已写出 ' + prev + '（小尺寸可读性检查）')


if __name__ == '__main__':
    main()
