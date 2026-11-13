/**
 * 自研主题：几何、配色与动效参数。
 *
 * 全览大画布：默认 1024×256，53 列 × 16px 一屏看完。
 * 8×8 点阵精灵每点正好 2px，不会溢出格子互相糊在一起。
 * 常量、布局与配色全部本项目自定，不沿用任何上游项目的数值或节奏。
 * 零数据装饰已清零（第 19 节），背景与飞船以 classic 为基准统一
 * （第 26、29 节），见 `docs/adr/0000-rewrite-baseline.md`。
 */

import type { RGB } from '../codec/types.js';
import type { EnemyKind, RenderContext } from '../../contract/action.js';

export interface Theme {
  /** 深渐变的上沿色（与 classic 一致） */
  background: RGB;
  /** 深渐变的下沿色 */
  bgBottom: RGB;
  /** 渐变量化色带数；有限色带才不会打满 256 色表 */
  bandCount: number;
  ship: RGB;
  bullet: RGB;
  bulletTrail: RGB;
  explosion: RGB;
  explosionCore: RGB;
  drone: RGB;
  cluster: RGB;
  boss: RGB;
  pad: number;
  /** 网格上方留白（构图不变） */
  topInset: number;
  shipHeight: number;
  gap: number;
  cellMin: number;
  cellMax: number;
  rows: number;
  /** 打爆的大爆炸持续帧数 */
  explosionFrames: number;
}

export const defaultTheme: Readonly<Theme> = {
  background: [10, 13, 20],
  bgBottom: [19, 25, 38],
  bandCount: 8,
  ship: [68, 147, 248],
  bullet: [255, 232, 140],
  bulletTrail: [255, 138, 62],
  explosion: [255, 162, 74],
  explosionCore: [255, 246, 210],
  drone: [92, 220, 132],
  cluster: [116, 224, 255],
  boss: [255, 148, 194],
  pad: 8,
  topInset: 22,
  shipHeight: 22,
  gap: 16,
  cellMin: 8,
  cellMax: 16,
  rows: 7,
  explosionFrames: 6,
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
  gridWidth: number;
  shipY: number;
}

/**
 * 列宽同时受宽度与高度约束；默认 53 列时 cell=16。
 * 网格水平居中，两侧留白，画面不会左重右轻。
 */
export function layoutFor(columns: number, ctx: RenderContext, theme: Theme): Layout {
  const usableWidth = ctx.width - theme.pad * 2;
  const usableHeight =
    ctx.height - theme.pad * 2 - theme.topInset - theme.gap - theme.shipHeight;
  const cell = Math.max(
    theme.cellMin,
    Math.min(
      theme.cellMax,
      Math.floor(usableWidth / Math.max(1, columns)),
      Math.floor(usableHeight / theme.rows),
    ),
  );
  const gridWidth = cell * Math.max(1, columns);
  const gridTop = theme.pad + theme.topInset;
  return {
    pad: theme.pad,
    cell,
    rowH: cell,
    gridLeft: Math.max(theme.pad, Math.floor((ctx.width - gridWidth) / 2)),
    gridTop,
    gridWidth,
    shipY: gridTop + cell * theme.rows + theme.gap,
  };
}
