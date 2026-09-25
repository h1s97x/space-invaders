"""数据结构：靶子、敌人、子弹、粒子、星星、贡献矩阵、策略枚举。

纯数据（dataclass）+ 极少的派生属性，不含任何更新/绘制逻辑 ——
逻辑在 `engine.py`，绘制在 `render.py`。
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import List, Tuple


@dataclass
class Target:
    """贡献格子靶子。"""
    col: int
    row: int
    x: float        # 屏幕左上角 x
    y: float        # 屏幕左上角 y
    size: int       # 格子像素大小（基础 CELL + level 加成）
    level: int      # 1..5 贡献等级
    hp: int         # 剩余 HP
    max_hp: int = 1 # 初始 HP，用于「受伤降一档配色」的视觉反馈
    alive: bool = True
    boss: bool = False  # 开局预定：这一格打爆后会化身为 BOSS（阶段事件宿主）

    @property
    def cx(self): return self.x + self.size / 2
    @property
    def cy(self): return self.y + self.size / 2
    def rect(self): return (self.x, self.y, self.x + self.size, self.y + self.size)


@dataclass
class Enemy:
    """从被打爆的高贡献格子里飞出来的 BOSS —— 往下俯冲。"""
    x: float; y: float
    vx: float; vy: float
    hp: int; max_hp: int
    alive: bool = True
    size: int = 18


@dataclass
class Bullet:
    x: float; y: float
    vy: float = -5.0
    alive: bool = True
    friendly: bool = True   # True=飞船射的  False=BOSS射的
    hits: int = 0           # 已穿透的靶子数
    max_hits: int = 1       # 穿透上限


@dataclass
class Particle:
    x: float; y: float
    vx: float; vy: float
    life: int; max_life: int
    color: Tuple[int, int, int]
    size: int = 2


@dataclass
class Flash:
    """爆炸白闪 + 向外扩张的冲击环。

    粒子只是「余烬」，真正的打击感来自这一下白闪：一个中心亮点 +
    一圈快速扩张并淡出的点环。没有它，打爆看起来只是一小撮方块散开。
    """
    x: float; y: float
    r: float; max_r: float      # 当前/最终半径
    life: int; max_life: int


@dataclass
class Star:
    x: int; y: int; z: int    # z=0..2 视差层，越大越远越慢
    speed: float


@dataclass
class Contributions:
    rows: List[List[int]]
    username: str
    total: int = 0      # 一年总贡献数（GitHub 返回的 totalContributions）


class Strategy(str, Enum):
    COLUMN = "column"
    ROW     = "row"
    RANDOM  = "random"
    CHAOS   = "chaos"   # 🌟 混沌：优先揍贡献最高的格子，同档随机打散
