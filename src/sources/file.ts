/**
 * file 源：读取归一化日历 JSON。
 *
 * 这也是「取数外置」的现成接口：平台流水线可以先用自己的凭据取数、
 * 落成 JSON，再让镜像只做渲染，内核一行都不用改。
 */

import { readFile } from 'node:fs/promises';
import {
  DATE_KEY_PATTERN,
  heatOf,
  type Calendar,
  type Day,
  type Metrics,
} from '../contract/calendar.js';
import type { Source, SourceContext } from '../contract/registry.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonNegative(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${where} 需要非负有限数字，收到 ${String(value)}`);
  }
  return value;
}

function dateKey(value: unknown, where: string): string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) {
    throw new Error(`${where} 需要 YYYYMMDD，收到 ${String(value)}`);
  }
  return value;
}

function parseMetrics(value: unknown, where: string): Metrics {
  if (!isRecord(value)) throw new Error(`${where}.metrics 需要对象`);
  return {
    commits: nonNegative(value.commits, `${where}.metrics.commits`),
    pullRequests: nonNegative(value.pullRequests, `${where}.metrics.pullRequests`),
    issues: nonNegative(value.issues, `${where}.metrics.issues`),
    reviews: nonNegative(value.reviews, `${where}.metrics.reviews`),
    score: nonNegative(value.score, `${where}.metrics.score`),
  };
}

/** 校验并归一化。total 一律重算，不信任文件里写的值。 */
export function parseCalendar(value: unknown): Calendar {
  if (!isRecord(value)) throw new Error('日历需要是 JSON 对象');
  const from = dateKey(value.from, 'from');
  const to = dateKey(value.to, 'to');
  if (from > to) throw new Error(`from(${from}) 不能晚于 to(${to})`);
  if (!Array.isArray(value.days)) throw new Error('days 需要是数组');

  const days: Day[] = value.days.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`days[${index}] 需要是对象`);
    return {
      date: dateKey(entry.date, `days[${index}].date`),
      metrics: parseMetrics(entry.metrics, `days[${index}]`),
    };
  });
  let previous = '';
  for (const day of days) {
    if (day.date < previous) throw new Error(`days 必须按日期升序：${previous} 之后出现 ${day.date}`);
    if (day.date === previous) throw new Error(`days 出现重复日期 ${day.date}`);
    if (day.date < from || day.date > to) throw new Error(`${day.date} 超出 from..to 区间`);
    previous = day.date;
  }

  return {
    from,
    to,
    days,
    total: days.reduce((sum, day) => sum + heatOf(day.metrics), 0),
  };
}

export const fileSource: Source = {
  id: 'file',
  async read(ctx: SourceContext): Promise<Calendar> {
    if (!ctx.path) throw new Error('file 源需要 CONTRIB_CALENDAR 指定日历路径');
    const text = await readFile(ctx.path, 'utf8');
    return parseCalendar(JSON.parse(text) as unknown);
  },
};
