/**
 * GitHub 源：GraphQL 贡献日历 → 中性 Calendar。
 *
 * 平台的字段名（contributionCount / contributionDays / GraphQL errors）
 * 只在本文件出现，绝不穿透到 contract/ 或 domain/。
 */

import {
  heatOf,
  rollingWindow,
  ZERO_METRICS,
  type Calendar,
  type Day,
} from '../contract/calendar.js';
import type { Source, SourceContext } from '../contract/registry.js';

const QUERY = `
query($user: String!) {
  user(login: $user) {
    contributionsCollection {
      contributionCalendar {
        weeks { contributionDays { date contributionCount } }
      }
    }
  }
}
`;

interface GraphQLBody {
  data?: {
    user?: {
      contributionsCollection?: {
        contributionCalendar?: {
          weeks?: { contributionDays?: { date: string; contributionCount: number }[] }[];
        };
      };
    } | null;
  };
  errors?: { message?: string }[];
}

export const githubSource: Source = {
  id: 'github',

  async read(ctx: SourceContext): Promise<Calendar> {
    if (!ctx.user) throw new Error('github 源需要 CONTRIB_USER');
    const doFetch = ctx.fetch ?? globalThis.fetch;
    const endpoint = ctx.endpoint || 'https://api.github.com/graphql';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'space-invaders/0.1',
    };
    if (ctx.token) headers.Authorization = `bearer ${ctx.token}`;

    const response = await doFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: QUERY, variables: { user: ctx.user } }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}`);

    const body = (await response.json()) as GraphQLBody;
    if (body.errors?.length) {
      throw new Error(`GitHub GraphQL: ${body.errors[0]?.message ?? 'unknown'}`);
    }
    const weeks = body.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
    if (!weeks) throw new Error('GitHub GraphQL 未返回 contributionCalendar');

    const { from, to } = rollingWindow(ctx.now ?? new Date());
    const days: Day[] = [];
    for (const week of weeks) {
      for (const day of week.contributionDays ?? []) {
        const key = String(day.date).replace(/-/g, '');
        if (key < from || key > to) continue;
        const count = Number(day.contributionCount);
        if (!Number.isFinite(count) || count <= 0) continue;
        days.push({ date: key, metrics: { ...ZERO_METRICS, commits: count } });
      }
    }
    days.sort((a, b) => a.date.localeCompare(b.date));

    return {
      from,
      to,
      days,
      total: days.reduce((sum, day) => sum + heatOf(day.metrics), 0),
    };
  },
};
