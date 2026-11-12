/** renderer 注册表。加一种输出 = 加一个模块并在这里注册，domain/ 与 cli/ 不动。 */

import { createRegistry, type Registry, type Renderer } from '../contract/registry.js';
import { invaderRenderer } from './invader/index.js';

export const renderers: Registry<Renderer> = createRegistry<Renderer>('renderer');
renderers.register(invaderRenderer);
