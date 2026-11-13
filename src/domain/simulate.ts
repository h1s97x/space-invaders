/**
 * Level → Action[]：自研「波次」推进器。
 *
 * 三种列顺序由 rules.ts 注册：`shuffle`（按 seed 洗牌，默认）/
 * `spread`（中心扩散）/ `waves`（逐列）。
 * 共用一条硬规则：每次 `fire` 动态挑当前列 `row` 最大（最下方）仍活着的目标，
 * 所以 `Action.target` 天然就是子弹沿列向上飞时命中的第一个敌人 —— 不会穿过前排。
 * 规则层维护一份纯 `remaining` 状态，`Action` 契约形状不变，渲染层仍不决定打谁。
 * 发射总数恒等于全部强度之和，因此一定能清完且可复现。
 */

import type { Action, Level, Target } from '../contract/action.js';

type Order = (level: Level, columns: readonly number[]) => number[];

function* runColumns(level: Level, order: Order): Generator<Action, void, undefined> {
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
  for (const column of order(level, [...byColumn.keys()])) {
    const group = byColumn.get(column) ?? [];
    const shots = group.reduce((sum, target) => sum + target.tier, 0);
    yield { kind: 'move', column };

    for (let shot = 0; shot < shots; shot += 1) {
      // 每发都重选：打死后自动落到下一个最下方的活目标，视觉上子弹不会越过它。
      const victim = group
        .filter((target) => (remaining.get(target.key) ?? 0) > 0)
        .sort((a, b) => b.row - a.row)[0];
      if (!victim) break;
      remaining.set(victim.key, (remaining.get(victim.key) ?? 1) - 1);
      combo += 1;
      yield { kind: 'fire', column, target: victim.key, combo };
    }
    yield { kind: 'rest' };
  }
  yield { kind: 'finish', combo };
}

/** 自研 xorshift + Fisher-Yates：同一 seed 必得同一列序，换 seed 换一套清场顺序。 */
function shuffled(columns: readonly number[], seed: number): number[] {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
  const result = [...columns];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = result[i]!;
    const b = result[j]!;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** 默认规则：按 level.seed 打乱列序，剩余敌人始终散布全画面。 */
export function* simulateLevel(level: Level): Generator<Action, void, undefined> {
  yield* runColumns(level, (lvl, columns) => shuffled(columns, lvl.seed));
}

/** 中心扩散：从中间列向两侧交替，同距离先左后右。 */
export function* simulateSpread(level: Level): Generator<Action, void, undefined> {
  yield* runColumns(level, (lvl, columns) => {
    const mid = Math.floor(lvl.columns / 2);
    return [...columns].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid) || a - b);
  });
}

/** 旧逐列顺序，保留为可回退的规则。视觉命中逻辑与其余规则完全一致。 */
export function* simulateWaves(level: Level): Generator<Action, void, undefined> {
  yield* runColumns(level, (_lvl, columns) => [...columns].sort((a, b) => a - b));
}
