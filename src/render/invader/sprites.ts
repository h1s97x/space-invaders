/**
 * 自绘精灵：怪物、飞船、子弹与爆炸。
 *
 * 美术画法参考了两个自有旧仓：6×6 外星人轮廓、菱形机身 + 半透明机翼、
 * 粒子爆炸。这里重画成 8×8 三型两帧，不引入任何图像库或字体文件。
 * 网格、残影、尾焰、点阵字形等零数据装饰已移除（ADR 0000 第 17、19 节）。
 */

import type { createSurface } from '../codec/raster.js';
import type { Point, RGB } from '../codec/types.js';
import type { EnemyKind } from '../../contract/action.js';
import type { Theme } from './theme.js';

type Surface = ReturnType<typeof createSurface>;

/** 8×8 点阵：'#' 主色、'+' 高光、'-' 阴影、'.' 透明。三型各有两帧。 */
const ENEMY_SPRITES: Readonly<Record<EnemyKind, readonly (readonly string[])[]>> = Object.freeze({
  drone: [
    ['..####..', '.######.', '##+##+##', '########', '.##..##.', '##.##.##', '..#..#..', '.#....#.'],
    ['..####..', '.######.', '##+##+##', '########', '##.##.##', '.#....#.', '#......#', '........'],
  ],
  cluster: [
    ['.#....#.', '..####..', '.######.', '##+##+##', '########', '.#.##.#.', '#......#', '..#..#..'],
    ['#......#', '.#....#.', '..####..', '##+##+##', '########', '#.#..#.#', '..#..#..', '.#....#.'],
  ],
  boss: [
    ['#..##..#', '.######.', '##+##+##', '########', '########', '##.##.##', '.#....#.', '#......#'],
    ['#......#', '#..##..#', '.######.', '##+##+##', '########', '.######.', '##.##.##', '#......#'],
  ],
});

function shade(color: RGB, factor: number): RGB {
  return [
    Math.min(255, Math.round(color[0] * factor)),
    Math.min(255, Math.round(color[1] * factor)),
    Math.min(255, Math.round(color[2] * factor)),
  ];
}

/** 点阵按格子精确缩放：8 点 × (cell/8) 正好等于 cell，不溢出到邻格。 */
export function drawEnemy(
  surface: Surface,
  x: number,
  y: number,
  cell: number,
  kind: EnemyKind,
  color: RGB,
  frame: 0 | 1,
): void {
  const pattern = ENEMY_SPRITES[kind][frame] ?? ENEMY_SPRITES[kind][0]!;
  const px = Math.max(1, cell / 8);
  const light = shade(color, 1.35);
  const dark = shade(color, 0.55);
  for (let row = 0; row < pattern.length; row += 1) {
    const bits = pattern[row] ?? '';
    for (let col = 0; col < bits.length; col += 1) {
      const ch = bits[col];
      if (ch === '.') continue;
      const paint = ch === '+' ? light : ch === '-' ? dark : color;
      const x0 = x + col * px;
      const y0 = y + row * px;
      surface.rect(x0, y0, x0 + px, y0 + px, paint);
    }
  }
}

/** 菱形机身 + 两片半透明后掠翼 + 翼尖实色 + 座舱高光。 */
export function drawShip(surface: Surface, cx: number, top: number, cell: number, theme: Theme): void {
  const bodyHalf = Math.max(4, cell * 0.42);
  const wingHalf = Math.max(7, cell * 0.82);
  const nose = top;
  const widest = top + cell * 0.62;
  const tail = top + cell * 1.15;

  for (const side of [-1, 1] as const) {
    const wing: Point[] = [
      [cx + side * bodyHalf * 0.7, top + cell * 0.4],
      [cx + side * wingHalf, top + cell * 0.95],
      [cx + side * wingHalf, tail],
      [cx + side * bodyHalf * 0.7, top + cell * 0.72],
    ];
    surface.polygon(wing, theme.shipWing, 0.5);
    surface.rect(
      cx + side * wingHalf - (side < 0 ? cell * 0.1 : 0),
      top + cell * 0.45,
      cx + side * wingHalf + (side > 0 ? cell * 0.1 : 0),
      tail,
      theme.ship,
    );
  }

  surface.polygon(
    [[cx, nose], [cx - bodyHalf, widest], [cx, tail], [cx + bodyHalf, widest]],
    theme.ship,
  );
  surface.rect(
    cx - Math.max(1, cell * 0.09),
    top + cell * 0.2,
    cx + Math.max(1, cell * 0.09),
    top + cell * 0.5,
    theme.cockpit,
    0.9,
  );
}

/**
 * 子弹：竖直胶囊本体（4 层叠色）+ 下方 3 段递减拖尾。
 * 画法取自有旧仓的弹体资产，尺寸与衰减均为本项目自定。
 */
export function drawBullet(surface: Surface, x: number, y: number, theme: Theme): void {
  const halfH = 5;
  const gap = 6;
  for (let i = 3; i >= 1; i -= 1) {
    const ty = y + i * gap;
    surface.rect(x - 1, ty - 3, x + 1, ty + 3, theme.bulletTrail, 0.45 / i);
  }
  surface.rect(x - 3, y - halfH - 2, x + 3, y + halfH + 2, theme.bullet, 0.2);
  surface.rect(x - 2, y - halfH - 1, x + 2, y + halfH + 1, theme.bullet, 0.4);
  surface.rect(x - 1, y - halfH, x + 1, y + halfH, theme.bullet, 0.72);
  surface.rect(x, y - halfH + 1, x + 1, y + halfH - 1, theme.explosionCore);
}

export interface Burst {
  x: number;
  y: number;
  age: number;
  angles: readonly number[];
  /** 命中未致死的小爆炸更快散完，打爆的大爆炸持续更久 */
  lifetime: number;
  maxRadius: number;
}

export function drawBursts(surface: Surface, bursts: readonly Burst[], theme: Theme): void {
  for (const burst of bursts) {
    const progress = burst.age / burst.lifetime;
    const fade = Math.max(0, 1 - progress);
    const radius = 3 + progress * burst.maxRadius;
    const size = Math.max(1, 3 * fade);
    for (const angle of burst.angles) {
      const px = burst.x + Math.cos(angle) * radius;
      const py = burst.y + Math.sin(angle) * radius;
      const color = burst.age < 2 ? theme.explosionCore : theme.explosion;
      surface.rect(px - size, py - size, px + size, py + size, color, fade);
    }
  }
}
