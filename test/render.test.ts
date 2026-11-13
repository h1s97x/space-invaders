/**
 * 渲染层回归：锁住五组曾经出问题的地方
 * ① 精灵溢出格子；② 飞船退化；③ 装饰层回归；④ 中段帧空白；
 * ⑤ 瞬发子弹与阶段顺序（ADR 0000 第 18、19 节）。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurface } from '../src/render/codec/raster.js';
import type { RenderContext } from '../src/contract/action.js';
import { dateKeyOf, type Calendar } from '../src/contract/calendar.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel } from '../src/domain/simulate.js';
import { defaultTheme, layoutFor } from '../src/render/invader/theme.js';
import { createBackdrop } from '../src/render/invader/backdrop.js';
import * as backdropModule from '../src/render/invader/backdrop.js';
import { animate } from '../src/render/invader/animate.js';
import { expand } from '../src/render/motion.js';
import * as sprites from '../src/render/invader/sprites.js';
import { drawBullet, drawEnemy, drawShip } from '../src/render/invader/sprites.js';

const ctx: RenderContext = { width: 1024, height: 256, scale: 1, fps: 20, maxFrames: 4800 };

function withSurface(paint: (surface: ReturnType<typeof createSurface>) => void): Uint8ClampedArray {
  const surface = createSurface(ctx.width, ctx.height);
  paint(surface);
  return surface.data.slice();
}

function opaquePixels(data: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) count += 1;
  return count;
}

function bbox(data: Uint8ClampedArray): { width: number; height: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const p = i / 4;
    const x = p % ctx.width;
    const y = Math.floor(p / ctx.width);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { width: maxX < 0 ? 0 : maxX - minX + 1, height: maxY < 0 ? 0 : maxY - minY + 1 };
}

function distinctColors(data: Uint8ClampedArray): number {
  const colors = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  }
  return colors.size;
}

/** 覆盖整年的 24 个目标，保证中段帧仍有敌人。 */
const YEAR_DAYS = Array.from({ length: 24 }, (_, i) => ({
  date: dateKeyOf(new Date(Date.UTC(2025, 10, 10 + i * 15))),
  metrics: { commits: 1 + (i % 7), pullRequests: 0, issues: 0, reviews: 0, score: 0 },
}));
const YEAR: Calendar = {
  from: '20251109',
  to: '20261112',
  total: YEAR_DAYS.reduce((sum, day) => sum + day.metrics.commits, 0),
  days: YEAR_DAYS,
};

test('全览大画布：53 列每格 16px、网格居中、飞船区不越界', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  assert.equal(layout.cell, 16);
  assert.ok(layout.gridWidth <= ctx.width - layout.pad * 2);
  assert.ok(layout.gridLeft > layout.pad, '网格应水平居中');
  assert.ok(layout.shipY + layout.cell <= ctx.height);
  assert.ok(layout.shipY > layout.gridTop);
});

test('8×8 精灵精确填满格子，不再溢出到邻格', () => {
  const cell = layoutFor(53, ctx, defaultTheme).cell;
  const data = withSurface((s) => drawEnemy(s, 100, 100, cell, 'drone', defaultTheme.drone, 0));
  const box = bbox(data);
  assert.ok(box.width <= cell, `精灵宽 ${box.width} 超过格子 ${cell}`);
  assert.ok(box.height <= cell, `精灵高 ${box.height} 超过格子 ${cell}`);
  assert.ok(opaquePixels(data) > 80, '16px 格子里的精灵应有足够面积');
});

test('三类敌人与两帧动画都有面积且互不相同', () => {
  const cell = layoutFor(53, ctx, defaultTheme).cell;
  const colors = [defaultTheme.drone, defaultTheme.cluster, defaultTheme.boss];
  const kinds = ['drone', 'cluster', 'boss'] as const;
  const results = kinds.map((kind, i) =>
    withSurface((s) => drawEnemy(s, 20, 20, cell, kind, colors[i]!, 0)),
  );
  for (const data of results) assert.ok(opaquePixels(data) > 60);
  assert.notDeepEqual([...results[0]!], [...results[1]!]);
  assert.notDeepEqual([...results[1]!], [...results[2]!]);
  const frame1 = withSurface((s) => drawEnemy(s, 20, 20, cell, 'drone', defaultTheme.drone, 1));
  assert.notDeepEqual([...results[0]!], [...frame1]);
});

test('飞船建模与子弹仍在，零数据装饰的绘制函数已移除', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  const ship = withSurface((s) => drawShip(s, 200, layout.shipY, layout.cell, defaultTheme));
  assert.ok(bbox(ship).width >= 12, '飞船横向跨度不足');
  assert.ok(opaquePixels(withSurface((s) =>
    drawBullet(s, 200, layout.gridTop + 40, defaultTheme))) > 60, '子弹与三段拖尾应可见');

  for (const name of [
    'drawHud', 'drawText', 'drawLaser', 'drawGrid', 'drawStars',
    'drawShipTrail', 'drawThruster',
  ]) {
    assert.equal(name in sprites, false, `${name} 不应再导出`);
  }
});

test('背景只有纯色底与静态星点，不再有渐变 / 地平线', () => {
  const backdrop = createBackdrop(ctx, defaultTheme);
  const again = createBackdrop(ctx, defaultTheme);
  assert.deepEqual([...backdrop.subarray(0, 4096)], [...again.subarray(0, 4096)], '静态底图可复现');

  let backgroundPixels = 0;
  for (let i = 0; i < backdrop.length; i += 4) {
    if (
      backdrop[i] === defaultTheme.background[0] &&
      backdrop[i + 1] === defaultTheme.background[1] &&
      backdrop[i + 2] === defaultTheme.background[2]
    ) backgroundPixels += 1;
  }
  assert.ok(backgroundPixels > ctx.width * ctx.height * 0.99, '纯色底应占绝大多数像素');
  assert.ok(distinctColors(backdrop) < 100, '不应再有渐变 / 星云的数百色阶');
  assert.equal('drawHorizon' in backdropModule, false);
  assert.equal('createStars' in backdropModule, false);
});

test('不再有 HUD：点阵字形已移除，顶部留白没有进度条色带', () => {
  const level = buildLevel(YEAR, 1);
  const frames = [...animate(level, simulateLevel(level), ctx)];
  const middle = frames[Math.floor(frames.length / 2)]!;
  const backdrop = createBackdrop(ctx, defaultTheme);
  const row = layoutFor(53, ctx, defaultTheme).gridTop - 4;
  let changed = 0;
  for (let x = 0; x < ctx.width; x += 1) {
    const i = (row * ctx.width + x) * 4;
    if (
      middle.data[i] !== backdrop[i] ||
      middle.data[i + 1] !== backdrop[i + 1] ||
      middle.data[i + 2] !== backdrop[i + 2]
    ) changed += 1;
  }
  assert.ok(changed < 40, `顶部第 ${row} 行有 ${changed} 个非背景像素，疑似 HUD 色带`);
});

test('整年真数据的中段帧不是空白，且逐帧阶段完整', () => {
  const level = buildLevel(YEAR, 1);
  assert.ok(level.columns >= 50);

  const phases = [...expand([...simulateLevel(level)], Math.floor(level.columns / 2))];
  const firstLaunch = phases.findIndex((p) => p.kind === 'launch');
  assert.ok(firstLaunch > 0, '应存在发射帧');
  assert.ok(phases.slice(0, firstLaunch).some((p) => p.kind === 'travel'), '飞船必须先匀速到位');
  const firstImpact = phases.findIndex((p) => p.kind === 'impact');
  assert.ok(firstImpact > firstLaunch, '命中必须晚于发射');
  assert.ok(phases.slice(firstLaunch, firstImpact).some((p) => p.kind === 'flight'), '命中前子弹必须在飞');

  const frames = [...animate(level, simulateLevel(level), ctx)];
  assert.equal(frames.length, Math.min(phases.length, ctx.maxFrames), '每个动画阶段恰好出一帧');
  const middle = frames[Math.floor(frames.length / 2)]!;
  assert.equal(middle.width, ctx.width);
  assert.equal(middle.height, ctx.height);
  assert.ok(distinctColors(middle.data) >= 8, '应有背景、星点、怪物、飞船等层次');

  let enemyPixels = 0;
  for (let i = 0; i < middle.data.length; i += 4) {
    const r = middle.data[i]!, g = middle.data[i + 1]!;
    if (g > 150 && g > r + 30) enemyPixels += 1;
  }
  assert.ok(enemyPixels > 100, `中段帧敌人像素 ${enemyPixels} 过少`);
});
