/**
 * 动作 → 逐帧阶段（纯数据，零像素、零平台）。
 *
 * `domain/` 只产出抽象 Action；本模块把它展开成可见的动画阶段，让
 * 「飞船匀速到位 → 发射 → 子弹飞行 → 命中 → 冷却 → 收尾」每一帧都有画面。
 * 命中仍由 `fire` 决定，这里只是把结算时机推迟到弹道走完，不改变关卡语义。
 * 参数一律以「帧」为单位、本项目自定，不涉及任何上游的速度 / 时间步长 / 节奏常量。
 */

import type { Action } from '../contract/action.js';

export interface MotionParams {
  /** 飞船每帧匀速推进的列数（按距离均分，最后一帧精确落在目标列） */
  shipStep: number;
  /** 子弹每帧完成的弹道进度 0..1 */
  bulletProgressStep: number;
  /** 两发之间的冷却帧 */
  cooldownFrames: number;
  /** 收尾让爆炸散完的帧数 */
  tailFrames: number;
}

export const defaultMotion: Readonly<MotionParams> = Object.freeze({
  shipStep: 1.5,
  bulletProgressStep: 0.25,
  cooldownFrames: 2,
  tailFrames: 5,
});

export type Phase =
  | { kind: 'start'; column: number }
  | { kind: 'travel'; from: number; to: number; progress: number }
  | { kind: 'launch'; action: Action; column: number; progress: 0 }
  | { kind: 'flight'; action: Action; progress: number }
  | { kind: 'impact'; action: Action }
  | { kind: 'cooldown' }
  | { kind: 'tail' };

/** 弹道帧数（含发射帧与命中帧）。 */
export function flightFrames(params: MotionParams = defaultMotion): number {
  return Math.max(1, Math.ceil(1 / params.bulletProgressStep));
}

/**
 * 展开动作序列。每个阶段对应一帧；`travel` 帧数由列距决定，
 * 到位后才可能出现 `launch`，因此「停稳才开火」是结构保证，不是渲染层的判断。
 */
export function* expand(
  actions: Iterable<Action>,
  startColumn: number,
  params: MotionParams = defaultMotion,
): Generator<Phase, void, undefined> {
  let column = startColumn;
  yield { kind: 'start', column };

  const steps = flightFrames(params);
  for (const action of actions) {
    if (action.kind === 'move' && action.column !== undefined) {
      const from = column;
      const to = action.column;
      const travel = Math.ceil(Math.abs(to - from) / params.shipStep);
      for (let i = 1; i <= travel; i += 1) {
        yield { kind: 'travel', from, to, progress: i / travel };
      }
      column = to;
      continue;
    }

    if (action.kind === 'fire') {
      yield { kind: 'launch', action, column, progress: 0 };
      for (let i = 1; i < steps; i += 1) {
        yield { kind: 'flight', action, progress: i / steps };
      }
      yield { kind: 'impact', action };
      for (let i = 0; i < params.cooldownFrames; i += 1) yield { kind: 'cooldown' };
      continue;
    }

    if (action.kind === 'finish') {
      for (let i = 0; i < params.tailFrames; i += 1) yield { kind: 'tail' };
    }
    // rest 是 domain 的节奏留白，冷却帧已覆盖，不额外出帧
  }
}
