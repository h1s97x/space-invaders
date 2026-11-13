/**
 * 规则装配处：活跃度 → 敌人类型 / 波次 / 动作序列。
 *
 * 新增玩法 = 在这里加一个 Rule 并放进 builtinRules，注册表会自动收录；
 * cli/ 与 render/ 不需要知道有几种玩法。
 */

import type { Rule } from '../contract/registry.js';
import { buildLevel } from './model.js';
import { simulateLevel, simulateSpread, simulateWaves } from './simulate.js';

/** 默认：按 CONTRIB_SEED 洗牌，清场不按位置连续推进。 */
export const shuffleRule: Rule = {
  id: 'shuffle',
  build: buildLevel,
  simulate: simulateLevel,
};

/** 可回退：中心扩散。 */
export const spreadRule: Rule = {
  id: 'spread',
  build: buildLevel,
  simulate: simulateSpread,
};

/** 可回退：按列从左到右。 */
export const wavesRule: Rule = {
  id: 'waves',
  build: buildLevel,
  simulate: simulateWaves,
};

export const builtinRules: readonly Rule[] = Object.freeze([shuffleRule, spreadRule, wavesRule]);
