import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DATE_KEY_PATTERN,
  dateKeyOf,
  heatOf,
  rollingWindow,
} from '../src/contract/calendar.js';
import { enemyKindOf } from '../src/contract/action.js';
import { parseCalendar } from '../src/sources/file.js';

const METRICS = { commits: 3, pullRequests: 2, issues: 1, reviews: 4, score: 5 };

test('heatOf 是活跃值的唯一求和口径', () => {
  assert.equal(heatOf(METRICS), 15);
  assert.equal(heatOf({ commits: 0, pullRequests: 0, issues: 0, reviews: 0, score: 0 }), 0);
});

test('日期键与滚动窗口按 UTC 且起点对齐周日', () => {
  assert.equal(dateKeyOf(new Date('2026-11-12T23:30:00Z')), '20261112');
  assert.equal(DATE_KEY_PATTERN.test('20261112'), true);
  assert.equal(DATE_KEY_PATTERN.test('2026-11-12'), false);

  const { from, to, years } = rollingWindow(new Date('2026-11-12T00:00:00Z'));
  assert.equal(to, '20261112');
  assert.equal(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(4, 6)) - 1, Number(from.slice(6, 8)))).getUTCDay(), 0);
  assert.ok(years.includes(2026));
  assert.ok(years.length >= 2, '滚动一年必然跨两个公历年');
});

test('parseCalendar 重算 total 并拒绝脏数据', () => {
  const clean = parseCalendar({
    from: '20261101',
    to: '20261114',
    total: 999,
    days: [{ date: '20261102', metrics: METRICS }],
  });
  assert.equal(clean.total, 15, '不信任文件里写的 total');
  assert.equal(clean.days.length, 1);

  const bad = (value: unknown): void => {
    parseCalendar(value);
  };
  assert.throws(() => bad({ from: '2026-11-01', to: '20261114', days: [] }), /YYYYMMDD/);
  assert.throws(() => bad({ from: '20261114', to: '20261101', days: [] }), /不能晚于/);
  assert.throws(() => bad({ from: '20261101', to: '20261114', days: [
    { date: '20261103', metrics: METRICS },
    { date: '20261102', metrics: METRICS },
  ] }), /升序/);
  assert.throws(() => bad({ from: '20261101', to: '20261114', days: [
    { date: '20261102', metrics: { ...METRICS, commits: -1 } },
  ] }), /非负/);
  assert.throws(() => bad({ from: '20261101', to: '20261114', days: [
    { date: '20261031', metrics: METRICS },
  ] }), /超出/);
});

test('敌人类型由自研分档映射，不含血量概念', () => {
  assert.equal(enemyKindOf(1), 'drone');
  assert.equal(enemyKindOf(2), 'cluster');
  assert.equal(enemyKindOf(3), 'boss');
});
