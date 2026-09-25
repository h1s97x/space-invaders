# 01 · 整体架构

---

## 1. 架构总览

项目采取**极简三层结构**：数据获取 → 游戏引擎（含渲染） → GIF 编码。
没有框架、没有异步、没有持久化，全部状态都活在 `Engine` 一个对象的 Python 内存里。

```
┌──────────────────────────────────────────────────────────────────────┐
│ 入口层  __main__.py   /   console_script (gh-pixel-pulverizer)        │
│         └─→ cli.py:main(argv)                                        │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│ 数据层：Contributions 生产                                            │
│   fetch_contributions()  ── HTTP/GraphQL ──▶ api.github.com          │
│   generate_dummy()       ── zlib.crc32 播种 ──▶ 确定性本地假数据       │
│   （任一失败 → return None → 上层回退 generate_dummy）                │
└───────────────────────────┬──────────────────────────────────────────┘
                            │  Contributions(rows: List[List[int]], username, total)
┌───────────────────────────▼──────────────────────────────────────────┐
│ 领域/渲染层：Engine（唯一的有状态对象）                                │
│   targets / enemies / bullets / particles / stars / ship_x            │
│   每帧：update → collide → prune → render                            │
│   产出：Iterator[PIL.Image.Image]（RGB, 860×230）                     │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│ 编码层：GIF 输出                                                      │
│   build_palette(首帧) → quantize_frame(每帧, 共享调色板) → save_all   │
└───────────────────────────┬──────────────────────────────────────────┘
                            │
                     *.gif + stdout + $GITHUB_OUTPUT
```

### 1.1 为什么是「单文件」？

`cli.py` 868 行承载了全部逻辑。这不是疏忽，而是**刻意的产品决策**：
README 提供的「不用 Action、自己拼脚本」用法是让用户 `curl` 单个 `cli.py` 下来直接跑：

```yaml
curl -sSL .../gh_pixel_pulverizer/cli.py -o pixel_pulverizer.py
python pixel_pulverizer.py "$REPO_OWNER" -o game.gif
```

因此 **`cli.py` 必须保持「零包内相对导入」**（它只用标准库 + PIL，`main()` 可直接脚本执行）。
拆分模块会让这条「单文件 standalone」用法失效 —— 这是做重构前必须知道的约束。

---

## 2. 分层职责矩阵

| 层 | 组件 | 职责 | 是否有状态 |
|----|------|------|-----------|
| 入口 | `__main__.py`、`pyproject.toml:[project.scripts]` | 暴露 `python -m` 与 `gh-pixel-pulverizer` 两种调用 | 否 |
| CLI | `main(argv)` | 参数解析、token/username 解析、数据源选择、打印进度、写 `$GITHUB_OUTPUT` | 否（只读 env） |
| 数据获取 | `fetch_contributions()`、`generate_dummy()` | 产出 `Contributions` | 否（纯函数） |
| 领域模型 | `Target` / `Enemy` / `Bullet` / `Particle` / `Star` / `Contributions` / `Strategy` | 数据容器 + 少量几何属性 | 数据本身 |
| 引擎 | `Engine` | 游戏循环、物理、碰撞、AI、绘制 | **是**（唯一可变状态持有者） |
| 编码 | `build_palette()` / `quantize_frame()` / `encode_gif()` | RGB 帧 → 量化 P 帧 → GIF 文件 | 否（`encode_gif` 内局部变量） |

---

## 3. 数据流细节

### 3.1 输入：Contributions 矩阵

```
行索引 r = weekday (0=周日 … 6=周六)     → ROWS = 7
列索引 c = week index (0..52)            → COLS = 53
值 = 当天的 contributionCount
```

由 GraphQL 响应组装，注意**越界防御**：只取前 `COLS` 周，且 `0 <= weekday < ROWS` 才写入
（`cli.py:227-232`）。

### 3.2 矩阵 → 靶子：分位数分档

```python
counts = sorted(v for row in rows for v in row if v > 0)     # 只统计非空格
frac   = bisect.bisect_left(counts, count) / len(counts)      # 严格小于 count 的占比
level  = 1 if frac<0.25  else 2 if frac<0.50  else
         3 if frac<0.75  else 4 if frac<0.90  else 5
```

| level | 分位区间 | 边长 `size` | HP | 颜色 | 备注 |
|-------|----------|-------------|----|------|------|
| 1 | [0.00, 0.25) | 13 | 1 | `GR_L1` | |
| 2 | [0.25, 0.50) | 14 | 1 | `GR_L2` | |
| 3 | [0.50, 0.75) | 15 | 1 | `GR_L3` | |
| 4 | [0.75, 0.90) | 16 | 1 | `GR_L4` | **可出 BOSS** |
| 5 | [0.90, 1.00] | 16（被 `CELL+GAP+1` 截断） | **2** | `GR_L5` + 皇冠条 | **可出 BOSS**；HP=2 需两发 |

> ⚠️ **已知现象**：`size = min(CELL + level - 1, CELL + GAP + 1)`
> 导致 level 4 与 level 5 的实际边长**同为 16**，视觉上无法用大小区分，只能靠颜色 + 皇冠条。

中心化定位：`x = PADDING_LR + c*(CELL+GAP) + (CELL - size)//2`，使放大的格子在网格内居中而不越界
（`cli.py:344-345`）。

### 3.3 帧循环

`Engine.iter_frames()`（`cli.py:711-744`）每帧严格按此顺序执行：

```
1. _update_stars()        星空滚动（含到底重生）
2. _update_ship()         选靶 + 平滑插值横移
3. _fire()                开火（清场率 <45% 时三连散射）+ 枪口火花
4. _update_bullets()      子弹位移与出界判定
5. _update_enemies()      BOSS 重力加速 / 正弦横摆 / 触底自爆 / 每 40 帧射击
6. _update_particles()    粒子位移、重力、阻尼、寿命递减
7. _collide()             三组碰撞：己方弹→靶 / 己方弹→BOSS / BOSS 弹→飞船
8. _prune()               真正移除死亡对象
──────────────────────────────────────────────────────────
9.  yield _render_frame() ← 暂停点，调用方（编码器）此刻消费这一帧
──────────────────────────────────────────────────────────
10. 每 50 帧打印进度（verbose）
11. 若 alive==0 且 defeated>0 → 追加 15 帧 celebration 烟花 → return
```

> **注意 7 与 8 的顺序**：碰撞在帧末统一结算，因此新生成/刚死亡的实体不会在本帧被重复处理。
> **`_prune()` 必须在 `_collide()` 之后**，否则刚标记为死亡的实体要存活到下一帧。

### 3.4 输出管线

```
iter_frames() ──yield──▶ encode_gif()
                            ├─ first = next(it)（StopIteration → RuntimeError("没有帧")）
                            ├─ pal_img = build_palette(first)     # 全局唯一调色板
                            ├─ for f in it: quantized.append(quantize_frame(f, pal_img))
                            └─ quantized[0].save(path, save_all=True,
                                    append_images=quantized[1:],
                                    duration=frame_ms, loop=0, optimize=True)
```

**共享调色板**是画面不闪烁的关键：若每帧各自 `quantize()`，同一像素在不同帧会被映射到
不同调色板索引，产生跑马灯式的色闪。

---

## 4. 坐标系统与画面布局

单帧是 **860 × 230** 的 RGB 画布。所有绘制都是像素级绝对坐标，无相机/变换。

```
 x →  0                                                    860
y │   0 ┌────────────────────────────────────────────────────┐
↓  │     │ 左上 SCORE / BEAT          右上 @username / F###  │  ← HUD 区 (y 6..18)
   │  20 │ ┌──────────────────────────────────────────────┐ │
   │     │ │  贡献图战场 GRID_TOP=20                       │ │
   │     │ │  cols 53 × rows 7, cell=13, gap=2            │ │
   │     │ │  水平居中: PADDING_LR = 33                    │ │
   │ 123 │ └──────────────────────────────────────────────┘ │  ← GRID_BOTTOM = 123
   │     │                                                  │
   │ 193 │                ▲  飞船 (SHIP_Y=193, 32×22)        │  ← 飞船区
   │     │              ╱ ╲ + 尾焰                           │
   │ 222 │                                        ▓▓▓▓ 进度条│  ← 底部生命条 bar_w=140
   │ 230 └────────────────────────────────────────────────────┘
```

### 4.1 派生尺寸常量（`cli.py:58-101`）

| 常量 | 值 | 推导 |
|------|-----|------|
| `CELL` / `GAP` | 13 / 2 | 单个格子边长与间隙 |
| `COLS` / `ROWS` | 53 / 7 | GitHub 贡献日历的形状 |
| `GRID_W` | 793 | `53*13 + 52*2` |
| `GRID_H` | 103 | `7*13 + 6*2` |
| `PADDING_LR` | 33 | `(860 - 793) // 2`，让贡献图水平居中 |
| `GRID_TOP` / `GRID_BOTTOM` | 20 / 123 | `TOP_PAD` / `TOP_PAD + GRID_H` |
| `SHIP_Y` | 193 | `GRID_BOTTOM + 70`；刻意上移 10px，避免尾焰压住 y=222 的进度条 |
| `HEIGHT` | 230 | 硬编码，对齐原稿 |

> **注意**：`WIDTH` 先算得 `793 + 34*2 = 861`，随后被**硬覆盖为 860**（`cli.py:71-72`），
> 并把 `PADDING_LR` 改为 33。这一「先算后改」是为了像素级对齐参考稿，改动坐标系统时别漏看。

---

## 5. 渲染管线（绘制顺序即 z-order）

`_render_frame()`（`cli.py:696-709`）的顺序是**不允许随意调换**的：

```python
img = Image.new("RGB", (WIDTH, HEIGHT), BG)      # 1. 背景
d = ImageDraw.Draw(img)
self._draw_grid_bg(d)      # 2. 贡献图底板 + 网格线
self._draw_stars(d)        # 3. 3 层视差星空
if not celebration:
    self._draw_targets(d)  # 4. 靶子（含皇冠、未爆标记）
    self._draw_enemies(d)  # 5. BOSS
    self._draw_bullets(d)  # 6. 子弹（区分敌我颜色）
self._draw_ship(d)         # 7. 飞船（两翼→机身→舱→尾焰）
self._draw_particles(d)    # 8. 粒子（按寿命做亮度衰减）
self._draw_hud(d)          # 9. HUD（分数/击败数/用户名/帧号/生命条）
```

两条隐性约束：

1. **`_draw_grid_bg` 必须在 `_draw_stars` 之前**：网格底板是不透明的整块矩形，若顺序颠倒会把整片星空盖掉。
2. **celebration 帧跳过 4/5/6**：通关动画只保留星空、飞船、粒子与 HUD，让烟花成为唯一主角。

---

## 6. 内存与体积模型

### 6.1 峰值内存

| 方案 | 峰值内存 | 说明 |
|------|---------|------|
| `list(engine.iter_frames())`（旧） | ≈ 230 MB | 数百张 RGB 帧同时驻留：860×230×3 B × 400 |
| `encode_gif(engine.iter_frames())`（现） | ≈ 1/3 | RGB 原帧被即时量化丢弃，只留 P 模式帧 |

**这是不可回退的设计**：把 `iter_frames()` 改写成返回 `list` 会直接让 CI 内存紧张。

> 补充事实：`encode_gif()` 内部仍会把量化后的帧 `append` 进 `quantized` 列表
> （`cli.py:794-796`），因为 Pillow 的 `save_all` 需要一个完整序列。
> 它只节流了「RGB → P」这一步的重量级内存，并非真正的零拷贝流式写出。详见 [07](./07-design-decisions.md#22-已知限制)。

### 6.2 GIF 体积

```
体积 ≈ 帧数 × 每帧差分区域字节数
```

| 旋钮 | 命令 | 效果 |
|------|------|------|
| **帧数**（最有效） | `--max-frame 180` | 线性下降；但可能打不完、看不到通关烟花 |
| **色数** | `--colors 16` | 线性下降；像素画几乎无感（`_clamp_colors` 限幅在 2..256） |
| **粒子数** | 改 `cli.py:_explode` 的 `n` | 全屏散布粒子会撑大每帧脏矩形；砍半粒子 ≈ 省 25% |

默认已做的两件事（**不要反向改动**）：

- 关闭调色板抖动 `Image.Dither.NONE` —— 像素画是大色块，抖动只徒增高频噪声、放大体积；
- **不指定 `disposal=2`** —— 强制全量编码，实测体积翻倍。当前每帧都是不透明整图，
  配合 `optimize=True` 的脏矩形差分不会产生残影（`tests` 里有逐帧比对的回归用例守护）。

实测（README 数据）：3 个不同用户，约 320~480 帧、2.8~3.3 MB，峰值内存 ≈ 230 MB。

---

## 7. 游戏性状态机

```
                    ┌──────────────── Engine.__init__ ────────────────┐
                    │ _build_targets() → _spawn_stars() → max_frame   │
                    └───────────────────────┬────────────────────────┘
                                            ▼
                                  ┌─── COMBAT ───┐
                                  │ 每帧 fire/   │◀───┐
                                  │ collide/prune│    │
                                  └──────┬───────┘    │
                           alive>0 且    │    alive==0 且 defeated>0
                           frame<max ────┘────────────┼──▶ CELEBRATION（15 帧烟花）→ return
                                                      │
                           frame 达到 max_frame ──────┴──▶ 结束（未清场，无烟花）
```

- **得分规则**：打爆靶子 `+level*20`；击杀 BOSS `+100`；被 BOSS 子弹命中 `-5`（`max(0, ...)` 保底）。
- **飞船不死亡**：被击中只扣分 + 喷射 12 个橙色粒子，游戏继续 —— 保证 GIF 一定能产出。
- **清场保证**：默认 `max_frame` 由 `_auto_max_frame()` 推算，`total_hp * 2.4 + 90`（下限 240），
  源于「实测约 1.6 帧/HP」并留 ~50% 余量。空贡献图特判为 60 帧。

---

## 8. 并发与副作用

| 方面 | 现状 |
|------|------|
| 并发 | **无**。单线程、无 asyncio、无线程池。渲染是纯 CPU 顺序执行。 |
| 网络 | 唯一出口是 `fetch_contributions()`，`urllib.request` 同步阻塞，`timeout=15`。 |
| 文件副作用 | 写 1 个 GIF；有 `$GITHUB_OUTPUT` 时**追加** 4 行 KV。 |
| 全局状态 | 无模块级可变状态。所有状态在 `Engine` 实例上。随机数经 `random.Random(seed)` 局部化。 |
| 幂等性 | 同 `--seed` + 同用户名 ⇒ 逐字节一致的 GIF（有回归测试守护）。 |
