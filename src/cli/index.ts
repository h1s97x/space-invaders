#!/usr/bin/env node
/**
 * 唯一入口：读 env → 选 source → 生成关卡 → 渲染 → 编码 → 写一个文件 → 退出。
 *
 * 内核零平台：没有平台判断、没有凭据探测、没有输出变量、没有提交动作。
 */

import type { Frame } from '../contract/action.js';
import { parseArgs, type Config } from './args.js';
import { report, writeGif } from './outputs.js';
import { sources } from '../sources/index.js';
import { rules } from '../domain/index.js';
import { renderers } from '../render/index.js';
import { encodeGif, type GifFrame } from '../render/codec/gif.js';
import { buildPaletteFromFrames, toIndices, upscale, type Palette } from '../render/codec/pixels.js';
import type { RGB } from '../render/codec/types.js';
import { defaultTheme } from '../render/invader/theme.js';

/**
 * 数据层主色：怪物、飞船、子弹。背景与爆炸都复用有限色带 / 弹色，
 * 这里只保留主题色，确保量化时低频特效色不被近似掉。
 */
const ACCENT_COLORS: readonly RGB[] = Object.freeze([
  defaultTheme.drone,
  defaultTheme.cluster,
  defaultTheme.boss,
  defaultTheme.ship,
  defaultTheme.bullet,
] as RGB[]);

/** 两遍流式：第一遍统计颜色，第二遍边放大边编码，帧不驻留内存。 */
function* pixelFrames(frames: Iterable<Frame>, max: number): Generator<Uint8ClampedArray> {
  let emitted = 0;
  for (const frame of frames) {
    if (emitted >= max) break;
    yield frame.data;
    emitted += 1;
  }
}

function encodeSequence(
  makeFrames: () => Iterable<Frame>,
  cfg: Config,
): { buffer: Buffer; frames: number } {
  const palette: Palette = buildPaletteFromFrames(
    pixelFrames(makeFrames(), cfg.maxFrames),
    255,
    ACCENT_COLORS,
  );
  let frames = 0;

  function* gifFrames(): Generator<GifFrame, void, undefined> {
    let previous: Uint8ClampedArray | null = null;
    for (const frame of makeFrames()) {
      if (frames >= cfg.maxFrames) break;
      const up = upscale(frame.data, frame.width, frame.height, cfg.scale);
      const indices = toIndices(up.data, palette.map, palette.nearest);
      const current = new Uint32Array(up.data.buffer, up.data.byteOffset, up.width * up.height);
      const before = previous
        ? new Uint32Array(previous.buffer, previous.byteOffset, previous.length / 4)
        : null;

      let left = 0;
      let top = 0;
      let width = up.width;
      let height = up.height;
      let region: Uint8Array = indices;

      if (before) {
        let minX = up.width;
        let minY = up.height;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < up.height; y += 1) {
          for (let x = 0; x < up.width; x += 1) {
            if (current[y * up.width + x] === before[y * up.width + x]) continue;
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }

        if (maxX < 0) {
          // 整帧未变：写 1×1 全透明帧，播放器保留上一帧
          width = 1;
          height = 1;
          region = new Uint8Array([0]);
        } else {
          left = minX;
          top = minY;
          width = maxX - minX + 1;
          height = maxY - minY + 1;
          region = new Uint8Array(width * height);
          for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
              const gx = left + x;
              const gy = top + y;
              const at = gy * up.width + gx;
              region[y * width + x] = current[at] === before[at] ? 0 : indices[at]!;
            }
          }
        }
      }

      previous = Uint8ClampedArray.from(up.data);
      yield {
        indices: region,
        palette: palette.palette,
        transparentIndex: 0,
        delay: frame.delayMs,
        left,
        top,
        width,
        height,
      };
      frames += 1;
    }
  }

  const buffer = encodeGif({
    width: cfg.width * cfg.scale,
    height: cfg.height * cfg.scale,
    frames: gifFrames(),
  });
  if (frames === 0) throw new Error('没有可编码的帧');
  return { buffer, frames };
}

async function main(): Promise<void> {
  const cfg = parseArgs();

  const source = sources.get(cfg.source);
  const calendar = await source.read({
    user: cfg.user,
    token: cfg.token,
    endpoint: cfg.endpoint,
    path: cfg.calendar,
  });

  const rule = rules.get(cfg.rule);
  const level = rule.build(calendar, cfg.seed);
  const renderer = renderers.get(cfg.renderer);
  const makeFrames = (): Iterable<Frame> =>
    renderer.frames(level, rule.simulate(level), {
      width: cfg.width,
      height: cfg.height,
      scale: cfg.scale,
      fps: cfg.fps,
      maxFrames: cfg.maxFrames,
    });

  const { buffer, frames } = encodeSequence(makeFrames, cfg);
  await writeGif(cfg.output, buffer);

  const targets = level.waves.reduce((sum, wave) => sum + wave.targets.length, 0);
  report({
    source: source.id,
    targets,
    frames,
    bytes: buffer.length,
    path: cfg.output,
  });
}

main().catch((error: unknown) => {
  console.error(`[space-invaders] 失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
