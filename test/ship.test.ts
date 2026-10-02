/**
 * 飞船运动与开火闸门。
 *
 * 参考 czl9707/gh-space-shooter 的 `Ship.animate` / `GameState.can_take_action`
 * （MIT, Copyright (c) 2026 Zane Chen），见根目录 NOTICE。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COLS, SHIP_SPEED, SHIP_SHOOT_COOLDOWN, deltaTimeFor } from '../src/config.js';
import { Ship } from '../src/types.js';

const DT = deltaTimeFor(40);

test('出生在正中间', () => {
  const s = new Ship(Math.floor((COLS - 1) / 2));
  assert.equal(s.x, 25);
  assert.equal(s.targetX, 25);
  assert.equal(s.isMoving(), false, '出生即静止');
});

test('匀速逼近目标：每帧位移 = speed × dt', () => {
  const s = new Ship(0);
  s.moveTo(10);
  s.animate(DT, SHIP_SPEED);
  assert.ok(Math.abs(s.x - SHIP_SPEED * DT) < 1e-9, `实际 ${s.x}`);
});

test('绝不越过目标（min/max 夹住）', () => {
  const s = new Ship(0);
  s.moveTo(0.3); // 目标比一帧位移还近
  s.animate(DT, SHIP_SPEED);
  assert.equal(s.x, 0.3, '应精确停在目标上，不越过');
  assert.equal(s.isMoving(), false);
});

test('isMoving：x !== targetX', () => {
  const s = new Ship(5);
  assert.equal(s.isMoving(), false);
  s.moveTo(9);
  assert.equal(s.isMoving(), true);
  // 从 5 到 9 共 4 格，每帧 12.5×0.075=0.9375 格 → 需要 5 帧才到得了
  for (let i = 0; i < 6; i++) s.animate(DT, SHIP_SPEED);
  assert.equal(s.x, 9);
  assert.equal(s.isMoving(), false);
});

test('canShoot：开火后进入冷却，冷却完恢复', () => {
  const s = new Ship(0);
  assert.equal(s.canShoot(), true);
  s.shootCooldown = SHIP_SHOOT_COOLDOWN;
  assert.equal(s.canShoot(), false);
  // 冷却 0.2s；一帧 dt=0.075，所以 3 帧后应该好了
  s.animate(DT, SHIP_SPEED);
  s.animate(DT, SHIP_SPEED);
  assert.equal(s.canShoot(), false, '2 帧(0.15s) 还没到 0.2s');
  s.animate(DT, SHIP_SPEED);
  assert.ok(s.shootCooldown <= 0, '3 帧(0.225s) 应已冷却完');
  assert.equal(s.canShoot(), true);
});

test('左右对称', () => {
  const a = new Ship(0); a.moveTo(8);
  const b = new Ship(20); b.moveTo(12);
  a.animate(DT, SHIP_SPEED);
  b.animate(DT, SHIP_SPEED);
  assert.ok(Math.abs(a.x - (SHIP_SPEED * DT)) < 1e-9);
  assert.ok(Math.abs(b.x - (20 - SHIP_SPEED * DT)) < 1e-9);
});
