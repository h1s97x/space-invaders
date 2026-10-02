
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * gifenc 没有随包发布类型声明，这里只声明我们实际用到的 API。
 *
 * 注意模块路径写的是 `gifenc/dist/gifenc.esm.js` 而不是裸包名 `gifenc`：
 * gifenc 的 package.json 里 `main` 指向 CJS 构建，Node 的 ESM 加载器对
 * esbuild 产出的 CJS（`__export` getter 形式）**探测不到具名导出**，
 * `import { GIFEncoder } from 'gifenc'` 会直接抛
 * "The requested module does not provide an export named 'GIFEncoder'"。
 * 它同时提供了 `module` 字段指向的 ESM 构建，所以这里显式引那个文件。
 *
 * 关键数据结构：**调色板是 `[r,g,b]` 子数组的数组**，不是扁平字节数组；
 * `applyPalette` 要求它的长度 ≤ 256。
 */
declare module 'gifenc/dist/gifenc.esm.js' {
  /** 一个调色板项：[r, g, b]（量化带 alpha 时可能是 [r,g,b,a]）。 */
  export type PaletteEntry = number[];

  export interface WriteFrameOptions {
    palette?: PaletteEntry[] | null;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    repeat?: number;
    dispose?: number;
    first?: boolean;
    colorDepth?: number;
  }

  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions,
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
  }

  export function GIFEncoder(): Encoder;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
  ): PaletteEntry[];

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: PaletteEntry[],
    format?: string,
  ): Uint8Array;
}