/**
 * 输出契约（docs/02-contract.md 第 4 节）：只落盘 + stdout 一行摘要。
 *
 * 镜像不写平台输出变量、不提交仓库、不上传制品；这些全部由流水线负责。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface Summary {
  source: string;
  targets: number;
  frames: number;
  bytes: number;
  path: string;
}

export async function writeGif(path: string, data: Uint8Array): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}

export function report(summary: Summary): void {
  const { source, targets, frames, bytes, path } = summary;
  console.log(
    `[space-invaders] source=${source} targets=${targets} frames=${frames} bytes=${bytes} path=${path}`,
  );
}
