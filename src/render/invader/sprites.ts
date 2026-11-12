/**
 * 自绘点阵字形与精灵。
 *
 * 不依赖字体文件、不依赖图像库：数字是 5×7 点阵，敌人是光栅图元拼的。
 */

import type { createSurface } from '../codec/raster.js';
import type { Point, RGB } from '../codec/types.js';
import type { EnemyKind } from '../../contract/action.js';

type Surface = ReturnType<typeof createSurface>;

/** 0-9 的 5×7 点阵，够画连击计数。 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
});

/** 在画布上写一行点阵数字；scale 为整数倍，未知字符留空一格。 */
export function drawNumber(
  surface: Surface,
  text: string,
  x: number,
  y: number,
  color: RGB,
  scale = 1,
): void {
  let cursor = x;
  for (const char of text) {
    const glyph = GLYPHS[char];
    if (glyph) {
      for (let row = 0; row < glyph.length; row += 1) {
        const bits = glyph[row] ?? '';
        for (let col = 0; col < bits.length; col += 1) {
          if (bits[col] !== '1') continue;
          surface.rect(
            cursor + col * scale,
            y + row * scale,
            cursor + (col + 1) * scale,
            y + (row + 1) * scale,
            color,
          );
        }
      }
    }
    cursor += 6 * scale;
  }
}

/** 三类敌人形状不同：单机 / 三连簇 / 带棱角的大块。 */
export function drawEnemy(
  surface: Surface,
  x: number,
  y: number,
  width: number,
  height: number,
  kind: EnemyKind,
  color: RGB,
): void {
  const inset = 1;
  const x0 = x + inset;
  const y0 = y + inset;
  const x1 = x + width - inset - 1;
  const y1 = y + height - inset - 1;
  if (x1 <= x0 || y1 <= y0) return;

  if (kind === 'drone') {
    surface.roundedRect(x0, y0, x1, y1, 2, color);
    return;
  }
  if (kind === 'cluster') {
    const third = (x1 - x0) / 3;
    for (let i = 0; i < 3; i += 1) {
      surface.roundedRect(x0 + i * third, y0, x0 + (i + 1) * third - 1, y1, 1, color);
    }
    return;
  }
  const points: Point[] = [
    [x0 + (x1 - x0) / 2, y0],
    [x1, y0 + (y1 - y0) / 3],
    [x1 - 2, y1],
    [x0 + 2, y1],
    [x0, y0 + (y1 - y0) / 3],
  ];
  surface.polygon(points, color);
}

export function drawShip(surface: Surface, x: number, y: number, width: number, color: RGB): void {
  const mid = x + width / 2;
  const points: Point[] = [
    [mid, y],
    [x + width - 2, y + 6],
    [x + 2, y + 6],
  ];
  surface.polygon(points, color);
  surface.rect(mid - 1, y + 2, mid + 1, y + 4, [255, 255, 255]);
}

export function drawBullet(surface: Surface, x: number, y: number, color: RGB): void {
  surface.rect(x - 1, y, x + 1, y + 8, color);
}
