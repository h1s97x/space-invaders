"""游戏引擎：状态 + 每帧更新 + 碰撞 + 主循环。

这里**只有玩法逻辑**，一行 PIL 都不碰 —— 画什么、怎么画全在 `render.py`。
好处是：调平衡性（开火频率、穿透数、BOSS 概率）不会误伤观感，反之亦然。

`iter_frames()` 是生成器，配合 `gif.encode_gif()` 可以边渲染边编码。
"""

from __future__ import annotations

import bisect
import math
import random
from typing import Iterator, List, Optional

from .config import (
    BOSS_HOST_COUNT, BOSS_HP, BOSS_PHASE_PCT, BULLET_PIERCE, BULLET_SPEED, CELL,
    COLS, DEFAULT_BOSS_CHANCE, DEFAULT_FPS,
    FIRE_MAX_INTERVAL, FIRE_MIN_INTERVAL, GAP, GOAL_CANDIDATES,
    GOAL_DIR_BIAS,
    GRID_BOTTOM,
    GRID_TOP, GRID_W, HEIGHT, HIT_STOP_FRAMES, HIT_STOP_SPEED_SCALE,
    PADDING_LR, PARTICLES, ROWS, SHIP_ARRIVE_EPS, SHIP_H, SHIP_MAX_SPEED,
    SHIP_W, SHIP_Y, SHOOT_COOLDOWN, SKIP_CHANCE, STAR_SPEEDS, TRIPLE_ENABLED,
    W_FAR,
    W_NEAR, W_SAME, WIDTH,
)
from .models import (Bullet, Contributions, Enemy, Flash, Particle, Star,
                     Strategy, Target)
from .render import Renderer


class Engine:
    def __init__(self, contrib: Contributions,
                 strategy: Strategy = Strategy.RANDOM,
                 fps: int = DEFAULT_FPS, max_frame: int = 0,
                 boss_chance: float = DEFAULT_BOSS_CHANCE,
                 fire_interval: int = FIRE_MIN_INTERVAL,
                 seed: Optional[int] = None):
        self.contrib = contrib
        self.strategy = strategy
        self.fps = fps
        self.frame_ms = max(8, round(1000 / fps))
        self.boss_chance = boss_chance
        self.fire_interval = max(1, fire_interval)
        self.rng = random.Random(seed)

        self.targets: List[Target] = []
        self.enemies: List[Enemy] = []      # BOSS 外星人
        self.bullets: List[Bullet] = []
        self.particles: List[Particle] = []
        self.flashes: List[Flash] = []
        self.stars: List[Star] = []

        # 开火是「进入新列」触发的：记录上一次开火时压在哪一列、第几帧
        self.last_fire_col = -99
        self.last_fire_frame = -FIRE_MAX_INTERVAL
        self.shots = 0          # 标定用：总发弹数（含散射的副弹）

        # 飞船：**从正中间起飞** —— 参考项目 Ship 的初始 x=25，即 52 列的中点。
        # 从边上起步的话，开场十几秒只有半张图在动，中间起飞才是「向两边展开」。
        self.ship_x = (WIDTH - SHIP_W) / 2
        self.ship_cx = self.ship_x + SHIP_W / 2
        self.ship_target_x = self.ship_x    # 当前 goto 的目的地（列中心）
        self.ship_dir = self.rng.choice((-1, 1))
        self.goal_col = -1                  # 当前主攻的那一列
        self.arrived = True                 # 是否已停在目标列上
        self.shoot_cd = 0                   # 同列连发冷却
        self.recoil = 0                     # 普通命中的减速剩余帧数
        self.recoil_hard = 0                # 重音命中的实心停顿剩余帧数（稀有）

        self.score = 0
        self.defeated = 0
        self.total_targets = 0
        self.frame = 0

        self.renderer = Renderer(self)
        self._build_targets()
        self._spawn_stars()
        self.total_targets = len(self.targets)
        # max_frame <= 0 → 按总血量自动推算，保证默认参数下真能清场
        self.max_frame = max_frame if max_frame > 0 else self._auto_max_frame()

    def _auto_max_frame(self) -> int:
        """按「要访问多少个非空列」估帧数上限。

        新模型下时长不再由趟数决定，而是由**目标列的个数 × 每次跳转的代价**决定：
        每个非空列都要 goto 一次（跳转距离按权重是 1~3 列，≈15~45px），
        少数硬列（血量 > 穿透）还要停下来连发。再留 BOSS / 收尾 / 烟花的余量。
        """
        total_hp = sum(t.hp for t in self.targets)
        if total_hp == 0:
            return 60
        # 每个非空列 ≈ 一次 goto（跳转 1~3 列 ≈ 15~45px）+ 打击 + 回头补漏掉的列。
        # 实测最坏情况（chaos / 密集贡献图）≈ 26 帧/列，取这个系数才不会被截断。
        cols = len({t.col for t in self.targets})
        # ＋BOSS 战余量：每个宿主最坏要额外跑一段俯冲 / 追打才能处理掉，
        # 不然预算用完时 BOSS 还在天上飞，整场会被判定成「没清场」。
        return max(240, int(cols * 26) + 120 + BOSS_HOST_COUNT * 130)

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
                # 格子大小**统一 CELL**：贡献高低只用颜色深浅表达。
                # 之前写成 size = CELL + level - 1（13~17），等于把同一个信息编码
                # 了两遍 —— 大方块既是更亮又是更大，两种视觉变量互相打架，
                # 而且格子撑出网格边界后整张图的整齐感就散了（对齐 GitHub 官方
                # 贡献图的做法：只有颜色深浅在变，方块永远是同一个大小）。
                size = CELL
                # HP：只有最顶尖的一档需要两发，否则清场帧数会失控
                max_hp = 2 if level >= 5 else 1
                x = PADDING_LR + c * (CELL + GAP) + (CELL - size) // 2
                y = GRID_TOP + r * (CELL + GAP) + (CELL - size) // 2
                self.targets.append(Target(
                    col=c, row=r, x=x, y=y, size=size, level=level,
                    hp=max_hp, max_hp=max_hp))
        self._mark_boss_hosts()

    def _mark_boss_hosts(self):
        """开局就把 BOSS 的「宿主」钉下来 —— BOSS 不再靠掷骰子随机出现。

        按贡献从高到低挑 BOSS_HOST_COUNT 个格子标记 `boss=True`：只有它们打爆
        才化身 BOSS，而且还要过 `_collide` 里的后半场门控。
        排序键不掺 rng（level / size / 坐标兜底），所以同一张贡献图的宿主每次
        都相同 —— 出场因此是可预期的，而不是「这次有下次没有」。
        """
        if not self.targets:
            return
        ranked = sorted(self.targets,
                        key=lambda t: (-t.level, -t.size, t.col, t.row))
        for t in ranked[:BOSS_HOST_COUNT]:
            t.boss = True

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

    def _update_ship(self):
        """goto 目标列 —— 移植自参考项目 `Ship.animate()` 的匀速趋近。

        飞船不再无限巡航，而是飞向 `_pick_goal()` 指定的**某一列**，到位即停，
        由 `_fire()` 把它打干净，再拉下一个目标。于是节奏是「飞 → 停 → 打 → 飞」。
        """
        if self.shoot_cd > 0:
            self.shoot_cd -= 1
        # 重音（level>=4 / BOSS 宿主）→ 真·钉住。它稀有，所以这一下才读得出来
        if self.recoil_hard > 0:
            self.recoil_hard -= 1
            return
        # 普通命中 → 不钉死，只「抽一下」。每格都实心凝固会在 268 格上叠出
        # +536 帧；减速几乎不花帧数，却照样看得见打爆那一刻的顿挫。
        speed = SHIP_MAX_SPEED
        if self.recoil > 0:
            self.recoil -= 1
            speed = SHIP_MAX_SPEED * HIT_STOP_SPEED_SCALE
        dx = self.ship_target_x - self.ship_x
        if abs(dx) > SHIP_ARRIVE_EPS:
            self.ship_dir = 1 if dx > 0 else -1
            self.ship_x += self.ship_dir * min(speed, abs(dx))
            self.arrived = False
        else:
            self.ship_x = self.ship_target_x
            self.arrived = True
        self.ship_x = max(5, min(WIDTH - SHIP_W - 5, self.ship_x))
        self.ship_cx = self.ship_x + SHIP_W / 2

    # ── 目标选择 ────────────────────────────────────────────────────

    def _col_center(self, col: int) -> float:
        """第 col 列的中心 x（飞船要停到这里）。"""
        return PADDING_LR + col * (CELL + GAP) + CELL / 2

    def _col_health(self, col: int) -> int:
        """这一列还剩下多少血。"""
        return sum(t.hp for t in self.targets if t.alive and t.col == col)

    def _col_in_flight(self, col: int) -> int:
        """已经飞在这一列上、还没落地的己方子弹数。"""
        return sum(1 for b in self.bullets
                   if b.alive and b.friendly and self._col_under(b.x) == col)

    def _col_done(self, col: int) -> bool:
        """这一列是否已经被「在飞的子弹」覆盖掉了 —— 是就不必再补枪。"""
        return (self._col_health(col) - self._col_in_flight(col) * BULLET_PIERCE) <= 0

    def _reconsider(self):
        """当前目标列已经打完（或已被在飞子弹覆盖）→ 拉下一个目标。

        对应参考项目主循环 `for action in strategy.generate_actions(state)`：
        只有 `can_take_action()`（停稳 + 冷却好）成立时才拉下一个动作。
        """
        if self.goal_col >= 0 and self._col_health(self.goal_col) > 0 \
                and not (self.arrived and self._col_done(self.goal_col)):
            return
        self._pick_goal()

    def _pick_goal(self):
        """选下一个主攻列 —— 参考项目 `RandomStrategy` 的移植 + 策略变体。

        照抄的三条（这是整个模型的地基）：
          1. **候选集是「仍有存活格子的列」**，不是全部 52 列。这一条同时买到了
             两件事：每一枪都必然打在有东西的地方（不会扫过空区空放），
             且每个非空列迟早会被选到 → 清场必然完成，不需要补扫兜底。
          2. 只取最近的 N 个候选 —— 路径长度可控，不会满屏乱飞。
          3. 距离加权随机：同列 10 / 1~3 列 100 / 4 列以上 1。
             「就近」换效率，长尾的 1 保留跳到远处的意外。
             **随机性来自这里**，而不是靠飞船乱走 —— 乱走会退化成随机游走，
             净位移趋近 0，清场率会崩（实测 238/268 → 84/268）。
        """
        alive = [t for t in self.targets if t.alive]
        if not alive:
            # 靶子清完了但 BOSS 还在 → 把 BOSS 当成终点目标：横向对准它。
            # 少了这一段的话飞船会僵在原地对空气开火，BOSS 只能等自己撞底。
            boss = [e for e in self.enemies if e.alive]
            self.goal_col = -1
            if boss:
                b = boss[0]
                cx = b.x + b.size / 2 - SHIP_W / 2
                self.ship_target_x = max(5, min(WIDTH - SHIP_W - 5, cx))
            else:
                self.ship_target_x = self.ship_x
            return
        cols = sorted({t.col for t in alive})
        cur = self._col_under(self.ship_cx)

        if self.strategy == Strategy.COLUMN:
            # 按列推进：一路往右，到头绕回最左边（中间起飞 → 右半场 → 左半场）
            right = [c for c in cols if c > cur]
            goal = min(right) if right else min(cols)
        else:
            if self.strategy == Strategy.ROW:
                # 按行：先啃最下面一行（射击游戏里先清离自己最近的）
                row = max(t.row for t in alive)
                cols = sorted({t.col for t in alive if t.row == row})
            cand = sorted(cols, key=lambda c: abs(c - cur))[:GOAL_CANDIDATES]
            if self.strategy == Strategy.CHAOS:
                # 权重更平 → 更常远程奔袭。别再压得更平了：早先取 40/20 时
                # 单场要 1311 帧（65s）才收尾，超出自动上限直接跑不完。
                near, far = 60, 8
            else:
                near, far = W_NEAR, W_FAR
            weights = []
            for c in cand:
                d = abs(c - cur)
                w = W_SAME if c == cur else (near if d <= 3 else far)
                if (c - cur) * self.ship_dir > 0:
                    w *= GOAL_DIR_BIAS
                weights.append(w)
            goal = self.rng.choices(cand, weights=weights)[0]

        self.goal_col = goal
        self.ship_target_x = self._col_center(goal) - SHIP_W / 2

    def _fire(self):
        """飞船开火 —— 唯一的规则是：**这一列还没被在飞的子弹覆盖，就开一枪**。

        这是参考项目 `ColumnStrategy` 里 `while flying_bullets < total_health`
        的对应物，也是「射速由血量派生」的实现：
          * 软列（血量 ≤ 穿透）→ 一发掠过即清，飞船不停；
          * 硬列（血量 > 穿透）→ 停在该列上按 SHOOT_COOLDOWN 连发。
        于是射速不是一个恒定频率的节拍器，而是随场上剩余血量自然起伏。
        """
        since = self.frame - self.last_fire_frame
        col = self._col_under(self.ship_cx)
        hp = self._col_health(col)
        # BOSS 战：靶子已经清完，但 BOSS 还在天上飞 —— 此时必须继续开火。
        # 少了这一条，`_fire` 会在上面直接 return，BOSS 就成了打不死的存在，
        # 清场判定（现在会数 enemies）也永远等不到它消失。
        boss_left = any(e.alive for e in self.enemies)
        if hp == 0 and not boss_left:
            return
        # 在飞的子弹已经够打完这一列了 → 不再补枪。
        # 这是参考项目 ColumnStrategy 的 `while flying_bullets < total_health`
        # 的直接对应，也是「射速由血量派生」的实现：软列一发掠过即清、
        # 硬列停在原地按冷却连发，不再是一个恒定频率的节拍器。
        # 只在**还有靶子**时有意义：hp=0 时这个不等式恒真，会把 BOSS 战也挡掉。
        if hp > 0 and self._col_in_flight(col) * BULLET_PIERCE >= hp:
            return
        if col != self.last_fire_col:
            # 掠过新列 → 受最小间隔约束（防止高速通过时同一列重复判定）
            if since < self.fire_interval:
                return
            # 有一定概率「放过这一列」，留到回头再补。
            # 没有这一条的话，飞船会一边走一边把沿途清光，前方永远有目标、
            # 后方永远是空的，轨迹必然退化成单向扫荡 —— 就是那种机械感。
            # 只有会漏、会回头，才有「扫过去 → 掉头补两列 → 继续」的起伏。
            if self.rng.random() < SKIP_CHANCE:
                self.last_fire_col = col      # 记下来，这次走过不算数
                self.last_fire_frame = self.frame
                return
        elif self.shoot_cd > 0:
            # 停在同一列上（攻坚硬列）→ 按冷却连发
            return
        cx = self.ship_cx
        bx = cx - 1; by = SHIP_Y - 4
        # 有 BOSS 时不再要求「头顶必须有靶子」—— 否则 BOSS 战一枪都打不出去
        if not self._has_target_above(bx) and not boss_left:
            return
        self.shoot_cd = SHOOT_COOLDOWN
        self.last_fire_col = col
        self.last_fire_frame = self.frame
        alive_pct = sum(1 for t in self.targets if t.alive) / max(1, self.total_targets)
        triple = TRIPLE_ENABLED and alive_pct < 0.45
        self.bullets.append(Bullet(x=bx, y=by, vy=-BULLET_SPEED, max_hits=BULLET_PIERCE))
        self.shots += 1
        if triple:
            # 副弹要各自校验目标，且必须落在**不同的列**：
            # 只校验"有没有活格子"的话，±6px 常常仍在同一列，
            # 主弹刚把那列清完，两颗副弹就成了必然空放的废弹
            # （实测后期 60% 的子弹零命中，观感上就是一直在突突突）。
            for off in (-6, 6):
                if self._col_under(bx + off) == col:
                    continue
                if not self._has_target_above(bx + off):
                    continue
                self.bullets.append(Bullet(x=bx + off, y=by + 2,
                                           vy=-BULLET_SPEED * 0.96,
                                           max_hits=BULLET_PIERCE))
                self.shots += 1
        # 枪口火花
        for _ in range(3):
            self.particles.append(Particle(
                x=bx, y=by,
                vx=self.rng.uniform(-0.8, 0.8),
                vy=self.rng.uniform(-1.5, -0.3),
                life=8, max_life=8,
                color=(255, 240, 120), size=1))

    def _col_under(self, cx: float) -> int:
        """飞船中心当前压在哪一列（用于「每进入新列开一枪」的触发）。

        为什么不用「累计位移 ≥ 15px」：位移触发会和列网格错相位，
        跨过某列时正好落在 2px 的列间距里就整列被跳过，最后得靠补扫找回来
        —— 这是之前需要 2.5 趟才清完的主因。按列索引触发则保证每列必被打到一次。
        """
        return int((cx - PADDING_LR) // (CELL + GAP))

    def _has_target_above(self, bx: float) -> bool:
        """枪口正上方这一列是否还有活着的格子（决定这一枪开不开）。"""
        for t in self.targets:
            if not t.alive:
                continue
            rx, _, rw, _ = t.rect()
            if rx <= bx <= rw:
                return True
        return False

    def _past_boss_phase(self) -> bool:
        """清场是否已过半 —— BOSS 只在后半段登场，才有「收尾高潮」的结构。

        旧设计里 BOSS 什么时候冒出来全看运气，开场就可能把几个都放完；
        加了这道门控，它才稳定落在中后段，成为看得出节奏的一个阶段。
        """
        alive = sum(1 for t in self.targets if t.alive)
        return alive / max(1, self.total_targets) <= BOSS_PHASE_PCT

    def _any_threat_left(self) -> bool:
        """还有东西要打吗？**BOSS 也算**。

        旧的清场判定只数 targets，于是 BOSS 还活着就宣布清场、直接跳进庆祝，
        BOSS 成了打完之后没人管的孤儿 —— 这正是它和主循环「两张皮」的根因。
        """
        if any(t.alive for t in self.targets):
            return True
        return any(e.alive for e in self.enemies)

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

    def _update_flashes(self):
        for f in self.flashes:
            if f.life <= 0: continue
            f.life -= 1
            f.r += (f.max_r - 2.0) / f.max_life

    def _prune(self):
        """回收已死亡的粒子 / 子弹 / 敌人 / 白闪。

        它们原先只被标记 alive=False 却永远留在列表里，每帧仍会被
        完整遍历一次，帧数一多就是纯粹的无界增长。
        """
        if self.particles:
            self.particles = [p for p in self.particles if p.life > 0]
        if self.bullets:
            self.bullets = [b for b in self.bullets if b.alive]
        if self.enemies:
            self.enemies = [e for e in self.enemies if e.alive]
        if self.flashes:
            self.flashes = [f for f in self.flashes if f.life > 0]

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
                        # 打爆才算「一记实打实的中弹」→ 命中停顿。
                        # 稀有的高贡献格 / BOSS 宿主才配得上实心凝固，其余格子只
                        # 减速抽一下 —— 不然 268 格会把整场时长翻倍。
                        self.recoil = HIT_STOP_FRAMES
                        if t.level >= 4 or t.boss:
                            self.recoil_hard = HIT_STOP_FRAMES
                            self._explode(t.cx, t.cy, t.level, big=True)
                        # BOSS 不再是随机彩蛋：只有开局钉好的宿主格、且已过
                        # 后半场门控，打爆才化身 BOSS。出场因此是可预期的收尾
                        # 阶段，而且必须把它打掉才算真正清场（清场判定会数它）。
                        if (t.boss and self._past_boss_phase()
                                and self.rng.random() < self.boss_chance):
                            self.enemies.append(Enemy(
                                x=t.cx - 9, y=t.cy - 9,
                                vx=self.rng.uniform(-0.3, 0.3), vy=0.5,
                                hp=BOSS_HP, max_hp=BOSS_HP))
                            self._explode(t.cx, t.cy, t.level, big=True)
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
                for _ in range(6):
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
            n = 2
        elif big:
            n = 18
        else:
            n = 4 + level * 2
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
        # 白闪只留给「大场面」：BOSS 击落、以及等级较高的格子。
        # 之前每个格子都闪一下，整屏持续爆白，反而淹没了打爆的节奏感。
        if big or level >= 4:
            max_r = 16.0 if big else 5.0 + level
            self.flashes.append(Flash(x=x, y=y, r=2.0, max_r=max_r,
                                      life=8, max_life=8))

    # ── 主循环 ──────────────────────────────────────────────────────

    def _render_frame(self, celebration: bool = False):
        """绘制当前状态（委托给 `render.Renderer`）。"""
        return self.renderer.render(celebration)

    def _step(self) -> None:
        """推进一帧的**纯逻辑**（不渲染）。

        渲染（`iter_frames`）和标定（`simulate`）共用这一条路径 ——
        否则标定跑出来的结论和真实产物是两回事，等于没标定。
        """
        self._update_stars()
        self._update_ship()
        self._reconsider()
        self._fire()
        self._update_bullets()
        self._update_enemies()
        self._update_particles()
        self._update_flashes()
        self._collide()
        self._prune()

    def simulate(self, max_frame: int = 0) -> dict:
        """无渲染地跑完一场，返回标定指标。

        用来回答「这组参数到底行不行」：清场帧数、发弹数、每发平均伤害。
        比渲染一遍再数格子快两个数量级，所以参数扫描可以随便跑。
        """
        budget = max_frame or self.max_frame
        total_hp = sum(t.max_hp for t in self.targets)
        for self.frame in range(budget):
            self._step()
            if not self._any_threat_left() and self.defeated > 0:
                return self._stats(total_hp, cleared=True, frames=self.frame + 1)
        return self._stats(total_hp, cleared=False, frames=budget)

    def _stats(self, total_hp: int, cleared: bool, frames: int) -> dict:
        left_hp = sum(t.hp for t in self.targets if t.alive)
        dmg = total_hp - left_hp
        return {
            "cleared": cleared,
            "frames": frames,
            "seconds": round(frames / self.fps, 1),
            "shots": self.shots,
            "shots_per_sec": round(self.shots / max(1, frames) * self.fps, 2),
            "dmg_per_shot": round(dmg / max(1, self.shots), 2),
            "left": sum(1 for t in self.targets if t.alive),
            "total": self.total_targets,
        }

    def iter_frames(self, verbose: bool = True) -> Iterator:
        """逐帧产出画面（生成器）。

        调用方可以边消费边量化编码，RGB 原帧用完即丢 —— 相比原先一次性
        攒下几百张 RGB 帧（300 帧约 170MB）能大幅压低峰值内存。
        """
        for self.frame in range(self.max_frame):
            self._step()

            yield self._render_frame()

            alive = sum(1 for t in self.targets if t.alive)
            if verbose and self.frame % 50 == 0:
                print(f"  frame {self.frame:3d}  alive={alive:3d}/{self.total_targets}  "
                      f"score={self.score}  enemies={len(self.enemies)}")

            # 全部打完（**包括 BOSS**）→ 追加 15 帧胜利庆祝
            if not self._any_threat_left() and self.defeated > 0:
                for _ in range(15):
                    # 连发烟花
                    self._explode(self.rng.randint(50, WIDTH - 50),
                                  self.rng.randint(40, HEIGHT - 80),
                                  level=5, big=True)
                    self._update_particles()
                    self._prune()
                    yield self._render_frame(celebration=True)
                return

    def run(self, verbose: bool = True) -> List:
        """兼容旧接口：一次性返回全部帧（内存占用高，建议改用 iter_frames）。"""
        return list(self.iter_frames(verbose))
