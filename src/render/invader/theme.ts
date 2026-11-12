/**
 * 自研主题：配色与几何。
 *
 * 全部常量由本项目定义，不沿用任何参考项目的画布尺寸、格子大小或节奏。
 */

import type { RGB } from '../codec/types.js';
import type { EnemyKind, RenderContext } from '../../contract/action.js';

export interface Theme {
  background: RGB;
  grid: RGB;
  ship: RGB;
  bullet: RGB;
  text: RGB;
  drone: RGB;
  cluster: RGB;
  boss: RGB;
  pad: number;
  cellMin: number;
  cellMax: number;
  rows: number;
  reservedBottom: number;
}

export const defaultTheme: Readonly<Theme> = {
  background: [13, 17, 23],
  grid: [26, 33, 43],
  ship: [88, 166, 255],
  bullet: [255, 214, 92],
  text: [148, 163, 184],
  drone: [57, 211, 83],
  cluster: [126, 231, 135],
  boss: [214, 245, 180],
  pad: 6,
  cellMin: 2,
  cellMax: 24,
  rows: 7,
  reservedBottom: 12,
};

export function colorForKind(theme: Theme, kind: EnemyKind): RGB {
  return kind === 'drone' ? theme.drone : kind === 'cluster' ? theme.cluster : theme.boss;
}

export interface Layout {
  pad: number;
  cell: number;
  rowH: number;
  shipY: number;
}

/**
 * 低分辨率画布的布局。
 *
 * 列宽既要设上限（日历很短时不把格子拉成横条），也必须能收缩到放得下整年：
 * 53 列 × 6px = 318px 会超出默认 240px 画布，后面的列会被画到画布外、
 * 整帧看起来是空的。`cellMin` 因此取 2，让 `fit` 真正决定长窗口的列宽。
 */
export function layoutFor(columns: number, ctx: RenderContext, theme: Theme): Layout {
  const usableWidth = ctx.width - theme.pad * 2;
  const usableHeight = ctx.height - theme.pad * 2 - theme.reservedBottom;
  return {
    pad: theme.pad,
    cell: Math.max(
      theme.cellMin,
      Math.min(theme.cellMax, Math.floor(usableWidth / Math.max(1, columns))),
    ),
    rowH: Math.max(3, Math.floor(usableHeight / theme.rows)),
    shipY: ctx.height - 10,
  };
}
