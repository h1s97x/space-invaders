
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 数据来源：GitHub GraphQL 抓取 + 离线假数据兜底。
 *
 * 对外只有两个函数，且 `fetchContributions()` **任何失败都只返回 null** ——
 * 调用方（CLI）拿到 null 就退到假数据，绝不让一次网络抖动搞挂构建。
 */
import { crc32 } from 'node:zlib';
import { COLS, ROWS } from './config.js';
import { Rng } from './rng.js';
import { Contributions } from './types.js';

const GRAPHQL = `
query($user: String!) {
  user(login: $user) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { contributionCount weekday }
        }
      }
    }
  }
}
`;

interface GraphQLResponse {
  data?: {
    user?: {
      contributionsCollection: {
        contributionCalendar: {
          totalContributions: number;
          weeks: { contributionDays: { contributionCount: number; weekday: number }[] }[];
        };
      };
    };
  };
  errors?: { message?: string }[];
}

/** 抓取贡献图。任何失败都返回 null（打印 warn 后交由调用方回退）。 */
export async function fetchContributions(
  username: string,
  token: string | undefined,
): Promise<Contributions | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'gh-space-invaders-ts/0.1',
  };
  if (token) headers.Authorization = `bearer ${token}`;

  let body: GraphQLResponse;
  try {
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: GRAPHQL, variables: { user: username } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) {
      console.warn(`  [warn] API 返回 ${resp.status}: ${resp.statusText}`);
      return null;
    }
    body = (await resp.json()) as GraphQLResponse;
  } catch (e) {
    console.warn(`  [warn] API 请求失败: ${(e as Error).message}`);
    return null;
  }

  // GraphQL 习惯用 HTTP 200 + errors 表达失败（token 无效 / 用户不存在 / 限流）
  if (body.errors?.length) {
    console.warn(`  [warn] GraphQL 错误: ${body.errors[0]?.message ?? 'unknown'}`);
    return null;
  }
  const user = body.data?.user;
  if (!user) {
    console.warn(`  [warn] 找不到用户 '${username}'`);
    return null;
  }

  const cal = user.contributionsCollection.contributionCalendar;
  const rows: number[][] = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
  cal.weeks.slice(0, COLS).forEach((week, c) => {
    for (const day of week.contributionDays) {
      const r = day.weekday;
      if (r >= 0 && r < ROWS) rows[r][c] = day.contributionCount;
    }
  });
  return new Contributions(rows, username, cal.totalContributions ?? 0);
}

/**
 * 假数据 —— 看起来像真实贡献图。
 *
 * 用 `crc32(username)` 而不是字符串 hash：必须让同一个用户名在任何机器上
 * 都得到同一份数据，`--seed` 才有复现意义。
 */
export function generateDummy(username = 'octocat'): Contributions {
  const rows: number[][] = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
  const rng = new Rng(crc32(username) >>> 0);

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      rows[r][c] =
        r === 0 || r === 6
          ? rng.weighted([0, 0, 0, 1, 2], [40, 20, 10, 20, 10])
          : rng.weighted([0, 1, 2, 3, 4, 5, 10], [15, 15, 20, 20, 15, 10, 5]);
    }
  }
  // 种几个高产格，保证 level 4/5 一定存在
  for (let i = 0; i < 8; i++) {
    const rc = rng.int(0, ROWS - 1);
    const cc = rng.int(0, COLS - 1);
    rows[rc][cc] = rng.int(15, 40);
  }
  const total = rows.reduce((a, r) => a + r.reduce((b, v) => b + v, 0), 0);
  return new Contributions(rows, username, total);
}