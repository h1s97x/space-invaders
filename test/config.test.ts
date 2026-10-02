/**
 * 坐标系与常量契约 —— 这些数字直接决定画面布局，改错了整张图就歪。
 *
 * 参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen），见根目录 NOTICE。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BULLET_SPEED, CELL, COLS, GAP, HEIGHT, PADDING, PITCH, ROWS,
  SHIP_ROW, SHIP_SPEED, SHIP_SHOOT_COOLDOWN, WIDTH,
  cellX, cellY, deltaTimeFor, frameMsFor,
} from '../src/config.js';
import { ENEMY_COLORS } from '../src/types.js';

test('画布尺寸与参考一致：860×230', () => {
  assert.equal(WIDTH, 860);
  assert.equal(HEIGHT, 230);
});

test('格子几何：cell 12 / gap 3 / padding 40 / pitch 15', () => {
  assert.equal(CELL, 12);
  assert.equal(GAP, 3);
  assert.equal(PADDING, 40);
  assert.equal(PITCH, CELL + GAP);
});

test('网格尺寸：52 列 × 7 行，飞船停在第 10 行', () => {
  assert.equal(COLS, 52);
  assert.equal(ROWS, 7);
  assert.equal(SHIP_ROW, 10); // ROWS + 3，照抄参考 SHIP_POSITION_Y
});

test('格坐标 → 像素坐标映射', () => {
  assert.equal(cellX(0), 40);
  assert.equal(cellX(1), 55);
  assert.equal(cellX(51), 40 + 51 * 15);
  assert.equal(cellY(0), 40);
  assert.equal(cellY(SHIP_ROW), 40 + 10 * 15); // 190
});

test('速度与时长单位是「格/秒」和「秒」，与帧率解耦', () => {
  assert.equal(SHIP_SPEED, 12.5);
  assert.equal(BULLET_SPEED, 7.5);
  assert.equal(SHIP_SHOOT_COOLDOWN, 0.2);
});

test('时间步长是 3.0/fps（不是 1/fps），帧时长是 2000/fps', () => {
  assert.equal(deltaTimeFor(40), 3.0 / 40);
  assert.equal(frameMsFor(40), 50);
  assert.equal(frameMsFor(25), 80);
  assert.notEqual(deltaTimeFor(40), 1 / 40); // 反直觉但要锁住
});

test('敌人配色只有 4 档（照抄参考 enemy_colors）', () => {
  assert.deepEqual(Object.keys(ENEMY_COLORS).map(Number).sort((a, b) => a - b), [1, 2, 3, 4]);
  assert.deepEqual(ENEMY_COLORS[1], [0, 109, 50]);
  assert.deepEqual(ENEMY_COLORS[4], [87, 242, 135]);
});
