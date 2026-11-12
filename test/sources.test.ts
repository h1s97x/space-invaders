import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rollingWindow, type Calendar } from '../src/contract/calendar.js';
import { cnbSource } from '../src/sources/cnb.js';
import { fileSource, parseCalendar } from '../src/sources/file.js';
import { githubSource } from '../src/sources/github.js';
import { mockSource } from '../src/sources/mock.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOW = new Date('2026-11-12T00:00:00Z');
const { from, to } = rollingWindow(NOW);

function fakeFetch(payload: unknown): typeof globalThis.fetch {
  const handler = async (): Promise<Response> =>
    new Response(JSON.stringify(payload), { status: 200 });
  return handler as unknown as typeof globalThis.fetch;
}

const DAYS = [
  { date: '20261109', metrics: { commits: 12, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
  { date: '20261111', metrics: { commits: 2, pullRequests: 0, issues: 0, reviews: 0, score: 0 } },
];

const EXPECTED: Calendar = { from, to, days: DAYS, total: 14 };

const GITHUB_PAYLOAD = {
  data: {
    user: {
      contributionsCollection: {
        contributionCalendar: {
          weeks: [{
            contributionDays: [
              { date: '2026-11-09', contributionCount: 12 },
              { date: '2026-11-10', contributionCount: 0 },
              { date: '2026-11-11', contributionCount: 2 },
              { date: '2026-11-20', contributionCount: 9 },
            ],
          }],
        },
      },
    },
  },
};

const CNB_PAYLOAD = {
  '20261109': { commit_count: 12 },
  '20261110': { commit_count: 0 },
  '20261111': { commit_count: 2 },
  '20261120': { commit_count: 9 },
};

test('mock 源完全确定，与示例日历一致', async () => {
  const a = await mockSource.read({ user: '' });
  const b = await mockSource.read({ user: '' });
  assert.deepEqual(a, b);
  const fromExample = parseCalendar(JSON.parse(readFileSync(join(repoRoot, 'examples', 'calendar.json'), 'utf8')) as unknown);
  assert.deepEqual(fromExample, a);
});

test('github 源归一：裁掉未来日期与 0 值', async () => {
  const calendar = await githubSource.read({
    user: 'octocat',
    token: 'test',
    fetch: fakeFetch(GITHUB_PAYLOAD),
    now: NOW,
  });
  assert.deepEqual(calendar, EXPECTED);
});

test('cnb 源归一：按年合并、稀疏补零、未来日期裁掉', async () => {
  const calendar = await cnbSource.read({
    user: 'h1s97x',
    token: 'test',
    fetch: fakeFetch(CNB_PAYLOAD),
    now: NOW,
  });
  assert.deepEqual(calendar, EXPECTED);
});

test('cnb 的「有活动」不等于 commit_count > 0', async () => {
  const calendar = await cnbSource.read({
    user: 'h1s97x',
    fetch: fakeFetch({ '20261105': { score: 5, commit_count: 0 } }),
    now: NOW,
  });
  assert.equal(calendar.days.length, 1);
  assert.equal(calendar.total, 5);
});

test('三个源对同一份语义数据归一成同一份 Calendar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-invaders-src-'));
  const path = join(dir, 'calendar.json');
  try {
    writeFileSync(path, JSON.stringify({ from, to, total: 0, days: DAYS }));
    const [a, b, c] = await Promise.all([
      githubSource.read({ user: 'u', fetch: fakeFetch(GITHUB_PAYLOAD), now: NOW }),
      cnbSource.read({ user: 'u', fetch: fakeFetch(CNB_PAYLOAD), now: NOW }),
      fileSource.read({ user: '', path }),
    ]);
    assert.deepEqual(a, b);
    assert.deepEqual(b, c);
    assert.deepEqual(c, EXPECTED);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
