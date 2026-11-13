/**
 * classic 静态底图：8 色带极淡深渐变（ADR 0000 第 28 节）。
 *
 * 与 invader 对称，但更克制：不加星点（第 17 节已删）、不加基准线
 * （classic 飞船在 y=216，与 invader 基准线位置冲突）。
 * 只在 animate() 开头算一次，之后每帧 `data.set(backdrop)` 复用 → 零差分。
 */

import { createSurface } from '../codec/raster.js';
import type { RGB } from '../codec/types.js';
import type { RenderContext } from '../../contract/action.js';
import type { ClassicTheme } from './theme.js';

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function createBackdrop(ctx: RenderContext, theme: ClassicTheme): Uint8ClampedArray {
  const surface = createSurface(ctx.width, ctx.height);
  const bands = theme.bandCount;
  for (let band = 0; band < bands; band += 1) {
    const y0 = Math.floor((band * ctx.height) / bands);
    const y1 = Math.floor(((band + 1) * ctx.height) / bands);
    surface.rect(0, y0, ctx.width, y1,
      lerpColor(theme.background, theme.bgBottom, band / (bands - 1)));
  }
  return surface.data.slice();
}
