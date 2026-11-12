/**
 * CNB 源：活跃日历 REST → 中性 Calendar。
 *
 * 三条实测差异都收敛在这里：
 * - key 是 `YYYYMMDD`，只返回有活动的日期，缺失日期天然补零（Calendar 稀疏）；
 * - 「有活动」指任意字段非 0，不等于 commit_count > 0；
 * - 接口按年返回，窗口跨年时逐年请求再合并，漏一年不会报错、只会少一片数据。
 */

import {
  DATE_KEY_PATTERN,
  heatOf,
  rollingWindow,
  type Calendar,
  type Day,
} from '../contract/calendar.js';
import type { Source, SourceContext } from '../contract/registry.js';

interface CnbEntry {
  commit_count?: number;
  pr_count?: number;
  issues_count?: number;
  score?: number;
  valid_cr_count?: number;
  valid_pr_count?: number;
}

type CnbCalendar = Record<string, CnbEntry>;

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

export const cnbSource: Source = {
  id: 'cnb',

  async read(ctx: SourceContext): Promise<Calendar> {
    if (!ctx.user) throw new Error('cnb 源需要 CONTRIB_USER');
    const doFetch = ctx.fetch ?? globalThis.fetch;
    const base = (ctx.endpoint || 'https://api.cnb.cool').replace(/\/$/, '');
    const { from, to, years } = rollingWindow(ctx.now ?? new Date());
    const merged: CnbCalendar = {};

    for (const year of years) {
      const url = `${base}/users/${encodeURIComponent(ctx.user)}/calendar?year=${year}`;
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (ctx.token) headers.Authorization = `Bearer ${ctx.token}`;

      const response = await doFetch(url, {
        headers,
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 204) continue;
      if (!response.ok) throw new Error(`CNB API ${response.status} ${response.statusText}`);

      const raw = (await response.json()) as CnbCalendar | null;
      if (!raw || typeof raw !== 'object') continue;
      for (const [key, entry] of Object.entries(raw)) {
        const normalized = String(key).replace(/\D/g, '');
        if (DATE_KEY_PATTERN.test(normalized)) merged[normalized] = entry;
      }
    }

    const days: Day[] = Object.entries(merged)
      .filter(([key]) => key >= from && key <= to)
      .map(([date, entry]) => ({
        date,
        metrics: {
          commits: nonNegative(entry?.commit_count),
          pullRequests: nonNegative(entry?.pr_count) + nonNegative(entry?.valid_pr_count),
          issues: nonNegative(entry?.issues_count),
          reviews: nonNegative(entry?.valid_cr_count),
          score: nonNegative(entry?.score),
        },
      }))
      .filter((day) => heatOf(day.metrics) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      from,
      to,
      days,
      total: days.reduce((sum, day) => sum + heatOf(day.metrics), 0),
    };
  },
};
