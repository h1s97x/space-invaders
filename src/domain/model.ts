/**
 * Calendar → Level：把归一化日历铺成自研的「波次」盘面。
 *
 * 纯数据变换，零 IO。分位分档、敌人类型、网格坐标都在这里一次算完，
 * 渲染层不需要再理解活跃度口径。
 */

import { heatOf, type Calendar } from '../contract/calendar.js';
import { enemyKindOf, type Level, type Target, type Tier, type Wave } from '../contract/action.js';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

function utc(key: string): number {
  return Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
}

/** 该日期所在周的周日 00:00 UTC，作为第 0 列的起点。 */
function sundayOf(key: string): number {
  const t = utc(key);
  return t - new Date(t).getUTCDay() * DAY_MS;
}

/** 三分位切点；极端活跃值不会把分档顶出 1..3。 */
function cutPoints(heats: readonly number[]): { q1: number; q2: number } {
  const sorted = [...heats].filter((h) => h > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return { q1: 0, q2: 0 };
  const last = sorted.length - 1;
  return {
    q1: sorted[Math.floor(last / 3)] ?? 0,
    q2: sorted[Math.floor((last * 2) / 3)] ?? 0,
  };
}

export function buildLevel(calendar: Calendar, seed: number): Level {
  const heats = calendar.days.map((day) => heatOf(day.metrics));
  const max = Math.max(1, ...heats);
  const { q1, q2 } = cutPoints(heats);
  const origin = sundayOf(calendar.from);
  const columns = Math.max(1, Math.floor((utc(calendar.to) - origin) / WEEK_MS) + 1);

  const targets: Target[] = calendar.days.map((day, index) => {
    const t = utc(day.date);
    const heat = heats[index] ?? 0;
    const tier: Tier = heat <= q1 ? 1 : heat <= q2 ? 2 : 3;
    return {
      key: day.date,
      column: Math.floor((t - origin) / WEEK_MS),
      row: new Date(t).getUTCDay(),
      tier,
      kind: enemyKindOf(tier),
      heat: heat / max,
    };
  });

  const waves: Wave[] = [];
  for (let column = 0; column < columns; column++) {
    const group = targets.filter((target) => target.column === column);
    if (group.length > 0) waves.push({ index: column, targets: group });
  }

  return { seed, from: calendar.from, to: calendar.to, columns, waves };
}
