/**
 * 渲染层回归（v3）：锁住四组曾经出问题的地方
 * ① 精灵溢出格子糊成一团；② 飞船退化/无轨迹；③ 背景单薄；④ 中段帧空白。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurface } from '../src/render/codec/raster.js';
import type { RenderContext } from '../src/contract/action.js';
import { dateKeyOf, type Calendar } from '../src/contract/calendar.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel } from '../src/domain/simulate.js';
import { defaultTheme, layoutFor } from '../src/render/invader/theme.js';
import { createBackdrop, createStars, drawHorizon } from '../src/render/invader/backdrop.js';
import { animate } from '../src/render/invader/animate.js';
import {
  drawEnemy,
  drawHud,
  drawLaser,
  drawShip,
  drawShipTrail,
  drawStars,
  drawText,
  drawThruster,
} from '../src/render/invader/sprites.js';

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
  assert.ok(layout.gridLeft > layout.pad, '网格应水平居中，两侧留白给星云');
  assert.ok(layout.shipY + layout.cell <= ctx.height);
  assert.ok(layout.horizonY > layout.shipY, '地平线在飞船下方');
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

test('飞船有翼有机身，残影 / 尾焰 / 激光轨迹都能落像素', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  const ship = withSurface((s) => drawShip(s, 200, layout.shipY, layout.cell, defaultTheme));
  assert.ok(bbox(ship).width >= 12, '飞船横向跨度不足');

  assert.ok(opaquePixels(withSurface((s) =>
    drawShipTrail(s, [10, 11, 12, 13], layout, defaultTheme))) > 20);
  assert.ok(opaquePixels(withSurface((s) =>
    drawThruster(s, 200, layout.shipY, layout.cell, defaultTheme, 3))) > 10);
  assert.ok(opaquePixels(withSurface((s) =>
    drawLaser(s, 200, layout.shipY, layout.gridTop + 40, 1, defaultTheme))) > 100);
});

test('深空分层背景：渐变星云、扫描线、地平线与三层星点', () => {
  const backdrop = createBackdrop(ctx, defaultTheme);
  assert.ok(distinctColors(backdrop) >= 20, '渐变 + 星云应产生丰富色阶');

  const layout = layoutFor(53, ctx, defaultTheme);
  const horizon = withSurface((s) => drawHorizon(s, ctx, layout, defaultTheme, 10));
  assert.ok(opaquePixels(horizon) > 500, '地平线光带与透视线应可见');

  let seed = 7;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const stars = createStars(ctx, defaultTheme, random);
  assert.equal(stars.length, defaultTheme.starCount);
  const speeds = new Set(stars.map((star) => star.speed.toFixed(4)));
  assert.ok(speeds.size >= 3, '三层星点速度应不同以形成视差');

  const starPixels = withSurface((s) => drawStars(s, stars, defaultTheme));
  assert.ok(opaquePixels(starPixels) > 100);
});

test('HUD 与点阵文字能落像素', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  const hud = withSurface((s) =>
    drawHud(s, ctx.width, layout, { score: 120, combo: 7, wave: 12, waves: 53, cleared: 30, total: 98 }, defaultTheme),
  );
  assert.ok(opaquePixels(hud) > 300);
  assert.ok(opaquePixels(withSurface((s) => drawText(s, 'SCORE 0120', 8, 8, defaultTheme.hud, 2))) > 100);
});

test('整年真数据的中段帧不是空白，且画面有层次', () => {
  const level = buildLevel(YEAR, 1);
  assert.ok(level.columns >= 50);

  const frames = [...animate(level, simulateLevel(level), ctx)];
  assert.ok(frames.length > 20);
  const middle = frames[Math.floor(frames.length / 2)]!;
  assert.equal(middle.width, ctx.width);
  assert.equal(middle.height, ctx.height);
  assert.ok(distinctColors(middle.data) >= 20, '应有渐变背景、星云、网格、敌人、飞船、HUD 等多层');

  let enemyPixels = 0;
  for (let i = 0; i < middle.data.length; i += 4) {
    const r = middle.data[i]!, g = middle.data[i + 1]!;
    if (g > 150 && g > r + 30) enemyPixels += 1;
  }
  assert.ok(enemyPixels > 100, `中段帧敌人像素 ${enemyPixels} 过少`);
});
