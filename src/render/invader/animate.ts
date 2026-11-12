/**
 * 帧序列生成：Level + Action[] → 完整 RGBA 帧。
 *
 * 每帧完整重画（低分辨率画布，成本可控），不依赖上一帧，便于黄金帧复现。
 * 不 import 具体玩法模块：只认 contract/ 里的 Level 与 Action。
 */

import { createSurface } from '../codec/raster.js';
import { enemyKindOf, type Action, type Frame, type Level, type RenderContext, type Tier } from '../../contract/action.js';
import { colorForKind, defaultTheme, layoutFor, type Theme } from './theme.js';
import { drawBullet, drawEnemy, drawNumber, drawShip } from './sprites.js';

interface State {
  remaining: Map<string, number>;
  shipColumn: number;
  flash: number;
  combo: number;
}

function paint(
  surface: ReturnType<typeof createSurface>,
  level: Level,
  ctx: RenderContext,
  state: State,
  theme: Theme,
): void {
  const l = layoutFor(level.columns, ctx, theme);
  surface.fill(theme.background);

  for (let column = 0; column < level.columns; column += 1) {
    for (let row = 0; row < theme.rows; row += 1) {
      const x = l.pad + column * l.cell;
      const y = l.pad + row * l.rowH;
      surface.roundedRect(x, y, x + l.cell - 2, y + l.rowH - 2, 1, theme.grid);
    }
  }

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      const left = state.remaining.get(target.key) ?? 0;
      if (left <= 0) continue;
      const kind = enemyKindOf(Math.min(3, left) as Tier);
      drawEnemy(
        surface,
        l.pad + target.column * l.cell,
        l.pad + target.row * l.rowH,
        l.cell,
        l.rowH,
        kind,
        colorForKind(theme, kind),
      );
    }
  }

  const shipX = l.pad + state.shipColumn * l.cell;
  drawShip(surface, shipX, l.shipY, l.cell, theme.ship);
  if (state.flash > 0) drawBullet(surface, shipX + l.cell / 2, l.shipY - 14, theme.bullet);
  drawNumber(surface, String(state.combo), ctx.width - 30, 4, theme.text, 1);
}

export function* animate(
  level: Level,
  actions: Iterable<Action>,
  ctx: RenderContext,
  theme: Theme = defaultTheme,
): Generator<Frame, void, undefined> {
  const surface = createSurface(ctx.width, ctx.height);
  const state: State = {
    remaining: new Map(),
    shipColumn: Math.floor(level.columns / 2),
    flash: 0,
    combo: 0,
  };
  for (const wave of level.waves) {
    for (const target of wave.targets) state.remaining.set(target.key, target.tier);
  }

  const delayMs = Math.max(20, Math.round(1000 / ctx.fps));
  const emit = (): Frame => {
    paint(surface, level, ctx, state, theme);
    return { width: ctx.width, height: ctx.height, data: surface.data.slice(), delayMs };
  };

  let emitted = 0;
  yield emit();
  emitted += 1;

  for (const action of actions) {
    if (emitted >= ctx.maxFrames) return;
    if (action.kind === 'move' && action.column !== undefined) state.shipColumn = action.column;
    if (action.kind === 'fire' && action.target !== undefined) {
      const left = state.remaining.get(action.target) ?? 0;
      state.remaining.set(action.target, Math.max(0, left - 1));
      state.flash = 2;
      state.combo = action.combo ?? state.combo;
    } else {
      state.flash = Math.max(0, state.flash - 1);
    }
    yield emit();
    emitted += 1;
  }
}
