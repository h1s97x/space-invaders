/**
 * 帧序列生成（v2）：Level + Action[] → 完整 RGBA 帧。
 *
 * 每帧是一张完整低分辨率画面，交给 codec 统一放大与编码。
 * 只认 contract/ 的 Level 与 Action，不 import 具体玩法模块。
 * 所有随机都来自 level.seed 派生的自研 xorshift，同一输入永远同一段动画。
 */

import { createSurface } from '../codec/raster.js';
import { enemyKindOf, type Action, type Frame, type Level, type RenderContext, type Tier } from '../../contract/action.js';
import { colorForKind, defaultTheme, layoutFor, type Layout, type Theme } from './theme.js';
import {
  drawBullet,
  drawBursts,
  drawEnemy,
  drawGrid,
  drawHud,
  drawShip,
  drawStars,
  drawText,
  type Burst,
  type Star,
} from './sprites.js';

interface State {
  remaining: Map<string, number>;
  clearedColumns: Set<number>;
  columnTargets: Map<number, number>;
  shipX: number;
  shipTarget: number;
  score: number;
  combo: number;
  wave: number;
  cleared: number;
  bursts: Burst[];
  bullet: { column: number; row: number; age: number } | null;
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

function makeStars(ctx: RenderContext, theme: Theme, random: () => number): Star[] {
  return Array.from({ length: theme.starCount }, () => {
    const brightness = 0.3 + random() * 0.7;
    return {
      x: random() * ctx.width,
      y: random() * ctx.height,
      brightness,
      size: random() < 0.82 ? 1 : 2,
      speed: theme.starSpeed * (0.4 + brightness),
    };
  });
}

function step(state: State, ctx: RenderContext, theme: Theme): void {
  for (const star of state.stars) {
    star.y += star.speed;
    if (star.y > ctx.height) {
      star.y = -2;
      star.x = state.random() * ctx.width;
    }
  }
  state.bursts = state.bursts
    .map((burst) => ({ ...burst, age: burst.age + 1 }))
    .filter((burst) => burst.age < theme.explosionFrames);
  if (state.bullet) {
    state.bullet.age += 1;
    if (state.bullet.age >= theme.bulletFrames) state.bullet = null;
  }
  state.shipX += (state.shipTarget - state.shipX) * 0.36;
}

function paint(
  surface: ReturnType<typeof createSurface>,
  level: Level,
  ctx: RenderContext,
  state: State,
  layout: Layout,
  theme: Theme,
  frameIndex: number,
): Frame {
  surface.fill(theme.background);
  drawStars(surface, state.stars, theme);
  drawGrid(surface, layout, level.columns, state.clearedColumns, theme);

  const bob: 0 | 1 = frameIndex % 18 < 9 ? 0 : 1;
  for (const wave of level.waves) {
    for (const target of wave.targets) {
      const left = state.remaining.get(target.key) ?? 0;
      if (left <= 0) continue;
      const kind = enemyKindOf(Math.min(3, left) as Tier);
      drawEnemy(
        surface,
        layout.pad + target.column * layout.cell,
        layout.gridTop + target.row * layout.rowH,
        layout.cell,
        kind,
        colorForKind(theme, kind),
        bob,
      );
    }
  }

  if (state.bullet) {
    const progress = state.bullet.age / theme.bulletFrames;
    const x = layout.pad + state.bullet.column * layout.cell + layout.cell / 2;
    const from = layout.shipY;
    const to = layout.gridTop + state.bullet.row * layout.rowH + layout.cell / 2;
    drawBullet(surface, x, from + (to - from) * (1 - progress), theme);
  }

  drawBursts(surface, state.bursts, theme);
  drawShip(surface, layout.pad + state.shipX * layout.cell + layout.cell / 2, layout.shipY, layout.cell, theme);

  const total = level.waves.reduce((sum, wave) => sum + wave.targets.length, 0);
  drawHud(
    surface,
    ctx.width,
    layout,
    {
      score: state.score,
      combo: state.combo,
      wave: state.wave,
      waves: level.columns,
      cleared: state.cleared,
      total,
    },
    theme,
  );

  return { width: ctx.width, height: ctx.height, data: surface.data.slice(), delayMs: Math.max(20, Math.round(1000 / ctx.fps)) };
}

export function* animate(
  level: Level,
  actions: Iterable<Action>,
  ctx: RenderContext,
  theme: Theme = defaultTheme,
): Generator<Frame, void, undefined> {
  const surface = createSurface(ctx.width, ctx.height);
  const layout = layoutFor(level.columns, ctx, theme);
  const random = seededRandom(level.seed);
  const state: State = {
    remaining: new Map(),
    clearedColumns: new Set(),
    columnTargets: new Map(),
    shipX: Math.floor(level.columns / 2),
    shipTarget: Math.floor(level.columns / 2),
    score: 0,
    combo: 0,
    wave: 0,
    cleared: 0,
    bursts: [],
    bullet: null,
    stars: makeStars(ctx, theme, random),
    random,
  };

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      state.columnTargets.set(target.column, (state.columnTargets.get(target.column) ?? 0) + 1);
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, level, ctx, state, layout, theme, emitted);
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
      state.bullet = { column: targetColumn, row: targetRow, age: 0 };

      if (left > 0 && next === 0) {
        state.cleared += 1;
        state.wave = Math.max(state.wave, targetColumn + 1);
        const cx = layout.pad + targetColumn * layout.cell + layout.cell / 2;
        const cy = layout.gridTop + targetRow * layout.rowH + layout.cell / 2;
        state.bursts.push({
          x: cx,
          y: cy,
          age: 0,
          angles: Array.from({ length: 9 }, () => random() * Math.PI * 2),
        });
        if ((state.columnTargets.get(targetColumn) ?? 0) > 0) {
          const allGone = level.waves
            .flatMap((wave) => wave.targets)
            .filter((target) => target.column === targetColumn)
            .every((target) => (state.remaining.get(target.key) ?? 0) === 0);
          if (allGone) state.clearedColumns.add(targetColumn);
        }
      }
    }

    // rest 不单独出帧：状态继续推进，避免大量重复画面撑大 GIF
    if (action.kind !== 'rest') {
      step(state, ctx, theme);
      yield emit();
      emitted += 1;
    } else {
      step(state, ctx, theme);
    }

    if (action.kind === 'finish' && emitted < ctx.maxFrames) {
      for (let tail = 0; tail < 4 && emitted < ctx.maxFrames; tail += 1) {
        step(state, ctx, theme);
        yield emit();
        emitted += 1;
      }
    }
  }

  // 收尾字幕，避免最后一帧一闪而过
  if (emitted < ctx.maxFrames) {
    drawText(surface, 'CLEAR', ctx.width / 2 - 18, layout.gridTop + layout.gridHeight / 2, theme.hud, 2);
    yield { width: ctx.width, height: ctx.height, data: surface.data.slice(), delayMs: 120 };
  }
}
