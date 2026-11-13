/**
 * 静态底图：有限色带深渐变 + 分档静态星点 + 1px 基准线（ADR 0000 第 26 节）。
 *
 * 全部只算一次，之后每帧 `data.set(backdrop)` 复用 —— 零差分、零逐帧开销。
 * 星点位置由固定种子生成、亮度固定 4 档，避免每颗一个灰度值把 256 色表打满。
 * 星云、CRT 扫描线、三层视差星点、地平线光带与滚动透视线仍未加回。
 */

import { createSurface } from '../codec/raster.js';
import type { RGB } from '../codec/types.js';
import type { RenderContext } from '../../contract/action.js';
import type { Theme } from './theme.js';

const STAR_LEVELS: readonly RGB[] = Object.freeze([
  [70, 70, 70],
  [100, 100, 100],
  [135, 135, 135],
  [175, 175, 175],
]);

function staticRandom(): () => number {
  let state = 0x2f6e2b1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function createBackdrop(ctx: RenderContext, theme: Theme): Uint8ClampedArray {
  const surface = createSurface(ctx.width, ctx.height);

  // 渐变必须量化成有限色带：逐行渐变会产生 256 种颜色，把 GIF 的色表吃光，
  // 子弹 / 爆炸这类低频暖色会被挤掉并量化成灰蓝。
  const bands = theme.bandCount;
  for (let band = 0; band < bands; band += 1) {
    const y0 = Math.floor((band * ctx.height) / bands);
    const y1 = Math.floor(((band + 1) * ctx.height) / bands);
    surface.rect(0, y0, ctx.width, y1,
      lerpColor(theme.background, theme.bgBottom, band / (bands - 1)));
  }

  const random = staticRandom();
  for (let i = 0; i < theme.starCount; i += 1) {
    const x = Math.floor(random() * ctx.width);
    const y = Math.floor(random() * ctx.height);
    const level = STAR_LEVELS[Math.floor(random() * STAR_LEVELS.length)]!;
    surface.rect(x, y, x + 1, y + 1, level);
  }

  // 1px 静态基准线：无光晕、无滚动、无透视线，与被否掉的地平线光带划清界限。
  surface.rect(0, theme.baselineY, ctx.width, theme.baselineY + 1, theme.baseline);

  return surface.data.slice();
}
