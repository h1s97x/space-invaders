/**
 * 生成黄金摘要（阶段 1 只记录尺寸 / 帧数 / 摘要，不入库 GIF 本体）。
 *
 * 用法：npm run golden → 更新 test/golden/mock.json
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cli = resolve(here, '..', 'src', 'cli', 'index.js');

const dir = mkdtempSync(join(tmpdir(), 'space-invaders-golden-'));
const out = join(dir, 'golden.gif');
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
  if (result.status !== 0) throw new Error(result.stderr || 'CLI 运行失败');

  const buffer = readFileSync(out);
  let frames = 0;
  for (let i = 0; i + 2 < buffer.length; i += 1) {
    if (buffer[i] === 0x21 && buffer[i + 1] === 0xf9 && buffer[i + 2] === 0x04) frames += 1;
  }

  const golden = {
    source: 'mock',
    seed: 1,
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    frames,
    bytes: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
  const target = join(repoRoot, 'test', 'golden', 'mock.json');
  writeFileSync(target, `${JSON.stringify(golden, null, 2)}\n`);
  console.log(`[golden] 已写入 ${target}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
