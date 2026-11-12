/**
 * 帧序列生成（v3）：Level + Action[] → 完整 RGBA 帧。
 *
 * 深空分层底图只算一次；三层星点、地平线、两帧精灵、激光、爆炸、
 * 飞船滑行 + 残影 + 尾焰逐帧叠加。所有随机来自 level.seed 的自研 xorshift。
 * 只认 contract/ 的 Level 与 Action，不 import 具体玩法模块。
 */

import { createSurface } from '../codec/raster.js';
import { enemyKindOf, type Action, type Frame, type Level, type RenderContext, type Tier } from '../../contract/action.js';
import { colorForKind, defaultTheme, layoutFor, type Layout, type Theme } from './theme.js';
import { createBackdrop, createStars, driftStars, drawHorizon } from './backdrop.js';
import {
  drawBursts,
  drawEnemy,
  drawGrid,
  drawHud,
  drawLaser,
  drawShip,
  drawShipTrail,
  drawStars,
  drawText,
  drawThruster,
  type Burst,
  type Star,
} from './sprites.js';

interface Beam {
  x: number;
  fromY: number;
  toY: number;
  age: number;
}

interface State {
  remaining: Map<string, number>;
  clearedColumns: Set<number>;
  columnTargets: Map<number, number>;
  shipX: number;
  shipTarget: number;
  history: number[];
  score: number;
  combo: number;
  wave: number;
  cleared: number;
  bursts: Burst[];
  beam: Beam | null;
  stars: Star[];
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

function step(state: State, ctx: RenderContext, theme: Theme): void {
  driftStars(state.stars, ctx, state.random);

  state.bursts = state.bursts
    .map((burst) => ({ ...burst, age: burst.age + 1 }))
    .filter((burst) => burst.age < theme.explosionFrames);
  if (state.beam) {
    state.beam.age += 1;
    if (state.beam.age > theme.bulletFrames) state.beam = null;
  }

  // 飞船每帧都朝目标推进一点：连续开火帧里也在滑行，轨迹才不是「瞬移」。
  const delta = state.shipTarget - state.shipX;
  if (Math.abs(delta) > 0.02) {
    state.shipX += Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0.7, Math.abs(delta) * 0.45));
  } else {
    state.shipX = state.shipTarget;
  }
  state.history.push(state.shipX);
  if (state.history.length > theme.trailFrames) state.history.shift();
}

function paint(
  surface: ReturnType<typeof createSurface>,
  backdrop: Uint8ClampedArray,
  level: Level,
  ctx: RenderContext,
  state: State,
  layout: Layout,
  theme: Theme,
  frameIndex: number,
): Frame {
  surface.data.set(backdrop);
  drawStars(surface, state.stars, theme);
  drawHorizon(surface, ctx, layout, theme, frameIndex);
  drawGrid(surface, layout, level.columns, state.clearedColumns, theme);

  const bob: 0 | 1 = frameIndex % 18 < 9 ? 0 : 1;
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
        bob,
      );
    }
  }

  if (state.beam) {
    const intensity = Math.max(0, 1 - state.beam.age / (theme.bulletFrames + 1));
    drawLaser(surface, state.beam.x, state.beam.fromY, state.beam.toY, intensity, theme);
  }
  drawBursts(surface, state.bursts, theme);

  const shipCx = layout.gridLeft + state.shipX * layout.cell + layout.cell / 2;
  drawShipTrail(surface, state.history, layout, theme);
  drawShip(surface, shipCx, layout.shipY, layout.cell, theme);
  drawThruster(surface, shipCx, layout.shipY, layout.cell, theme, frameIndex);

  const total = level.waves.reduce((sum, wave) => sum + wave.targets.length, 0);
  drawHud(surface, ctx.width, layout, {
    score: state.score,
    combo: state.combo,
    wave: state.wave,
    waves: level.columns,
    cleared: state.cleared,
    total,
  }, theme);

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
    clearedColumns: new Set(),
    columnTargets: new Map(),
    shipX: startX,
    shipTarget: startX,
    history: [startX],
    score: 0,
    combo: 0,
    wave: 0,
    cleared: 0,
    bursts: [],
    beam: null,
    stars: createStars(ctx, theme, random),
    random,
  };

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      state.columnTargets.set(target.column, (state.columnTargets.get(target.column) ?? 0) + 1);
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, backdrop, level, ctx, state, layout, theme, emitted);
  yield emit();
  emitted += 1;

  for (const action of actions) {
    if (emitted >= ctx.maxFrames) return;

    if (action.kind === 'move' && action.column !== undefined) {
      state.shipTarget = action.column;
      state.wave = Math.max(state.wave, action.column + 1);
    } else if (action.kind === 'fire' && action.target !== undefined) {
      const left = state.remaining.get(action.target) ?? 0;
      const next = Math.max(0, left - 1);
      state.remaining.set(action.target, next);
      state.combo = action.combo ?? state.combo + 1;
      state.score += 10 + state.combo;

      let targetRow = 0;
      let targetColumn = action.column ?? state.shipTarget;
      for (const wave of level.waves) {
        const found = wave.targets.find((target) => target.key === action.target);
        if (found) {
          targetRow = found.row;
          targetColumn = found.column;
          break;
        }
      }
      const cx = layout.gridLeft + targetColumn * layout.cell + layout.cell / 2;
      const cy = layout.gridTop + targetRow * layout.rowH + layout.cell / 2;
      state.beam = { x: cx, fromY: layout.shipY, toY: cy, age: 0 };

      if (left > 0 && next === 0) {
        state.cleared += 1;
        state.wave = Math.max(state.wave, targetColumn + 1);
        state.bursts.push({
          x: cx,
          y: cy,
          age: 0,
          angles: Array.from({ length: 9 }, () => random() * Math.PI * 2),
        });
        const allGone = level.waves
          .flatMap((wave) => wave.targets)
          .filter((target) => target.column === targetColumn)
          .every((target) => (state.remaining.get(target.key) ?? 0) === 0);
        if (allGone) state.clearedColumns.add(targetColumn);
      }
    }

    step(state, ctx, theme);
    // rest 不单独出帧：状态继续推进，避免大量重复画面撑大 GIF
    if (action.kind !== 'rest') {
      yield emit();
      emitted += 1;
    }

    if (action.kind === 'finish' && emitted < ctx.maxFrames) {
      for (let tail = 0; tail < 4 && emitted < ctx.maxFrames; tail += 1) {
        step(state, ctx, theme);
        yield emit();
        emitted += 1;
      }
    }
  }

  if (emitted < ctx.maxFrames) {
    drawText(surface, 'CLEAR', ctx.width / 2 - 36, layout.gridTop + layout.gridHeight / 2, theme.hud, 3);
    yield { width: ctx.width, height: ctx.height, data: surface.data.slice(), delayMs: 120 };
  }
}
