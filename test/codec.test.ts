/**
 * 自研编解码器的回归防护（ADR 0003：搬实现，也搬对应的结构断言）。
 *
 * 这些坑一旦回退，产出的 GIF 在浏览器里可能仍能播，但体积或帧延迟会悄悄坏掉。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif, lzwCompress, type GifFrame } from '../src/render/codec/gif.js';
import { buildPalette, FALLBACK_INDEX, toIndices, upscale } from '../src/render/codec/pixels.js';
import type { RGB } from '../src/render/codec/types.js';
import { createSurface } from '../src/render/codec/raster.js';

function frame(indices: Uint8Array, palette: Uint8Array, delay = 50): GifFrame {
  return { indices, palette, transparentIndex: 0, delay };
}

const PALETTE = new Uint8Array(768);

test('encodeGif 产出 GIF89a 结构、循环扩展与 Trailer', () => {
  const gif = encodeGif({
    width: 2,
    height: 1,
    frames: [frame(new Uint8Array([0, 1]), PALETTE), frame(new Uint8Array([1, 0]), PALETTE)],
  });
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 2);
  assert.equal(gif.readUInt16LE(8), 1);
  assert.equal(gif[gif.length - 1], 0x3b);

  // Netscape 循环扩展必须写在第一帧之前
  const loop = gif.indexOf(Buffer.from([0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53]));
  const firstImage = gif.indexOf(Buffer.from([0x2c]));
  assert.ok(loop >= 0 && firstImage > loop, '循环扩展在第一帧之前');
});

test('帧延迟写进图形控制扩展，并转成 1/100 秒', () => {
  const gif = encodeGif({ width: 1, height: 1, frames: [frame(new Uint8Array([0]), PALETTE, 50)] });
  const gce = gif.indexOf(Buffer.from([0x21, 0xf9, 0x04]));
  assert.ok(gce >= 0);
  assert.equal(gif.readUInt16LE(gce + 4), 5);
});

test('无帧与超尺寸都立即报错', () => {
  assert.throws(() => encodeGif({ width: 1, height: 1, frames: [] }), /至少需要一帧/);
  assert.throws(() => encodeGif({
    width: 65536,
    height: 1,
    frames: [frame(new Uint8Array([0]), PALETTE)],
  }), /尺寸超出上限/);
});

test('lzwCompress 首码是 clear code，压缩比随重复度提升', () => {
  const flat = new Uint8Array(512).fill(7);
  const noisy = new Uint8Array(512).map((_, i) => i % 251);
  const compressed = lzwCompress(flat, 8);
  assert.ok(compressed.length > 2);
  // 码宽是 9 位，首码跨两个字节：按 LSB 顺序还原才是 clear code
  const firstCode = (compressed[0]! | (compressed[1]! << 8)) & 0x1ff;
  assert.equal(firstCode, 1 << 8);
  assert.ok(lzwCompress(noisy, 8).length > compressed.length);
});

test('预留色优先进入调色板，不会被高频背景色阶挤出', () => {
  const accent: RGB = [255, 160, 72];
  const data = new Uint8ClampedArray(8 * 4);
  for (let i = 0; i < 7; i += 1) {
    const gray = 20 + i * 20;
    data.set([gray, gray, gray, 255], i * 4);
  }
  data.set([...accent, 255], 7 * 4);

  // limit=3 只放得下 2 个实色；不预留时暖色按 key 排序必被灰阶挤掉
  const plain = buildPalette(data, 3);
  const reserved = buildPalette(data, 3, [accent]);
  const key = (accent[0] << 16) | (accent[1] << 8) | accent[2];
  assert.equal(plain.map.has(key), false);
  assert.ok(reserved.map.has(key), '预留的暖色必须保真');
});

test('透明像素落索引 0，纯白不透明不是透明色', () => {
  const surface = createSurface(2, 1);
  surface.rect(1, 0, 2, 1, [255, 255, 255]);
  const palette = buildPalette(surface.data, 255);
  const indices = toIndices(surface.data, palette.map, palette.nearest);
  assert.equal(indices[0], 0);
  assert.notEqual(indices[1], 0);
  assert.equal(FALLBACK_INDEX, 255);
});

test('upscale 是整数倍最近邻，scale=1 原样返回', () => {
  const surface = createSurface(2, 1);
  surface.rect(0, 0, 1, 1, [255, 0, 0]);
  surface.rect(1, 0, 2, 1, [0, 0, 255]);
  const same = upscale(surface.data, 2, 1, 1);
  assert.equal(same.width, 2);
  assert.deepEqual([...same.data], [...surface.data]);

  const big = upscale(surface.data, 2, 1, 2);
  assert.equal(big.width, 4);
  assert.equal(big.height, 2);
  assert.deepEqual([...big.data.subarray(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...big.data.subarray(4, 8)], [255, 0, 0, 255]);
});
