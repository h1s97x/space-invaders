/**
 * classic 帧序列：把贡献日历本身画成敌人方阵。
 *
 * 与 invader 共享同一份 `Level` / `Action[]` 契约，但完全不画外星人、
 * 星云或 HUD 进度条 —— 只保留深黑底、星点、四档绿方块、SCORE / 署名与蓝色小飞船。
 * 飞船每帧持续滑行（不是瞬移），子弹是一条短亮线，命中后方块变暗。
 */

import { createSurface } from '../codec/raster.js';
import type { Action, Frame, Level, RenderContext } from '../../contract/action.js';
import { drawText, textWidth } from '../invader/sprites.js';
import { classicLayout, classicTheme, levelOfHeat, type ClassicTheme } from './theme.js';

interface Star {
  x: number;
  y: number;
  brightness: number;
  size: number;
  speed: number;
}

interface Beam {
  x: number;
  y: number;
  age: number;
}

interface State {
  remaining: Map<string, number>;
  byCell: Map<string, { key: string; heat: number }>;
  shipX: number;
  shipTarget: number;
  score: number;
  beam: Beam | null;
  stars: Star[];
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

function makeStars(ctx: RenderContext, theme: ClassicTheme, random: () => number): Star[] {
  return Array.from({ length: theme.starCount }, () => {
    const brightness = 0.35 + random() * 0.65;
    return {
      x: random() * ctx.width,
      y: random() * ctx.height,
      brightness,
      size: random() < 0.85 ? 1 : 2,
      speed: 0.08 + brightness * 0.22,
    };
  });
}

function step(state: State, ctx: RenderContext): void {
  for (const star of state.stars) {
    star.y += star.speed;
    if (star.y > ctx.height) star.y = -2;
  }
  if (state.beam) {
    state.beam.age += 1;
    if (state.beam.age > 3) state.beam = null;
  }
  const delta = state.shipTarget - state.shipX;
  if (Math.abs(delta) > 0.02) {
    state.shipX += Math.sign(delta) * Math.min(Math.abs(delta), Math.max(0.7, Math.abs(delta) * 0.45));
  } else {
    state.shipX = state.shipTarget;
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

  for (const star of state.stars) {
    const levelValue = Math.round(255 * star.brightness);
    surface.rect(
      star.x,
      star.y,
      star.x + star.size,
      star.y + star.size,
      [
        Math.round((theme.star[0] * levelValue) / 255),
        Math.round((theme.star[1] * levelValue) / 255),
        Math.round((theme.star[2] * levelValue) / 255),
      ],
      star.brightness,
    );
  }

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

  if (state.beam) {
    const alpha = Math.max(0, 1 - state.beam.age / 4);
    surface.rect(state.beam.x - 1, state.beam.y, state.beam.x + 1, theme.shipY - 8, theme.bullet, alpha);
  }

  const shipX = layout.gridLeft + state.shipX * layout.stepX + layout.stepX / 2;
  surface.polygon(
    [[shipX, theme.shipY], [shipX - 7, theme.shipY + 11], [shipX + 7, theme.shipY + 11]],
    theme.ship,
  );

  drawText(surface, `SCORE ${String(state.score).padStart(4, '0')}`, theme.pad, theme.hudY, theme.hud, 2);
  const mark = theme.watermark.toUpperCase();
  drawText(surface, mark, ctx.width - theme.pad - textWidth(mark, 2), theme.hudY, theme.hud, 2);

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
  const layout = classicLayout(level.columns, ctx, theme);
  const random = seededRandom(level.seed);
  const startX = Math.floor(level.columns / 2);
  const state: State = {
    remaining: new Map(),
    byCell: new Map(),
    shipX: startX,
    shipTarget: startX,
    score: 0,
    beam: null,
    stars: makeStars(ctx, theme, random),
  };

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      state.remaining.set(target.key, target.tier);
      state.byCell.set(`${target.column}:${target.row}`, { key: target.key, heat: target.heat });
    }
  }

  let emitted = 0;
  const emit = (): Frame => paint(surface, level, ctx, state, theme);
  yield emit();
  emitted += 1;

  for (const action of actions) {
    if (emitted >= ctx.maxFrames) return;

    if (action.kind === 'move' && action.column !== undefined) {
      state.shipTarget = action.column;
    } else if (action.kind === 'fire' && action.target !== undefined) {
      const left = state.remaining.get(action.target) ?? 0;
      state.remaining.set(action.target, Math.max(0, left - 1));
      state.score += 10;

      let column = action.column ?? state.shipTarget;
      let row = 0;
      for (const wave of level.waves) {
        const found = wave.targets.find((target) => target.key === action.target);
        if (found) {
          column = found.column;
          row = found.row;
          break;
        }
      }
      state.beam = {
        x: layout.gridLeft + column * layout.stepX + layout.cell / 2,
        y: layout.gridTop + row * layout.stepY + layout.cell / 2,
        age: 0,
      };
    }

    step(state, ctx);
    if (action.kind !== 'rest') {
      yield emit();
      emitted += 1;
    }

    if (action.kind === 'finish' && emitted < ctx.maxFrames) {
      for (let tail = 0; tail < 4 && emitted < ctx.maxFrames; tail += 1) {
        step(state, ctx);
        yield emit();
        emitted += 1;
      }
    }
  }

  if (emitted < ctx.maxFrames) {
    drawText(surface, 'CLEAR', ctx.width / 2 - 36, layout.gridTop + 30, theme.hud, 3);
    yield { width: ctx.width, height: ctx.height, data: surface.data.slice(), delayMs: 120 };
  }
}
