
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * 可复现随机数 —— 对应 Python 版的 `random.Random(seed)`。
 *
 * 用 mulberry32（32 位状态、周期 2^32）而不是 `Math.random()`：GIF 必须**逐帧可复现**，
 * 否则同一个 --seed 跑两次出来的动画不一样，根本没法对比调参。
 *
 * Python 的 `random` 与 JS 的 `Math.random` 算法不同，所以本文件**不会**和 Python 版
 * 逐帧一致（那是两套独立的随机序列）。一致性只保证「同一份 TS 代码、同一个 seed
 * 永远得到同一条动画」。
 */export class Rng {
  private s: number;

  constructor(seed?: number) {
    // seed 缺省时用时间+熵混合，对应 Python 的 random.Random(None)
    this.s = (seed ?? (Date.now() ^ Math.floor(Math.random() * 0xffffffff))) >>> 0;
  }

  /** [0, 1) 均匀分布。 */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [a, b) 均匀分布，对应 `rng.uniform(a, b)`。 */
  uniform(a: number, b: number): number {
    return a + (b - a) * this.next();
  }

  /** [a, b] 闭区间整数，对应 `rng.randint(a, b)`。 */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  /** 等概率取一个元素，对应 `rng.choice(seq)`。 */
  choice<T>(seq: readonly T[]): T {
    return seq[this.int(0, seq.length - 1)];
  }

  /** 加权取一个元素，对应 `rng.choices(population, weights)[0]`。 */
  weighted<T>(seq: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < seq.length; i++) {
      r -= weights[i];
      if (r < 0) return seq[i];
    }
    return seq[seq.length - 1];
  }
}