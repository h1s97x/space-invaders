/**
 * invader 渲染器：一层薄装配，只把注册表接口接到 animate()。
 *
 * 换渲染器 = 在 src/render/ 下加一个目录并注册，cli/ 与 domain/ 不动。
 */

import type { Action, Frame, Level, RenderContext } from '../../contract/action.js';
import type { Renderer } from '../../contract/registry.js';
import { animate } from './animate.js';

export const invaderRenderer: Renderer = {
  id: 'invader',
  frames(level: Level, actions: Iterable<Action>, ctx: RenderContext): Iterable<Frame> {
    return animate(level, actions, ctx);
  },
};
