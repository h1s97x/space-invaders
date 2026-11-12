/** classic 渲染器回归：两种输出并存，且 classic 保持「绿方块方阵」的观感。 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RenderContext } from '../src/contract/action.js';
import { dateKeyOf, type Calendar } from '../src/contract/calendar.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel } from '../src/domain/simulate.js';
import { renderers } from '../src/render/index.js';
import { animate as classicAnimate } from '../src/render/classic/animate.js';
import { parseArgs } from '../src/cli/args.js';

const ctx: RenderContext = { width: 1024, height: 256, scale: 1, fps: 20, maxFrames: 4800 };

const YEAR_DAYS = Array.from({ length: 24 }, (_, i) => ({
  date: dateKeyOf(new Date(Date.UTC(2025, 10, 10 + i * 15))),
  metrics: { commits: 1 + (i % 9), pullRequests: 0, issues: 0, reviews: 0, score: 0 },
}));
const YEAR: Calendar = {
  from: '20251109',
  to: '20261112',
  total: YEAR_DAYS.reduce((sum, day) => sum + day.metrics.commits, 0),
  days: YEAR_DAYS,
};

test('两种渲染器都注册，同一 Level 都能产出帧', () => {
  assert.ok(renderers.has('invader'));
  assert.ok(renderers.has('classic'));
  const level = buildLevel(YEAR, 1);
  const invader = [...renderers.get('invader').frames(level, simulateLevel(level), ctx)];
  const classic = [...renderers.get('classic').frames(level, simulateLevel(level), ctx)];
  assert.ok(invader.length > 10);
  assert.ok(classic.length > 10);
  assert.equal(classic[0]!.width, ctx.width);
  assert.equal(classic[0]!.height, ctx.height);
  assert.notDeepEqual([...classic[0]!.data], [...invader[0]!.data], '两种输出应确实不同');
});

test('classic 画面有绿方块、星点、署名 HUD 与蓝色飞船', () => {
  const level = buildLevel(YEAR, 1);
  const frames = [...classicAnimate(level, simulateLevel(level), ctx)];
  const first = frames[0]!.data;
  let green = 0;
  let ship = 0;
  let pale = 0;
  for (let i = 0; i < first.length; i += 4) {
    const r = first[i]!, g = first[i + 1]!, b = first[i + 2]!;
    if (g > r + 20 && g > b + 10 && g > 60) green += 1;
    if (b > r + 60 && b > 180) ship += 1;
    if (r > 150 && g > 170 && b > 200) pale += 1;
  }
  assert.ok(green > 500, `绿方块像素 ${green} 过少`);
  assert.ok(ship > 20, `飞船像素 ${ship} 过少`);
  assert.ok(pale > 50, `星点 / HUD 像素 ${pale} 过少`);

  // 清场过程中绿方块应逐渐减少，说明命中确实生效
  const last = frames[frames.length - 1]!.data;
  let lastGreen = 0;
  for (let i = 0; i < last.length; i += 4) {
    const r = last[i]!, g = last[i + 1]!, b = last[i + 2]!;
    if (g > r + 20 && g > b + 10 && g > 60) lastGreen += 1;
  }
  assert.ok(lastGreen < green, '清场后绿方块应减少');
});

test('renderer 参数只接受两种输出，非法值立即报错', () => {
  assert.equal(parseArgs({ CONTRIB_RENDERER: 'classic' }).renderer, 'classic');
  assert.equal(parseArgs({}).renderer, 'invader');
  assert.throws(() => parseArgs({ CONTRIB_RENDERER: 'nope' }), /CONTRIB_RENDERER 只能是/);
});
