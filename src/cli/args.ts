/**
 * 全项目唯一的参数声明处。
 *
 * `scripts/docs.ts` 由 ARGS 生成 README 参数表并做 `--check`；
 * 改默认值却忘了改文档，CI 会拦下来（ADR 0000 第 4 节）。
 */

import { readContribEnv, type ContribEnv } from './env.js';

export interface ArgSpec {
  /** `CONTRIB_` 之后的小写名，如 `max_frames` */
  name: string;
  type: 'string' | 'number';
  default: string | number;
  description: string;
  min?: number;
  max?: number;
  values?: readonly string[];
}

export const ARGS: readonly ArgSpec[] = Object.freeze([
  { name: 'source', type: 'string', default: 'mock', values: ['github', 'cnb', 'file', 'mock'], description: '数据源 id，显式指定，内核不做平台探测' },
  { name: 'user', type: 'string', default: '', description: '目标用户名；file / mock 可为空' },
  { name: 'token', type: 'string', default: '', description: '访问令牌，由平台流水线注入' },
  { name: 'endpoint', type: 'string', default: '', description: '可选 API 基址覆盖' },
  { name: 'calendar', type: 'string', default: '', description: 'file 源读取的归一化日历路径' },
  { name: 'output', type: 'string', default: 'game.gif', description: '唯一产物路径' },
  { name: 'seed', type: 'number', default: 1, min: 0, max: 2_147_483_647, description: '固定随机种子' },
  { name: 'fps', type: 'number', default: 20, min: 10, max: 50, description: '播放帧率' },
  { name: 'scale', type: 'number', default: 1, min: 1, max: 8, description: '整数倍放大（画布已够大，默认不放大）' },
  { name: 'width', type: 'number', default: 1024, min: 32, max: 2048, description: '低分辨率画布宽（放大前，53 列 × 16px 全览）' },
  { name: 'height', type: 'number', default: 256, min: 16, max: 1024, description: '低分辨率画布高（放大前，含顶部留白与飞船区）' },
  { name: 'max_frames', type: 'number', default: 4800, min: 1, max: 20000, description: '帧数硬上界' },
  { name: 'rule', type: 'string', default: 'shuffle', description: '规则注册表 id；shuffle＝按 seed 洗牌（默认），spread＝中心扩散，waves＝逐列' },
  { name: 'renderer', type: 'string', default: 'invader', values: ['invader', 'classic'], description: '渲染注册表 id；invader＝像素外星人，classic＝贡献绿方块方阵' },
]);

export interface Config {
  source: string;
  user: string;
  token: string;
  endpoint: string;
  calendar: string;
  output: string;
  seed: number;
  fps: number;
  scale: number;
  width: number;
  height: number;
  maxFrames: number;
  rule: string;
  renderer: string;
}

function envName(name: string): string {
  return `CONTRIB_${name.toUpperCase()}`;
}

export function parseArgs(raw: NodeJS.ProcessEnv = process.env): Config {
  const env: ContribEnv = readContribEnv(raw);
  const values: Record<string, string | number> = {};

  for (const spec of ARGS) {
    const rawValue = env[spec.name];
    if (rawValue === undefined) {
      values[spec.name] = spec.default;
      continue;
    }
    if (spec.type === 'number') {
      const n = Number(rawValue);
      if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new Error(`${envName(spec.name)} 需要整数，收到 '${rawValue}'`);
      }
      if (spec.min !== undefined && n < spec.min) throw new Error(`${envName(spec.name)} 最小 ${spec.min}，收到 ${n}`);
      if (spec.max !== undefined && n > spec.max) throw new Error(`${envName(spec.name)} 最大 ${spec.max}，收到 ${n}`);
      values[spec.name] = n;
      continue;
    }
    if (spec.values && !spec.values.includes(rawValue)) {
      throw new Error(`${envName(spec.name)} 只能是 ${spec.values.join(' | ')}，收到 '${rawValue}'`);
    }
    values[spec.name] = rawValue;
  }

  const str = (name: string): string => String(values[name]);
  const num = (name: string): number => Number(values[name]);
  return {
    source: str('source'),
    user: str('user'),
    token: str('token'),
    endpoint: str('endpoint'),
    calendar: str('calendar'),
    output: str('output'),
    seed: num('seed'),
    fps: num('fps'),
    scale: num('scale'),
    width: num('width'),
    height: num('height'),
    maxFrames: num('max_frames'),
    rule: str('rule'),
    renderer: str('renderer'),
  };
}

/** 生成 README 参数表，供 scripts/docs.ts 使用。 */
export function describeArgs(): string {
  const rows = ARGS.map((spec) => {
    const range = spec.values
      ? spec.values.join(' \\| ')
      : spec.type === 'number'
        ? `${spec.min ?? '-'}..${spec.max ?? '-'}`
        : 'string';
    return `| \`${envName(spec.name)}\` | ${spec.type} | \`${spec.default}\` | ${range} | ${spec.description} |`;
  });
  return [
    '| 环境变量 | 类型 | 默认 | 取值 | 说明 |',
    '|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}
