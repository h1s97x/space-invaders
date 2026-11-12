/**
 * domain ↔ render 之间的契约：关卡、动作、帧。
 *
 * 硬约束（ADR 0000 第 4 节）：domain/ 不 import sources/，render/ 不 import
 * 具体玩法。两边只认本文件的形状，因此换规则或换渲染器都不必改对方。
 */

import type { DateKey } from './calendar.js';

/**
 * 自研强度分档。刻意不叫 health / level：本项目的规则是「波次 + 热度」，
 * 不沿用任何参考项目的血量口径。
 */
export type Tier = 1 | 2 | 3;

/** 自研敌人类型，由活跃度分档决定形状，与任何参考项目的血量口径无关。 */
export type EnemyKind = 'drone' | 'cluster' | 'boss';

/** 分档 → 敌人类型的唯一映射，供规则层与渲染层共用。 */
export function enemyKindOf(tier: Tier): EnemyKind {
  return tier === 1 ? 'drone' : tier === 2 ? 'cluster' : 'boss';
}

/** 一个可攻击目标：日历里活跃的一天。坐标是网格坐标，不是像素。 */
export interface Target {
  key: DateKey;
  /** 第几周（0 起），由 from 所在周的周日算起 */
  column: number;
  /** 周内第几天（0 起，0 = 周日） */
  row: number;
  tier: Tier;
  kind: EnemyKind;
  /** 归一化活跃度 0..1，由规则层按分位计算 */
  heat: number;
}

/** 一波：同一周内的目标集合。 */
export interface Wave {
  index: number;
  targets: Target[];
}

export interface Level {
  seed: number;
  from: DateKey;
  to: DateKey;
  columns: number;
  waves: Wave[];
}

/**
 * 抽象动作，不含像素、帧号或平台概念。
 * - `move`：飞船移到某列
 * - `fire`：向某目标开火（命中效果由规则层决定的 combo 传递）
 * - `rest`：空转一帧，用于节奏留白
 * - `finish`：清场收尾标记
 */
export type ActionKind = 'move' | 'fire' | 'rest' | 'finish';

export interface Action {
  kind: ActionKind;
  column?: number;
  target?: DateKey;
  /** 连击计数，渲染层据此决定特效强度 */
  combo?: number;
}

/** 渲染上下文：纯数据，由 CLI 从 CONTRIB_* 组装。 */
export interface RenderContext {
  width: number;
  height: number;
  scale: number;
  fps: number;
  /** 输出帧数上限，保证流水线有界 */
  maxFrames: number;
}

/** 一帧完整 RGBA 画面（自研光栅的产物，可直接交给 codec）。 */
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  delayMs: number;
}
