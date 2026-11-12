/**
 * 规则装配处：活跃度 → 敌人类型 / 波次 / 连击。
 *
 * 新增玩法 = 在这里加一个 Rule 并放进 builtinRules，注册表会自动收录；
 * cli/ 与 render/ 不需要知道有几种玩法。
 */

import type { Rule } from '../contract/registry.js';
import { buildLevel } from './model.js';
import { simulateLevel } from './simulate.js';

export const wavesRule: Rule = {
  id: 'waves',
  build: buildLevel,
  simulate: simulateLevel,
};

export const builtinRules: readonly Rule[] = Object.freeze([wavesRule]);
