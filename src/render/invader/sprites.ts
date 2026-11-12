/**
 * 自绘精灵与点阵字形（v2）。
 *
 * 美术画法参考了两个自有旧仓：6×6 外星人轮廓、菱形机身 + 半透明机翼、
 * 粒子爆炸、视差星空、5×7 点阵字形。这里全部重画成 8×8 三型两帧，
 * 并加入 HUD、拖尾与清空标记；不引入任何图像库或字体文件。
 */

import type { createSurface } from '../codec/raster.js';
import type { Point, RGB } from '../codec/types.js';
import type { EnemyKind } from '../../contract/action.js';
import type { Layout, Theme } from './theme.js';

type Surface = ReturnType<typeof createSurface>;

const GLYPH_W = 5;
const GLYPH_H = 7;
const ADVANCE = GLYPH_W + 1;

/** 5×7 点阵，取自自有旧实现（纯美术资产，非玩法设计）。 */
const GLYPHS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
});

export function textWidth(text: string, scale = 1): number {
  return text.length * ADVANCE * scale;
}

export function drawText(
  surface: Surface,
  text: string,
  x: number,
  y: number,
  color: RGB,
  scale = 1,
): void {
  let cursor = x;
  for (const char of text.toUpperCase()) {
    const glyph = GLYPHS[char];
    if (glyph) {
      for (let row = 0; row < GLYPH_H; row += 1) {
        const bits = glyph[row] ?? '';
        for (let col = 0; col < GLYPH_W; col += 1) {
          if (bits[col] !== '#') continue;
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
    cursor += ADVANCE * scale;
  }
}

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

/** 点阵按格子缩放；cell ≥ 8 时每个点至少 1px，形状不会退化成竖线。 */
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
  const main = color;
  const light = shade(color, 1.35);
  const dark = shade(color, 0.55);
  for (let row = 0; row < pattern.length; row += 1) {
    const bits = pattern[row] ?? '';
    for (let col = 0; col < bits.length; col += 1) {
      const ch = bits[col];
      if (ch === '.') continue;
      const paint = ch === '+' ? light : ch === '-' ? dark : main;
      const x0 = x + col * px;
      const y0 = y + row * px;
      surface.rect(x0, y0, x0 + Math.ceil(px), y0 + Math.ceil(px), paint);
    }
  }
}

/** 菱形机身 + 两片半透明后掠翼 + 翼尖实色 + 座舱高光。 */
export function drawShip(surface: Surface, cx: number, top: number, cell: number, theme: Theme): void {
  const bodyHalf = Math.max(3, cell * 0.42);
  const wingHalf = Math.max(5, cell * 0.8);
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

/** 子弹头 + 渐隐拖尾。 */
export function drawBullet(surface: Surface, x: number, y: number, theme: Theme): void {
  surface.rect(x - 2, y - 2, x + 2, y + 3, theme.bullet);
  for (let i = 1; i <= 4; i += 1) {
    surface.rect(x - 1, y + 3 + (i - 1) * 3, x + 1, y + 5 + (i - 1) * 3, theme.bulletTrail, 1 - i * 0.2);
  }
}

export interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
  speed: number;
}

export function drawStars(surface: Surface, stars: readonly Star[], theme: Theme): void {
  for (const star of stars) {
    const level = Math.round(255 * star.brightness);
    const color: RGB = [
      Math.round((theme.star[0] * level) / 255),
      Math.round((theme.star[1] * level) / 255),
      Math.round((theme.star[2] * level) / 255),
    ];
    surface.rect(star.x, star.y, star.x + star.size, star.y + star.size, color, star.brightness);
  }
}

export interface Burst {
  x: number;
  y: number;
  age: number;
  angles: readonly number[];
}

/** 粒子沿固定角度扩散、随进度淡出。角度来自种子随机，保证可复现。 */
export function drawBursts(surface: Surface, bursts: readonly Burst[], theme: Theme): void {
  for (const burst of bursts) {
    const progress = burst.age / theme.explosionFrames;
    const fade = Math.max(0, 1 - progress);
    const radius = 2 + progress * Math.max(6, theme.cellMax);
    const size = Math.max(1, 2.4 * fade);
    for (const angle of burst.angles) {
      const px = burst.x + Math.cos(angle) * radius;
      const py = burst.y + Math.sin(angle) * radius;
      const color = burst.age < 2 ? theme.explosionCore : theme.explosion;
      surface.rect(px - size, py - size, px + size, py + size, color, fade);
    }
  }
}

export interface HudState {
  score: number;
  combo: number;
  wave: number;
  waves: number;
  cleared: number;
  total: number;
}

export function drawHud(
  surface: Surface,
  width: number,
  layout: Layout,
  state: HudState,
  theme: Theme,
): void {
  const pad = layout.pad;
  const y = layout.hudY + 3;
  drawText(surface, `SCORE ${String(state.score).padStart(4, '0')}`, pad, y, theme.hud, 1);
  const comboText = `COMBO ${String(state.combo).padStart(2, '0')}`;
  drawText(surface, comboText, pad + 96, y, theme.hud, 1);
  const waveText = `WAVE ${String(state.wave).padStart(2, '0')}/${String(state.waves).padStart(2, '0')}`;
  drawText(surface, waveText, width - pad - textWidth(waveText), y, theme.hudDim, 1);

  const barY = layout.hudY + 12;
  const barWidth = width - pad * 2;
  surface.rect(pad, barY, pad + barWidth, barY + 2, theme.grid);
  const filled = state.total > 0 ? Math.round((barWidth * state.cleared) / state.total) : 0;
  if (filled > 0) surface.rect(pad, barY, pad + filled, barY + 2, theme.ship);
}

/** 网格：已清空的列用暗色 + 一个小十字标记，避免画面左半边全空。 */
export function drawGrid(
  surface: Surface,
  layout: Layout,
  columns: number,
  clearedColumns: ReadonlySet<number>,
  theme: Theme,
): void {
  for (let column = 0; column < columns; column += 1) {
    const cleared = clearedColumns.has(column);
    const color = cleared ? theme.gridCleared : theme.grid;
    for (let row = 0; row < theme.rows; row += 1) {
      const x = layout.pad + column * layout.cell;
      const y = layout.gridTop + row * layout.rowH;
      surface.roundedRect(x, y, x + layout.cell - 1, y + layout.rowH - 1, 1, color, 0.82);
    }
    if (cleared) {
      const x = layout.pad + column * layout.cell + layout.cell / 2;
      const y = layout.gridTop + layout.gridHeight / 2;
      surface.rect(x - 1, y - 3, x + 1, y + 3, theme.hudDim, 0.55);
      surface.rect(x - 3, y - 1, x + 3, y + 1, theme.hudDim, 0.55);
    }
  }
}
