
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 绘制层 —— **参考 czl9707/gh-space-shooter 的 `renderer.py` + 各 drawable 的 `draw()` 重写**。
 *
 * 逐条对照：
 *   - `Enemy.draw`：圆角方块，颜色按**剩余血量**取 `enemy_colors[health]`
 *   - `Bullet.draw`：3 段递减 alpha 的拖尾 + 本体叠 4 层（0.6/0.4/0.2 偏移），
 *     画成一个**竖直的黄色胶囊**，不是我们之前那种小点 + 矩形
 *   - `Explosion.draw`：`progress` 驱动半径扩张 + 淡出，粒子尺寸随 progress 变小
 *   - `Starfield.draw`：亮度直接当灰度画（我们之前是查表 + 视差 3 层，多余）
 *   - `Ship.draw`：机身菱形 + 半透明三角翼 + 翼尖竖条，几何一字不改
 *
 * 保留我们自己的两样（参考没有、但你之前明确要的）：底部 HUD 与 5×7 点阵字。
 */
import { createCanvas, type Canvas, type SKRSContext2D } from '@napi-rs/canvas';
import {
  BACKGROUND,
  BULLET_COLOR,
  BULLET_TRAIL_SPACING,
  BULLET_TRAILING_LENGTH,
  CELL,
  COLS,
  GRID_COLOR,
  HEIGHT,
  ROWS,
  SHIP_COLOR,
  SHIP_ROW,
  WIDTH,
  cellX,
  cellY,
  rgba,
} from './config.js';
import { drawText, textWidth } from './font.js';
import { ENEMY_COLORS } from './types.js';
import type { Engine } from './engine.js';

/** 一帧的像素数据。 */
export interface Frame {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

let board: Canvas | null = null;

/** 预渲染背景（纯色 + 空格子），每帧 drawImage 一次即可。 */
function getBoard(): Canvas {
  if (board) return board;
  const cv = createCanvas(WIDTH, HEIGHT);
  const d = cv.getContext('2d');
  d.fillStyle = rgba(BACKGROUND);
  d.fillRect(0, 0, WIDTH, HEIGHT);
  // 空格子当网格（参考：grid_color 的圆角方块）
  d.fillStyle = rgba(GRID_COLOR);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      d.beginPath();
      d.roundRect(cellX(x), cellY(y), CELL, CELL, 2);
      d.fill();
    }
  }
  board = cv;
  return cv;
}

export class Renderer {
  private canvas: Canvas;
  private ctx: SKRSContext2D;

  constructor(private game: Engine) {
    this.canvas = createCanvas(WIDTH, HEIGHT);
    this.ctx = this.canvas.getContext('2d');
  }

  render(): Frame {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(getBoard(), 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    this.drawStars(ctx);
    // 绘制顺序对齐 GameState.draw：星空 → 敌人 → 爆炸 → 子弹 → 飞船
    this.drawEnemies(ctx);
    this.drawExplosions(ctx);
    this.drawBullets(ctx);
    this.drawShip(ctx);
    this.drawHud(ctx);

    const img = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    return { data: img.data, width: WIDTH, height: HEIGHT };
  }

  /** 参考 `Starfield.draw`：亮度直接当灰度。 */
  private drawStars(ctx: SKRSContext2D): void {
    for (const s of this.game.stars) {
      const b = Math.round(255 * s.brightness);
      ctx.fillStyle = `rgba(${b},${b},${b},1)`;
      ctx.fillRect(Math.round(cellX(s.x)), Math.round(cellY(s.y)), s.size, s.size);
    }
  }

  /** 参考 `Enemy.draw`：颜色按剩余血量取（掉血就变暗一档）。 */
  private drawEnemies(ctx: SKRSContext2D): void {
    for (const e of this.game.enemies) {
      const color = ENEMY_COLORS[e.health] ?? ENEMY_COLORS[1];
      ctx.fillStyle = rgba(color);
      ctx.beginPath();
      ctx.roundRect(cellX(e.x), cellY(e.y), CELL, CELL, 2);
      ctx.fill();
    }
  }

  /** 参考 `Bullet.draw`：3 段拖尾 + 本体 4 层叠加。 */
  private drawBullets(ctx: SKRSContext2D): void {
    for (const b of this.game.bullets) {
      // 拖尾在**下方**（子弹向上飞）
      for (let i = 0; i < BULLET_TRAILING_LENGTH; i++) {
        const trailY = b.y + (i + 1) * BULLET_TRAIL_SPACING;
        const fade = ((i + 1) / BULLET_TRAILING_LENGTH) * 0.5; // 0.5 / 0.33 / 0.17
        this.drawBullet(ctx, b.x, trailY, fade, 0);
      }
      // 本体：4 层叠加（0.6 / 0.4 / 0.2 偏移 + 最实的一层）
      this.drawBullet(ctx, b.x, b.y, 0.3, 0.6);
      this.drawBullet(ctx, b.x, b.y, 0.4, 0.4);
      this.drawBullet(ctx, b.x, b.y, 0.5, 0.2);
      this.drawBullet(ctx, b.x, b.y, 1.0, 0);
    }
  }

  /** 参考 `Bullet._draw_bullet`：一个竖直胶囊（宽 1~2，高 8~9）。 */
  private drawBullet(
    ctx: SKRSContext2D,
    bx: number,
    by: number,
    fade: number,
    offset: number,
  ): void {
    const x = cellX(bx) + CELL / 2;
    const y = cellY(by) + CELL / 2;
    const rX = 0.5 + offset;
    const rY = 4 + offset;
    ctx.fillStyle = rgba(BULLET_COLOR, fade * 255);
    ctx.fillRect(x - rX, y - rY, rX * 2, rY * 2);
  }

  /** 参考 `Explosion.draw`：粒子沿固定角度向外扩散、半径随 progress 涨、整体淡出。 */
  private drawExplosions(ctx: SKRSContext2D): void {
    for (const ex of this.game.explosions) {
      const progress = ex.elapsed / ex.duration;
      const fade = 1 - progress;
      const cx = cellX(ex.x) + CELL / 2;
      const cy = cellY(ex.y) + CELL / 2;
      const distance = progress * ex.maxRadius;
      // 粒子随 progress 变小：int((1 - progress*0.5) * 3) + 1
      const size = Math.trunc((1 - progress * 0.5) * 3) + 1;
      ctx.fillStyle = rgba(BULLET_COLOR, 255 * fade);
      for (let i = 0; i < ex.angles.length; i++) {
        const px = Math.trunc(cx + distance * Math.cos(ex.angles[i]));
        const py = Math.trunc(cy + distance * Math.sin(ex.angles[i]));
        ctx.fillRect(px - size, py - size, size * 2, size * 2);
      }
    }
  }

  /**
   * 飞船 —— 几何沿用参考项目 `drawables/ship.py` 的画法（Galaga 风）。
   * 参考是 `cell_size` 相对尺寸：机身菱形 ±3 / 70% 高，双翼 ±8 宽，翼尖 2px 竖条。
   */
  private drawShip(ctx: SKRSContext2D): void {
    const g = this.game;
    const x = cellX(g.ship.x);
    const y = cellY(SHIP_ROW);
    const size = CELL;
    const cx = x + size / 2;
    const wing = 8;
    // 参考用整型 x（子弹也用 int(ship.x)），这里跟随
    const ix = Math.floor(cx);

    // 双翼（半透明三角）
    ctx.fillStyle = rgba(SHIP_COLOR, 128);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(ix + s * 2, y + size * 0.5);
      ctx.lineTo(ix + s * wing, y + size * 0.8);
      ctx.lineTo(ix + s * wing, y + size);
      ctx.lineTo(ix + s * 2, y + size * 0.7);
      ctx.closePath();
      ctx.fill();
    }
    // 翼尖实心竖条
    ctx.fillStyle = rgba(SHIP_COLOR);
    for (const s of [-1, 1]) {
      ctx.fillRect(ix + s * wing - 1, y + size * 0.5, 2, size * 0.5);
      ctx.fillRect(ix + s * wing, y + size * 0.5, 1, size * 0.5);
    }
    // 机身菱形
    ctx.beginPath();
    ctx.moveTo(ix, y);
    ctx.lineTo(ix - 3, y + size * 0.7);
    ctx.lineTo(ix, y + size);
    ctx.lineTo(ix + 3, y + size * 0.7);
    ctx.closePath();
    ctx.fill();
  }

  /** HUD：我们自己加的（参考没有）。 */
  private drawHud(ctx: SKRSContext2D): void {
    const g = this.game;
    drawText(ctx, 8, 6, `SCORE ${g.score}`, [200, 210, 230]);
    const name = `@${g.contrib.username}`;
    drawText(ctx, WIDTH - 8 - textWidth(name), 6, name, [120, 130, 150]);
  }
}
