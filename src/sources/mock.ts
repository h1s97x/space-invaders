/**
 * mock 源：完全确定的假日历，不依赖当前时间与网络。
 *
 * 固定区间让 e2e 与黄金帧在任何机器上得到同一份输入。
 */

import { heatOf, type Calendar, type Day } from '../contract/calendar.js';
import type { Source } from '../contract/registry.js';

const FROM = '20261101';
const TO = '20261114';

const FIXED: readonly Day[] = Object.freeze([
  { date: '20261102', metrics: { commits: 3, pullRequests: 0, issues: 0, reviews: 0, score: 5 } },
  { date: '20261104', metrics: { commits: 1, pullRequests: 1, issues: 0, reviews: 0, score: 3 } },
  { date: '20261106', metrics: { commits: 0, pullRequests: 0, issues: 2, reviews: 1, score: 4 } },
  { date: '20261109', metrics: { commits: 12, pullRequests: 0, issues: 0, reviews: 0, score: 14 } },
  { date: '20261111', metrics: { commits: 2, pullRequests: 0, issues: 0, reviews: 0, score: 2 } },
]);

export const mockSource: Source = {
  id: 'mock',
  async read(): Promise<Calendar> {
    const days = FIXED.map((day) => ({ date: day.date, metrics: { ...day.metrics } }));
    return {
      from: FROM,
      to: TO,
      days,
      total: days.reduce((sum, day) => sum + heatOf(day.metrics), 0),
    };
  },
};
