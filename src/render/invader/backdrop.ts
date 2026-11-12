/**
 * 深空分层背景贴图（v3）。
 *
 * 分四层，从远到近：垂直渐变 + 星云光斑（静态，只算一次）→ CRT 扫描线（静态）
 * → 三层视差星点（逐帧漂移）→ 地平线光带与透视线（随帧轻微脉动）。
 * 全部用自研光栅图元画，不引入图像资源。
 */

import { createSurface } from '../codec/raster.js';
import type { RGB } from '../codec/types.js';
import type { RenderContext } from '../../contract/action.js';
import type { Layout, Theme } from './theme.js';
import type { Star } from './sprites.js';

type Surface = ReturnType<typeof createSurface>;

function mix(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpColor(a: RGB, b: RGB, t: number): RGB {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

/**
 * 静态底图：渐变 + 星云 + 扫描线。
 * 只在动画开始时算一次，之后每帧 `data.set(backdrop)` 复用，避免逐帧重画渐变。
 */
export function createBackdrop(ctx: RenderContext, theme: Theme): Uint8ClampedArray {
  const surface = createSurface(ctx.width, ctx.height);

  // 渐变必须量化成有限色带：逐行渐变会产生 256 种颜色，把 GIF 的 255 色表吃光，
  // 激光/尾焰/爆炸这些低频暖色会被挤掉并量化成灰蓝，动画里就完全看不见。
  const bands = 16;
  for (let band = 0; band < bands; band += 1) {
    const y0 = Math.floor((band * ctx.height) / bands);
    const y1 = Math.floor(((band + 1) * ctx.height) / bands);
    surface.rect(0, y0, ctx.width, y1, lerpColor(theme.bgTop, theme.bgBottom, band / (bands - 1)));
  }

  const blobs: ReadonlyArray<{ x: number; y: number; rx: number; ry: number; color: RGB }> = [
    { x: 0.17, y: 0.28, rx: 300, ry: 110, color: theme.nebulaA },
    { x: 0.81, y: 0.2, rx: 340, ry: 130, color: theme.nebulaB },
    { x: 0.5, y: 0.68, rx: 420, ry: 80, color: theme.nebulaA },
    { x: 0.34, y: 0.46, rx: 200, ry: 70, color: theme.nebulaB },
  ];
  for (const blob of blobs) {
    const cx = blob.x * ctx.width;
    const cy = blob.y * ctx.height;
    for (let layer = 4; layer >= 1; layer -= 1) {
      const rx = (blob.rx * layer) / 4;
      const ry = (blob.ry * layer) / 4;
      surface.roundedRect(
        cx - rx,
        cy - ry,
        cx + rx,
        cy + ry,
        Math.min(rx, ry) * 0.85,
        blob.color,
        0.035,
      );
    }
  }

  // 扫描线用固定不透明色，避免 alpha 混合再造出一批中间色
  for (let y = 0; y < ctx.height; y += 4) {
    surface.rect(0, y, ctx.width, y + 1, theme.scanline);
  }

  return surface.data.slice();
}

/** 三层星点：远层小而慢、近层大而快，形成视差。随机源可注入以保证复现。 */
export function createStars(
  ctx: RenderContext,
  theme: Theme,
  random: () => number,
): Star[] {
  return Array.from({ length: theme.starCount }, (_, index) => {
    const layer = index % theme.starLayers;
    const brightness = 0.22 + layer * 0.2 + random() * 0.24;
    return {
      x: random() * ctx.width,
      y: random() * ctx.height,
      brightness,
      size: layer === theme.starLayers - 1 ? 2 : 1,
      speed: theme.starSpeed * (0.25 + layer * 0.6),
      layer,
    };
  });
}

export function driftStars(
  stars: readonly Star[],
  ctx: RenderContext,
  random: () => number,
): void {
  for (const star of stars) {
    star.y += star.speed;
    if (star.y > ctx.height) {
      star.y = -2;
      star.x = random() * ctx.width;
    }
  }
}

/** 地平线光带 + 竖向透视线，给画面一个「地面」参照。 */
export function drawHorizon(
  surface: Surface,
  ctx: RenderContext,
  layout: Layout,
  theme: Theme,
  frameIndex: number,
): void {
  const y = layout.horizonY;
  // 光带用固定不透明色阶；alpha 脉动会不断造出新颜色，挤占调色板。
  for (let i = 0; i < 7; i += 1) {
    const color = lerpColor(theme.horizonGlow, theme.bgBottom, i / 6);
    surface.rect(0, y + i * 4, ctx.width, y + i * 4 + 4, color);
  }
  surface.rect(0, y, ctx.width, y + 1, theme.horizon);

  // 透视线随帧横向滚动：有动感但不产生新颜色
  const shift = frameIndex % 64;
  for (let x = layout.gridLeft - 64 + shift; x < layout.gridLeft + layout.gridWidth; x += 64) {
    surface.rect(x, y + 1, x + 1, ctx.height, theme.horizonGlow);
  }
}
