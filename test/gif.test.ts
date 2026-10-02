/**
 * GIF 编码产物校验。
 *
 * 编码层用的是 gifenc（MIT, Matt DesLauriers），换库/改参数时用这组测试守住产物格式。
 *
 * 注意：**必须用极小的数据集**。完整动画有 2600+ 帧，一次性编码进内存会 OOM
 * （实测三次全量编码直接 SIGKILL）。这里只用 4 个格子，跑几十帧就够验格式了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WIDTH, HEIGHT, frameMsFor } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { encodeGif } from '../src/gif.js';
import { Strategy } from '../src/types.js';
import { makeContrib } from './helpers.js';

/** 只有 4 个格子、每格 1 血 —— 几帧就清完。 */
function tinyContrib() {
  const cells: number[][] = [];
  for (let c = 0; c < 52; c++) cells.push(new Array(7).fill(0));
  for (const c of [10, 20, 30, 40]) cells[c][0] = 1;
  return makeContrib(cells);
}

function encodeTiny(colors = 32): { buf: Buffer; frames: number } {
  const e = new Engine(tinyContrib(), Strategy.RANDOM, 40, 0, 1);
  const path = join(tmpdir(), `ghsi-${process.pid}-${colors}-${Math.random().toString(36).slice(2)}.gif`);
  const frames = encodeGif(e.iterFrames(false), path, e.frameMs, colors);
  const buf = readFileSync(path);
  unlinkSync(path);
  return { buf, frames };
}

test('产出的是合法 GIF89a，尺寸正确，帧数与写入一致', () => {
  const { buf, frames } = encodeTiny();
  assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a', 'GIF 头');
  assert.equal(buf[buf.length - 1], 0x3b, 'GIF 尾块 0x3B');
  assert.equal(buf.readUInt16LE(6), WIDTH, '逻辑屏宽');
  assert.equal(buf.readUInt16LE(8), HEIGHT, '逻辑屏高');
  assert.ok(buf[10] & 0x80, '应存在全局颜色表');
  assert.ok(frames > 0 && frames < 500, `小数据集帧数应很小，实际 ${frames}`);
});

test('调色板颜色数生效：16 色体积不大于 32 色', () => {
  const a = encodeTiny(16).buf.length;
  const b = encodeTiny(32).buf.length;
  assert.ok(a <= b, `16 色(${a}) 不应大于 32 色(${b})`);
});

test('颜色数被夹在 2..255（回归：曾把透明槽位算进颜色数）', () => {
  // gifenc 的 applyPalette 要求调色板长度 <= 256，
  // 我们在末尾多留一项当透明索引，所以量化色数上限是 255。
  for (const colors of [0, 1, 300]) {
    const { buf } = encodeTiny(colors);
    assert.equal(buf.subarray(0, 6).toString('ascii'), 'GIF89a', `colors=${colors} 应仍能正常编码`);
  }
});

test('帧时长换算：fps=40 → 50ms', () => {
  assert.equal(frameMsFor(40), 50);
  assert.ok(Math.abs(1000 / frameMsFor(40) - 20) < 1e-9);
});
