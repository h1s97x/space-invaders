"""GIF 编码：共享调色板 + 逐帧量化 + 脏矩形差分。

体积的两个关键决策都在这里（别踩回去）：
  * 关掉抖动 —— 像素画都是大色块，抖动只会塞高频噪声，变大而观感不变；
  * 不指定 disposal=2 —— 那会强制每帧全量编码，实测体积直接翻倍。
"""

from __future__ import annotations

import os
from typing import Iterable

from PIL import Image

from .config import DEFAULT_COLORS


def _clamp_colors(colors: int) -> int:
    return max(2, min(256, colors))


def build_palette(first: Image.Image, colors: int = DEFAULT_COLORS) -> Image.Image:
    """用首帧生成一张统一的调色板图（P 模式），给所有帧共用 → 不闪烁。"""
    palette = (first.quantize(colors=_clamp_colors(colors),
                              dither=Image.Dither.NONE).getpalette() or [])[:256 * 3]
    # putpalette 需要完整的 256*3 调色板，不足部分补零
    palette += [0] * (256 * 3 - len(palette))
    pal_img = Image.new("P", first.size)
    pal_img.putpalette(palette)
    return pal_img


def quantize_frame(frame: Image.Image, pal_img: Image.Image,
                   colors: int = DEFAULT_COLORS) -> Image.Image:
    """把一帧映射到统一调色板。

    关掉抖动：像素画本来都是大色块，抖动只会往里塞高频噪声，
    让 GIF 明显变大而观感几乎不变。
    """
    return frame.quantize(palette=pal_img, colors=_clamp_colors(colors),
                          dither=Image.Dither.NONE)


def encode_gif(frames: Iterable[Image.Image], path: str, frame_ms: int,
               colors: int = DEFAULT_COLORS) -> int:
    """把所有帧编码成一个 GIF，返回实际写入的帧数。

    `frames` 可以是生成器：这里边消费边量化，RGB 原帧用完即丢，
    峰值内存只与「量化后的帧」成正比（约为 RGB 帧的 1/3）。
    """
    colors = _clamp_colors(colors)
    it = iter(frames)
    try:
        first = next(it)
    except StopIteration:
        raise RuntimeError("没有帧")

    pal_img = build_palette(first, colors)
    quantized = [quantize_frame(first, pal_img, colors)]
    for f in it:
        quantized.append(quantize_frame(f, pal_img, colors))

    # 不要指定 disposal=2：那会强制每帧全量编码，实测体积直接翻倍。
    # 每帧都是不透明整图，配合 optimize=True 的脏矩形差分不会产生残影。
    quantized[0].save(
        path, save_all=True, append_images=quantized[1:],
        duration=frame_ms, loop=0, optimize=True)
    print(f"  ✅ {path}  ({len(quantized)} 帧, {os.path.getsize(path):,} bytes)")
    return len(quantized)
