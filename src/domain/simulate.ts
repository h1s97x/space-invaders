/**
 * Level + seed → Action[]：自研「波次 + 连击」的推进器。
 *
 * 随机源是自己实现的 xorshift32，不用 Math.random，因此同一 seed 永远同一串动作。
 * 只产出抽象动作（move / fire / rest / finish），不含像素、帧号或平台概念。
 */

import type { Action, Level, Target } from '../contract/action.js';

/** 自研确定性洗牌：波内目标顺序由 seed 决定，观感不必每局一样，但必须可复现。 */
function seededOrder<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4_294_967_296;
  };
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = copy[i]!;
    const b = copy[j]!;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

function* actionsFor(
  targets: readonly Target[],
  seed: number,
  comboStart: number,
): Generator<Action, number, undefined> {
  let combo = comboStart;
  for (const target of seededOrder(targets, seed)) {
    yield { kind: 'move', column: target.column };
    for (let shot = 0; shot < target.tier; shot += 1) {
      combo += 1;
      yield { kind: 'fire', column: target.column, target: target.key, combo };
    }
    yield { kind: 'rest' };
  }
  return combo;
}

export function* simulateLevel(level: Level): Generator<Action, void, undefined> {
  let combo = 0;
  for (const wave of level.waves) {
    combo = yield* actionsFor(wave.targets, level.seed + wave.index, combo);
  }
  yield { kind: 'finish', combo };
}
