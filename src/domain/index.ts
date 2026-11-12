/** rule 注册表。换玩法 = 加一个模块并在这里注册，render/ 与 cli/ 不动。 */

import { createRegistry, type Registry, type Rule } from '../contract/registry.js';
import { builtinRules } from './rules.js';

export const rules: Registry<Rule> = createRegistry<Rule>('rule');
for (const rule of builtinRules) rules.register(rule);
