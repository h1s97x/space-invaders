import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enemyKindOf, type Action } from '../src/contract/action.js';
import { dateKeyOf, type Calendar } from '../src/contract/calendar.js';
import { rules } from '../src/domain/index.js';
import { buildLevel } from '../src/domain/model.js';
import { simulateLevel, simulateSpread, simulateWaves } from '../src/domain/simulate.js';

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

/** 同一周（同一列）里上下两个目标：用来验证子弹不会穿过下方敌人。 */
const SAME_COLUMN: Calendar = {
  from: '20261101',
  to: '20261107',
  total: 6,
  days: [
    { date: '20261101', metrics: { commits: 1, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
    { date: '20261103', metrics: { commits: 5, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
  ],
};

/** 八列，用来验证 seed 洗牌确实改变清场顺序。 */
const MANY_COLUMNS: Calendar = {
  from: '20261101',
  to: '20261226',
  total: 36,
  days: Array.from({ length: 8 }, (_, i) => ({
    date: dateKeyOf(new Date(Date.UTC(2026, 10, 1 + i * 7))),
    metrics: { commits: 1 + i, pullRequests: 0, issues: 0, reviews: 0, score: 0 },
  })),
};

function moves(actions: readonly Action[]): number[] {
  return actions.filter((a) => a.kind === 'move').map((a) => a.column!);
}

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

test('simulateLevel 按 seed 洗牌可复现、连击总数正确且视觉命中', () => {
  const level = buildLevel(CALENDAR, 7);
  const first = [...simulateLevel(level)];
  assert.deepEqual(first, [...simulateLevel(level)]);
  assert.equal(first[first.length - 1]?.kind, 'finish');
  assert.equal(first[first.length - 1]?.combo, 1 + 2 + 3);

  const many = buildLevel(MANY_COLUMNS, 7);
  const order = moves([...simulateLevel(many)]);
  assert.deepEqual([...new Set(order)].sort((a, b) => a - b), many.waves.map((w) => w.index));
  assert.ok(order.length > many.waves.length, '按发点射应产生比列数更多的移动');
  assert.ok(order.length > new Set(order).size, '同一列应被分批访问，而不是一次清完');
  const other = moves([...simulateLevel(buildLevel(MANY_COLUMNS, 999))]);
  assert.notDeepEqual(order, other, '不同 seed 应得到不同清场顺序');
  assert.notDeepEqual(order, [...order].sort((a, b) => a - b), '默认顺序不应退化为逐列');

  // 中心扩散与逐列保留为可回退项
  assert.deepEqual(moves([...simulateSpread(level)]), [1, 0, 2]);
  assert.deepEqual(moves([...simulateWaves(level)]), [0, 1, 2]);
  assert.ok(rules.has('shuffle'));
  assert.ok(rules.has('spread'));
  assert.ok(rules.has('waves'));

  // 视觉命中：同列里先打 row 最大（最下方）的目标，打完才轮到上面的
  const sameColumn = buildLevel(SAME_COLUMN, 1);
  const byKey = new Map(sameColumn.waves.flatMap((w) => w.targets).map((t) => [t.key, t]));
  const fires = [...simulateLevel(sameColumn)].filter((a) => a.kind === 'fire');
  const totalShots = [...byKey.values()].reduce((sum, t) => sum + t.tier, 0);
  assert.equal(fires.length, totalShots, '发射总数应等于强度之和');
  const rows = fires.map((a) => byKey.get(a.target ?? '')?.row);
  assert.deepEqual(rows, [...rows].sort((a, b) => (b ?? 0) - (a ?? 0)),
    `子弹不应穿过下方活目标，实际命中行 ${rows.join(',')}`);
  assert.equal(rows[0], 2, '先打最下方');
  assert.equal(rows[rows.length - 1], 0, '最后才打最上方');
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
