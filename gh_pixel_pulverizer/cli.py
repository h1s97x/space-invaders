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
    python tools/gh_pixel_pulverizer.py h1s97x                    # 真数据
    python tools/gh_pixel_pulverizer.py --offline                  # 假数据
    python tools/gh_pixel_pulverizer.py -o game.gif -s random --fps 40
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple

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

# 飞船区域
SHIP_Y = GRID_BOTTOM + 80              # 203（飞船中心）
SHIP_W = 32
SHIP_H = 22


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


class Strategy(str, Enum):
    COLUMN = "column"
    ROW     = "row"
    RANDOM  = "random"
    CHAOS   = "chaos"   # 🌟 混沌：优先级随机打散


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
            data = json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  [warn] API 失败: {e}")
        return None

    user = data.get("data", {}).get("user")
    if not user:
        print(f"  [warn] 找不到用户 '{username}'")
        return None

    weeks = user["contributionsCollection"]["contributionCalendar"]["weeks"]
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    for c, week in enumerate(weeks[:COLS]):
        for day in week["contributionDays"]:
            r = day["weekday"]
            if 0 <= r < ROWS:
                rows[r][c] = day["contributionCount"]
    return Contributions(rows=rows, username=username)


def generate_dummy(username: str = "octocat") -> Contributions:
    """假数据 —— 看起来像真实贡献图。"""
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    rng = random.Random(hash(username) & 0xFFFF)
    for c in range(COLS):
        for r in range(ROWS):
            if r in (0, 6):
                count = rng.choices([0, 0, 0, 1, 2], weights=[40, 20, 10, 20, 10])[0]
            else:
                count = rng.choices([0, 1, 2, 3, 4, 5, 10], weights=[15, 15, 20, 20, 15, 10, 5])[0]
            rows[r][c] = count
    # 种几个 BOSS
    for _ in range(8):
        rc = rng.randint(0, ROWS - 1)
        cc = rng.randint(0, COLS - 1)
        rows[rc][cc] = rng.randint(15, 40)
    return Contributions(rows=rows, username=username)


# ──────────────────────────── 引擎 ──────────────────────────────────────────

class Engine:
    def __init__(self, contrib: Contributions,
                 strategy: Strategy = Strategy.RANDOM,
                 fps: int = 40, max_frame: int = 300,
                 boss_chance: float = 0.18,
                 seed: Optional[int] = None):
        self.contrib = contrib
        self.strategy = strategy
        self.fps = fps
        self.frame_ms = max(8, round(1000 / fps))
        self.max_frame = max_frame
        self.boss_chance = boss_chance
        self.rng = random.Random(seed)

        self.targets: List[Target] = []
        self.enemies: List[Enemy] = []      # BOSS 外星人
        self.bullets: List[Bullet] = []
        self.particles: List[Particle] = []
        self.stars: List[Star] = []

        self.ship_x = WIDTH / 2 - SHIP_W / 2
        self.ship_target_x = self.ship_x

        self.score = 0
        self.defeated = 0
        self.total_targets = 0
        self.frame = 0

        self._build_targets()
        self._spawn_stars()
        self.total_targets = len(self.targets)

    # ── 初始化 ──────────────────────────────────────────────────────

    def _build_targets(self):
        for r in range(ROWS):
            for c in range(COLS):
                count = self.contrib.rows[r][c]
                if count <= 0:
                    continue
                level = min(5, max(1, count // 5))
                # cell 大小：基础 CELL + level 加成（但不超过贡献图网格）
                size = CELL + level - 1     # 13..17
                size = min(size, CELL + GAP + 1)  # 不要溢出网格间隙
                # HP：level 1→1发就爆, level 5→3发 (BOSS 格)
                hp = 1 if level <= 3 else (2 if level == 4 else 3)
                x = PADDING_LR + c * (CELL + GAP) + (CELL - size) // 2
                y = GRID_TOP + r * (CELL + GAP) + (CELL - size) // 2
                self.targets.append(Target(
                    col=c, row=r, x=x, y=y, size=size, level=level, hp=hp))

    def _spawn_stars(self):
        for _ in range(160):
            self.stars.append(Star(
                x=self.rng.randint(0, WIDTH - 1),
                y=self.rng.randint(0, HEIGHT - 1),
                z=self.rng.randint(0, 2),
                speed=[0.15, 0.35, 0.7][self.rng.randint(0, 2)],
            ))

    # ── 每帧更新 ────────────────────────────────────────────────────

    def _update_stars(self):
        for s in self.stars:
            s.y += s.speed
            if s.y >= HEIGHT:
                s.y = 0
                s.x = self.rng.randint(0, WIDTH - 1)

    def _update_ship(self):
        """飞船左右移动 —— 自动瞄准最活跃（y 最小 / 最近 / 最大贡献）的靶子。"""
        alive = [t for t in self.targets if t.alive]
        if not alive:
            return
        # 根据 strategy 决定优先目标
        if self.strategy == Strategy.COLUMN:
            # 最右列最上面的
            alive.sort(key=lambda t: (-t.col, t.row))
        elif self.strategy == Strategy.ROW:
            # 最上面一行最左边的
            alive.sort(key=lambda t: (t.row, t.col))
        elif self.strategy == Strategy.CHAOS:
            # 贡献最多的先打
            alive.sort(key=lambda t: -t.level)
        else:  # RANDOM
            alive.sort(key=lambda t: self.rng.random())
        target = alive[0]
        self.ship_target_x = target.cx - SHIP_W / 2
        # 平滑插值
        self.ship_x += (self.ship_target_x - self.ship_x) * 0.10
        self.ship_x = max(5, min(WIDTH - SHIP_W - 5, self.ship_x))

    def _fire(self):
        """飞船开火 —— 速度/频率随剩余敌占比变化。"""
        alive_pct = sum(1 for t in self.targets if t.alive) / max(1, self.total_targets)
        # 剩余越少 → 飞船越猛（三发散射）
        triple = alive_pct < 0.4   # 还剩不到 40% 就三发散射
        rate = 2 if triple else 3   # 2 帧一次 vs 3 帧一次
        if self.frame % rate != 0:
            return
        cx = self.ship_x + SHIP_W / 2
        bx = cx - 1; by = SHIP_Y - 4
        self.bullets.append(Bullet(x=bx, y=by, vy=-5.0))
        if triple:
            self.bullets.append(Bullet(x=bx - 6, y=by + 2, vy=-4.8))
            self.bullets.append(Bullet(x=bx + 6, y=by + 2, vy=-4.8))
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

    def _collide(self):
        # 玩家子弹 → 靶子
        for b in self.bullets:
            if not b.alive or not b.friendly: continue
            for t in self.targets:
                if not t.alive: continue
                rx, ry, rw, rh = t.rect()
                if rx <= b.x <= rw and ry <= b.y <= rh:
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
        if tiny:
            n = 4
        elif big:
            n = 60
        else:
            n = 20 + level * 12
        for _ in range(n):
            ang = self.rng.uniform(0, 2 * math.pi)
            sp = self.rng.uniform(0.5, 2.5 + level * 0.3 if not big else 4.0)
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
            for a in range(0, 360, 18):
                ang = math.radians(a)
                self.particles.append(Particle(
                    x=x, y=y,
                    vx=math.cos(ang) * (3.0 if big else 2.2 + level * 0.2),
                    vy=math.sin(ang) * (3.0 if big else 2.2 + level * 0.2),
                    life=20, max_life=20,
                    color=(255, 255, 255), size=2))

    # ── 绘制 ────────────────────────────────────────────────────────

    def _draw_stars(self, d: ImageDraw.ImageDraw):
        # 3 层视差：不同亮度
        for s in self.stars:
            col = STARS[min(3, s.z + 1)] if self.frame % 2 == 0 else STARS[s.z]
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

    def run(self, verbose: bool = True) -> List[Image.Image]:
        frames: List[Image.Image] = []

        for self.frame in range(self.max_frame):
            self._update_stars()
            self._update_ship()
            self._fire()
            self._update_bullets()
            self._update_enemies()
            self._update_particles()
            self._collide()

            img = Image.new("RGB", (WIDTH, HEIGHT), BG)
            d = ImageDraw.Draw(img)
            self._draw_stars(d)
            self._draw_grid_bg(d)
            self._draw_targets(d)
            self._draw_enemies(d)
            self._draw_bullets(d)
            self._draw_ship(d)
            self._draw_particles(d)
            self._draw_hud(d)
            frames.append(img)

            a = sum(1 for t in self.targets if t.alive)
            if verbose and self.frame % 50 == 0:
                print(f"  frame {self.frame:3d}  alive={a:3d}/{self.total_targets}  "
                      f"score={self.score}  enemies={len(self.enemies)}")

            # 全部打完 → 追加 15 帧胜利庆祝
            if a == 0 and self.defeated > 0:
                for _ in range(15):
                    # 连发烟花
                    self._explode(self.rng.randint(50, WIDTH - 50),
                                  self.rng.randint(40, HEIGHT - 80),
                                  level=5, big=True)
                    self._update_particles()
                    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
                    d = ImageDraw.Draw(img)
                    self._draw_stars(d)
                    self._draw_particles(d)
                    self._draw_hud(d)
                    frames.append(img)
                break

        return frames


# ──────────────────────────── GIF 编码 ──────────────────────────────────────

def encode_gif(frames: List[Image.Image], path: str, frame_ms: int):
    """首帧量化拿统一调色板，所有帧共享 → 不闪烁。"""
    if not frames:
        raise RuntimeError("没有帧")
    first_q = frames[0].quantize(colors=64, dither=Image.Dither.NONE)
    pal_img = Image.new("P", frames[0].size)
    pal_img.putpalette(first_q.getpalette()[:256 * 3] + [0] * (256 * 3 - 256 * 3))
    # putpalette 需要完整的 256*3 字节
    full_pal = first_q.getpalette()[:256 * 3]
    pal_img = Image.new("P", frames[0].size)
    pal_img.putpalette(full_pal)

    quantized = [first_q]
    for f in frames[1:]:
        quantized.append(
            f.convert("RGB").quantize(palette=pal_img, colors=64,
                                       dither=Image.Dither.FLOYDSTEINBERG))

    quantized[0].save(
        path, save_all=True, append_images=quantized[1:],
        duration=frame_ms, loop=0, optimize=True, disposal=2)
    print(f"  ✅ {path}  ({len(frames)} 帧, {os.path.getsize(path):,} bytes)")


# ──────────────────────────── CLI ───────────────────────────────────────────

def main(argv=None):
    ap = argparse.ArgumentParser(
        description="gh-pixel-pulverizer — 把 GitHub 贡献图射成 GIF")
    ap.add_argument("username", nargs="?", default=None)
    ap.add_argument("-o", "--output", default="game.gif")
    ap.add_argument("-s", "--strategy", default="random",
                    choices=["column", "row", "random", "chaos"])
    ap.add_argument("--fps", type=int, default=40)
    ap.add_argument("--max-frame", type=int, default=300)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--no-commit", action="store_true")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--boss-chance", type=float, default=0.18,
                    help="高贡献格被打爆后飞出 BOSS 的几率 (0~1)")
    args = ap.parse_args(argv)

    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    username = args.username or os.environ.get("GITHUB_USER") or "octocat"

    if args.offline or not token:
        print(f"🌱 离线模式 — 假数据模拟 @{username}")
        contrib = generate_dummy(username)
    else:
        print(f"🌐 拉取 @{username} 贡献图…")
        contrib = fetch_contributions(username, token)
        if contrib is None:
            print("  → 回退假数据")
            contrib = generate_dummy(username)

    total = sum(1 for row in contrib.rows for c in row if c > 0)
    print(f"📊 非空格子: {total}  总贡献: {sum(sum(contrib.rows, []))}")

    engine = Engine(contrib, strategy=Strategy(args.strategy),
                    fps=args.fps, max_frame=args.max_frame,
                    boss_chance=args.boss_chance, seed=args.seed)
    print(f"🎬 渲染 strategy={args.strategy} fps={args.fps} "
          f"max_frame={args.max_frame} size={WIDTH}x{HEIGHT}")
    frames = engine.run()

    print(f"💾 编码 GIF ({engine.frame_ms}ms/帧)…")
    encode_gif(frames, args.output, engine.frame_ms)
    a = sum(1 for t in engine.targets if t.alive)
    print(f"🏁 score={engine.score}  击败 {engine.defeated}/{engine.total_targets}")

    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a") as f:
            f.write(f"output={args.output}\nframes={len(frames)}\n"
                    f"score={engine.score}\nusername={username}\n")


if __name__ == "__main__":
    main()
