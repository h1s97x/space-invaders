/**
 * 渲染层回归：防止 v1 的三个视觉缺陷回来
 * ① 一年 53 列被压成 1px 竖线；② 飞船三角形退化成一个点；③ 中段帧空白。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSurface } from '../src/render/codec/raster.js';
import type { RenderContext } from '../src/contract/action.js';
import { dateKeyOf, type Calendar } from '../src/contract/calendar.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel } from '../src/domain/simulate.js';
import { defaultTheme, layoutFor } from '../src/render/invader/theme.js';
import { animate } from '../src/render/invader/animate.js';
import { drawEnemy, drawHud, drawShip, drawStars, drawText, type Star } from '../src/render/invader/sprites.js';

const ctx: RenderContext = { width: 512, height: 128, scale: 2, fps: 20, maxFrames: 4800 };

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

function distinctColors(data: Uint8ClampedArray): number {
  const colors = new Set<number>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
  }
  return colors.size;
}

/** 覆盖整年的 24 个目标：保证中段帧仍有敌人，能复现 v1「半张废帧」的场景。 */
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

test('整年 53 列的格子能画出形状，且不越出画布', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  assert.ok(layout.cell >= 8, `cell=${layout.cell} 应至少 8px`);
  assert.ok(layout.gridWidth <= ctx.width - layout.pad * 2, '网格不能超出画布宽度');
  assert.ok(layout.shipY + layout.cell <= ctx.height, '飞船区不能超出画布高度');
});

test('三类敌人与两帧动画都有实际面积且互不相同', () => {
  const cell = layoutFor(53, ctx, defaultTheme).cell;
  const colors = [defaultTheme.drone, defaultTheme.cluster, defaultTheme.boss];
  const kinds = ['drone', 'cluster', 'boss'] as const;
  const results = kinds.map((kind, i) =>
    withSurface((s) => drawEnemy(s, 20, 20, cell, kind, colors[i]!, 0)),
  );
  for (const data of results) assert.ok(opaquePixels(data) > 20, '精灵不应退化成竖线');
  assert.notDeepEqual([...results[0]!], [...results[1]!]);
  assert.notDeepEqual([...results[1]!], [...results[2]!]);

  const frame1 = withSurface((s) => drawEnemy(s, 20, 20, cell, 'drone', defaultTheme.drone, 1));
  assert.notDeepEqual([...results[0]!], [...frame1], '两帧翅膀动画应不同');
});

test('飞船有翼有机身，不再退化成一个点', () => {
  const cell = layoutFor(53, ctx, defaultTheme).cell;
  const data = withSurface((s) => drawShip(s, 100, 95, cell, defaultTheme));
  assert.ok(opaquePixels(data) > 40, `飞船像素 ${opaquePixels(data)} 过少`);

  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! === 0) continue;
    const x = (i / 4) % ctx.width;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
  }
  assert.ok(maxX - minX >= 8, `飞船横向跨度 ${maxX - minX} 过小`);
});

test('HUD、点阵文字与星空都能落像素', () => {
  const layout = layoutFor(53, ctx, defaultTheme);
  const hud = withSurface((s) =>
    drawHud(s, ctx.width, layout, { score: 120, combo: 7, wave: 12, waves: 53, cleared: 30, total: 98 }, defaultTheme),
  );
  assert.ok(opaquePixels(hud) > 100, 'HUD 应有文字与进度条');
  assert.ok(opaquePixels(withSurface((s) => drawText(s, 'SCORE 0120', 8, 8, defaultTheme.hud))) > 60);

  const stars: Star[] = Array.from({ length: 90 }, (_, i) => ({
    x: (i * 7) % ctx.width,
    y: (i * 11) % ctx.height,
    brightness: 0.6,
    size: 1,
    speed: 0.5,
  }));
  assert.ok(opaquePixels(withSurface((s) => drawStars(s, stars, defaultTheme))) >= 80);
});

test('整年真数据的中段帧不是空白，且画面有层次', () => {
  const level = buildLevel(YEAR, 1);
  assert.ok(level.columns >= 50, `应铺满整年，实际 ${level.columns} 列`);

  const frames = [...animate(level, simulateLevel(level), ctx)];
  assert.ok(frames.length > 20);
  const middle = frames[Math.floor(frames.length / 2)]!;
  assert.equal(middle.width, ctx.width);
  assert.equal(middle.height, ctx.height);
  assert.ok(distinctColors(middle.data) >= 8, '应有背景、网格、敌人、飞船、HUD、星空等多层颜色');

  // 敌人颜色（绿/青/粉）在中段帧必须存在，否则又是「竖线阵」或空盘
  let enemyPixels = 0;
  for (let i = 0; i < middle.data.length; i += 4) {
    const r = middle.data[i]!, g = middle.data[i + 1]!;
    if (g > 150 && g > r + 30) enemyPixels += 1;
  }
  assert.ok(enemyPixels > 20, `中段帧敌人像素 ${enemyPixels} 过少`);
});
