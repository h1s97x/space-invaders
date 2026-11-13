/**
 * classic 帧序列：把贡献日历本身画成敌人方阵。
 *
 * 与 invader 共享同一份 `Level` / `Action[]` 契约和 `render/motion.ts` 的逐帧阶段，
 * 但不画外星人、星点、分数 / 署名 HUD —— 只留深黑底、四档绿方块、蓝色小飞船、
 * 逐帧上移的子弹与命中爆炸（ADR 0000 第 17、18 节）。
 */

import { createSurface } from '../codec/raster.js';
import type { Action, Frame, Level, RenderContext } from '../../contract/action.js';
import { expand, type Phase } from '../motion.js';
import { classicLayout, classicTheme, levelOfHeat, type ClassicTheme } from './theme.js';

interface Bullet {
  x: number;
  fromY: number;
  toY: number;
  progress: number;
}

interface Burst {
  x: number;
  y: number;
  age: number;
  angles: readonly number[];
}

interface State {
  remaining: Map<string, number>;
  byCell: Map<string, { key: string; heat: number }>;
  shipX: number;
  bullet: Bullet | null;
  bursts: Burst[];
}

interface Placement {
  column: number;
  row: number;
}

function step(state: State): void {
  state.bursts = state.bursts
    .map((burst) => ({ ...burst, age: burst.age + 1 }))
    .filter((burst) => burst.age < 4);
}

function drawBullet(
  surface: ReturnType<typeof createSurface>,
  bullet: Bullet,
  theme: ClassicTheme,
): void {
  const y = bullet.fromY + (bullet.toY - bullet.fromY) * bullet.progress;
  for (let i = 3; i >= 1; i -= 1) {
    surface.rect(bullet.x - 1, y + i * 6 - 3, bullet.x + 1, y + i * 6 + 3, theme.bullet, 0.45 / i);
  }
  surface.rect(bullet.x - 2, y - 6, bullet.x + 2, y + 6, theme.bullet, 0.4);
  surface.rect(bullet.x - 1, y - 5, bullet.x + 1, y + 5, theme.bullet);
}

function drawBursts(
  surface: ReturnType<typeof createSurface>,
  bursts: readonly Burst[],
  theme: ClassicTheme,
): void {
  for (const burst of bursts) {
    const fade = Math.max(0, 1 - burst.age / 4);
    const radius = 2 + burst.age * 3;
    for (const angle of burst.angles) {
      const px = burst.x + Math.cos(angle) * radius;
      const py = burst.y + Math.sin(angle) * radius;
      surface.rect(px - 1, py - 1, px + 1, py + 1, theme.bullet, fade);
    }
  }
}

function paint(
  surface: ReturnType<typeof createSurface>,
  level: Level,
  ctx: RenderContext,
  state: State,
  theme: ClassicTheme,
): Frame {
  const layout = classicLayout(level.columns, ctx, theme);
  surface.fill(theme.background);

  for (let column = 0; column < level.columns; column += 1) {
    for (let row = 0; row < 7; row += 1) {
      const x = layout.gridLeft + column * layout.stepX;
      const y = layout.gridTop + row * layout.stepY;
      const cell = state.byCell.get(`${column}:${row}`);
      let color = theme.empty;
      if (cell) {
        color = (state.remaining.get(cell.key) ?? 0) > 0
          ? levelOfHeat(cell.heat, theme)
          : theme.cleared;
      }
      surface.rect(x, y, x + layout.cell, y + layout.cell, color);
    }
  }

  drawBursts(surface, state.bursts, theme);
  if (state.bullet) drawBullet(surface, state.bullet, theme);

  const shipX = layout.gridLeft + state.shipX * layout.stepX + layout.stepX / 2;
  surface.polygon(
    [[shipX, theme.shipY], [shipX - 7, theme.shipY + 11], [shipX + 7, theme.shipY + 11]],
    theme.ship,
  );

  return {
    width: ctx.width,
    height: ctx.height,
    data: surface.data.slice(),
    delayMs: Math.max(20, Math.round(1000 / ctx.fps)),
  };
}

function applyPhase(
  phase: Phase,
  state: State,
  targets: ReadonlyMap<string, Placement>,
  layout: { gridLeft: number; gridTop: number; stepX: number; stepY: number; cell: number },
  theme: ClassicTheme,
): void {
  switch (phase.kind) {
    case 'start':
      return;
    case 'travel':
      state.shipX = phase.from + (phase.to - phase.from) * phase.progress;
      return;
    case 'launch':
    case 'flight': {
      const key = phase.action.target ?? '';
      const at = targets.get(key);
      const column = at?.column ?? (phase.kind === 'launch' ? phase.column : Math.round(state.shipX));
      state.bullet = {
        x: layout.gridLeft + column * layout.stepX + layout.cell / 2,
        fromY: theme.shipY - 8,
        toY: layout.gridTop + (at?.row ?? 0) * layout.stepY + layout.cell / 2,
        progress: phase.progress,
      };
      return;
    }
    case 'impact': {
      const key = phase.action.target ?? '';
      const left = state.remaining.get(key) ?? 0;
      const dead = left > 0 && left - 1 === 0;
      state.remaining.set(key, Math.max(0, left - 1));
      state.bullet = null;

      const at = targets.get(key);
      const column = at?.column ?? Math.round(state.shipX);
      const count = dead ? 9 : 4;
      state.bursts.push({
        x: layout.gridLeft + column * layout.stepX + layout.cell / 2,
        y: layout.gridTop + (at?.row ?? 0) * layout.stepY + layout.cell / 2,
        age: 0,
        angles: Array.from({ length: count }, (_, i) => (i * Math.PI * 2) / count),
      });
      return;
    }
    case 'cooldown':
    case 'tail':
      return;
  }
}

export function* animate(
  level: Level,
  actions: Iterable<Action>,
  ctx: RenderContext,
  theme: ClassicTheme = classicTheme,
): Generator<Frame, void, undefined> {
  const surface = createSurface(ctx.width, ctx.height);
  const layout = classicLayout(level.columns, ctx, theme);
  const startX = Math.floor(level.columns / 2);
  const state: State = {
    remaining: new Map(),
    byCell: new Map(),
    shipX: startX,
    bullet: null,
    bursts: [],
  };

  const targets = new Map<string, Placement>();
  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      state.byCell.set(`${target.column}:${target.row}`, { key: target.key, heat: target.heat });
      targets.set(target.key, { column: target.column, row: target.row });
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, level, ctx, state, theme);
  for (const phase of expand(actions, startX)) {
    if (emitted >= ctx.maxFrames) return;
    applyPhase(phase, state, targets, layout, theme);
    if (phase.kind !== 'start') step(state);
    yield emit();
    emitted += 1;
  }
}
