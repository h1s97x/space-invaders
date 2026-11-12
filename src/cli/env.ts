/**
 * 环境变量读取：只认自有前缀，其它前缀一律忽略。
 *
 * 平台侧的参数名由各自 YAML 映射到本前缀，内核里没有第二套参数解析。
 */

export const PREFIX = 'CONTRIB_';

export type ContribEnv = Readonly<Record<string, string>>;

/** 把 `CONTRIB_MAX_FRAMES` 归一成 `max_frames`；空值不写入，交由 args 取默认。 */
export function readContribEnv(raw: NodeJS.ProcessEnv = process.env): ContribEnv {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(PREFIX) || value === undefined || value === '') continue;
    out[key.slice(PREFIX.length).toLowerCase()] = value;
  }
  return Object.freeze(out);
}
