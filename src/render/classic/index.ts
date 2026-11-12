/** classic 渲染器：贡献日历方阵 + 星点 + 极简 HUD，与 invader 并存的第二种输出。 */

import type { Action, Frame, Level, RenderContext } from '../../contract/action.js';
import type { Renderer } from '../../contract/registry.js';
import { animate } from './animate.js';

export const classicRenderer: Renderer = {
  id: 'classic',
  *frames(level: Level, actions: Iterable<Action>, ctx: RenderContext): Iterable<Frame> {
    yield* animate(level, actions, ctx);
  },
};
