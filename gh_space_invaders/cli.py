#!/usr/bin/env python3
"""
gh-space-invaders — 把你的 GitHub 贡献图变成一场像素粉碎游戏！

我们自己实现了一遍，还加了几个巧思：
  🌟 贡献越多 → 格子越大、血越厚、被打掉时爆炸越绚丽
  🌟 收尾阶段登场 BOSS 外星人往下俯冲（宿主格开局钉定、清场过半才现身）
  🌟 视差星空 + 飞船尾焰强度随"剩余敌占比"变化
  🌟 4 种入侵策略：column / row / random / chaos（我们多了 chaos）
  🌟 没有 token 时自动用假数据兜底

用法:
    python -m gh_space_invaders h1s97x                   # 真数据
    python -m gh_space_invaders --offline                # 假数据
    python -m gh_space_invaders -o game.gif -s random --fps 40

这里只放「参数解析 + 串流程」。抓数据在 `data.py`、玩法在 `engine.py`、
画面在 `render.py`、编码在 `gif.py`。
"""

from __future__ import annotations

import argparse
import os

from .config import (DEFAULT_BOSS_CHANCE, DEFAULT_COLORS, DEFAULT_FPS,
                     FIRE_MIN_INTERVAL, HEIGHT, WIDTH)
from .data import fetch_contributions, generate_dummy
from .engine import Engine
from .gif import encode_gif
from .models import Strategy

# 兼容旧导入路径：以下名字历史上都挂在 cli 上，拆分后继续暴露，
# 外部脚本 `from gh_space_invaders.cli import X` 不受影响。
from .config import COLS, ROWS  # noqa: F401
from .gif import build_palette, quantize_frame  # noqa: F401
from .models import Contributions  # noqa: F401

__all__ = ["main", "build_parser"]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        description="gh-space-invaders — 把 GitHub 贡献图射成 GIF")
    ap.add_argument("username", nargs="?", default=None,
                    help="GitHub 用户名（默认取 GITHUB_USER / 仓库 owner / octocat）")
    ap.add_argument("-o", "--output", default="game.gif")
    ap.add_argument("-s", "--strategy", default="random",
                    choices=["column", "row", "random", "chaos"])
    ap.add_argument("--fps", type=int, default=DEFAULT_FPS,
                    help=f"播放帧率（只改每帧时长，不影响帧数/体积，默认 {DEFAULT_FPS}）")
    ap.add_argument("--max-frame", type=int, default=0,
                    help="最大帧数，0 = 按靶子血量自动推算（默认）")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--seed", type=int, default=None,
                    help="固定随机种子（方便复现）")
    ap.add_argument("--colors", type=int, default=DEFAULT_COLORS,
                    help=f"GIF 调色板颜色数，越少体积越小（默认 {DEFAULT_COLORS}）")
    ap.add_argument("--boss-chance", type=float, default=DEFAULT_BOSS_CHANCE,
                    help="BOSS 宿主格被打爆后化身为 BOSS 的几率 (0~1，默认必定出场)。"
                         "宿主开局就钉定（取 BOSS_HOST_COUNT 个高贡献格），"
                         "且只在清场过半后才可能现身")
    ap.add_argument("--fire-interval", type=int, default=FIRE_MIN_INTERVAL,
                    help=f"两炮之间的**最小**帧间隔（默认 {FIRE_MIN_INTERVAL}）。"
                         f"实际射速由飞船速度决定：每横向走过一列才开一炮，"
                         f"这个参数只用于压制原地抖动时的连发")
    return ap


def main(argv=None):
    args = build_parser().parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    username = (args.username
                or os.environ.get("GITHUB_USER")
                or os.environ.get("GITHUB_REPOSITORY_OWNER")
                or "octocat")

    if args.offline or not token:
        print(f"🌱 离线模式 — 假数据模拟 @{username}")
        contrib = generate_dummy(username)
    else:
        print(f"🌐 拉取 @{username} 贡献图…")
        contrib = fetch_contributions(username, token)
        if contrib is None:
            print("  → 回退假数据")
            contrib = generate_dummy(username)

    filled = sum(1 for row in contrib.rows for c in row if c > 0)
    print(f"📊 非空格子: {filled}  总贡献: {contrib.total}")

    engine = Engine(contrib, strategy=Strategy(args.strategy),
                    fps=args.fps, max_frame=args.max_frame,
                    boss_chance=args.boss_chance,
                    fire_interval=args.fire_interval, seed=args.seed)
    print(f"🎬 渲染 strategy={args.strategy} fps={args.fps} "
          f"max_frame={engine.max_frame} size={WIDTH}x{HEIGHT}")

    print(f"💾 编码 GIF ({engine.frame_ms}ms/帧, {args.colors} 色)…")
    n_frames = encode_gif(engine.iter_frames(), args.output,
                          engine.frame_ms, args.colors)

    print(f"🏁 score={engine.score}  击败 {engine.defeated}/{engine.total_targets}")

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"output={args.output}\nframes={n_frames}\n"
                    f"score={engine.score}\nusername={username}\n")


if __name__ == "__main__":
    main()
