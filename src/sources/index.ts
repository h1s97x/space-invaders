/** source 注册表。新增平台 = 加一个模块并在这里注册，核心文件不动。 */

import { createRegistry, type Registry, type Source } from '../contract/registry.js';
import { cnbSource } from './cnb.js';
import { fileSource } from './file.js';
import { githubSource } from './github.js';
import { mockSource } from './mock.js';

export const sources: Registry<Source> = createRegistry<Source>('source');
sources.register(mockSource);
sources.register(fileSource);
sources.register(githubSource);
sources.register(cnbSource);
