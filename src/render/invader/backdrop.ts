/**
 * 静态底图：纯色 + 少量固定灰度星点（ADR 0000 第 19 节）。
 *
 * 星点位置由固定种子生成、逐帧不变，因此不产生差分、不会撑大脏矩形。
 * 渐变、星云、CRT 扫描线、三层视差星点、地平线光带与透视线已全部移除。
 */

import { createSurface } from '../codec/raster.js';
import type { RenderContext } from '../../contract/action.js';
import type { Theme } from './theme.js';

function staticRandom(): () => number {
  let state = 0x2f6e2b1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function createBackdrop(ctx: RenderContext, theme: Theme): Uint8ClampedArray {
  const surface = createSurface(ctx.width, ctx.height);
  surface.fill(theme.background);

  const random = staticRandom();
  for (let i = 0; i < theme.starCount; i += 1) {
    const x = Math.floor(random() * ctx.width);
    const y = Math.floor(random() * ctx.height);
    const level = Math.round(70 + random() * 120);
    surface.rect(x, y, x + 1, y + 1, [level, level, level]);
  }

  return surface.data.slice();
}
