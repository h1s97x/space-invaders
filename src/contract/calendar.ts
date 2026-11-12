/**
 * 自研贡献日历契约 —— 层间唯一的数据模型。
 *
 * 硬约束（ADR 0000 第 4 节）：本文件不含任何平台 API 字段名。
 * GitHub 的 contributionCount / contributionDays 与 CNB 的 commit_count /
 * YYYYMMDD 稀疏对象，都只能存在于 sources/ 的适配代码里，不能穿透到这里。
 */

/** 全项目唯一日期表示：`YYYYMMDD`。不用 Date 对象，避免时区把一天挪到另一周。 */
export type DateKey = string;

/** 日期键的合法形状，供各 source 归一后自检。 */
export const DATE_KEY_PATTERN = /^\d{8}$/;

/**
 * 中性活跃口径。字段名是语义，不是任何一方的接口字段。
 * 所有字段必填且为非负整数；无数据的平台填 0，而不是留空。
 */
export interface Metrics {
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  score: number;
}

/** 有活动的一天。稀疏是允许的：日历只收录有活动的日期。 */
export interface Day {
  date: DateKey;
  metrics: Metrics;
}

/**
 * 一份归一化日历。
 *
 * - `from` / `to`：覆盖区间（含两端），决定铺盘的周范围；与 days 是否稀疏无关。
 * - `days`：只含有活动的日期，按 date 升序，不重复。
 * - `total`：所有 metrics 之和，由 source 在归一时一次算出，供规则层与摘要复用。
 */
export interface Calendar {
  from: DateKey;
  to: DateKey;
  days: Day[];
  total: number;
}

/** 空口径常量，供 source 构造 Day 时展开，避免各处手写五个 0。 */
export const ZERO_METRICS: Readonly<Metrics> = Object.freeze({
  commits: 0,
  pullRequests: 0,
  issues: 0,
  reviews: 0,
  score: 0,
});

/** 口径求和，作为 `heat` 与 `total` 的唯一定义处。 */
export function heatOf(metrics: Metrics): number {
  return (
    metrics.commits +
    metrics.pullRequests +
    metrics.issues +
    metrics.reviews +
    metrics.score
  );
}

const DAY_MS = 86_400_000;

/** Date → `YYYYMMDD`，一律按 UTC，避免时区把一天挪到另一周。 */
export function dateKeyOf(date: Date): DateKey {
  const y = String(date.getUTCFullYear()).padStart(4, '0');
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 在线源共用的「滚动一年」窗口：从今天回溯 364 天，再把起点对齐到所在周的周日。
 * `years` 是窗口覆盖到的公历年，供按年查询的 API 逐年请求。
 */
export function rollingWindow(now: Date): {
  from: DateKey;
  to: DateKey;
  years: readonly number[];
} {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const start = today - 364 * DAY_MS;
  const fromMs = start - new Date(start).getUTCDay() * DAY_MS;
  const first = new Date(fromMs);
  const last = new Date(today);
  const years: number[] = [];
  for (let year = first.getUTCFullYear(); year <= last.getUTCFullYear(); year += 1) years.push(year);
  return { from: dateKeyOf(first), to: dateKeyOf(last), years };
}
