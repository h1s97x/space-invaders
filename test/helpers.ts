/**
 * 共享测试工具。
 *
 * 原则：**不新增任何依赖** —— 用 Node 22 内置的 `node:test` + `node:assert`，
 * 由 `tsx` 直接跑 TypeScript。
 */
import { COLS, ROWS } from '../src/config.js';
import { Contributions, type Strategy } from '../src/types.js';
import { Engine } from '../src/engine.js';

/**
 * 造一份可控的贡献数据。
 *
 * @param cells `[列][行] = 贡献数`，内部转成 `rows[行][列]`（我们数据层的轴向）
 */
export function makeContrib(cells: number[][], username = 'tester'): Contributions {
  const rows: number[][] = Array.from({ length: ROWS }, () => new Array<number>(COLS).fill(0));
  cells.forEach((col, c) => col.forEach((v, r) => { rows[r][c] = v; }));
  const total = rows.reduce((a, r) => a + r.reduce((b, v) => b + v, 0), 0);
  return new Contributions(rows, username, total);
}

/** 每一列只有 1 个格子的数据 —— 用来观察策略的「清场顺序」。 */
export function oneCellPerColumn(level = 9): Contributions {
  const cells: number[][] = [];
  for (let c = 0; c < COLS; c++) {
    const col = new Array<number>(ROWS).fill(0);
    col[0] = level;
    cells.push(col);
  }
  return makeContrib(cells);
}

/**
 * 记录每一列「被打空」的先后顺序。
 *
 * 从 `iterFrames` 逐帧观察（而不是 `simulate`），因为要看局面变化。
 * 数据集很小所以很快。
 */
export function clearOrder(contrib: Contributions, strategy: Strategy, seed = 1): number[] {
  const e = new Engine(contrib, strategy, 40, 0, seed);
  const remaining = new Set<number>(e.enemies.map((en) => en.x));
  const order: number[] = [];
  for (const _frame of e.iterFrames(false)) {
    if (remaining.size === 0) break;
    for (const c of [...remaining]) {
      if (!e.enemies.some((en) => en.x === c)) {
        remaining.delete(c);
        order.push(c);
      }
    }
  }
  return order;
}

/** 判断序列是否严格递增。 */
export function isStrictlyIncreasing(xs: number[]): boolean {
  for (let i = 1; i < xs.length; i++) if (xs[i] <= xs[i - 1]) return false;
  return true;
}