#!/usr/bin/env python3
"""
gh-pixel-pulverizer — 把你的 GitHub 贡献图变成一场像素粉碎游戏！

我们自己实现了一遍，还加了几个巧思：
  🌟 贡献越多 → 格子越大、血越厚、被打掉时爆炸越绚丽
  🌟 高贡献格被打爆后有几率飞出 BOSS 外星人往下俯冲（紧张感）
  🌟 视差星空 + 飞船尾焰强度随"剩余敌占比"变化
  🌟 4 种入侵策略：column / row / random / chaos（我们多了 chaos）
  🌟 没有 token 时自动用假数据兜底

用法:
    python -m gh_pixel_pulverizer h1s97x                   # 真数据
    python -m gh_pixel_pulverizer --offline                # 假数据
    python -m gh_pixel_pulverizer -o game.gif -s random --fps 40
"""

from __future__ import annotations

import argparse
import bisect
import json
import math
import os
import random
import urllib.error
import urllib.request
import zlib
from dataclasses import dataclass
from enum import Enum
from typing import Iterable, Iterator, List, Optional, Tuple

from PIL import Image, ImageDraw, ImageFont


# ──────────────────────────── 调色板 ────────────────────────────────────────

BG        = (13, 17, 23)
GRID_BG   = (22, 27, 34)
GR_L0     = (33, 38, 45)
GR_L1     = (14, 68, 41)
GR_L2     = (0, 109, 50)
GR_L3     = (38, 166, 65)
GR_L4     = (57, 211, 83)
GR_L5     = (87, 242, 135)
SHIP_BODY = (68, 147, 248)
SHIP_DARK = (41, 82, 136)
SHIP_FL   = (255, 160, 30)
SHIP_FL2  = (255, 220, 80)
BOSS_HI   = (255, 210, 80)
BULLET    = (255, 255, 180)
STARS     = [(120, 130, 150), (160, 170, 190), (200, 210, 230), (255, 255, 255)]
PARTICLES = [GR_L4, GR_L3, (255, 200, 80), (255, 120, 60), (255, 255, 255)]
HUD1 = (200, 210, 230)
HUD2 = (120, 130, 150)


# ──────────────────────────── 尺寸（匹配原始 860×230）─────────────────────────

CELL = 13
GAP  = 2
COLS = 53
ROWS = 7

GRID_W = COLS * CELL + (COLS - 1) * GAP   # 689 + 104 = 793
GRID_H = ROWS * CELL + (ROWS - 1) * GAP   # 91 + 12  = 103

# 贡献图居中放，左右各留 (860-793)/2 ≈ 33.5 → 34
PADDING = 34
TOP_PAD = 20
WIDTH  = GRID_W + PADDING * 2          # 793 + 68 = 861 → 调整一下
WIDTH  = 860                            # 硬对齐原始
HEIGHT = 230

# 重新算 padding 让 GRID 居中
PADDING_LR = (WIDTH - GRID_W) // 2     # (860 - 793) // 2 = 33

# 贡献图 y 范围
GRID_TOP    = TOP_PAD                  # 20
GRID_BOTTOM = GRID_TOP + GRID_H        # 123

# 飞船区域（比原来上移 10px，否则尾焰最高会压住底部 HUD 进度条 y=222）
SHIP_Y = GRID_BOTTOM + 70              # 193（飞船中心）
SHIP_W = 32
SHIP_H = 22

# 3 层视差星空：z=0 最近（最快最亮）→ z=2 最远（最慢最暗）
STAR_SPEEDS = [0.70, 0.35, 0.15]

# GIF 调色板颜色数（越少体积越小，32 色实测可省 ~40% 体积）
DEFAULT_COLORS = 32

# RANDOM 策略锁定同一个目标多少帧（否则飞船每帧改主意 → 原地抖动）
TARGET_LOCK_FRAMES = 25

# 一颗子弹最多穿透几个靶子。
# 贡献图有 200~350 个非空格子，一发一杀是打不完的（帧数会失控、GIF 也会过大）。
BULLET_PIERCE = 3

# 飞船横向追踪目标的插值系数（越大追得越快、浪费在赶路上的帧数越少）
SHIP_TRACK = 0.18


# ──────────────────────────── 数据结构 ──────────────────────────────────────

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
    alive: bool = True

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


# ──────────────────────────── GitHub GraphQL ────────────────────────────────

GRAPHQL = """
query($user: String!) {
  user(login: $user) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { contributionCount weekday }
        }
      }
    }
  }
}
"""


def fetch_contributions(username: str, token: Optional[str]) -> Optional[Contributions]:
    url = "https://api.github.com/graphql"
    headers = {"Content-Type": "application/json",
               "User-Agent": "gh-pixel-pulverizer/2.0"}
    if token:
        headers["Authorization"] = f"bearer {token}"
    payload = json.dumps({"query": GRAPHQL, "variables": {"user": username}}).encode()

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # 401 / 403 常见于 token 无效或 API 限流
        print(f"  [warn] API 返回 {e.code}: {e.reason}")
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  [warn] API 请求失败: {e}")
        return None
    except (json.JSONDecodeError, ValueError) as e:
        print(f"  [warn] API 返回不是合法 JSON: {e}")
        return None

    if body.get("errors"):
        # GraphQL 习惯用 HTTP 200 + errors 表达失败（token 无效 / 用户不存在 / 限流）
        msg = (body["errors"][0] or {}).get("message", "unknown")
        print(f"  [warn] GraphQL 错误: {msg}")
        return None

    user = body.get("data", {}).get("user")
    if not user:
        print(f"  [warn] 找不到用户 '{username}'")
        return None

    calendar = user["contributionsCollection"]["contributionCalendar"]
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    for c, week in enumerate(calendar["weeks"][:COLS]):
        for day in week["contributionDays"]:
            r = day["weekday"]
            if 0 <= r < ROWS:
                rows[r][c] = day["contributionCount"]
    return Contributions(rows=rows, username=username,
                         total=calendar.get("totalContributions", 0))


def generate_dummy(username: str = "octocat") -> Contributions:
    """假数据 —— 看起来像真实贡献图。

    用 crc32 而不是内置 hash()：str 的 hash 每个进程都带随机盐，
    会让 --seed 失去可复现性。
    """
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    rng = random.Random(zlib.crc32(username.encode("utf-8")))
    for c in range(COLS):
        for r in range(ROWS):
            if r in (0, 6):
                count = rng.choices([0, 0, 0, 1, 2], weights=[40, 20, 10, 20, 10])[0]
            else:
                count = rng.choices([0, 1, 2, 3, 4, 5, 10], weights=[15, 15, 20, 20, 15, 10, 5])[0]
            rows[r][c] = count
    # 种几个高产格，保证 level 4/5 的 BOSS 格一定存在
    for _ in range(8):
        rc = rng.randint(0, ROWS - 1)
        cc = rng.randint(0, COLS - 1)
        rows[rc][cc] = rng.randint(15, 40)
    total = sum(v for row in rows for v in row)
    return Contributions(rows=rows, username=username, total=total)


# ──────────────────────────── 引擎 ──────────────────────────────────────────

class Engine:
    def __init__(self, contrib: Contributions,
                 strategy: Strategy = Strategy.RANDOM,
                 fps: int = 40, max_frame: int = 0,
                 boss_chance: float = 0.18,
                 seed: Optional[int] = None):
        self.contrib = contrib
        self.strategy = strategy
        self.fps = fps
        self.frame_ms = max(8, round(1000 / fps))
        self.boss_chance = boss_chance
        self.rng = random.Random(seed)

        self.targets: List[Target] = []
        self.enemies: List[Enemy] = []      # BOSS 外星人
        self.bullets: List[Bullet] = []
        self.particles: List[Particle] = []
        self.stars: List[Star] = []

        self.ship_x = WIDTH / 2 - SHIP_W / 2
        self.ship_target_x = self.ship_x
        self.locked_target: Optional[Target] = None
        self.target_lock_until = 0

        self.score = 0
        self.defeated = 0
        self.total_targets = 0
        self.frame = 0

        self._build_targets()
        self._spawn_stars()
        self.total_targets = len(self.targets)
        # max_frame <= 0 → 按总血量自动推算，保证默认参数下真能清场
        self.max_frame = max_frame if max_frame > 0 else self._auto_max_frame()

    def _auto_max_frame(self) -> int:
        """按「总 HP ÷ 实际开火速率」估一个够用的帧数上限。"""
        total_hp = sum(t.hp for t in self.targets)
        if total_hp == 0:
            return 60
        # 实测清场约需 1.6 帧/HP，这里留 ~50% 余量吸收不同数据的波动；
        # 真打完了会提前 return，所以这个上限宽一点不影响正常产物体积。
        return max(240, int(total_hp * 2.4) + 90)

    # ── 初始化 ──────────────────────────────────────────────────────

    def _build_targets(self):
        """按用户自身的贡献分位数分档（对齐 GitHub 官方的分档思路）。

        旧实现是 count // 5 的绝对阈值：真实数据里绝大多数格子都落在
        level 1，整张贡献图一片深绿，也几乎凑不出 BOSS 格。
        """
        counts = sorted(v for row in self.contrib.rows for v in row if v > 0)
        if not counts:
            return
        n = len(counts)

        def level_of(count: int) -> int:
            # 严格小于 count 的占比，用 bisect 避免重复值扎堆时全挤进同一档
            frac = bisect.bisect_left(counts, count) / n
            if frac < 0.25:
                return 1
            if frac < 0.50:
                return 2
            if frac < 0.75:
                return 3
            if frac < 0.90:
                return 4
            return 5

        for r in range(ROWS):
            for c in range(COLS):
                count = self.contrib.rows[r][c]
                if count <= 0:
                    continue
                level = level_of(count)
                # cell 大小：基础 CELL + level 加成（但不超过贡献图网格）
                size = CELL + level - 1     # 13..17
                size = min(size, CELL + GAP + 1)  # 不要溢出网格间隙
                # HP：只有最顶尖的一档需要两发，否则清场帧数会失控
                hp = 2 if level >= 5 else 1
                x = PADDING_LR + c * (CELL + GAP) + (CELL - size) // 2
                y = GRID_TOP + r * (CELL + GAP) + (CELL - size) // 2
                self.targets.append(Target(
                    col=c, row=r, x=x, y=y, size=size, level=level, hp=hp))

    def _spawn_stars(self):
        # 速度与亮度都绑定 z 层，才是真正的「3 层视差」
        for _ in range(160):
            z = self.rng.randint(0, 2)
            self.stars.append(Star(
                x=self.rng.randint(0, WIDTH - 1),
                y=self.rng.randint(0, HEIGHT - 1),
                z=z,
                speed=STAR_SPEEDS[z],
            ))

    # ── 每帧更新 ────────────────────────────────────────────────────

    def _update_stars(self):
        for s in self.stars:
            s.y += s.speed
            if s.y >= HEIGHT:
                s.y = 0
                s.x = self.rng.randint(0, WIDTH - 1)

    def _pick_target(self) -> Optional[Target]:
        """按策略挑出一个优先靶子。"""
        alive = [t for t in self.targets if t.alive]
        if not alive:
            self.locked_target = None
            return None
        if self.strategy == Strategy.COLUMN:
            # 最右列最上面的
            return min(alive, key=lambda t: (-t.col, t.row))
        if self.strategy == Strategy.ROW:
            # 最上面一行最左边的
            return min(alive, key=lambda t: (t.row, t.col))
        if self.strategy == Strategy.CHAOS:
            # 混沌：优先揍贡献最高的格子，同档随机打散
            self.rng.shuffle(alive)
            return min(alive, key=lambda t: -t.level)
        # RANDOM：锁定若干帧，否则飞船每帧改主意 → 原地抖动、打不准
        if (self.locked_target is None or not self.locked_target.alive
                or self.frame >= self.target_lock_until):
            self.locked_target = self.rng.choice(alive)
            self.target_lock_until = self.frame + TARGET_LOCK_FRAMES
        return self.locked_target

    def _update_ship(self):
        """飞船左右移动 —— 平滑插值追向 _pick_target() 选出的靶子。"""
        target = self._pick_target()
        if target is None:
            return
        self.ship_target_x = target.cx - SHIP_W / 2
        # 平滑插值
        self.ship_x += (self.ship_target_x - self.ship_x) * SHIP_TRACK
        self.ship_x = max(5, min(WIDTH - SHIP_W - 5, self.ship_x))

    def _fire(self):
        """飞船开火 —— 每帧一发；剩余敌占比低于 45% 时升级成三发散射。"""
        alive_pct = sum(1 for t in self.targets if t.alive) / max(1, self.total_targets)
        triple = alive_pct < 0.45
        cx = self.ship_x + SHIP_W / 2
        bx = cx - 1; by = SHIP_Y - 4
        self.bullets.append(Bullet(x=bx, y=by, vy=-5.0, max_hits=BULLET_PIERCE))
        if triple:
            self.bullets.append(Bullet(x=bx - 6, y=by + 2, vy=-4.8,
                                       max_hits=BULLET_PIERCE))
            self.bullets.append(Bullet(x=bx + 6, y=by + 2, vy=-4.8,
                                       max_hits=BULLET_PIERCE))
        # 枪口火花
        for _ in range(3):
            self.particles.append(Particle(
                x=bx, y=by,
                vx=self.rng.uniform(-0.8, 0.8),
                vy=self.rng.uniform(-1.5, -0.3),
                life=8, max_life=8,
                color=(255, 240, 120), size=1))

    def _update_bullets(self):
        for b in self.bullets:
            if not b.alive: continue
            b.y += b.vy
            if b.y < -10 or b.y > HEIGHT + 10:
                b.alive = False

    def _update_enemies(self):
        """BOSS 外星人 —— 往下俯冲 + 偶尔向飞船射子弹。"""
        for e in self.enemies:
            if not e.alive: continue
            e.vy += 0.04
            e.vy = min(e.vy, 2.2)
            e.vx += math.sin(self.frame * 0.06 + e.x * 0.02) * 0.05
            e.vx = max(-1.5, min(1.5, e.vx))
            e.x += e.vx; e.y += e.vy
            # 触底 → 撞飞船，同归于尽
            if e.y > HEIGHT - 30:
                self._explode(e.x + e.size/2, HEIGHT - 30, big=True)
                e.alive = False
            # BOSS 射子弹
            if self.frame % 40 == 0 and e.y > GRID_BOTTOM and e.y < SHIP_Y - 40:
                self.bullets.append(Bullet(
                    x=e.x + e.size/2, y=e.y + e.size, vy=3.0, friendly=False))

    def _update_particles(self):
        for p in self.particles:
            if p.life <= 0: continue
            p.x += p.vx; p.y += p.vy
            p.vy += 0.08; p.vx *= 0.97
            p.life -= 1

    def _prune(self):
        """回收已死亡的粒子 / 子弹 / 敌人。

        它们原先只被标记 alive=False 却永远留在列表里，每帧仍会被
        完整遍历一次，帧数一多就是纯粹的无界增长。
        """
        if self.particles:
            self.particles = [p for p in self.particles if p.life > 0]
        if self.bullets:
            self.bullets = [b for b in self.bullets if b.alive]
        if self.enemies:
            self.enemies = [e for e in self.enemies if e.alive]

    def _collide(self):
        # 玩家子弹 → 靶子
        for b in self.bullets:
            if not b.alive or not b.friendly: continue
            for t in self.targets:
                if not t.alive: continue
                rx, ry, rw, rh = t.rect()
                if rx <= b.x <= rw and ry <= b.y <= rh:
                    # 立刻穿出该格子，否则子弹会在同一格子的高度带里停留数帧被重复判定
                    b.y = ry - 1
                    b.hits += 1
                    if b.hits >= b.max_hits:
                        b.alive = False
                    t.hp -= 1
                    if t.hp <= 0:
                        t.alive = False
                        self.defeated += 1
                        self.score += t.level * 20
                        self._explode(t.cx, t.cy, t.level)
                        # 🌟 巧思：BOSS 格被打爆 → 有几率飞出 BOSS
                        if t.level >= 4 and self.rng.random() < self.boss_chance:
                            self.enemies.append(Enemy(
                                x=t.cx - 9, y=t.cy - 9,
                                vx=self.rng.uniform(-0.3, 0.3), vy=0.5,
                                hp=3, max_hp=3))
                    else:
                        self._explode(t.cx, t.cy, t.level, tiny=True)
                    break

        # 玩家子弹 → BOSS 外星人
        for b in self.bullets:
            if not b.alive or not b.friendly: continue
            for e in self.enemies:
                if not e.alive: continue
                if e.x <= b.x <= e.x + e.size and e.y <= b.y <= e.y + e.size:
                    b.alive = False
                    e.hp -= 1
                    self._explode(b.x, b.y, level=2, tiny=True)
                    if e.hp <= 0:
                        e.alive = False
                        self.score += 100
                        self._explode(e.x + e.size/2, e.y + e.size/2, big=True)
                    break

        # BOSS 子弹 → 飞船（简化：直接扣分 + 飞船"抖动"）
        for b in self.bullets:
            if not b.alive or b.friendly: continue
            sx, sy, sw, sh = self.ship_x + 4, SHIP_Y - 4, SHIP_W - 4, SHIP_H
            if sx <= b.x <= sx + sw and sy <= b.y <= sy + sh:
                b.alive = False
                self.score = max(0, self.score - 5)
                # 飞船被击中特效
                for _ in range(12):
                    self.particles.append(Particle(
                        x=b.x, y=b.y,
                        vx=self.rng.uniform(-2, 2), vy=self.rng.uniform(-2, 1),
                        life=15, max_life=15,
                        color=(255, 100, 60), size=2))

    def _explode(self, x: float, y: float, level: int = 2,
                 tiny: bool = False, big: bool = False):
        # 粒子数既是观感也是体积：全屏散布的粒子会把每帧的差分区域撑满，
        # 实测粒子砍半可直接省掉约 25% 的 GIF 体积，而观感几乎无损。
        if tiny:
            n = 3
        elif big:
            n = 34
        else:
            n = 10 + level * 6
        for _ in range(n):
            ang = self.rng.uniform(0, 2 * math.pi)
            sp_max = 4.0 if big else 2.5 + level * 0.3
            sp = self.rng.uniform(0.5, sp_max)
            self.particles.append(Particle(
                x=x, y=y,
                vx=math.cos(ang) * sp, vy=math.sin(ang) * sp,
                life=self.rng.randint(15, 40 + level * 3),
                max_life=40 + level * 3,
                color=self.rng.choice(PARTICLES),
                size=self.rng.choice([1, 1, 2, 2, 3]),
            ))
        # 白色火花环（大爆炸）
        if not tiny and (level >= 3 or big):
            ring = 3.0 if big else 2.2 + level * 0.2
            for a in range(0, 360, 18):
                ang = math.radians(a)
                self.particles.append(Particle(
                    x=x, y=y,
                    vx=math.cos(ang) * ring,
                    vy=math.sin(ang) * ring,
                    life=20, max_life=20,
                    color=(255, 255, 255), size=2))

    # ── 绘制 ────────────────────────────────────────────────────────

    def _draw_stars(self, d: ImageDraw.ImageDraw):
        # 3 层视差：z=0 最近 → 最快最亮；z=2 最远 → 最慢最暗
        for s in self.stars:
            idx = 3 - s.z                              # z=0 → STARS[3] 最亮
            col = STARS[idx] if self.frame % 2 == 0 else STARS[max(0, idx - 1)]
            d.point((s.x, s.y), fill=col)

    def _draw_grid_bg(self, d: ImageDraw.ImageDraw):
        # 贡献图区域外框
        d.rectangle([PADDING_LR - 2, GRID_TOP - 2,
                     PADDING_LR + GRID_W + 1, GRID_BOTTOM + 1],
                    fill=GRID_BG)
        # 淡网格线
        for c in range(COLS + 1):
            gx = PADDING_LR + c * (CELL + GAP) - GAP // 2
            d.line([(gx, GRID_TOP), (gx, GRID_BOTTOM)], fill=(30, 35, 42))
        for r in range(ROWS + 1):
            gy = GRID_TOP + r * (CELL + GAP) - GAP // 2
            d.line([(PADDING_LR, gy), (PADDING_LR + GRID_W, gy)], fill=(30, 35, 42))

    def _draw_targets(self, d: ImageDraw.ImageDraw):
        COLORS = [GR_L1, GR_L2, GR_L3, GR_L4, GR_L5]
        for t in self.targets:
            if not t.alive: continue
            col = COLORS[min(4, t.level - 1)]
            x0, y0, x1, y1 = t.rect()
            d.rectangle([x0, y0, x1, y1], fill=col)
            # BOSS 格额外标记：皇冠
            if t.level >= 5:
                d.rectangle([x0, y0 - 2, x1, y0 - 1], fill=BOSS_HI)
            # HP > 1 时显示一个小标记（表示没打爆）
            if t.hp > 1:
                d.point((x0 + 2, y0 + 2), fill=BG)

    def _draw_bullets(self, d: ImageDraw.ImageDraw):
        for b in self.bullets:
            if not b.alive: continue
            if b.friendly:
                bx = int(b.x); by = int(b.y)
                d.rectangle([bx - 1, by - 3, bx + 1, by + 2], fill=BULLET)
                d.point((bx, by - 4), fill=(200, 255, 200))
            else:
                bx = int(b.x); by = int(b.y)
                d.rectangle([bx - 1, by - 1, bx + 1, by + 3], fill=(255, 100, 80))

    def _draw_enemies(self, d: ImageDraw.ImageDraw):
        """BOSS 外星人：红色带刺。"""
        for e in self.enemies:
            if not e.alive: continue
            col = (230, 60, 60) if e.hp == e.max_hp else (200, 40, 40)
            ex, ey = int(e.x), int(e.y)
            # 身体
            d.rectangle([ex, ey, ex + e.size - 1, ey + e.size - 1], fill=col)
            # 刺（四个角）
            d.polygon([(ex - 2, ey), (ex, ey - 2), (ex, ey)], fill=col)
            d.polygon([(ex + e.size, ey), (ex + e.size + 2, ey - 2),
                       (ex + e.size, ey)], fill=col)
            # 眼睛（瞄准飞船）
            sx = self.ship_x + SHIP_W / 2
            dx = 1 if sx > ex + e.size / 2 else -1
            d.point((ex + e.size // 2 + dx, ey + 4), fill=(255, 255, 255))
            d.point((ex + e.size // 2 + dx, ey + e.size - 5), fill=(255, 255, 255))
            # HP 条
            if e.hp < e.max_hp:
                w = e.size * e.hp // e.max_hp
                d.rectangle([ex, ey - 3, ex + w - 1, ey - 2], fill=BOSS_HI)

    def _draw_ship(self, d: ImageDraw.ImageDraw):
        sx = int(self.ship_x)
        sy = SHIP_Y
        # 尾焰强度（越少敌人越燃）
        alive_pct = sum(1 for t in self.targets if t.alive) / max(1, self.total_targets)
        flame_boost = 1.5 - alive_pct  # 1.5 (全灭) → 0.5 (全活)
        flame_h = int(4 * flame_boost + math.sin(self.frame * 0.7) * 2 + 2)
        # 两翼
        d.polygon([(sx - 5, sy + SHIP_H - 2), (sx + 6, sy + 8),
                   (sx + 6, sy + SHIP_H - 2)], fill=SHIP_DARK)
        d.polygon([(sx + SHIP_W + 5, sy + SHIP_H - 2),
                   (sx + SHIP_W - 6, sy + 8),
                   (sx + SHIP_W - 6, sy + SHIP_H - 2)], fill=SHIP_DARK)
        # 梯形机身
        d.polygon([
            (sx + SHIP_W // 2, sy - 4),
            (sx + SHIP_W - 2, sy + SHIP_H - 6),
            (sx + 2, sy + SHIP_H - 6),
        ], fill=SHIP_BODY)
        # 舱
        d.ellipse([sx + SHIP_W//2 - 3, sy + 2,
                   sx + SHIP_W//2 + 3, sy + 10], fill=(180, 220, 255))
        # 尾焰（外 → 内）
        d.polygon([
            (sx + SHIP_W//2 - 6, sy + SHIP_H - 6),
            (sx + SHIP_W//2 + 6, sy + SHIP_H - 6),
            (sx + SHIP_W//2, sy + SHIP_H - 6 + flame_h),
        ], fill=SHIP_FL)
        d.polygon([
            (sx + SHIP_W//2 - 2, sy + SHIP_H - 6),
            (sx + SHIP_W//2 + 2, sy + SHIP_H - 6),
            (sx + SHIP_W//2, sy + SHIP_H - 6 + flame_h - 2),
        ], fill=SHIP_FL2)

    def _draw_particles(self, d: ImageDraw.ImageDraw):
        for p in self.particles:
            if p.life <= 0: continue
            alpha = p.life / p.max_life
            col = tuple(int(v * alpha + 0 * (1 - alpha)) for v in p.color)
            d.rectangle([int(p.x) - 1, int(p.y) - 1,
                         int(p.x) + p.size, int(p.y) + p.size],
                        fill=col)

    def _draw_hud(self, d: ImageDraw.ImageDraw):
        font = ImageFont.load_default()
        alive = sum(1 for t in self.targets if t.alive)
        total = self.total_targets
        # 左上
        d.text((8, 6), f"SCORE {self.score}", fill=HUD1, font=font)
        d.text((8, 18), f"BEAT {self.defeated}/{total}", fill=HUD2, font=font)
        # 右上：用户名
        name = f"@{self.contrib.username}"
        d.text((WIDTH - 6 - len(name) * 6 - 50, 6), name, fill=HUD2, font=font)
        d.text((WIDTH - 6 - 50, 18), f"F{self.frame:03d}", fill=HUD2, font=font)
        # 底生命条
        bar_w = 140
        bx = WIDTH - bar_w - 6
        by = HEIGHT - 8
        d.rectangle([bx, by, bx + bar_w, by + 2], fill=(45, 50, 60))
        if total:
            pct = alive / total
            col = GR_L4 if pct > 0.3 else (255, 120, 80)
            d.rectangle([bx, by, bx + int(bar_w * pct), by + 2], fill=col)

    # ── 主循环 ──────────────────────────────────────────────────────

    def _render_frame(self, celebration: bool = False) -> Image.Image:
        img = Image.new("RGB", (WIDTH, HEIGHT), BG)
        d = ImageDraw.Draw(img)
        # 先铺贡献图底、再画星空 —— 反过来整片网格区会把星星整块盖掉
        self._draw_grid_bg(d)
        self._draw_stars(d)
        if not celebration:
            self._draw_targets(d)
            self._draw_enemies(d)
            self._draw_bullets(d)
        self._draw_ship(d)
        self._draw_particles(d)
        self._draw_hud(d)
        return img

    def iter_frames(self, verbose: bool = True) -> Iterator[Image.Image]:
        """逐帧产出画面（生成器）。

        调用方可以边消费边量化编码，RGB 原帧用完即丢 —— 相比原先一次性
        攒下几百张 RGB 帧（300 帧约 170MB）能大幅压低峰值内存。
        """
        for self.frame in range(self.max_frame):
            self._update_stars()
            self._update_ship()
            self._fire()
            self._update_bullets()
            self._update_enemies()
            self._update_particles()
            self._collide()
            self._prune()

            yield self._render_frame()

            alive = sum(1 for t in self.targets if t.alive)
            if verbose and self.frame % 50 == 0:
                print(f"  frame {self.frame:3d}  alive={alive:3d}/{self.total_targets}  "
                      f"score={self.score}  enemies={len(self.enemies)}")

            # 全部打完 → 追加 15 帧胜利庆祝
            if alive == 0 and self.defeated > 0:
                for _ in range(15):
                    # 连发烟花
                    self._explode(self.rng.randint(50, WIDTH - 50),
                                  self.rng.randint(40, HEIGHT - 80),
                                  level=5, big=True)
                    self._update_particles()
                    self._prune()
                    yield self._render_frame(celebration=True)
                return

    def run(self, verbose: bool = True) -> List[Image.Image]:
        """兼容旧接口：一次性返回全部帧（内存占用高，建议改用 iter_frames）。"""
        return list(self.iter_frames(verbose))


# ──────────────────────────── GIF 编码 ──────────────────────────────────────

def _clamp_colors(colors: int) -> int:
    return max(2, min(256, colors))


def build_palette(first: Image.Image, colors: int = DEFAULT_COLORS) -> Image.Image:
    """用首帧生成一张统一的调色板图（P 模式），给所有帧共用 → 不闪烁。"""
    palette = (first.quantize(colors=_clamp_colors(colors),
                              dither=Image.Dither.NONE).getpalette() or [])[:256 * 3]
    # putpalette 需要完整的 256*3 调色板，不足部分补零
    palette += [0] * (256 * 3 - len(palette))
    pal_img = Image.new("P", first.size)
    pal_img.putpalette(palette)
    return pal_img


def quantize_frame(frame: Image.Image, pal_img: Image.Image,
                   colors: int = DEFAULT_COLORS) -> Image.Image:
    """把一帧映射到统一调色板。

    关掉抖动：像素画本来都是大色块，抖动只会往里塞高频噪声，
    让 GIF 明显变大而观感几乎不变。
    """
    return frame.quantize(palette=pal_img, colors=_clamp_colors(colors),
                          dither=Image.Dither.NONE)


def encode_gif(frames: Iterable[Image.Image], path: str, frame_ms: int,
               colors: int = DEFAULT_COLORS) -> int:
    """把所有帧编码成一个 GIF，返回实际写入的帧数。

    `frames` 可以是生成器：这里边消费边量化，RGB 原帧用完即丢，
    峰值内存只与「量化后的帧」成正比（约为 RGB 帧的 1/3）。
    """
    colors = _clamp_colors(colors)
    it = iter(frames)
    try:
        first = next(it)
    except StopIteration:
        raise RuntimeError("没有帧")

    pal_img = build_palette(first, colors)
    quantized = [quantize_frame(first, pal_img, colors)]
    for f in it:
        quantized.append(quantize_frame(f, pal_img, colors))

    # 不要指定 disposal=2：那会强制每帧全量编码，实测体积直接翻倍。
    # 每帧都是不透明整图，配合 optimize=True 的脏矩形差分不会产生残影。
    quantized[0].save(
        path, save_all=True, append_images=quantized[1:],
        duration=frame_ms, loop=0, optimize=True)
    print(f"  ✅ {path}  ({len(quantized)} 帧, {os.path.getsize(path):,} bytes)")
    return len(quantized)


# ──────────────────────────── CLI ───────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="gh-pixel-pulverizer — 把 GitHub 贡献图射成 GIF")
    ap.add_argument("username", nargs="?", default=None,
                    help="GitHub 用户名（默认取 GITHUB_USER / 仓库 owner / octocat）")
    ap.add_argument("-o", "--output", default="game.gif")
    ap.add_argument("-s", "--strategy", default="random",
                    choices=["column", "row", "random", "chaos"])
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--max-frame", type=int, default=0,
                    help="最大帧数，0 = 按靶子血量自动推算（默认）")
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--seed", type=int, default=None,
                    help="固定随机种子（方便复现）")
    ap.add_argument("--colors", type=int, default=DEFAULT_COLORS,
                    help=f"GIF 调色板颜色数，越少体积越小（默认 {DEFAULT_COLORS}）")
    ap.add_argument("--boss-chance", type=float, default=0.18,
                    help="高贡献格被打爆后飞出 BOSS 的几率 (0~1)")
    args = ap.parse_args(argv)

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
                    boss_chance=args.boss_chance, seed=args.seed)
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
