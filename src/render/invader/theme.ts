/**
 * 自研主题：几何、配色与动效参数。
 *
 * v2 的几何是为「整年 53 列」定的：默认画布 512×128（放大前），
 * 每格接近正方形，8×8 点阵精灵才有地方画形状。
 * 参考过两个自有旧仓的美术画法，但常量、布局与配色全部重新定义，
 * 不沿用任何上游项目的数值或节奏。
 */

import type { RGB } from '../codec/types.js';
import type { EnemyKind, RenderContext } from '../../contract/action.js';

export interface Theme {
  background: RGB;
  grid: RGB;
  gridCleared: RGB;
  ship: RGB;
  shipWing: RGB;
  cockpit: RGB;
  bullet: RGB;
  bulletTrail: RGB;
  hud: RGB;
  hudDim: RGB;
  star: RGB;
  explosion: RGB;
  explosionCore: RGB;
  drone: RGB;
  cluster: RGB;
  boss: RGB;
  /** 上下留白 */
  pad: number;
  /** 顶部 HUD 高度 */
  hudHeight: number;
  /** 底部飞船区高度 */
  shipHeight: number;
  /** 网格与飞船之间的空档 */
  gap: number;
  cellMin: number;
  cellMax: number;
  rows: number;
  starCount: number;
  /** 每帧星点下落像素，按亮度形成视差 */
  starSpeed: number;
  /** 一次开火的子弹存续帧数 */
  bulletFrames: number;
  /** 爆炸粒子存续帧数 */
  explosionFrames: number;
}

export const defaultTheme: Readonly<Theme> = {
  background: [8, 12, 22],
  grid: [24, 34, 52],
  gridCleared: [15, 21, 34],
  ship: [96, 178, 255],
  shipWing: [62, 116, 198],
  cockpit: [230, 248, 255],
  bullet: [255, 228, 128],
  bulletTrail: [255, 146, 64],
  hud: [190, 212, 242],
  hudDim: [86, 106, 140],
  star: [188, 204, 232],
  explosion: [255, 160, 72],
  explosionCore: [255, 244, 206],
  drone: [88, 214, 128],
  cluster: [112, 220, 252],
  boss: [255, 142, 188],
  pad: 8,
  hudHeight: 16,
  shipHeight: 16,
  gap: 10,
  cellMin: 6,
  cellMax: 16,
  rows: 7,
  starCount: 90,
  starSpeed: 0.45,
  bulletFrames: 3,
  explosionFrames: 6,
};

export function colorForKind(theme: Theme, kind: EnemyKind): RGB {
  return kind === 'drone' ? theme.drone : kind === 'cluster' ? theme.cluster : theme.boss;
}

export interface Layout {
  pad: number;
  cell: number;
  rowH: number;
  gridTop: number;
  gridHeight: number;
  shipY: number;
  hudY: number;
  /** 网格实际占用的宽度，用于进度条与居中 */
  gridWidth: number;
}

/**
 * 列宽同时受宽度与高度约束：既不能挤成 1px 竖线，也不能把 7 行拉成长条。
 * 短窗口（列数少）由 cellMax 与高度共同限制，长窗口由可用宽度决定。
 */
export function layoutFor(columns: number, ctx: RenderContext, theme: Theme): Layout {
  const usableWidth = ctx.width - theme.pad * 2;
  const usableHeight =
    ctx.height - theme.pad * 2 - theme.hudHeight - theme.gap - theme.shipHeight;
  const cell = Math.max(
    theme.cellMin,
    Math.min(
      theme.cellMax,
      Math.floor(usableWidth / Math.max(1, columns)),
      Math.floor(usableHeight / theme.rows),
    ),
  );
  const gridTop = theme.pad + theme.hudHeight;
  return {
    pad: theme.pad,
    cell,
    rowH: cell,
    gridTop,
    gridHeight: cell * theme.rows,
    gridWidth: cell * Math.max(1, columns),
    shipY: gridTop + cell * theme.rows + theme.gap,
    hudY: theme.pad,
  };
}
