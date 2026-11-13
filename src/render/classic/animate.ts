/**
 * classic 帧序列：把贡献日历本身画成敌人方阵。
 *
 * 与 invader 共享同一份 `Level` / `Action[]` 契约和 `render/motion.ts` 的逐帧时间线，
 * 但用独立的 `classicMotion` 节奏（按自有旧仓 `8d63e8a` 的速度比例换算，
 * 见 ADR 0000 第 23 节）。飞船、子弹、爆炸画法也按该旧仓重画。
 * 允许多弹齐飞，命中只在子弹到达帧结算（第 24 节）；
 * 方块每次命中退化一档绿、热度决定初始档位（第 27 节）；
 * 静态渐变底图只算一次、每帧复用（第 28 节）。
 * 只留四档绿方块、飞船、子弹与命中爆炸，不画星点 / HUD。
 */

import { createSurface } from '../codec/raster.js';
import type { Action, Frame, Level, RenderContext } from '../../contract/action.js';
import { classicMotion, expand, type BulletFlight, type Phase } from '../motion.js';
import { classicLayout, classicTheme, levelIndexOfHeat, type ClassicTheme } from './theme.js';
import { createBackdrop } from './backdrop.js';

interface Burst {
  x: number;
  y: number;
  age: number;
  angles: readonly number[];
  /** 打爆的大爆炸 5 帧、未致死的小爆炸 2 帧（旧仓 0.4s / 0.12s 的帧换算） */
  lifetime: number;
  maxRadius: number;
}

interface State {
  remaining: Map<string, number>;
  byCell: Map<string, { key: string; heat: number; tier: number }>;
  shipX: number;
  bullets: readonly BulletFlight[];
  bursts: Burst[];
}

interface Placement {
  column: number;
  row: number;
}

type Surface = ReturnType<typeof createSurface>;
type Layout = ReturnType<typeof classicLayout>;

function step(state: State): void {
  state.bursts = state.bursts
    .map((burst) => ({ ...burst, age: burst.age + 1 }))
    .filter((burst) => burst.age < burst.lifetime);
}

/** 子弹：3 段递减拖尾（在下方）+ 4 层叠色的竖直黄色胶囊。 */
function drawBullet(surface: Surface, x: number, y: number, theme: ClassicTheme, cell: number): void {
  const gap = Math.max(2, cell * 0.17);
  const halfH = Math.max(4, cell * 0.33);
  for (let i = 3; i >= 1; i -= 1) {
    const ty = y + i * gap;
    surface.rect(x - 1, ty - 3, x + 1, ty + 3, theme.bullet, 0.5 / i);
  }
  surface.rect(x - 3, y - halfH - 2, x + 3, y + halfH + 2, theme.bullet, 0.3);
  surface.rect(x - 2, y - halfH - 1, x + 2, y + halfH + 1, theme.bullet, 0.45);
  surface.rect(x - 1, y - halfH, x + 1, y + halfH, theme.bullet, 0.7);
  surface.rect(x, y - halfH + 1, x + 1, y + halfH - 1, theme.bullet);
}

function drawBursts(surface: Surface, bursts: readonly Burst[], theme: ClassicTheme): void {
  for (const burst of bursts) {
    const progress = burst.age / burst.lifetime;
    const fade = Math.max(0, 1 - progress);
    const radius = 2 + progress * burst.maxRadius;
    const size = Math.max(1, Math.round(3 * (1 - progress * 0.5)));
    for (const angle of burst.angles) {
      const px = burst.x + Math.cos(angle) * radius;
      const py = burst.y + Math.sin(angle) * radius;
      surface.rect(px - size, py - size, px + size, py + size, theme.bullet, fade);
    }
  }
}

/** 飞船：半透明双翼三角 + 翼尖竖条 + 菱形机身（按 cell 缩放，不照搬 12px 绝对尺寸）。 */
function drawShip(surface: Surface, cx: number, top: number, cell: number, theme: ClassicTheme): void {
  const ix = Math.floor(cx);
  const wing = Math.max(5, cell * 0.67);
  for (const side of [-1, 1] as const) {
    surface.polygon([
      [ix + side * 2, top + cell * 0.5],
      [ix + side * wing, top + cell * 0.8],
      [ix + side * wing, top + cell],
      [ix + side * 2, top + cell * 0.7],
    ], theme.ship, 0.5);
    surface.rect(
      ix + side * wing - 1, top + cell * 0.5,
      ix + side * wing + 1, top + cell,
      theme.ship,
    );
  }
  surface.polygon([
    [ix, top],
    [ix - cell * 0.25, top + cell * 0.7],
    [ix, top + cell],
    [ix + cell * 0.25, top + cell * 0.7],
  ], theme.ship);
}

function place(layout: Layout, target: Placement | undefined, fallbackColumn: number, theme: ClassicTheme): { x: number; y: number } {
  const column = target?.column ?? fallbackColumn;
  return {
    x: layout.gridLeft + column * layout.stepX + layout.cell / 2,
    y: layout.gridTop + (target?.row ?? 0) * layout.stepY + layout.cell / 2,
  };
}

function applyFrame(
  phase: Phase,
  state: State,
  targets: ReadonlyMap<string, Placement>,
  layout: Layout,
  theme: ClassicTheme,
): void {
  state.shipX = phase.shipX;
  state.bullets = phase.bullets;

  for (const action of phase.impacts) {
    const key = action.target ?? '';
    const left = state.remaining.get(key) ?? 0;
    const dead = left > 0 && left - 1 === 0;
    state.remaining.set(key, Math.max(0, left - 1));

    const at = place(layout, targets.get(key), action.column ?? Math.round(state.shipX), theme);
    const count = dead ? 8 : 4;
    state.bursts.push({
      x: at.x,
      y: at.y,
      age: 0,
      angles: Array.from({ length: count }, (_, i) => (i * Math.PI * 2) / count),
      lifetime: dead ? 5 : 2,
      maxRadius: dead ? layout.cell * 1.25 : layout.cell * 0.6,
    });
  }
}

function paint(
  surface: Surface,
  backdrop: Uint8ClampedArray,
  level: Level,
  ctx: RenderContext,
  state: State,
  theme: ClassicTheme,
  targets: ReadonlyMap<string, Placement>,
): Frame {
  const layout = classicLayout(level.columns, ctx, theme);
  surface.data.set(backdrop);

  for (let column = 0; column < level.columns; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const x = layout.gridLeft + column * layout.stepX;
      const y = layout.gridTop + row * layout.stepY;
      const cell = state.byCell.get(`${column}:${row}`);
      let color = theme.empty;
      if (cell) {
        const left = state.remaining.get(cell.key) ?? 0;
        if (left <= 0) {
          color = theme.cleared;
        } else {
          // 每次命中退化一档：base 至少为 tier-1，保证 remaining 从 tier 降到 1
          // 的过程中每次都严格降档，不会因热度低而卡在暗档不动。
          const base = Math.max(levelIndexOfHeat(cell.heat, theme), cell.tier - 1);
          const hits = cell.tier - left;
          const index = Math.max(0, Math.min(theme.levels.length - 1, base - hits));
          color = theme.levels[index]!;
        }
      }
      surface.rect(x, y, x + layout.cell, y + layout.cell, color);
    }
  }

  drawBursts(surface, state.bursts, theme);
  for (const bullet of state.bullets) {
    const at = place(layout, targets.get(bullet.action.target ?? ''),
      bullet.action.column ?? Math.round(state.shipX), theme);
    const fromY = theme.shipY - 8;
    const y = fromY + (at.y - fromY) * bullet.progress;
    drawBullet(surface, at.x, y, theme, layout.cell);
  }

  const shipX = layout.gridLeft + state.shipX * layout.stepX + layout.stepX / 2;
  drawShip(surface, shipX, theme.shipY, layout.cell, theme);

  return {
    width: ctx.width,
    height: ctx.height,
    data: surface.data.slice(),
    delayMs: Math.max(20, Math.round(1000 / ctx.fps)),
  };
}

export function* animate(
  level: Level,
  actions: Iterable<Action>,
  ctx: RenderContext,
  theme: ClassicTheme = classicTheme,
): Generator<Frame, void, undefined> {
  const surface = createSurface(ctx.width, ctx.height);
  const backdrop = createBackdrop(ctx, theme);
  const layout = classicLayout(level.columns, ctx, theme);
  const startX = Math.floor(level.columns / 2);
  const state: State = {
    remaining: new Map(),
    byCell: new Map(),
    shipX: startX,
    bullets: [],
    bursts: [],
  };

  const targets = new Map<string, Placement>();
  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      state.byCell.set(`${target.column}:${target.row}`, {
        key: target.key,
        heat: target.heat,
        tier: target.tier,
      });
      targets.set(target.key, { column: target.column, row: target.row });
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, backdrop, level, ctx, state, theme, targets);
  for (const phase of expand(actions, startX, classicMotion)) {
    if (emitted >= ctx.maxFrames) return;
    applyFrame(phase, state, targets, layout, theme);
    step(state);
    yield emit();
    emitted += 1;
  }
}
