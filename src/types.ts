
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 数据结构 —— **参考 czl9707/gh-space-shooter 的 `game/drawables/` 与 `strategies/`**。
 *
 * 最重要的一条：**坐标是「格坐标」而不是像素坐标**。
 *   - `Enemy.x` = 列号（整数，0..COLS-1），`Enemy.y` = 行号（整数，0..ROWS-1）
 *   - `Bullet.x` = **整数列号**，只有 `y` 是浮点
 *
 * 正因为子弹的 x 被量化成整数列，它**永远不会横向打偏** —— 命中判定就是
 * `enemy.x === bullet.x && enemy.y >= bullet.y`，没有"打空"这个概念。
 * 之前我们用像素坐标 + `colUnder()`，才会出现"飞船卡在两列之间 2px 缝里、
 * 子弹从缝中穿过"这类���根本不该存在的问题。
 */
import type { Rgb } from './config.js';

/** 敌人 = 一个贡献格子。血量 = 贡献等级（参考 `Enemy.health`）。 */
export class Enemy {
  constructor(
    public x: number,
    public y: number,
    public health: number,
  ) {}

  get alive(): boolean {
    return this.health > 0;
  }

  get cx(): number {
    return this.x;
  }
  get cy(): number {
    return this.y;
  }

  /** 挨一发。返回 'dead' 表示这一下打死了它（用于决定放哪种爆炸）。 */
  takeDamage(): 'hit' | 'dead' {
    this.health -= 1;
    return this.health <= 0 ? 'dead' : 'hit';
  }
}

/** 子弹。`x` 是整数列号，`y` 是浮点格坐标（向上飞）。 */
export class Bullet {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

/** 爆炸（参考 `Explosion`：固定角度的粒子向外扩散 + 淡出）。 */
export class Explosion {
  elapsed = 0;
  constructor(
    public x: number,
    public y: number,
    public readonly size: 'small' | 'large',
    public readonly duration: number,
    public readonly maxRadius: number,
    public readonly particleCount: number,
    public readonly angles: number[],
  ) {}
}

/** 视差星点（参考 `Starfield.Star`）。坐标也是格坐标。 */
export class Star {
  constructor(
    public x: number,
    public y: number,
    public brightness: number,
    public size: number,
    public speed: number,
  ) {}
}

/**
 * 飞船（参考 `drawables/ship.py`）。
 *
 * 匀速滑向目标列（`SHIP_SPEED` 格/秒），**到位才停**；开火与移动完全解耦，
 * 由 `canTakeAction()`（不移动 且 冷却好了）统一裁决。
 */
export class Ship {
  /** 出生在正中间（参考 `Ship.__init__` 的 `x = 25`，52 列的正中）。 */
  x: number;
  targetX: number;
  shootCooldown = 0;

  constructor(startX: number) {
    this.x = startX;
    this.targetX = startX;
  }

  moveTo(x: number): void {
    this.targetX = x;
  }

  isMoving(): boolean {
    return this.x !== this.targetX;
  }

  canShoot(): boolean {
    return this.shootCooldown <= 0;
  }

  /** 匀速逼近目标：位移按 `min()` 夹住，绝不越过（参考 `Ship.animate`）。 */
  animate(deltaTime: number, speed: number): void {
    const dx = speed * deltaTime;
    if (this.x < this.targetX) this.x = Math.min(this.x + dx, this.targetX);
    else if (this.x > this.targetX) this.x = Math.max(this.x - dx, this.targetX);

    if (this.shootCooldown > 0) this.shootCooldown -= deltaTime;
  }
}

/**
 * 一个离散动作（参考 `strategies/base_strategy.Action`）：
 * 飞船滑到 `x` 那一列，`shoot` 为真则到位后开一炮。
 */
export class Action {
  constructor(
    public x: number,
    public shoot = false,
  ) {}
}

/** 贡献矩阵。 */
export class Contributions {
  constructor(
    public rows: number[][],
    public username: string,
    public total = 0,
  ) {}
}

export const Strategy = {
  COLUMN: 'column',
  ROW: 'row',
  RANDOM: 'random',
  CHAOS: 'chaos',
} as const;
export type Strategy = (typeof Strategy)[keyof typeof Strategy];

export function isStrategy(v: string): v is Strategy {
  return v === 'column' || v === 'row' || v === 'random' || v === 'chaos';
}

/** 敌人配色按剩余血量取（参考 `RenderContext.enemy_colors`，键是 health）。 */
export const ENEMY_COLORS: Record<number, Rgb> = {
  1: [0, 109, 50],
  2: [38, 166, 65],
  3: [57, 211, 83],
  4: [87, 242, 135],
};