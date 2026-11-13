/**
 * Level → Action[]：自研「波次」推进器。
 *
 * 三种规则由 rules.ts 注册：`shuffle`（按发洗牌，默认）/ `spread` / `waves`。
 * 默认规则把「每一发」按 seed 打散到全画面，飞船不再清完一整列才走；
 * 另两种规则按列连续发射，作为可回退对照。
 * 共用一条硬规则：每次 `fire` 动态挑该列 `row` 最大（最下方）仍活着的目标，
 * 所以 `Action.target` 天然就是子弹沿列向上飞时命中的第一个敌人 —— 不会穿过前排。
 * 规则层维护一份纯 `remaining` 状态，`Action` 契约形状不变，渲染层仍不决定打谁。
 * 每列在发射计划里出现的次数恒等于该列总强度，因此一定能清完且可复现。
 */

import type { Action, Level, Target } from '../contract/action.js';

type Plan = (level: Level, byColumn: ReadonlyMap<number, Target[]>, seed: number) => number[];

function* runPlan(level: Level, plan: Plan): Generator<Action, void, undefined> {
  const remaining = new Map<string, number>();
  const byColumn = new Map<number, Target[]>();
  for (const wave of level.waves) {
    for (const target of wave.targets) {
      remaining.set(target.key, target.tier);
      const group = byColumn.get(target.column) ?? [];
      group.push(target);
      byColumn.set(target.column, group);
    }
  }

  let combo = 0;
  let current = -1;
  for (const column of plan(level, byColumn, level.seed)) {
    if (column !== current) {
      yield { kind: 'move', column };
      current = column;
    }

    // 每发都重选：打死后自动落到下一个最下方的活目标，视觉上子弹不会越过它。
    const victim = (byColumn.get(column) ?? [])
      .filter((target) => (remaining.get(target.key) ?? 0) > 0)
      .sort((a, b) => b.row - a.row)[0];
    if (!victim) continue;
    remaining.set(victim.key, (remaining.get(victim.key) ?? 1) - 1);
    combo += 1;
    yield { kind: 'fire', column, target: victim.key, combo };
  }
  yield { kind: 'finish', combo };
}

/** 自研 xorshift + Fisher-Yates：同一 seed 必得同一发射计划，换 seed 换一套顺序。 */
function shuffled(items: readonly number[], seed: number): number[] {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** 把列序列展开成逐发计划：每列重复「该列总强度」次。 */
function repeatColumns(byColumn: ReadonlyMap<number, Target[]>, order: readonly number[]): number[] {
  const plan: number[] = [];
  for (const column of order) {
    const shots = (byColumn.get(column) ?? []).reduce((sum, target) => sum + target.tier, 0);
    for (let i = 0; i < shots; i += 1) plan.push(column);
  }
  return plan;
}

/** 默认规则：把逐发计划整体洗牌，飞船在全画面点射，不再整列清空。 */
export function* simulateLevel(level: Level): Generator<Action, void, undefined> {
  yield* runPlan(level, (_lvl, byColumn, seed) =>
    shuffled(repeatColumns(byColumn, [...byColumn.keys()].sort((a, b) => a - b)), seed));
}

/** 中心扩散：列按到中心距离排序，同列连发（整列清完才走）。 */
export function* simulateSpread(level: Level): Generator<Action, void, undefined> {
  yield* runPlan(level, (lvl, byColumn) => {
    const mid = Math.floor(lvl.columns / 2);
    const order = [...byColumn.keys()].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
    return repeatColumns(byColumn, order);
  });
}

/** 旧逐列顺序，保留为可回退的规则。视觉命中逻辑与其余规则完全一致。 */
export function* simulateWaves(level: Level): Generator<Action, void, undefined> {
  yield* runPlan(level, (_lvl, byColumn) =>
    repeatColumns(byColumn, [...byColumn.keys()].sort((a, b) => a - b)));
}
