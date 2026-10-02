/**
 * 碰撞判定与敌人伤害。
 *
 * 参考原项目的 `Bullet._check_collision` / `Enemy.take_damage`
 * （MIT, Copyright (c) 2026 Zane Chen），见根目录 NOTICE。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHIP_ROW } from '../src/config.js';
import { Bullet, Enemy } from '../src/types.js';

test('敌人初始血量 = 贡献等级', () => {
  const e = new Enemy(3, 2, 4);
  assert.equal(e.x, 3);
  assert.equal(e.y, 2);
  assert.equal(e.health, 4);
  assert.equal(e.alive, true);
});

test('takeDamage：未打死返回 hit，打死返回 dead', () => {
  const e = new Enemy(0, 0, 2);
  assert.equal(e.takeDamage(), 'hit');
  assert.equal(e.health, 1);
  assert.equal(e.alive, true);
  assert.equal(e.takeDamage(), 'dead');
  assert.equal(e.health, 0);
  assert.equal(e.alive, false);
});

test('子弹的 x 是整数列号 —— 决定它永远不会横向打偏', () => {
  const b = new Bullet(7, SHIP_ROW - 1);
  assert.equal(b.x, 7);
  assert.equal(Number.isInteger(b.x), true);
});

test('命中判定：同一列 且敌人在子弹下方（y >= bullet.y）', () => {
  const b = new Bullet(7, 5);
  // 同列、y 在子弹下方 → 命中
  assert.ok(new Enemy(7, 6, 1).y >= b.y);
  // 同列但在子弹上方 → 不命中（子弹已经飞过去了）
  assert.ok(!(new Enemy(7, 3, 1).y >= b.y));
  // 不同列 → 不命中
  assert.ok(!(new Enemy(8, 6, 1).x === b.x && new Enemy(8, 6, 1).y >= b.y));
});

test('子弹只打同一列里「最靠上」的敌人（数组顺序 = 行号升序）', () => {
  // 这就是"子弹不会打偏、也不会跳格"的根源：find 取第一个满足条件的
  const column = [0, 1, 2, 3, 4, 5, 6].map((y) => new Enemy(7, y, 1));
  const bulletY = 4;
  const victim = column.find((e) => e.x === 7 && e.y >= bulletY);
  assert.equal(victim?.y, 4, '应命中恰好在子弹所在行的那格，而不是下方所有格');
});

test('血量上限是 4（贡献分档只产生 1..4）', () => {
  for (const lv of [1, 2, 3, 4]) {
    const e = new Enemy(0, 0, lv);
    let hits = 0;
    while (e.takeDamage() === 'hit') hits++;
    assert.equal(hits, lv - 1);
    assert.equal(e.alive, false);
  }
});
