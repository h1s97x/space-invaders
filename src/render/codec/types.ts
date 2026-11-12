/**
 * 编解码器自用的最小类型面（ADR 0003）。
 *
 * 刻意只有四个类型：不含 Cell / Board / Enemy / Ship 等任何玩法类型，
 * 因此 `raster.ts` / `pixels.ts` / `gif.ts` 可以独立于玩法演进。
 */

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type Point = [number, number];
export type PixelBuffer = Uint8Array | Uint8ClampedArray;
