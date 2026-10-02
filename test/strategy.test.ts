/**
 * 四种策略的行为契约。
 *
 * 参考原项目的 `game/strategies/*.py`（MIT, Copyright (c) 2026 Zane Chen），
 * 见根目录 NOTICE。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLS } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { generateDummy } from '../src/data.js';
import { Strategy } from '../src/types.js';
import { clearOrder, isStrictlyIncreasing, makeContrib, oneCellPerColumn } from './helpers.js';

const ALL = [Strategy.COLUMN, Strategy.ROW, Strategy.RANDOM, Strategy.CHAOS] as const;

test('四种策略都能把场清空（回归：曾出现剩 45 个 / 剩 1 个活靶）', () => {
  const contrib = generateDummy('octocat');
  for (const s of ALL) {
    const e = new Engine(contrib, s, 40, 0, 1);
    const r = e.simulate();
    assert.equal(r.cleared, true, `${s} 未清空，剩 ${r.enemies}`);
    assert.equal(r.enemies, 0, `${s} 还剩 ${r.enemies} 个敌人`);
  }
});

test('四种策略都不会死循环 / 超时（回归：曾出现活锁，退出码 124）', () => {
  const contrib = generateDummy('octocat');
  for (const s of ALL) {
    const e = new Engine(contrib, s, 40, 0, 1);
    const r = e.simulate();
    assert.ok(r.frames > 0 && r.frames < 20000, `${s} 帧数异常：${r.frames}`);
  }
});

test('四种策略都会真正开火（回归：曾出现 17435 帧只开 33 枪）', () => {
  const contrib = generateDummy('octocat');
  for (const s of ALL) {
    const e = new Engine(contrib, s, 40, 0, 1);
    const r = e.simulate();
    assert.ok(r.shots > 300, `${s} 发弹数异常少：${r.shots}`);
  }
});

test('column 策略：一排一排从第 0 列推到第 51 列（这是它的定义，不是 bug）', () => {
  const order = clearOrder(oneCellPerColumn(), Strategy.COLUMN);
  assert.equal(order.length, COLS, '每一列都应被打空');
  assert.ok(isStrictlyIncreasing(order), `清场顺序应单调递增，实际：${order.slice(0, 12)}…`);
});

test('random 策略：清场顺序非单调 —— 不会像 column 那样一排一排推', () => {
  // 这是用户明确要求的观感：轨迹要会来回跳，而不是从左扫到右。
  // 曾因为把 column 设成默认，导致画面"从左到右一排一排清理"。
  const order = clearOrder(oneCellPerColumn(), Strategy.RANDOM, 7);
  assert.equal(order.length, COLS);
  assert.ok(!isStrictlyIncreasing(order), `random 的清场顺序不该单调递增：${order.slice(0, 12)}…`);
});

test('默认策略是 random 而不是 column（回归：曾误设成 column）', async () => {
  // 不 import index.ts（它有副作用会真的跑起来），直接读源码里的默认值
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
  const m = src.match(/strategy:\s*Strategy\.(\w+)/);
  assert.ok(m, '应能在 index.ts 里找到默认 strategy');
  assert.equal(m[1], 'RANDOM', `默认策略应是 RANDOM，实际 ${m[1]}`);
});

test('random 策略只在「最近的若干列」里挑目标（照抄参考取 8 个最近）', () => {
  // 构造只有第 0 列和第 51 列有敌人的数据：
  // 加权最近邻不可能选中 51（距离 25，权重 1），应始终打第 0 列
  const cells: number[][] = Array.from({ length: COLS }, () => new Array(7).fill(0));
  cells[0][0] = 5;
  cells[51][0] = 5;
  const e = new Engine(makeContrib(cells), Strategy.RANDOM, 40, 0, 3);
  const r = e.simulate();
  assert.equal(r.cleared, true);
  assert.ok(r.frames < 3000, `不该为了一个远处孤格跑整张图，帧数=${r.frames}`);
});

test('敌人数与总血量：分档后血量只能是 1..4（回归：曾出现 hp40）', () => {
  const contrib = generateDummy('octocat');
  const e = new Engine(contrib, Strategy.COLUMN, 40, 0, 1);
  for (const en of e.enemies) {
    assert.ok(Number.isInteger(en.health), `血量应整数，实际 ${en.health}`);
    assert.ok(en.health >= 1 && en.health <= 4, `血量应落在 1..4，实际 ${en.health}`);
  }
});

test('score 与击败数成正比（回归：曾因先减血再读血量导致 score 恒为 0）', () => {
  const contrib = generateDummy('octocat');
  const e = new Engine(contrib, Strategy.COLUMN, 40, 0, 1);
  const r = e.simulate();
  assert.ok(r.cleared);
  assert.equal(e.defeated, e.totalTargets, '击败数应等于敌人总数');
  assert.ok(e.score > 0, `score 不该为 0，实际 ${e.score}`);
});
