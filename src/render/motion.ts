/**
 * 动作 → 逐帧时间线（纯数据，零像素、零平台）。
 *
 * `domain/` 只产出抽象 Action；本模块按帧推进「飞船横移 / 发射 / 在飞子弹 / 命中」，
 * 允许同一时刻有多颗子弹在飞 —— 发射不再等前一颗命中。
 * 命中仍由 `fire` 决定，渲染层只按到达帧结算，不重新挑目标。
 * 参数一律以「帧」为单位、本项目自定，不涉及任何上游的速度 / 时间步长 / 节奏常量。
 */

import type { Action } from '../contract/action.js';

export interface MotionParams {
  /** 飞船每帧匀速推进的列数（按距离均分） */
  shipStep: number;
  /** 单次横移最多用几帧（0 = 不设上限） */
  maxTravelFrames: number;
  /** 子弹飞完全程需要几帧 */
  bulletFrames: number;
  /** 两发之间的最小间隔帧数 */
  shotInterval: number;
  /** 收尾让爆炸散完的帧数 */
  tailFrames: number;
}

export const defaultMotion: Readonly<MotionParams> = Object.freeze({
  shipStep: 2.5,
  maxTravelFrames: 8,
  bulletFrames: 3,
  shotInterval: 2,
  tailFrames: 5,
});

/** classic 专用：弹道更长、横移更从容，保持第 23 节的比例观感。 */
export const classicMotion: Readonly<MotionParams> = Object.freeze({
  shipStep: 2,
  maxTravelFrames: 10,
  bulletFrames: 5,
  shotInterval: 2,
  tailFrames: 5,
});

export interface BulletFlight {
  action: Action;
  /** 0 = 刚出船头；到达 1 的那帧结算命中，不再绘制 */
  progress: number;
}

/** 一帧的全部事件：渲染层照此更新状态与画面，不自己判断打谁。 */
export interface Phase {
  kind: 'frame';
  shipX: number;
  bullets: readonly BulletFlight[];
  impacts: readonly Action[];
}

interface Flying {
  action: Action;
  born: number;
}

interface Travel {
  from: number;
  to: number;
  frame: number;
  total: number;
}

/**
 * 按帧推进动作序列：
 * - `move` 启动匀速横移，期间不发射新的（到位才开火），但在飞子弹继续飞；
 * - `fire` 按最小间隔注入在飞列表，不等前一颗命中；
 * - 每颗子弹在 `born + bulletFrames` 帧结算，命中顺序必然等于发射顺序。
 */
export function* expand(
  actions: Iterable<Action>,
  startColumn: number,
  params: MotionParams = defaultMotion,
): Generator<Phase, void, undefined> {
  const queue = [...actions];
  let index = 0;
  let frame = 0;
  let shipX = startColumn;
  let travel: Travel | null = null;
  let flying: Flying[] = [];
  let lastShot = -params.shotInterval;
  let tail = 0;

  for (;;) {
    // 1. 推进飞船横移
    if (travel) {
      travel.frame += 1;
      const p = Math.min(1, travel.frame / travel.total);
      shipX = travel.from + (travel.to - travel.from) * p;
      if (travel.frame >= travel.total) {
        shipX = travel.to;
        travel = null;
      }
    }

    // 2. 推进在飞子弹，收集本帧命中的动作
    const impacts: Action[] = [];
    const still: Flying[] = [];
    for (const bullet of flying) {
      if (frame - bullet.born >= params.bulletFrames) impacts.push(bullet.action);
      else still.push(bullet);
    }
    flying = still;

    // 3. 消费动作：到位且过了发射间隔才允许发射
    while (index < queue.length) {
      const action = queue[index]!;
      if (action.kind === 'move' && action.column !== undefined) {
        if (travel) break;
        const from = shipX;
        const to = action.column;
        index += 1;
        if (Math.abs(to - from) < 1e-6) {
          shipX = to;
          continue;
        }
        const natural = Math.ceil(Math.abs(to - from) / params.shipStep);
        const total = Math.max(1, params.maxTravelFrames > 0
          ? Math.min(params.maxTravelFrames, natural)
          : natural);
        travel = { from, to, frame: 0, total };
        break;
      }
      if (action.kind === 'fire') {
        if (travel || frame - lastShot < params.shotInterval) break;
        flying.push({ action, born: frame });
        lastShot = frame;
        index += 1;
        break;
      }
      // finish / rest 不单独占帧
      index += 1;
    }

    // 4. 产出本帧
    yield {
      kind: 'frame',
      shipX,
      bullets: flying.map((bullet) => ({
        action: bullet.action,
        progress: (frame - bullet.born) / params.bulletFrames,
      })),
      impacts,
    };
    frame += 1;

    // 5. 动作消费完、子弹落完、飞船到位后，补几帧让爆炸散完
    if (index >= queue.length && flying.length === 0 && !travel) {
      tail += 1;
      if (tail > params.tailFrames) return;
    }
  }
}
