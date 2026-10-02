#!/usr/bin/env node
/* ── 许可与来源 ───────────────────────────────────────────────
 * 本文件是 gh-space-invaders (MIT, Copyright (c) 2026 h1s97x) 的一部分。
 * 玩法设计参考 czl9707/gh-space-shooter（MIT, Copyright (c) 2026 Zane Chen）并做了重构，
 * 原作者的版权声明与许可声明见仓库根目录的 NOTICE 文件。 */
/**
 * gh-space-invaders —— 把GitHub 贡献图射成 GIF 的像素轰炸游戏。
 * 玩法逻辑参考 czl9707/gh-space-shooter
 * （`game_state.py` + `animator.py` + `strategies/`）。
 *
 * 用法:
 *    npm run offline                # 假数据 → game.gif
 *    npm run offline -- -o out.gif -s random
 *    node dist/index.js --user h1s97x        # 真数据（需 GITHUB_TOKEN）
 *    npm run dev -- --offline                # tsx 直跑，不编译
 */
import { appendFileSync } from 'node:fs';
import { DEFAULT_COLORS, DEFAULT_FPS } from './config.js';
import { fetchContributions, generateDummy } from './data.js';
import { Engine } from './engine.js';
import { encodeGif } from './gif.js';
import { Strategy, isStrategy } from './types.js';

interface Args {
  username?: string;
  output: string;
  strategy: string;
  fps: number;
  maxFrames: number;
  offline: boolean;
  seed?: number;
  colors: number;
  quiet: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    output: 'game.gif',
    // 默认 **random**，对齐参考项目 cli.py:60（`typer.Option("random", "--strategy")`）。
    // 别改成 column —— ColumnStrategy 是"从第 0 周扫到第 51 周"，一排一排推过去，
    // 那正是最机械的观感。RandomStrategy 取最近 8 个有目标的列、按
    // 同列10 / 1~3列100 / 4列以上1 加权随机挑一个（那个 1 就是"意外感"的来源），
    // 再打那一列最下面的敌人 —— 轨迹才会像人在玩。
    strategy: Strategy.RANDOM,
    fps: DEFAULT_FPS,
    maxFrames: 0,
    offline: false,
    colors: DEFAULT_COLORS,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    const next = (): string => {
      const n = argv[++i];
      if (n === undefined) throw new Error(`${v} 缺少参数`);
      return n;
    };
    switch (v) {
      case '-o':
      case '--output':
        a.output = next();
        break;
      case '-s':
      case '--strategy':
        a.strategy = next();
        break;
      case '--fps':
        a.fps = Number(next());
        break;
      case '--max-frame':
        a.maxFrames = Number(next());
        break;
      case '--seed':
        a.seed = Number(next());
        break;
      case '--colors':
        a.colors = Number(next());
        break;
      case '--user':
      case '--username':
        a.username = next();
        break;
      case '--offline':
        a.offline = true;
        break;
      case '--quiet':
        a.quiet = true;
        break;
      case '-h':
      case '--help':
        console.log(
          '用法: gh-space-invaders-ts [username] [选项]\n' +
            '  -o, --output <file>     输出 GIF（默认 game.gif）\n' +
            '  -s, --strategy <name>   column | row | random | chaos（默认 column）\n' +
            '      --fps <n>            参考项目默认 40；帧时长 = 2000/fps 毫秒\n' +
            '      --max-frame <n>      帧数上限兜底\n' +
            '      --colors <n>         调色板颜色数（默认 32）\n' +
            '      --seed <n>           固定随机种子\n' +
            '      --offline用假数据\n' +
            '      --quiet              不打印逐帧进度',
        );
        process.exit(0);
        break;
      default:
        if (v.startsWith('-')) throw new Error(`未知选项 ${v}`);
        a.username ??= v;
    }
  }
  if (!isStrategy(a.strategy)) {
    throw new Error(`--strategy 只能是 column | row | random | chaos，收到 '${a.strategy}'`);
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const username =
    args.username ||
    process.env.GITHUB_USER ||
    process.env.GITHUB_REPOSITORY_OWNER ||
    'octocat';

  let contrib;
  if (args.offline || !token) {
    console.log(`🌱 离线模式 — 假数据模拟 @${username}`);
    contrib = generateDummy(username);
  } else {
    console.log(`🌐 拉取 @${username} 贡献图…`);
    contrib = (await fetchContributions(username, token)) ?? null;
    if (contrib === null) {
      console.log('  → 回退假数据');
      contrib = generateDummy(username);
    }
  }

  const filled = contrib.rows.reduce((a, r) => a + r.filter((c) => c > 0).length, 0);
  console.log(`📊 非空格子: ${filled}  总贡献: ${contrib.total}`);

  const engine = new Engine(
    contrib,
    args.strategy as Strategy,
    args.fps,
    args.maxFrames,
    args.seed,
  );
  console.log(
    `🎬 渲染 strategy=${args.strategy} fps=${args.fps} ` +
      `deltaTime=${engine.deltaTime.toFixed(4)}s 帧时长=${engine.frameMs}ms`,
  );

  console.log(`💾 编码 GIF (${engine.frameMs}ms/帧, ${args.colors} 色)…`);
  const nFrames = encodeGif(engine.iterFrames(!args.quiet), args.output, engine.frameMs, args.colors);

  const st = engine.stats;
  console.log(`🏁 score=${st.score}  击败 ${st.defeated}/${st.total}`);

  const ghOut = process.env.GITHUB_OUTPUT;
  if (ghOut) {
    appendFileSync(
      ghOut,
      `output=${args.output}\nframes=${nFrames}\nscore=${st.score}\nusername=${username}\n`,
    );
  }
}

main().catch((e) => {
  console.error(`❌ ${(e as Error).message}`);
  process.exit(1);
});