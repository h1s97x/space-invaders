# 本项目设计思路与实现方案

> 把上游 `czl9707/gh-space-shooter` 的「goto 飞船 + 距离加权随机选列」模型移植进本项目，
> 并解决「观感机械」问题，同时保证 **必然清场**、**帧数可控**。
> 上游源码已逐文件研读（`constants.py` / `ship.py` / `random_strategy.py` /
> `base_strategy.py` / `animator.py`）。
>
> 本篇描述的是**当前已落地的实现**。早期两处曾被当作优点记录的「创新」后来被推翻重做：
> 「穿透=8 一发清列」与「随机飞出的 BOSS 彩蛋」，改法、实测数据与残留取舍见
> §6.1 与 §6.5 —— 记录失败的原因和记录成功的做法同样重要。

---

## 0. 背景与目标

旧版飞船是「无限匀速巡航 + 每列必开一枪」：开场即一条直线扫过去，没有呼吸感、
没有变向，结尾靠补扫兜底 —— 观感机械。上游的模型恰好提供了一个更聪明的骨架：
飞船**接任务式**地飞到某一列、停下、把那列打干净、再拉下一个目标。

本项目目标：
1. 移植上游的 **goto 飞船 + 到位才开火 + 距离加权随机选列** 骨架；
2. 在此骨架上做本地化，消除「机械感」并让节奏有起伏：`SKIP_CHANCE` 制造变向、
   穿透调小还原「段落感」、分级命中停顿还原「打击感」、BOSS 改造成收尾阶段；
3. 每一项改动都用无渲染标定（`simulate`）给出前后数据，保证默认参数下
   **必然清场**且帧数不爆 —— 而不是靠「看起来差不多」拍板。

---

## 1. 上游设计精要（我们抄了什么）

| 上游概念 | 我们如何对应 |
|---|---|
| `Action(x, shoot)` 动作队列 | `goal_col` + `_fire()` 的「到位才开火」状态机 |
| `Ship.move_to` + `animate` 匀速 goto | `_update_ship`（engine.py:159） |
| `RandomStrategy` 候选集=有敌人的列 | `_pick_goal`（engine.py:208）`cols = {t.col for t in alive}` |
| 距离加权随机（同列10/近100/远1，取最近8） | `GOAL_CANDIDATES=8`、`W_SAME/NEAR/FAR=10/100/1`（config.py:152-153） |
| 帧率无关：cells/s × `delta_time` | 速度以 px/帧表述，fps 只改帧时长（config.py:89-92） |
| 从中间起飞 `x=25` | `__init__` `ship_x = (WIDTH-SHIP_W)/2`（engine.py:61） |

上游关键常量（已核实）：`SHIP_SPEED=12.5 cells/s`、`BULLET_SPEED=7.5 cells/s`、
`SHIP_SHOOT_COOLDOWN=0.2s`、`DEFAULT_FPS=40`、`SHIP_POSITION_Y=10`。

---

## 2. 整体架构与状态机

- `engine.py` 的 `GameEngine` 同时承载 **状态 + 模拟 + 策略**；`config.py` 承载全部旋钮；
  `models.py` 定义 `Target / Bullet / Enemy / Strategy`（策略枚举 `COLUMN/ROW/RANDOM/CHAOS`，models.py:88-92）。
- 每帧主循环 `_step()`（engine.py:492）顺序：
  ```
  _update_stars → _update_ship → _reconsider → _fire → _update_bullets
  → _update_enemies → _update_particles → _update_flashes → _collide → _prune
  ```
  渲染（`iter_frames`）与标定（`simulate`）共用这同一条 `_step`，避免「标定结论和真实产物两回事」。
- 飞船运行时状态（`__init__`）：
  `ship_x / ship_cx / ship_target_x / ship_dir / arrived / goal_col / shoot_cd` +
  `recoil`（普通命中的减速余量）/ `recoil_hard`（重音的实心停顿余量）。

---

## 3. 核心机制一：goto 飞船（移植自 `Ship.animate`）

`_update_ship`（engine.py:159）每帧把 `ship_x` 朝 `ship_target_x` 匀速移动，到达
`SHIP_ARRIVE_EPS=1px` 容差即停、置 `arrived=True`：

```180:208:gh_pixel_pulverizer/engine.py
    def _update_ship(self):
        """goto 目标列 —— 移植自参考项目 `Ship.animate()` 的匀速趋近。
        ...
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
```

- `SHIP_MAX_SPEED=4.5 px/帧 @20fps = 90px/s`，约为上游 `12.5 格/s ≈ 188px/s` 的**一半**
  （滑行而非瞬移，更有「飞船感」）。
- 从正中间起飞（对应上游 `x=25`），开场即「向两边展开」。

---

## 4. 核心机制二：目标选择 `_pick_goal`（移植 `RandomStrategy` + 变体）

```208:255:gh_pixel_pulverizer/engine.py
    def _pick_goal(self):
        """选下一个主攻列 —— 参考项目 `RandomStrategy` 的移植 + 策略变体。
        ...
        """
        alive = [t for t in self.targets if t.alive]
        if not alive:
            self.goal_col = -1
            self.ship_target_x = self.ship_x
            return
        cols = sorted({t.col for t in alive})
        cur = self._col_under(self.ship_cx)

        if self.strategy == Strategy.COLUMN:
            # 按列推进：一路往右，到头绕回最左边
            right = [c for c in cols if c > cur]
            goal = min(right) if right else min(cols)
        else:
            if self.strategy == Strategy.ROW:
                # 按行：先啃最下面一行
                row = max(t.row for t in alive)
                cols = sorted({t.col for t in alive if t.row == row})
            cand = sorted(cols, key=lambda c: abs(c - cur))[:GOAL_CANDIDATES]
            ...
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
```

照抄上游的三条地基（注释见 engine.py:211-219）：
1. **候选集 = 仍有存活格子的列** → 每枪必中 + 每个非空列迟早被选到 → 必然清场；
2. **只取最近 `GOAL_CANDIDATES=8` 个** → 路径长度可控；
3. **距离加权随机** `W_SAME/NEAR/FAR=10/100/1` → 就近换效率，长尾的 1 保留跳远处的意外。
   随机性来自「选列」而非「飞船乱走」——否则净位移趋近 0、清场率崩。

策略变体（相对上游新增）：
- `COLUMN`：按列推进（一路右行，到头绕回最左）；
- `ROW`：先清最下面一行（射击游戏里先清离自己最近的）；
- `RANDOM`：默认，标准加权随机；
- `CHAOS`：权重更平（`near/far=60/8`），更常远程奔袭、偏向高贡献格。

`GOAL_DIR_BIAS` 默认 `1`（关闭方向惯性）——见 §6.3 说明。

另外 `_pick_goal`（engine.py:239）"无处可去"的分支现在是 **BOSS 战入口**：靶子已清空
但 BOSS 还在飞时，把 BOSS 当成终点目标横向对准它。少了这段，飞船会僵在原地对空气开火，
BOSS 只能等自己撞底 —— 那就不是「战斗」了。

---

## 5. 核心机制三：开火模型 `_fire`（射速由血量派生）

关键洞察（config.py:107-113 详述）：**射速不能独立调**，必须绑到飞船位移。
独立射速会与速度打架——飞船慢射速快时会停在空列上空放（实测 60% 子弹打空、
清场率 238/268 → 84/268）。改成「位移触发」后射速是派生量，二者不可能再冲突。

```296:369:gh_pixel_pulverizer/engine.py
    def _fire(self):
        """飞船开火 —— 唯一的规则是：**这一列还没被在飞的子弹覆盖，就开一枪**。
        ...
        """
        since = self.frame - self.last_fire_frame
        col = self._col_under(self.ship_cx)
        hp = self._col_health(col)
        # BOSS 战：靶子已经清完，但 BOSS 还在天上飞 —— 此时必须继续开火。
        # 少了这一条，`_fire` 会在上面直接 return，BOSS 就成了打不死的存在。
        boss_left = any(e.alive for e in self.enemies)
        if hp == 0 and not boss_left:
            return
        # 只在**还有靶子**时看「在飞子弹够不够」：hp=0 时这个不等式恒真，
        # 会把 BOSS 战也一起挡掉。
        if hp > 0 and self._col_in_flight(col) * BULLET_PIERCE >= hp:
            return
        if col != self.last_fire_col:
            if since < self.fire_interval:
                return
            # 有一定概率「放过这一列」，留到回头再补。
            if self.rng.random() < SKIP_CHANCE:
                self.last_fire_col = col
                self.last_fire_frame = self.frame
                return
        elif self.shoot_cd > 0:
            return
        ...
        self.shoot_cd = SHOOT_COOLDOWN
        ...
```

- 稀疏软列（血量 ≤ `BULLET_PIERCE=3`）→ 一发掠过即清；
- 密集硬列（4 格以上）→ 停在该列按 `SHOOT_COOLDOWN=3` 帧连发 —— **停顿是稀有的重音**；
- **BOSS 战豁免**：靶子清空后前两道 guard 本会把 BOSS 战一并挡掉，故显式放行（见 §6.5）；
- 触发点用 `_col_under`（engine.py:371）按**列索引**判断，而非累计位移 ——
  避免相位错位漏列（这是旧版需 2.5 趟才清完的主因）。

---

## 6. 我们改了/加了什么（相对上游的 3 条关键本地化）

### 6.1 穿透：从「一发清列」退回 `BULLET_PIERCE=3`（这条曾被推翻）

**曾经的取值是 8**（一列格子上限 ROWS=7 + 1 富余），当时当作优点记录：「一发穿整列、
飞船掠过即清、不必攻坚」。实测下来它恰恰是**观感问题的主因**，已被推翻：

| 现象 | 根因 |
|---|---|
| 射击感退化成「一道激光扫过」 | 一发即清，看不到逐格命中的过程与反馈 |
| 飞船几乎从不停 | 稀有硬列才需要第二发 → goto 模型想买的「飞→停→打→飞」段落感被抵消 |
| 与 `SKIP_CHANCE` 互相打架 | 两者都在制造起伏，但「掠过即清」默认成立，把「放过/回头」的意义吃掉了 |

改小的代价立刻显现 —— **先试 2，整场从约 600 帧涨到 1300 帧（@20fps 约 65s）**，
因为每列都要停下来补两发。最终取 **3** 作为「有颗粒感」与「打得完」的分界：

- 稀疏列（1~3 个格，占绝大多数）→ 一发掠过即清；
- 密集硬列（4 格以上）→ 真正停下来连发，**停顿因此成为稀有的重音，而不是每列的常态**。

时长并没有靠继续加速去换，而是靠 `DEFAULT_FPS` 20→25 免费压回来（fps 不动帧数与体积），
详见 §8 与 §9。

### 6.2 `SKIP_CHANCE=0.15` 制造变向（engine.py:285）
飞船掠过某列有 15% 概率放过、留到回头补。这是消除「机械单向扫荡」观感的**最关键一刀**：
没有它，前方永远有目标、后方永远空 → 轨迹必然退化成单向推扫。放过一些列才会出现
「扫过去 → 漏两列 → 掉头补 → 继续」的起伏。代价是路径变长，所以 **SKIP_CHANCE 直接决定时长，别乱调**。

### 6.3 关掉方向惯性 + 关掉后期三连发
- `GOAL_DIR_BIAS=1`（默认关闭）：惯性虽能省路程（709→572 帧），但把轨迹压成单向推进、
  变向次数从 6.6 掉到 3.0；一旦允许放过列（6.2），惯性连省时都省不了，只剩压平随机性的副作用。
- `TRIPLE_ENABLED=False`：后期散射虽能快 ~60 帧，但射速从 2.67 涨到 3.66 发/秒 →
  观感变成「一直在突突突」，正是要避免的。这条红线后来也约束了我自己：参数扫描里
  `SHOOT_COOLDOWN=2` 能把整场再压 65 帧，但射速会涨到 3.52 发/秒，正好踩进当年被
  否掉的区间，所以最终**保留 3 帧**（3.04 发/秒）。

### 6.4 分级命中停顿（hit-stop）——「打」这件事要有颗粒感

穿透调小之后，逐格清除在逻辑上成立了，但观感里还缺「打的那一下」：多个格子在同一帧
炸开，看起来只是"分别发生了几件事"。于是加了 `_collide` → `_update_ship` 的一记微卡顿：

| 命中对象 | 反馈 | 成本 |
|---|---|---|
| 普通格 | 飞船速度 ×`HIT_STOP_SPEED_SCALE=0.2`「抽一下」 | 几乎免费（仍在前进） |
| level≥4 / BOSS 宿主（稀有重音） | 实心凝固 `HIT_STOP_FRAMES=2` 帧 | 全场仅几十次 |

**为什么不在所有格子上实心凝固**：268 个格子 × 2 帧 = **+536 帧（约 27s）**，实测会把
整场顶到 1260 帧。分级之后普通格仍看得出顿挫，重音因为稀有才读得出来 —— 这条"稀缺性"
原则在 §6.1 的停顿和 §6.5 的 BOSS 上同样适用。

### 6.5 BOSS：从「随机彩蛋」改成「结构化的收尾阶段」（这条也被推翻过）

旧的彩蛋式实现是「level≥4 的格子按 `rng.random() < 0.10` 随机飞出 BOSS」，三个问题让它
始终是主循环之外的一张皮：

1. **时机与位置全随机** → 爱冒不冒，开场也可能一次放完，无法塑造中段高潮；
2. **与清场互不咬合**：清场判定只数 `targets`，BOSS 还活着也能宣布清场，
   于是它成了打完之后没人管的孤儿；
3. **威胁是假的**：飞船没有血量，BOSS 的子弹只扣分不致命，纯粹是干扰。

新实现把它钉成一个可预期的阶段（`_mark_boss_hosts` / `_past_boss_phase` /
`_any_threat_left`，engine.py:145 / 390 / 399）：

- **开局钉宿主**：按贡献挑定 `BOSS_HOST_COUNT=3` 个格子（排序不掺 rng → 同一张贡献图的
  宿主每次相同），只有它们打爆才化身 BOSS；
- **过半才登场**：`BOSS_PHASE_PCT=0.5` 门控，保证 BOSS 战落在中后段而不是开场；
- **必定出场**：`DEFAULT_BOSS_CHANCE=1.0`（默认不掷骰子），想要随机就调低；
- **必须打掉才算清场**：清场判定从"只数 targets"改成 `_any_threat_left()`，同时 `_fire`
  与 `_pick_goal` 都加了 BOSS 战分支 —— 否则 `_fire` 的 `hp == 0: return` 会让飞船在
  BOSS 战时直接停火，BOSS 反倒成了打不死的存在。

实测 4 策略 × 3 seed：**BOSS 出场 10/12 场**，全部清场。剩下 2 场是因为宿主在清场过半
之前就被顺手打爆了（宿主的分布由贡献图决定）；要做到 100% 出场就得让宿主列最后才被访问，
那会给选列策略额外背一层"排除宿主列"的耦合，目前判断不值得。

---

## 7. 收尾、自适帧数、必然清场

- **收尾**：`iter_frames`（engine.py:612）清场后追加 15 帧胜利烟花（`celebration`），
  进入条件已改成 `_any_threat_left()`（**含 BOSS**）。
- **自适帧数**：`_auto_max_frame`（engine.py:84）按非空列数 × 26 + 120 +
  `BOSS_HOST_COUNT × 130` 估上限 —— 最后那项是 BOSS 战余量，没有它预算用完时 BOSS
  还在天上，整场会被判成「没清场」。
- **必然清场**：候选集=有敌人的列 + 加权随机覆盖长尾 → 每个非空列迟早被选到
  （同上游保证）；`_col_done` 阻止对已覆盖列重复补枪，避免空放。

---

## 8. 调参常量一览（config.py）

| 常量 | 值 | 作用 |
|---|---|---|
| `DEFAULT_FPS` | **25**（原 20） | 只决定帧时长、不动逻辑/帧数/体积 —— 用它把 990 帧压回 39.6s |
| `SHIP_MAX_SPEED` | 4.5 px/帧 | 匀速段速度（≈上游一半，刻意保留的滑行感） |
| `SHIP_ARRIVE_EPS` | 1.0 px | 到位即停容差 |
| `SHOOT_COOLDOWN` | **3 帧**（原 5） | 同列连发间隔；再降到 2 会踩进 3.52 发/秒的「突突突」区 |
| `BULLET_SPEED` | 6.0 px/帧 | 子弹速度 |
| `BULLET_PIERCE` | **3**（原 8） | 单弹穿透数 —— 决定「停顿」是稀有重音还是每件常态，见 §6.1 |
| `HIT_STOP_FRAMES` | 2 帧 | 重音的实心凝固帧数 |
| `HIT_STOP_SPEED_SCALE` | 0.2 | 普通命中的顿挫：0=钉死（太贵） 1=完全没感觉 |
| `GOAL_CANDIDATES` | 8 | 最近候选列数 |
| `W_SAME / W_NEAR / W_FAR` | 10 / 100 / 1 | 距离加权（照抄上游） |
| `GOAL_DIR_BIAS` | 1 | 方向惯性（默认关闭） |
| `SKIP_CHANCE` | 0.15 | 放过列的概率（制造变向，决定时长） |
| `FIRE_MIN/MAX_INTERVAL` | 2 / 12 帧 | 进新列 / 停驻补枪间隔 |
| `TRIPLE_ENABLED` | False | 后期三连发（关闭以避「突突突」） |
| `BOSS_HOST_COUNT` | 3 | 开局钉定的 BOSS 宿主格个数 |
| `BOSS_HP` | 6 | BOSS 血量（比旧彩蛋的 3 厚，才像阶段目标） |
| `BOSS_PHASE_PCT` | 0.5 | 清场过半后才允许 BOSS 登场（第二阶段门控） |
| `DEFAULT_BOSS_CHANCE` | **1.0**（原 0.10） | 宿主化身的**概率**，默认必定出场以换取可预期性 |
| `TARGET_LOCK_FRAMES` | 25 | RANDOM 锁定同目标帧数（防抖动） |

---

## 9. 标定结果（验证）

`simulate`（engine.py:584）无渲染跑完一场，返回清场帧数 / 发弹 / 每秒发弹等指标
（比渲染快两个数量级，参数扫描随便跑）。

**当前实现**（`PIERCE=3` + 分级 hit-stop + 结构化 BOSS，`fps=25`），
4 策略 × 3 seed 的 `iter_frames` 实测：

| 指标 | 结果 |
|---|---|
| 清场率 | **12/12 全部清场**（含 BOSS：都要被打掉或自行退场才算完） |
| 平均帧数 / 时长 | 约 **990 帧 / 39.6s**（区间 879~1215 帧、35~49s） |
| BOSS 出场 | 10/12 场（另 2 场宿主在过半前就被打爆，见 §6.5） |
| 回归测试 | `tests/test_smoke.py` **18/18 通过** |

路上被数据否掉的两个版本（记在此以免回头再踩）：
- `PIERCE=2` → 1305 帧 / 65s，太长；
- 全格实心 hit-stop → 1260 帧，其中约 536 帧纯是凝固开销。

另做过一次「穿透 × 连发冷却 × 飞船速度」8 组合扫描，结论是"再快就要牺牲
`< 3.4 发/秒` 的不突突突原则"，所以没有采用 `SHOOT_COOLDOWN=2` / `SPEED=5.5`
这两个更省时的组合（它们能把时长再压到 40s），改用免费的 `fps` 补偿时长。

---

## 10. 局限与后续

- `SKIP_CHANCE` 直接决定时长：调大 → 路径更长、变向更多、动画更久；
- **BOSS 出场不是 100%**：宿主的分布由贡献图决定，若它在清场过半前就被顺手打爆，
  该场就没有 BOSS（实测 10/12）。要强制出场就得让宿主列最后才被访问，代价是给选列
  策略加一层耦合，目前判断不划算（§6.5）；
- **`PIERCE=3` 是时长与颗粒感的折中，不是最优**：想更强调"停下来攻坚"就往 2 调，
  但要接受时长涨回 65s 档；反过来往 8 调就回到了「激光扫过」；
- 网格对齐上游：`CELL+GAP=15px`，`COLS=53` 对应 GitHub 一年 52–53 周；
- 可选增强：把 §9 的参数扫描固化成 `--tune` 子命令、策略自动择优、
  按稀疏度自适应 `SKIP_CHANCE`。
