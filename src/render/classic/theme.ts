/**
 * classic 渲染器主题：还原重写前那种「贡献日历就是敌人」的极简观感。
 *
 * 深黑底 + 四档绿方块 + 底部小飞船，不再画星点、分数与署名 HUD
 * （ADR 0000 第 17 节）。飞船与子弹配色、画法按自有旧仓 `8d63e8a`
 * 比例对齐（第 23 节），画布几何仍是本项目自定的 1024×256。
 */

import type { RGB } from '../codec/types.js';
import type { RenderContext } from '../../contract/action.js';

export interface ClassicTheme {
  background: RGB;
  /** 无贡献的空格 */
  empty: RGB;
  /** 已被清掉的格子 */
  cleared: RGB;
  /** 活跃度四档绿，由暗到亮 */
  levels: readonly RGB[];
  ship: RGB;
  bullet: RGB;
  pad: number;
  gap: number;
  gridTop: number;
  shipY: number;
}

export const classicTheme: Readonly<ClassicTheme> = {
  background: [10, 13, 20],
  empty: [18, 24, 32],
  cleared: [13, 18, 25],
  levels: [
    [22, 55, 40],
    [35, 105, 62],
    [46, 160, 67],
    [57, 211, 83],
  ],
  ship: [68, 147, 248],
  bullet: [255, 223, 0],
  pad: 24,
  gap: 2,
  gridTop: 56,
  shipY: 216,
};

export interface ClassicLayout {
  cell: number;
  stepX: number;
  stepY: number;
  gridLeft: number;
  gridTop: number;
}

/** 53 列铺满画布宽度，方块保持正方形；行数固定 7（周）。 */
export function classicLayout(
  columns: number,
  ctx: RenderContext,
  theme: ClassicTheme,
): ClassicLayout {
  const usable = ctx.width - theme.pad * 2;
  const stepX = Math.max(4, Math.floor(usable / Math.max(1, columns)));
  const cell = Math.max(3, stepX - theme.gap);
  const stepY = Math.min(
    stepX,
    Math.max(cell + theme.gap, Math.floor((theme.shipY - theme.gridTop - 12) / 7)),
  );
  return {
    cell,
    stepX,
    stepY,
    gridLeft: Math.max(theme.pad, Math.floor((ctx.width - stepX * Math.max(1, columns)) / 2)),
    gridTop: theme.gridTop,
  };
}

/** 活跃度 → 四档绿，与 invader 的 tier 分档无关。 */
export function levelOfHeat(heat: number, theme: ClassicTheme): RGB {
  // 贡献值是长尾分布，线性分档会让大半画面落在最暗一档；sqrt 提亮中低活跃度
  const index = Math.min(
    theme.levels.length - 1,
    Math.floor(Math.sqrt(heat) * theme.levels.length),
  );
  return theme.levels[Math.max(0, index)]!;
}
