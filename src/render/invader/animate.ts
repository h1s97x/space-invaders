/**
 * 帧序列生成：Level + Action[] → 完整 RGBA 帧。
 *
 * 静态底图（纯色 + 固定星点）只算一次；怪物、子弹、爆炸、飞船逐帧叠加。
 * 画面里只有这四类携带数据，其余装饰已清零（ADR 0000 第 19 节）。
 * 逐帧阶段由 render/motion.ts 展开：到位才开火、弹道走完才命中。
 * 只认 contract/ 的 Level 与 Action，不 import 具体玩法模块。
 */

import { createSurface } from '../codec/raster.js';
import { enemyKindOf, type Action, type Frame, type Level, type RenderContext, type Tier } from '../../contract/action.js';
import { colorForKind, defaultTheme, layoutFor, type Layout, type Theme } from './theme.js';
import { createBackdrop } from './backdrop.js';
import { expand, type Phase } from '../motion.js';
import {
  drawBullet,
  drawBursts,
  drawEnemy,
  drawShip,
  type Burst,
} from './sprites.js';

interface Bullet {
  x: number;
  fromY: number;
  toY: number;
  progress: number;
}

interface State {
  remaining: Map<string, number>;
  shipX: number;
  bursts: Burst[];
  bullet: Bullet | null;
  random: () => number;
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
}

function step(state: State): void {
  state.bursts = state.bursts
    .map((burst) => ({ ...burst, age: burst.age + 1 }))
    .filter((burst) => burst.age < burst.lifetime);
}

interface Placement {
  column: number;
  row: number;
}

function place(layout: Layout, target: Placement | undefined, fallbackColumn: number): { x: number; y: number } {
  const column = target?.column ?? fallbackColumn;
  return {
    x: layout.gridLeft + column * layout.cell + layout.cell / 2,
    y: layout.gridTop + (target?.row ?? 0) * layout.rowH + layout.cell / 2,
  };
}

function applyPhase(
  phase: Phase,
  state: State,
  layout: Layout,
  theme: Theme,
  targets: ReadonlyMap<string, Placement>,
  random: () => number,
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
      const at = place(layout, targets.get(key), phase.kind === 'launch' ? phase.column : Math.round(state.shipX));
      state.bullet = { x: at.x, fromY: layout.shipY, toY: at.y, progress: phase.progress };
      return;
    }
    case 'impact': {
      const key = phase.action.target ?? '';
      const left = state.remaining.get(key) ?? 0;
      const next = Math.max(0, left - 1);
      state.remaining.set(key, next);
      state.bullet = null;

      const at = place(layout, targets.get(key), Math.round(state.shipX));
      const dead = left > 0 && next === 0;
      state.bursts.push({
        x: at.x,
        y: at.y,
        age: 0,
        angles: Array.from({ length: dead ? 9 : 4 }, () => random() * Math.PI * 2),
        lifetime: dead ? theme.explosionFrames : 3,
        maxRadius: dead ? theme.cellMax * 1.5 : theme.cellMax * 0.6,
      });
      return;
    }
    case 'cooldown':
    case 'tail':
      return;
  }
}

function paint(
  surface: ReturnType<typeof createSurface>,
  backdrop: Uint8ClampedArray,
  level: Level,
  ctx: RenderContext,
  state: State,
  layout: Layout,
  theme: Theme,
): Frame {
  surface.data.set(backdrop);

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      const left = state.remaining.get(target.key) ?? 0;
      if (left <= 0) continue;
      const kind = enemyKindOf(Math.min(3, left) as Tier);
      drawEnemy(
        surface,
        layout.gridLeft + target.column * layout.cell,
        layout.gridTop + target.row * layout.rowH,
        layout.cell,
        kind,
        colorForKind(theme, kind),
        0,
      );
    }
  }

  drawBursts(surface, state.bursts, theme);
  if (state.bullet) {
    const y = state.bullet.fromY + (state.bullet.toY - state.bullet.fromY) * state.bullet.progress;
    drawBullet(surface, state.bullet.x, y, theme);
  }

  const shipCx = layout.gridLeft + state.shipX * layout.cell + layout.cell / 2;
  drawShip(surface, shipCx, layout.shipY, layout.cell, theme);

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
  theme: Theme = defaultTheme,
): Generator<Frame, void, undefined> {
  const surface = createSurface(ctx.width, ctx.height);
  const backdrop = createBackdrop(ctx, theme);
  const layout = layoutFor(level.columns, ctx, theme);
  const random = seededRandom(level.seed);
  const startX = Math.floor(level.columns / 2);
  const state: State = {
    remaining: new Map(),
    shipX: startX,
    bursts: [],
    bullet: null,
    random,
  };

  const targets = new Map<string, Placement>();
  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      targets.set(target.key, { column: target.column, row: target.row });
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, backdrop, level, ctx, state, layout, theme);
  for (const phase of expand(actions, startX)) {
    if (emitted >= ctx.maxFrames) return;
    applyPhase(phase, state, layout, theme, targets, random);
    if (phase.kind !== 'start') step(state);
    yield emit();
    emitted += 1;
  }
}
