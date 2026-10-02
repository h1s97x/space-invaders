
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 常量 —— **参考 czl9707/gh-space-shooter 的 `constants.py` 与 `render_context.py`**。
 *
 * 所有速度都是「格/秒」，所有时长都是「秒」，与帧率解耦（沿用参考的做法）。
 * 画布尺寸也因此和参考完全一致：52 周 × (12+3) + 2×40 = 860，10 × 15 + 80 = 230。
 */
export type Rgb = readonly [number, number, number];

// ── 画面几何（参考 RenderContext.darkmode）─────────────────────────────────
export const CELL = 12;
export const GAP = 3;
export const PADDING = 40;

export const COLS = 52; // 参考用 52 周（我们原本 53，这里跟参考一致）
export const ROWS = 7;

export const PITCH = CELL + GAP; // 15px
/** 飞船所在的行（格坐标）。参考 `SHIP_POSITION_Y = NUM_DAYS + 3 = 10`。 */
export const SHIP_ROW = ROWS + 3;

export const GRID_W = COLS * PITCH;
export const WIDTH = GRID_W + PADDING * 2; // 860
export const HEIGHT = SHIP_ROW * PITCH + PADDING * 2; // 230

/** 格坐标 → 像素坐标（参考 `RenderContext.get_cell_position`）。 */
export function cellX(cx: number): number {
  return PADDING + cx * PITCH;
}
export function cellY(cy: number): number {
  return PADDING + cy * PITCH;
}

/** 把 RGB 补成 canvas 的 rgba() 字符串。 */
export function rgba(color: Rgb, alpha = 255): string {
  const a = Math.max(0, Math.min(255, Math.round(alpha))) / 255;
  return `rgba(${color[0]},${color[1]},${color[2]},${a})`;
}

// ── 调色板（参考 RenderContext.darkmode）────────────────────────────────────
export const BACKGROUND: Rgb = [13, 17, 23];
export const GRID_COLOR: Rgb = [22, 27, 34];
export const SHIP_COLOR: Rgb = [68, 147, 248];
/** 参考的子弹是**黄色**（255,223,0），不是我之前用的淡黄白。 */
export const BULLET_COLOR: Rgb = [255, 223, 0];

// ── 速度与时长（参考 constants.py，单位：格/秒 或 秒）────────────────────
/** 参考 `DEFAULT_FPS = 40`。 */
export const DEFAULT_FPS = 40;

/** 飞船横移：12.5 格/秒。 */
export const SHIP_SPEED = 12.5;
/** 子弹：7.5 格/秒。 */
export const BULLET_SPEED = 7.5;
/** 子弹拖尾：3 段，段间距 0.15 格（参考 `BULLET_TRAILING_LENGTH/SPACING`）。 */
export const BULLET_TRAILING_LENGTH = 3;
export const BULLET_TRAIL_SPACING = 0.15;
/** 两炮之间的冷却：0.2 秒（参考 `SHIP_SHOOT_COOLDOWN`）。 */
export const SHIP_SHOOT_COOLDOWN = 0.2;

/** 爆炸（参考 `EXPLOSION_*`）：小爆炸 4 粒/半径 10/0.12s，大爆炸 8 粒/半径 20/0.4s。 */
export const EXPLOSION_PARTICLE_COUNT_SMALL = 4;
export const EXPLOSION_PARTICLE_COUNT_LARGE = 8;
export const EXPLOSION_MAX_RADIUS_SMALL = 10;
export const EXPLOSION_MAX_RADIUS_LARGE = 20;
export const EXPLOSION_DURATION_SMALL = 0.12;
export const EXPLOSION_DURATION_LARGE = 0.4;

/** 星空（参考 `STAR_SPEED_MIN/MAX`）：越亮越快 = 越近。 */
export const STAR_SPEED_MIN = 1.0;
export const STAR_SPEED_MAX = 2.5;
export const STAR_COUNT = 100;

/**
 * 每帧的时间步长（秒）。
 *
 * 参考项目写的是 `delta_time = 3.0 / fps`（`animator.py:41`）—— 注意这**不是**
 * `1/fps`，而是它的 3 倍，等于给所有速度乘了一个 1.5 的加速系数。这是参考自己的
 * 节奏设定，这里**原样沿用**，不做"修正"。
 */
export const deltaTimeFor = (fps: number): number => 3.0 / fps;

/** GIF 每帧时长（毫秒）。参考写的是 `1000*2 // fps`（同样不是 `1000/fps`）。 */
export const frameMsFor = (fps: number): number => Math.floor((1000 * 2) / fps);

// ── 玩法参数（自己加的，参考没有）──────────────────────────────────────────
/** 收尾最多再跑多少帧（参考 `animator.py:91` 的 `force_kill_countdown = 100`）。 */
export const FORCE_KILL_FRAMES = 100;
/** 收尾后额外输出几帧（参考 `animator.py:101` 的 `for _ in range(5)`）。 */
export const TAIL_FRAMES = 5;
export const DEFAULT_COLORS = 32;