/**
 * 由 args.ts 的声明生成 README 参数表；`--check` 供 CI 拒绝文档漂移。
 *
 * 用法：npm run docs        （写入 README）
 *       npm run docs:check  （只读比对，不一致退出 1）
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeArgs } from '../src/cli/args.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readmePath = join(repoRoot, 'README.md');
const START = '<!--options-->';
const END = '<!--/options-->';

const readme = readFileSync(readmePath, 'utf8');
const block = `${START}\n\n${describeArgs()}\n\n${END}`;
const startIndex = readme.indexOf(START);
const endIndex = readme.indexOf(END);

if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
  console.error(`[docs] README 缺少 ${START} / ${END} 标记`);
  process.exit(1);
}

const current = readme.slice(startIndex, endIndex + END.length);
if (process.argv.includes('--check')) {
  if (current !== block) {
    console.error('[docs] README 参数表与 src/cli/args.ts 不一致，请运行 npm run docs');
    process.exit(1);
  }
  console.log('[docs] 参数表与声明一致');
} else {
  writeFileSync(readmePath, readme.slice(0, startIndex) + block + readme.slice(endIndex + END.length));
  console.log(`[docs] 已更新 ${readmePath}`);
}
