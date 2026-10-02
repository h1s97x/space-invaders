"""参数标定台：扫一遍 (飞船速度 × 穿透数 × 开火间距)，用数据选工作点。

用法：
    python tools/calibrate.py                       # 默认网格扫描
    python tools/calibrate.py --v 2.0 2.5 --pierce 5 7 9
    python tools/calibrate.py --v 3.0 --pierce 7 --spacing 10 15 20

为什么需要它：飞船速度、射速、穿透数是**强耦合**的三个量 ——
改任意一个都会同时改变「观感」和「清场帧数(=GIF 时长与体积)」，
凭手感调必然顾此失彼（实测把飞船从瞬移降到 2px/帧，清场率就从 238/268 掉到 84/268）。
这里用 `Engine.simulate()` 无渲染跑完整场，一组参数几毫秒，可以随便扫。

看哪几列：
  cleared   —— 12 场（2 份数据 × 6 seed）里打完的比例，必须 100%
  frames    —— 打完用了多少帧（= 时长 = 体积）
  shots/s   —— 观感：每秒几发。> 5 就太密了，2~4 比较从容
  dmg/shot  —— 效率：每发的平均伤害。越接近 pierce 说明越少空放
"""

from __future__ import annotations

import argparse
import statistics as st
import sys

import gh_space_invaders.engine as eng
from gh_space_invaders.data import generate_dummy

USERS = ("octocat", "torvalds")
SEEDS = (1, 2, 3, 7, 11, 42)
BUDGET = 1500          # 给足预算，测的是「真正打完要几帧」而不是「预算够不够」


def run_one(v: float, pierce: int, min_int: int, max_int: int,
            boss: float = 0.18) -> dict:
    """扫一组参数：2 份数据 × 6 个 seed，返回聚合指标。"""
    # 直接改 engine 模块的常量：它 `from .config import X`，所以 patch 的是引擎实际用的值
    eng.SHIP_MAX_SPEED = v
    eng.BULLET_PIERCE = pierce
    eng.FIRE_MIN_INTERVAL = min_int
    eng.FIRE_MAX_INTERVAL = max_int

    rows = []
    for u in USERS:
        for s in SEEDS:
            e = eng.Engine(generate_dummy(u), seed=s, max_frame=BUDGET,
                           boss_chance=boss)
            rows.append(e.simulate())

    return {
        "v": v,
        "pierce": pierce,
        "min_int": min_int,
        "boss": boss,
        "cleared": sum(r["cleared"] for r in rows) / len(rows),
        "frames": st.mean(r["frames"] for r in rows),
        "frames_max": max(r["frames"] for r in rows),
        "shots": st.mean(r["shots"] for r in rows),
        "sps": st.mean(r["shots_per_sec"] for r in rows),
        "dps_shot": st.mean(r["dmg_per_shot"] for r in rows),
        "left": st.mean(r["left"] for r in rows),
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="飞船速度 / 射速 / 穿透 的参数标定")
    ap.add_argument("--v", type=float, nargs="+", default=[2.0, 2.5, 3.0, 4.0],
                    help="飞船每帧位移上限（px）")
    ap.add_argument("--pierce", type=int, nargs="+", default=[5, 7, 9],
                    help="一发子弹最多穿透几个格子")
    ap.add_argument("--min-interval", type=int, nargs="+", default=[4],
                    help="进入新列后的最小开火间隔（帧）")
    ap.add_argument("--max-interval", type=int, default=12)
    ap.add_argument("--boss", type=float, nargs="+", default=[0.18],
                    help="BOSS 出现概率（BOSS 会吃掉子弹，直接影响清场时长）")
    args = ap.parse_args(argv)

    results = [
        run_one(v, p, mi, args.max_interval, bc)
        for v in args.v for p in args.pierce
        for mi in args.min_interval for bc in args.boss
    ]
    results.sort(key=lambda r: r["frames"])

    print(f"{'飞船v':>6} {'穿透':>4} {'间隔':>4} {'BOSS':>5} | {'清场率':>6} {'平均帧':>7} "
          f"{'最长帧':>7} {'时长s':>6} {'发/秒':>6} {'伤害/发':>7}")
    print("-" * 72)
    for r in results:
        mark = "  " if r["cleared"] == 1 else "←"      # ← 标记没能打完的组
        print(f"{r['v']:>6.1f} {r['pierce']:>4} {r['min_int']:>4} {r['boss']:>5.2f} | "
              f"{r['cleared']:>6.0%} {r['frames']:>7.0f} {r['frames_max']:>7.0f} "
              f"{r['frames'] / 20:>6.1f} {r['sps']:>6.2f} {r['dps_shot']:>7.2f} {mark}")

    ok = [r for r in results if r["cleared"] == 1 and r["sps"] <= 4.0]
    if ok:
        best = min(ok, key=lambda r: r["frames"])
        print(f"\n建议工作点：飞船 {best['v']}px/帧  穿透 {best['pierce']}  "
              f"最小间隔 {best['min_int']} 帧  →  "
              f"{best['frames']:.0f} 帧 / {best['frames'] / 20:.1f}s / "
              f"{best['sps']:.2f} 发每秒")
    else:
        print("\n没有同时满足「全部打完 + 每秒 ≤4 发」的组合，需要放宽约束或改机制。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
