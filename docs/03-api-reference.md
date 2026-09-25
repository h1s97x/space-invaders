# 03 · API 参考

> 所有行号对应当前仓库代码。`cli.py` 中标记 `_`-前缀的方法为内部实现，外部不应依赖。

---

## 1. 常量

### 1.1 调色板（`cli.py:36-55`）

| 常量 | RGB | 用途 |
|------|-----|------|
| `BG` | `(13, 17, 23)` | 画布背景 |
| `GRID_BG` | `(22, 27, 34)` | 贡献图区域底板 |
| `GR_L0` | `(33, 38, 45)` | ⚠️ **定义但未使用**（死代码） |
| `GR_L1` | `(14, 68, 41)` | level 1 靶子色 |
| `GR_L2` | `(0, 109, 50)` | level 2 |
| `GR_L3` | `(38, 166, 65)` | level 3；也用于粒子/血条 |
| `GR_L4` | `(57, 211, 83)` | level 4；也用于底部生命条、粒子 |
| `GR_L5` | `(87, 242, 135)` | level 5 |
| `SHIP_BODY` | `(68, 147, 248)` | 飞船机身 |
| `SHIP_DARK` | `(41, 82, 136)` | 飞船两翼 |
| `SHIP_FL` | `(255, 160, 30)` | 尾焰外层（橙） |
| `SHIP_FL2` | `(255, 220, 80)` | 尾焰内层（黄） |
| `BOSS_HI` | `(255, 210, 80)` | BOSS 血条 + level 5 皇冠条 |
| `BULLET` | `(255, 255, 180)` | 己方子弹 |
| `STARS` | 4 色列表（暗→白） | 星空亮度，索引越大越亮 |
| `PARTICLES` | 5 色列表 | 爆炸粒子取色池：`[GR_L4, GR_L3, (255,200,80), (255,120,60), (255,255,255)]` |
| `HUD1` | `(200, 210, 230)` | HUD 主文本（SCORE） |
| `HUD2` | `(120, 130, 150)` | HUD 次文本（BEAT / @user / F###） |

> 另有若干**内联字面量**颜色未提取为常量：网格线 `(30,35,42)`、己方子弹头 `(200,255,200)`、
> 敌方子弹 `(255,100,80)`、BOSS 身体 `(230,60,60)`/`(200,40,40)`、枪口火花 `(255,240,120)`、
> 飞船舱 `(180,220,255)`、命中特效 `(255,100,60)`、低血量进度条 `(255,120,80)`、
> 生命条底 `(45,50,60)`、白色火花环 `(255,255,255)`。

### 1.2 几何与可调参数（`cli.py:58-101`）

| 常量 | 值 | 含义 / 影响 |
|------|-----|------------|
| `CELL` | 13 | 格子基础边长 |
| `GAP` | 2 | 格子间隙 |
| `COLS` / `ROWS` | 53 / 7 | 贡献图行列数 |
| `GRID_W` / `GRID_H` | 793 / 103 | 贡献图总尺寸 |
| `PADDING` | 34 | ⚠️ 中间变量，随后被 `PADDING_LR` 取代 |
| `TOP_PAD` | 20 | 网格上边距 |
| `WIDTH` / `HEIGHT` | 860 / 230 | 画布尺寸 |
| `PADDING_LR` | 33 | `(860-793)//2`，实际水平居中使用 |
| `GRID_TOP` / `GRID_BOTTOM` | 20 / 123 | 网格纵向边界 |
| `SHIP_Y` | 193 | 飞船基准 y（已上移 10px 避免压住底部 HUD） |
| `SHIP_W` / `SHIP_H` | 32 / 22 | 飞船尺寸 |
| `STAR_SPEEDS` | `[0.70, 0.35, 0.15]` | z=0..2 三层星空的每帧下落速度 |
| `DEFAULT_COLORS` | 32 | 默认 GIF 调色板色数 |
| `TARGET_LOCK_FRAMES` | 25 | RANDOM 策略锁定同一靶子的帧数（防抖动） |
| `BULLET_PIERCE` | 3 | **单发子弹最大穿透数**（能否清场的关键） |
| `SHIP_TRACK` | 0.18 | 飞船横向追敌插值系数 |

---

## 2. 数据结构（`cli.py:104-171`）

### `Target` — 贡献格靶子

```python
@dataclass
class Target:
    col: int; row: int
    x: float; y: float      # 左上角屏幕坐标
    size: int               # 像素边长（13..16）
    level: int              # 1..5 贡献等级
    hp: int                 # 剩余 HP（level 5 为 2，其余为 1）
    alive: bool = True
```

| 成员 | 类型 | 说明 |
|------|------|------|
| `cx` / `cy` | property | 中心点坐标 `x + size/2`（碰撞、爆炸都用中心） |
| `rect()` | `-> Tuple[float,float,float,float]` | `(x0, y0, x1, y1)`，供绘制与*AABB 点判定*使用 |

### `Enemy` — BOSS 外星人

```python
@dataclass
class Enemy:
    x: float; y: float          # 左上角
    vx: float; vy: float        # 速度
    hp: int; max_hp: int        # 初始 3/3
    alive: bool = True
    size: int = 18              # 边长
```

### `Bullet` — 子弹（敌我共用）

```python
@dataclass
class Bullet:
    x: float; y: float
    vy: float = -5.0            # 己方向上为负；BOSS 子弹为 +3.0
    alive: bool = True
    friendly: bool = True       # True=飞船发射  False=BOSS 发射
    hits: int = 0               # 已穿透靶子数
    max_hits: int = 1           # 穿透上限（开火时设为 BULLET_PIERCE）
```

> 敌方子弹创建时**不传** `max_hits`（保持默认 1），但实际不被使用 —— 敌方子弹只与飞船碰撞，
> 命中后立即 `alive = False`。

### `Particle` — 爆炸粒子

```python
@dataclass
class Particle:
    x: float; y: float
    vx: float; vy: float
    life: int; max_life: int    # 剩余 / 初始寿命
    color: Tuple[int, int, int]
    size: int = 2
```

生命周期：每帧 `vy += 0.08`（重力）、`vx *= 0.97`（阻尼）、`life -= 1`；
渲染时按 `alpha = life / max_life` 线性衰减亮度，实现渐隐。

### `Star` — 星空点

```python
@dataclass
class Star:
    x: int; y: int; z: int      # z=0..2，越大越远
    speed: float                # = STAR_SPEEDS[z]
```

### `Contributions` — 贡献数据容器

```python
@dataclass
class Contributions:
    rows: List[List[int]]       # rows[weekday(0..6)][week(0..52)]
    username: str
    total: int = 0              # GitHub 的 totalContributions
```

### `Strategy` — 攻击策略枚举

```python
class Strategy(str, Enum):
    COLUMN = "column"   # 从最右列开始，自上而下
    ROW    = "row"      # 从最上行开始，自左而右
    RANDOM = "random"   # 随机，但锁定 TARGET_LOCK_FRAMES 帧
    CHAOS  = "chaos"    # 先打 level 最高的（同档先行洗牌随机化）
```

继承 `str` 因此 `Strategy(args.strategy)` 可直接由 argparse 的字符串构造，且可 `== "column"`。

---

## 3. 数据获取

### `fetch_contributions(username, token) -> Optional[Contributions]`
`cli.py:192-234`

**行为**
1. POST `https://api.github.com/graphql`，`User-Agent: gh-pixel-pulverizer/2.0`；
2. `token` 非空时加 `Authorization: bearer <token>`（同时也兼容无 token 的公开配额）；
3. 把 `contributionCalendar.weeks[].contributionDays[]` 铺进 `7×53` 矩阵，
   越界防御：`weeks[:COLS]`、`0 <= weekday < ROWS`；
4. 成功返回 `Contributions(rows, username, totalContributions)`。

**错误契约（重要）**：以下情况**一律 `print("[warn] ...")` 后返回 `None`，绝不抛出**：

| 失败 | 分支 |
|------|------|
| HTTP 401/403/其他状态码 | `urllib.error.HTTPError` |
| DNS / 超时 / 连接失败 | `urllib.error.URLError` 或 `TimeoutError`（`timeout=15`） |
| 非 JSON 响应（HTML 错误页等） | `json.JSONDecodeError` / `ValueError` |
| GraphQL `errors` 字段（HTTP 200 包错误是 GraphQL 惯例） | `body["errors"]` |
| `data.user` 为空（用户不存在 / token 无权限） | `not user` |

**副作用**：向 stdout 打印警告行。**网络 I/O（唯一网络出口）**。

### `generate_dummy(username="octocat") -> Contributions`
`cli.py:237-258`

用 `random.Random(zlib.crc32(username.encode("utf-8")))` 播种 ——
**刻意不用内置 `hash()`**：CPython 的 `str.__hash__` 每进程带随机盐（`PYTHONHASHSEED`），
会让 `--seed` 失去可复现性（历史 bug，见 `TestDummyData.test_reproducible`）。

生成规则：
- `row in (0, 6)`（周末）：`choices([0,0,0,1,2], weights=[40,20,10,20,10])` → 摸鱼；
- 工作日行：`choices([0,1,2,3,4,5,10], weights=[15,15,20,20,15,10,5])`；
- 额外随机种 8 个 `randint(15, 40)` 的高产格，**保证 level 4/5 的 BOSS 格一定存在**；
- `total` = 矩阵元素之和。

**副作用**：无。**确定性**：同一 username 永远得到同一矩阵（跨进程、跨版本可复现）。

### `GRAPHQL`（module-level str）
`cli.py:176-189`

```graphql
query($user: String!) {
  user(login: $user) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { contributionCount weekday } }
      }
    }
  }
}
```

---

## 4. `Engine`（`cli.py:263-748`）

### 4.1 `__init__(contrib, strategy=RANDOM, fps=40, max_frame=0, boss_chance=0.18, seed=None)`

| 属性 | 初始化 |
|------|--------|
| `frame_ms` | `max(8, round(1000/fps))` —— 下限 8ms 防御 fps 过大 |
| `rng` | `random.Random(seed)` —— 实例级随机数，不污染全局 |
| `targets/enemies/bullets/particles/stars` | 空列表，随后填充 |
| `ship_x` / `ship_target_x` | 初始水平居中 `WIDTH/2 - SHIP_W/2` |
| `locked_target` / `target_lock_until` | RANDOM 策略的锁定状态 |
| `score` / `defeated` / `total_targets` / `frame` | 计数器 |
| `max_frame` | `max_frame if max_frame > 0 else self._auto_max_frame()` |

**副作用**：调用 `_build_targets()`、`_spawn_stars()`。

### 4.2 `max_frame` 自动推算：`_auto_max_frame() -> int`
`cli.py:298-305`

```python
total_hp = sum(t.hp for t in self.targets)
if total_hp == 0: return 60                       # 空贡献图特判
return max(240, int(total_hp * 2.4) + 90)         # 实测 ~1.6 帧/HP，留 50% 余量
```

> 真清场会提前 `return`，所以这个上限宽松**不影响正常产物体积**，只作为兜底天花板。

### 4.3 `_build_targets()`
`cli.py:309-347`

- 收集所有 `v > 0` 的值排序 → `counts`，`n = len(counts)`；**`counts` 为空则直接 return**（全空贡献图）；
- `level_of(count)`：用 `bisect.bisect_left(counts, count) / n` 取「严格小于当前值的占比」；
  注释明确指出用 `bisect` 而非手动扫一遍，是为了**重复值扎堆时不挤进同一档**；
- `size = min(CELL + level - 1, CELL + GAP + 1)` → 上限 16（不溢出网格间隙）；
- `hp = 2 if level >= 5 else 1` —— 只有最顶尖档需要两发，否则清场帧数失控；
- 坐标居中补偿： `(CELL - size) // 2`。

> **历史变更**：旧实现用 `count // 5` 绝对阈值，导致真实数据绝大多数落在 level 1、
> 整图一片深绿且凑不出 BOSS 格。现改为**用户自身分位数**。

### 4.4 `_spawn_stars()`
`cli.py:349-358`

生成 160 颗星，`z = rng.randint(0,2)`，`speed = STAR_SPEEDS[z]`。速度与亮度都绑定 z → 真三层视差。

### 4.5 更新类方法

| 方法 | 行号 | 行为要点 |
|------|------|----------|
| `_update_stars()` | `362-367` | `s.y += s.speed`；到底则 `y=0` 且重新随机 `x` |
| `_pick_target()` | `369-390` | 见下表 |
| `_update_ship()` | `392-400` | `ship_target_x = target.cx - SHIP_W/2`；`ship_x += Δ * SHIP_TRACK`；再 clamp 到 `[5, WIDTH-SHIP_W-5]` |
| `_fire()` | `402-421` | 每帧必发 1 发（`-5.0`）；`alive_pct < 0.45` 时追加左右各 1 发（`-4.8`，偏移 ±6）；再生成 3 个枪口火花粒子 |
| `_update_bullets()` | `423-428` | 位移；`y < -10 或 y > HEIGHT+10` → `alive=False` |
| `_update_enemies()` | `430-446` | `vy += 0.04`（≤2.2）；`vx += sin(frame*0.06 + x*0.02)*0.05`（clamp ±1.5）；`y > HEIGHT-30` → 原地大爆炸并消失；`frame % 40 == 0 且 GRID_BOTTOM < y < SHIP_Y-40` → 发射 `vy=3.0` 的敌方子弹 |
| `_update_particles()` | `448-453` | 位移；重力 `vy += 0.08`；阻尼 `vx *= 0.97`；`life -= 1` |
| `_collide()` | `468-525` | 三组判定，见下 |
| `_prune()` | `455-466` | `particles[:] = [p for p in ... if p.life > 0]`（按 life 判定，不是 `alive`）；`bullets`/`enemies` 按 `alive` 过滤 |

**`_pick_target()` 策略表**

| Strategy | 选取规则 |
|----------|----------|
| `COLUMN` | `min(alive, key=lambda t: (-t.col, t.row))` → 最右列的最上面一格 |
| `ROW` | `min(alive, key=lambda t: (t.row, t.col))` → 最上行的左边一格 |
| `CHAOS` | `rng.shuffle(alive)` 后 `min(alive, key=lambda t: -t.level)` → 最高 level（同档随机） |
| `RANDOM` | 若 `locked_target` 为空/已死/锁过期（`frame >= target_lock_until`）则重选，`target_lock_until = frame + 25` |

**`_collide()` 三组判定**

1. **己方子弹 → 靶子**（`470-495`）
   AABB 点判定 `rx <= b.x <= rw and ry <= b.y <= rh`；命中后 **`b.y = ry - 1`**（立刻穿出该格高度带，
   否则同一格会被连续数帧重复判定）；`hits += 1`，达到 `max_hits` 则子弹消失；
   `t.hp -= 1`；归零则 `alive=False`、`defeated += 1`、`score += level*20`、大爆炸、
   且 **`level >= 4` 且 `rng.random() < boss_chance`** 时生成 `Enemy(x=cx-9, y=cy-9, vx=±0.3, vy=0.5, hp=3, max_hp=3)`；
   未归零则 `tiny` 爆炸。命中后 `break`（内层只结算一个靶子/帧）。

2. **己方子弹 → BOSS**（`498-510`）
   命中即子弹消失、`e.hp -= 1`、`tiny` 爆炸；归零则 `score += 100` + `big` 爆炸。

3. **BOSS 子弹 → 飞船**（`513-525`）
   判定矩形 `sx = ship_x+4, sy = SHIP_Y-4, sw = SHIP_W-4, sh = SHIP_H`（注意高度用了完整 `SHIP_H`）；
   命中则 `score = max(0, score - 5)` 并喷 12 个橙色粒子。**飞船不会死**，游戏必然能产出 GIF。

### 4.6 `_explode(x, y, level=2, tiny=False, big=False)`
`cli.py:527-559`

| 参数组合 | 粒子数 `n` | 速度上限 | 是否加白色火花环 |
|----------|-----------|----------|------------------|
| `tiny=True` | 3 | 2.5 + level*0.3 | 否 |
| `big=True` | 34 | 4.0 | 是（20 颗，每 18° 一颗，life=20） |
| 二者皆否 | `10 + level*6` | 2.5 + level*0.3 | 仅 `level >= 3` 时 |

粒子属性：`life = randint(15, 40 + level*3)`、`color = choice(PARTICLES)`、`size = choice([1,1,2,2,3])`、
方向 `ang ~ Uniform(0, 2π)`、速度 `Uniform(0.5, sp_max)`。

> **体积敏感区**：`n` 越大，每帧脏矩形越大、GIF 越大。注释指出粒子砍半 ≈ 省 25% 体积。

### 4.7 绘制方法（全部 `_draw_*(d: ImageDraw.ImageDraw)`，无副作用）

| 方法 | 行号 | 要点 |
|------|------|------|
| `_draw_stars` | `563-568` | `idx = 3 - s.z` 映射到亮度；偶帧用 `STARS[idx]`，奇帧降一档 → 闪烁感 |
| `_draw_grid_bg` | `570-581` | 先画底板矩形（外扩 2px），再画 54 条竖线 + 8 条横线，颜色 `(30,35,42)` |
| `_draw_targets` | `583-595` | `COLORS[min(4, level-1)]`；`level>=5` 在顶边画 2px 高的 `BOSS_HI` **皇冠条**；`hp > 1` 在左上角画 1 个 `BG` 色点表示「未打爆」 |
| `_draw_bullets` | `597-606` | 己方：3×6 矩形 + 顶端亮点；敌方：3×5 矩形（橙红） |
| `_draw_enemies` | `608-628` | 红色身体；满血 `(230,60,60)` / 受伤 `(200,40,40)`；四角尖刺；眼睛 `dx` 朝向飞船；`hp < max_hp` 时画 `BOSS_HI` 血条 |
| `_draw_ship` | `630-662` | `flame_boost = 1.5 - alive_pct`（残余越少越燃）；`flame_h = int(4*boost + sin(frame*0.7)*2 + 2)`；绘制顺序：两翼 → 梯形机身 → 舱（椭圆） → 尾焰外层 → 内层 |
| `_draw_particles` | `664-671` | `alpha = life/max_life`；`col = v*alpha` 线性调暗（注意 `+ 0*(1-alpha)` 是冗余写法） |
| `_draw_hud` | `673-692` | `ImageFont.load_default()`（**每帧重新加载**）；左上 `SCORE n` / `BEAT d/total`；右上 `@username`（按 `len(name)*6` 反推宽度做右对齐）+ `F###`；右下 140px 进度条，`pct > 0.3` 用 `GR_L4` 否则橙红 |

### 4.8 `iter_frames(verbose=True) -> Iterator[Image.Image]`
`cli.py:711-744`

**公开 API，是推荐的主入口。**

- `for self.frame in range(self.max_frame)` —— 循环变量是**实例属性**（因此 `_pick_target`、`_fire` 等可直接读取 `self.frame`）；
- 每帧：8 个 update → `yield _render_frame()` → 每 50 帧打印 → 清场判定；
- 清场条件 `alive == 0 and self.defeated > 0` → 追加 **15 帧 celebration**：每帧在
  `x∈[50, WIDTH-50]`、`y∈[40, HEIGHT-80]` 随机位置放一朵 `big=True, level=5` 烟花，
  然后 `_update_particles()` + `_prune()` + `yield _render_frame(celebration=True)`，最后 `return`；
- `verbose=False` 时不打印进度（**测试里一律用 False**）。

> celebration 帧内 `self.frame` **不再递增**（仍在同一次外层循环迭代里），所以 HUD 帧号会停在最后一帧。

### 4.9 `run(verbose=True) -> List[Image.Image]`
`cli.py:746-748`

```python
"""兼容旧接口：一次性返回全部帧（内存占用高，建议改用 iter_frames）。"""
return list(self.iter_frames(verbose))
```

⚠️ **遗留接口**，会一次性驻留全部 RGB 帧。**新代码不要调用**。

---

## 5. GIF 编码

### `_clamp_colors(colors: int) -> int`
`cli.py:753-754` — `max(2, min(256, colors))`。GIF 调色板最多 256 色，至少 2 色（Pillow 要求 ≥2）。

### `build_palette(first: Image.Image, colors=32) -> Image.Image`
`cli.py:757-765`

```python
palette = first.quantize(colors=..., dither=Image.Dither.NONE).getpalette()[:256*3]
palette += [0] * (256*3 - len(palette))     # 补齐到 768
pal_img = Image.new("P", first.size); pal_img.putpalette(palette)
```

返回一张 **P 模式调色板图**。共享它才能保证全片不闪烁。

### `quantize_frame(frame, pal_img, colors=32) -> Image.Image`
`cli.py:768-776`

`frame.quantize(palette=pal_img, colors=..., dither=Image.Dither.NONE)`。
关抖动的理由：像素画是大色块，抖动只会塞高频噪声 → 体积变大、观感几乎不变。

### `encode_gif(frames: Iterable[Image.Image], path: str, frame_ms: int, colors=32) -> int`
`cli.py:779-804`

- `frames` **可以是生成器**（也必须是，见架构文档的内存模型）；
- 空序列 → `raise RuntimeError("没有帧")`；
- 内部流程：取首帧 → `build_palette` → 逐帧 `quantize_frame` 收集到 `quantized` 列表 → 调用
  ```python
  quantized[0].save(path, save_all=True, append_images=quantized[1:],
                    duration=frame_ms, loop=0, optimize=True)
  ```
  **刻意不传 `disposal=2`**；
- **副作用**：写文件 `path`；`print(f"  ✅ {path}  ({n} 帧, {size:,} bytes)")`；
- **返回**：实际写入的帧数。

---

## 6. `main(argv=None)`
`cli.py:809-864`

**参数解析**（argparse）

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `username` | `nargs="?"` | `None` | 位置参数，可省略 |
| `-o, --output` | str | `game.gif` | 输出路径 |
| `-s, --strategy` | choice `[column,row,random,chaos]` | `random` | 策略 |
| `--fps` | int | `40` | 帧率（只影响播放快慢） |
| `--max-frame` | int | `0` | `0` = 自动推算 |
| `--offline` | flag | `False` | 强制走假数据 |
| `--seed` | int | `None` | 固定随机种子 |
| `--colors` | int | `32` | 调色板色数 |
| `--boss-chance` | float | `0.18` | BOSS 生成概率 |

**环境变量**

| 变量 | 用途 | 优先级 |
|------|------|--------|
| `GITHUB_TOKEN` | GraphQL token | 1 |
| `GH_TOKEN` | 同上备选 | 2 |
| `GITHUB_USER` | 默认用户名 | 2（命令行 > 它） |
| `GITHUB_REPOSITORY_OWNER` | Actions 场景仓库 owner | 3 |
| `GITHUB_OUTPUT` | 存在则追加 Action 输出 | — |

**用户名解析**（`830-833`，顺序不可颠倒）
`args.username → GITHUB_USER → GITHUB_REPOSITORY_OWNER → "octocat"`

**数据源决策**（`835-843`）
```
if args.offline or not token      → generate_dummy(username)      # 打印 "🌱 离线模式 — 假数据模拟 @x"
else                              → fetch_contributions(...)
                                     └─ 返回 None → print("  → 回退假数据") → generate_dummy(username)
```

**输出**：完成时有 4 行日志（非空格子统计 / 渲染参数 / 编码成功 / 最终 score），
并在 `$GITHUB_OUTPUT` 存在时**追加**：

```
output=<路径>
frames=<帧数>
score=<最终分>
username=<用户名>
```

---

## 7. 外部可见的「公共 API 清单」

`tests/test_smoke.py` 的 import 列表可作为稳定性的参考契约（`cli.py:20-33`）：

```python
from gh_pixel_pulverizer.cli import (
    COLS, HEIGHT, ROWS, WIDTH,                # 几何常量
    Contributions, Engine, Strategy,           # 领域模型
    build_palette, encode_gif, quantize_frame, # 编码
    fetch_contributions, generate_dummy,       # 数据获取
)
```

> 除此之外的一切（含所有 `_` 前缀方法）都视为实现细节，重构时可自由修改。
