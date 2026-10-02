
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * GIF 编码：共享调色板 + 透明索引差分。
 *
 * 与 Python 版（`gif.py`：PIL quantize + optimize=True 脏矩形差分）目标一致，
 * 换成 gifenc 之后靠**透明索引**实现同样的差分：把与上一帧**完全相同**的像素
 * 写成透明索引，并让 disposal=0（不恢复背景），于是解码器直接沿用上一帧内容 ——
 * 变化的像素才真正进 LZW 压缩流，体积大头因此只剩「变化区域」。
 *
 * 另外两条别踩回去：
 *  * **不指定 disposal=2** —— 那会强制每帧全量编码，体积直接翻倍；
 *  * **共享一张调色板**（只用首帧量化一次）—— 每帧各自量化会让色号在帧间漂移，
 *    播放时出现整片格子集体变色（"闪烁"）。
 */
import { writeFileSync } from 'node:fs';
import {
  GIFEncoder,
  applyPalette,
  quantize,
  type PaletteEntry,
} from 'gifenc/dist/gifenc.esm.js';
import { DEFAULT_COLORS } from './config.js';
import type { Frame } from './render.js';

function clampColors(colors: number): number {
  return Math.max(2, Math.min(255, colors));
}

/**
 * 首帧量化出统一调色板，给所有帧共用 → 不闪烁。
 *
 * 末尾**多留一项**当透明索引：GIF 的透明色是靠「色号 + transparent 标志」表达的，
 * 这个色号必须占一个真实槽位，所以可用的量化色数要少1（32 色 → 实际量化 32，
 * 索引 0..31，索引 32 专用作透明）。
 *
 * gifenc 的调色板是 `[r,g,b]` 子数组的数组（不是扁平字节），长度也不必是 2 的幂：
 * 它按 `1 << ceil(log2(len))` 写全局色表并用同一个公式填 LSD 的色表大小字段，
 * 两边自洽。塞不满的项会补 `[0,0,0]`。
 */
export function buildPalette(first: Frame, colors = DEFAULT_COLORS): PaletteEntry[] {
  const n = clampColors(colors);
  const found = quantize(asExactU8(first.data), n);
  const palette: PaletteEntry[] = [];
  for (let i = 0; i < n; i++) palette.push(found[i] ?? [0, 0, 0]);
  palette.push([0, 0, 0]); // 专用透明槽位
  return palette;
}

/**
 * 把 `getImageData().data` 变成**长度精确**的 Uint8Array 视图。
 *
 * gifenc 的 `applyPalette` 内部是 `new Uint32Array(rgba.buffer)` —— 它只认
 * 整个 ArrayBuffer，不看 byteOffset/byteLength。canvas 给的 view 恰好是精确的，
 * 但一旦底层 buffer 被复用/更大，就会整帧读到错位的像素。宁可多一次拷贝，
 * 也不能让编码器读到不属于这一帧的数据。
 */
function asExactU8(view: Uint8ClampedArray): Uint8Array {
  if (view.byteOffset === 0 && view.buffer.byteLength === view.byteLength) {
    return new Uint8Array(view.buffer);
  }
  return new Uint8Array(view);
}

export function encodeGif(
  frames: Iterable<Frame>,
  path: string,
  frameMs: number,
  colors: number = DEFAULT_COLORS,
): number {
  const it = frames[Symbol.iterator]();
  const first = it.next();
  if (first.done) throw new Error('没有帧');

  const palette = buildPalette(first.value, colors);
  const transparentIndex = palette.length - 1;
  const gif = GIFEncoder();

  // prevReal 保存上一帧的**真实**色号（不含透明占位），差分要以它为基准；
  // 不能拿上一帧写入的缓冲区比，否则「连续三帧不变的像素」会被误判成变化。
  let prevReal: Uint8Array | null = null;
  let count = 0;

  const write = (frame: Frame, isFirst: boolean): void => {
    const real = applyPalette(asExactU8(frame.data), palette);
    if (isFirst || prevReal === null) {
      gif.writeFrame(real, frame.width, frame.height, { palette, delay: frameMs, repeat: 0 });
    } else {
      const out = new Uint8Array(real.length);
      for (let i = 0; i < real.length; i++) {
        out[i] = real[i] === prevReal![i] ? transparentIndex : real[i];
      }
      gif.writeFrame(out, frame.width, frame.height, {
        delay: frameMs,
        transparent: true,
        transparentIndex,
        dispose: 0, // 0 = 不处置，上一帧内容保留 —— 透明像素才能"露"出上一帧
      });
    }
    prevReal = real;
    count++;
  };

  write(first.value, true);
  for (;;) {
    const r = it.next();
    if (r.done) break;
    write(r.value, false);
  }

  gif.finish();
  const bytes = gif.bytes();
  writeFileSync(path, bytes);
  console.log(`  ✅ ${path}  (${count} 帧, ${bytes.length.toLocaleString()} bytes)`);
  return count;
}