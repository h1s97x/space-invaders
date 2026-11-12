import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Renderer } from '../src/contract/registry.js';
import { renderers } from '../src/render/index.js';

const cli = fileURLToPath(new URL('../src/cli/index.js', import.meta.url));
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 图形控制扩展出现次数 = GIF 帧数。 */
function countFrames(buffer: Buffer): number {
  let count = 0;
  for (let i = 0; i + 2 < buffer.length; i += 1) {
    if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9 && buffer[i + 2] === 0x04) count += 1;
  }
  return count;
}

function run(env: Record<string, string>): { status: number | null; stderr: string; stdout: string; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'space-invaders-e2e-'));
  const out = join(dir, 'nested', 'out.gif');
  const result = spawnSync(process.execPath, [cli], {
    env: { ...process.env, ...env, CONTRIB_OUTPUT: out },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
    out,
  };
}

test('mock calendar → 10 帧 GIF（阶段 1 出口验收）', () => {
  const dir = mkdtempSync(join(tmpdir(), 'space-invaders-e2e-'));
  const out = join(dir, 'nested', 'out.gif');
  try {
    const result = spawnSync(process.execPath, [cli], {
      env: {
        ...process.env,
        CONTRIB_SOURCE: 'mock',
        CONTRIB_SEED: '1',
        CONTRIB_MAX_FRAMES: '10',
        CONTRIB_OUTPUT: out,
      },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);

    const buffer = readFileSync(out);
    assert.equal(buffer.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.equal(buffer.readUInt16LE(6), 480, '逻辑屏宽 = width × scale');
    assert.equal(buffer.readUInt16LE(8), 160, '逻辑屏高 = height × scale');
    assert.equal(countFrames(buffer), 10);
    assert.equal(buffer[buffer.length - 1], 0x3b, 'Trailer');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('非法枚举与未注册的插件立即失败，不静默回落', () => {
  const badEnum = run({ CONTRIB_SOURCE: 'does-not-exist' });
  assert.notEqual(badEnum.status, 0);
  assert.match(badEnum.stderr, /CONTRIB_SOURCE 只能是/);
  rmSync(join(badEnum.out, '..', '..'), { recursive: true, force: true });

  const badRule = run({ CONTRIB_RULE: 'nope' });
  assert.notEqual(badRule.status, 0);
  assert.match(badRule.stderr, /未注册的 rule/);
  rmSync(join(badRule.out, '..', '..'), { recursive: true, force: true });
});

test('黄金帧摘要稳定', () => {
  const result = run({ CONTRIB_SOURCE: 'mock', CONTRIB_SEED: '1', CONTRIB_MAX_FRAMES: '10' });
  assert.equal(result.status, 0, result.stderr);
  const buffer = readFileSync(result.out);
  const golden = JSON.parse(
    readFileSync(join(repoRoot, 'test', 'golden', 'mock.json'), 'utf8'),
  ) as { frames: number; width: number; height: number; sha256: string };

  assert.equal(countFrames(buffer), golden.frames);
  assert.equal(buffer.readUInt16LE(6), golden.width);
  assert.equal(buffer.readUInt16LE(8), golden.height);
  assert.equal(createHash('sha256').update(buffer).digest('hex'), golden.sha256);
  rmSync(join(result.out, '..', '..'), { recursive: true, force: true });
});

test('注册表可扩展：加一个假 renderer 无需改核心文件', () => {
  const dummy: Renderer = { id: 'dummy', frames: () => [] };
  renderers.register(dummy);
  assert.equal(renderers.get('dummy'), dummy);
  assert.equal(typeof dummy.frames, 'function');
  assert.ok(renderers.list().includes('invader'));
  assert.ok(renderers.list().includes('dummy'));
});
