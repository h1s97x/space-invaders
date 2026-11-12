import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enemyKindOf, type Action } from '../src/contract/action.js';
import type { Calendar } from '../src/contract/calendar.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel } from '../src/domain/simulate.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const CALENDAR: Calendar = {
  from: '20261101',
  to: '20261121',
  total: 30,
  days: [
    { date: '20261102', metrics: { commits: 1, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
    { date: '20261109', metrics: { commits: 8, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
    { date: '20261116', metrics: { commits: 21, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
  ],
};

test('buildLevel 是纯函数，分档 / 类型 / 坐标都合法', () => {
  const a = buildLevel(CALENDAR, 7);
  const b = buildLevel(CALENDAR, 7);
  assert.deepEqual(a, b);
  assert.equal(a.columns, 3);
  assert.equal(a.waves.length, 3);

  const targets = a.waves.flatMap((wave) => wave.targets);
  assert.equal(targets.length, 3);
  for (const target of targets) {
    assert.ok(target.tier >= 1 && target.tier <= 3);
    assert.equal(target.kind, enemyKindOf(target.tier));
    assert.ok(target.heat >= 0 && target.heat <= 1);
    assert.ok(target.row >= 0 && target.row <= 6);
    assert.ok(target.column >= 0 && target.column < a.columns);
  }
  assert.deepEqual(targets.map((t) => t.tier), [1, 2, 3]);
});

test('simulateLevel 可复现，且连击总数等于全部强度之和', () => {
  const level = buildLevel(CALENDAR, 7);
  const first: Action[] = [...simulateLevel(level)];
  const second: Action[] = [...simulateLevel(level)];
  assert.deepEqual(first, second);

  const finish = first[first.length - 1];
  assert.equal(finish?.kind, 'finish');
  assert.equal(finish?.combo, 1 + 2 + 3);
  assert.ok(first.some((action) => action.kind === 'fire'));
});

test('domain/ 不 import sources/，规则文件不含上游常量与策略名', () => {
  const dir = join(repoRoot, 'src', 'domain');
  const files = readdirSync(dir).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length >= 3);
  const forbidden = [
    /from\s+['"][^'"]*sources/,
    /columnStrategy|rowStrategy|randomStrategy/,
    /3\.0\s*\/\s*fps/,
    /860|230|12\.5|7\.5/,
    /SHIP_SPEED|BULLET_SPEED|hp\s*=/,
  ];
  for (const name of files) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${name} 命中 ${pattern}`);
    }
  }
});
