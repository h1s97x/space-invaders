/**
 * 三张注册表的接口签名（ADR 0000 第 4 节）。
 *
 * 本阶段只定义类型，不含实现：注册表的工厂在阶段 1 追加到本文件末尾。
 * 加平台 = sources/ 加一个 Source 并注册；加玩法 = domain/ 加一个 Rule 并注册；
 * 加输出 = render/ 加一个 Renderer 并注册。核心文件不动。
 */

import type { Calendar } from './calendar.js';
import type { Action, Frame, Level, RenderContext } from './action.js';

/** 取数上下文。fetch 可注入，让离线测试不需要真令牌、也不需要 mock 框架。 */
export interface SourceContext {
  user: string;
  token?: string;
  endpoint?: string;
  /** file 源使用的路径；其它源忽略 */
  path?: string;
  fetch?: typeof globalThis.fetch;
  /** 注入「今天」，用于确定滚动一年窗口；默认取系统时间，测试可固定 */
  now?: Date;
}

export interface Source {
  readonly id: string;
  read(ctx: SourceContext): Promise<Calendar>;
}

export interface Rule {
  readonly id: string;
  build(calendar: Calendar, seed: number): Level;
  simulate(level: Level): Iterable<Action>;
}

export interface Renderer {
  readonly id: string;
  frames(level: Level, actions: Iterable<Action>, ctx: RenderContext): Iterable<Frame>;
}

/** 所有插件的共同形状：一个可枚举的 id，便于注册表与参数校验共用。 */
export interface Named {
  readonly id: string;
}

export interface Registry<T extends Named> {
  register(item: T): void;
  get(id: string): T;
  has(id: string): boolean;
  list(): readonly string[];
}

/** 注册表工厂。失败时列出全部已注册 id，避免「改了名字却静默走默认」。 */
export function createRegistry<T extends Named>(kind: string): Registry<T> {
  const items = new Map<string, T>();
  const options = (): string => [...items.keys()].join(' | ') || '(空)';
  return {
    register(item: T): void {
      if (items.has(item.id)) throw new Error(`${kind} 重复注册: ${item.id}`);
      items.set(item.id, item);
    },
    get(id: string): T {
      const item = items.get(id);
      if (!item) throw new Error(`未注册的 ${kind}: '${id}'；可选 ${options()}`);
      return item;
    },
    has(id: string): boolean {
      return items.has(id);
    },
    list(): readonly string[] {
      return Object.freeze([...items.keys()]);
    },
  };
}
