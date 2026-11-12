/**
 * 自研主题：几何、配色、深空分层背景与动效参数（v3）。
 *
 * 全览大画布：默认 1024×256，53 列 × 16px 一屏看完。
 * 8×8 点阵精灵每点正好 2px，不会溢出格子互相糊在一起。
 * 常量、布局与配色全部本项目自定，不沿用任何上游项目的数值或节奏。
 */

import type { RGB } from '../codec/types.js';
import type { EnemyKind, RenderContext } from '../../contract/action.js';

export interface Theme {
  /** 背景垂直渐变（上 → 下） */
  bgTop: RGB;
  bgBottom: RGB;
  /** 两团星云的主色，靠多层低透明椭圆叠出光晕 */
  nebulaA: RGB;
  nebulaB: RGB;
  /** 地平线光带 */
  horizon: RGB;
  horizonGlow: RGB;
  /** CRT 扫描线 */
  scanline: RGB;
  scanlineAlpha: number;
  grid: RGB;
  gridCleared: RGB;
  ship: RGB;
  shipWing: RGB;
  cockpit: RGB;
  thruster: RGB;
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
  pad: number;
  hudHeight: number;
  shipHeight: number;
  gap: number;
  cellMin: number;
  cellMax: number;
  rows: number;
  starCount: number;
  starLayers: number;
  starSpeed: number;
  bulletFrames: number;
  explosionFrames: number;
  /** 飞船残影保留的帧数 */
  trailFrames: number;
}

export const defaultTheme: Readonly<Theme> = {
  bgTop: [5, 8, 18],
  bgBottom: [14, 22, 44],
  nebulaA: [38, 72, 138],
  nebulaB: [92, 48, 132],
  horizon: [76, 152, 214],
  horizonGlow: [28, 60, 108],
  scanline: [4, 7, 16],
  scanlineAlpha: 0.07,
  grid: [26, 38, 60],
  gridCleared: [13, 20, 34],
  ship: [110, 190, 255],
  shipWing: [58, 112, 198],
  cockpit: [235, 250, 255],
  thruster: [255, 178, 92],
  bullet: [255, 232, 140],
  bulletTrail: [255, 138, 62],
  hud: [198, 220, 248],
  hudDim: [92, 116, 156],
  star: [196, 212, 240],
  explosion: [255, 162, 74],
  explosionCore: [255, 246, 210],
  drone: [92, 220, 132],
  cluster: [116, 224, 255],
  boss: [255, 148, 194],
  pad: 8,
  hudHeight: 22,
  shipHeight: 22,
  gap: 16,
  cellMin: 8,
  cellMax: 16,
  rows: 7,
  starCount: 150,
  starLayers: 3,
  starSpeed: 0.5,
  bulletFrames: 3,
  explosionFrames: 6,
  trailFrames: 4,
};

export function colorForKind(theme: Theme, kind: EnemyKind): RGB {
  return kind === 'drone' ? theme.drone : kind === 'cluster' ? theme.cluster : theme.boss;
}

export interface Layout {
  pad: number;
  cell: number;
  rowH: number;
  gridLeft: number;
  gridTop: number;
  gridHeight: number;
  shipY: number;
  hudY: number;
  gridWidth: number;
  horizonY: number;
}

/**
 * 列宽同时受宽度与高度约束；默认 53 列时 cell=16。
 * 网格水平居中，两侧留白用于星云与光带，画面不会左重右轻。
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
  const gridWidth = cell * Math.max(1, columns);
  const gridTop = theme.pad + theme.hudHeight;
  return {
    pad: theme.pad,
    cell,
    rowH: cell,
    gridLeft: Math.max(theme.pad, Math.floor((ctx.width - gridWidth) / 2)),
    gridTop,
    gridHeight: cell * theme.rows,
    gridWidth,
    shipY: gridTop + cell * theme.rows + theme.gap,
    hudY: theme.pad,
    horizonY: ctx.height - 52,
  };
}
