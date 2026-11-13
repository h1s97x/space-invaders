/**
 * 帧序列生成：Level + Action[] → 完整 RGBA 帧。
 *
 * 静态底图（纯色 + 固定星点）只算一次；怪物、多颗在飞的子弹、爆炸、飞船逐帧叠加。
 * 怪物两帧按相邻列分组错峰，形成缓慢扫过的波浪（ADR 0000 第 21 节）。
 * 逐帧事件由 render/motion.ts 按帧推进：允许多弹齐飞，命中只在子弹到达帧结算。
 * 只认 contract/ 的 Level 与 Action，不 import 具体玩法模块。
 */

import { createSurface } from '../codec/raster.js';
import { enemyKindOf, type Action, type Frame, type Level, type RenderContext, type Tier } from '../../contract/action.js';
import { colorForKind, defaultTheme, layoutFor, type Layout, type Theme } from './theme.js';
import { createBackdrop } from './backdrop.js';
import { expand, type BulletFlight, type Phase } from '../motion.js';
import {
  drawBullet,
  drawBursts,
  drawEnemy,
  drawShip,
  type Burst,
} from './sprites.js';

/** 错峰周期与列分组：相邻 3 列同相位，组间差 1 帧，形成扫过的波浪。 */
const WAVE_PERIOD = 18;
const WAVE_GROUP = 3;

interface State {
  remaining: Map<string, number>;
  shipX: number;
  bullets: readonly BulletFlight[];
  bursts: Burst[];
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

function applyFrame(
  phase: Phase,
  state: State,
  layout: Layout,
  theme: Theme,
  targets: ReadonlyMap<string, Placement>,
  random: () => number,
): void {
  state.shipX = phase.shipX;
  state.bullets = phase.bullets;

  // 只允许在子弹真正到达的帧扣血、放爆炸；发射顺序与命中顺序一致。
  for (const action of phase.impacts) {
    const key = action.target ?? '';
    const left = state.remaining.get(key) ?? 0;
    const next = Math.max(0, left - 1);
    state.remaining.set(key, next);

    const at = place(layout, targets.get(key), action.column ?? Math.round(state.shipX));
    const dead = left > 0 && next === 0;
    state.bursts.push({
      x: at.x,
      y: at.y,
      age: 0,
      angles: Array.from({ length: dead ? 9 : 4 }, () => random() * Math.PI * 2),
      lifetime: dead ? theme.explosionFrames : 3,
      maxRadius: dead ? theme.cellMax * 1.5 : theme.cellMax * 0.6,
    });
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
  targets: ReadonlyMap<string, Placement>,
  frameIndex: number,
): Frame {
  surface.data.set(backdrop);

  for (const wave of level.waves) {
    for (const target of wave.targets) {
      const left = state.remaining.get(target.key) ?? 0;
      if (left <= 0) continue;
      const kind = enemyKindOf(Math.min(3, left) as Tier);
      // 按相邻列分组错开相位：同组同步、组间差一帧，整体像一道缓慢扫过的波浪。
      const phase = (frameIndex + Math.floor(target.column / WAVE_GROUP)) % WAVE_PERIOD;
      const frame: 0 | 1 = phase < WAVE_PERIOD / 2 ? 0 : 1;
      drawEnemy(
        surface,
        layout.gridLeft + target.column * layout.cell,
        layout.gridTop + target.row * layout.rowH,
        layout.cell,
        kind,
        colorForKind(theme, kind),
        frame,
      );
    }
  }

  drawBursts(surface, state.bursts, theme);
  for (const bullet of state.bullets) {
    const at = place(layout, targets.get(bullet.action.target ?? ''),
      bullet.action.column ?? Math.round(state.shipX));
    const y = layout.shipY + (at.y - layout.shipY) * bullet.progress;
    drawBullet(surface, at.x, y, theme);
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
    bullets: [],
    bursts: [],
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
  const emit = (frameIndex: number): Frame =>
    paint(surface, backdrop, level, ctx, state, layout, theme, targets, frameIndex);
  for (const phase of expand(actions, startX)) {
    if (emitted >= ctx.maxFrames) return;
    applyFrame(phase, state, layout, theme, targets, random);
    step(state);
    yield emit(emitted);
    emitted += 1;
  }
}
