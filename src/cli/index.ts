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
  const palette: Palette = buildPaletteFromFrames(pixelFrames(makeFrames(), cfg.maxFrames), 255);
  let frames = 0;

  function* gifFrames(): Generator<GifFrame, void, undefined> {
    for (const frame of makeFrames()) {
      if (frames >= cfg.maxFrames) break;
      const up = upscale(frame.data, frame.width, frame.height, cfg.scale);
      yield {
        indices: toIndices(up.data, palette.map, palette.nearest),
        palette: palette.palette,
        transparentIndex: 0,
        delay: frame.delayMs,
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
