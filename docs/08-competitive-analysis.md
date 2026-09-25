# 08 · 竞品分析：gh-space-shooter

> 对标仓库：<https://github.com/czl9707/gh-space-shooter>（921 stars / 74 forks，v2.0.5）
> 目标：弄清「为什么他们的画面更好看」，并输出**可直接落地的改进清单**。
> 分析基于对方 `main` 分支源码（含 `CLAUDE.md`、`constants.py`、`renderer.py`、`animator.py`、
> `render_context.py`、`drawables/*`、`strategies/*`、`output/gif_provider.py`）。

---

## 1. 先说结论

| 维度 | 我们（gh-pixel-pulverizer） | 对方（gh-space-shooter） | 判定 |
|------|---------------------------|--------------------------|------|
| **画面观感** | 纯 RGB 绘制，衰减靠「颜色乘 alpha 变暗」 | **RGBA 图层 + alpha 合成**，真正的半透明淡出 | ❌ 我们输 |
| **格子质感** | `rectangle` 直角方块 | `rounded_rectangle(radius=2)` 圆角 | ❌ 我们输 |
| **受击反馈** | `hp>1` 时画 1 个背景色点 | **血量直接映射颜色**（health 1..4 → 4 级绿） | ❌ 我们输 |
| **子弹表现** | 3×6 矩形 + 1 个点 | **3 段递减 alpha 拖尾** | ❌ 我们输 |
| **飞船精灵** | 梯形机身 + 椭圆舱 + 双色尾焰 | Galaga 风格：半透明机翼 + 描边 + 尖头机身 | ❌ 我们输 |
| **动作节奏** | 每帧无脑开火，飞船插值跟随 | **策略产出 Action → 飞船到位 → 等待冷却 → 开火** | ❌ 我们输（可读性） |
| **物理模型** | 每帧固定位移（与 fps 耦合） | **`delta_time` 时间步长**（cells/second） | ❌ 我们输 |
| **坐标系统** | 硬编码像素 + 多处魔数 | **格子坐标 + `RenderContext.get_cell_position()`** | ❌ 我们输 |
| **GIF 体积** | 默认 ~3 MB（53 周，含通关动画） | **`example.gif` = 12.4 MB** | ✅ 我们赢 4 倍 |
| **依赖** | 1 个（pillow），Py ≥3.9 | 5 个（typer/httpx/dotenv/rich/pillow），Py ≥3.12 | ✅ 我们赢 |
| **离线兜底** | `generate_dummy()` + `--seed` 全可复现 | 需联网拿真实数据（仅支持 `--raw-input` 复用 JSON） | ✅ 我们赢 |
| **玩法丰富度** | BOSS、chaos 策略、4 策略、自动帧预算 | 3 策略，无 BOSS | ✅ 我们赢 |
| **分发形态** | pip（含 git 直装）/ `python -m` / Action | pip / Action / **FastAPI 网页 + 在线生成器** | ⚠️ 对方赢（有 Web UI） |
| **品牌传播** | 无 | 右下角 `--watermark` 水印 | ⚠️ 对方赢 |

**一句话**：我们输的全在**像素美术与渲染管线**，赢的全在**工程品质（体积/依赖/离线/可复现）**。
改进方向非常明确 —— **只抄他们的渲染层，绝不抄他们的编码层。**

---

## 2. 根因：为什么他们的画面更好看

### 2.1 决定性差距 —— RGBA 图层 + alpha 合成

```python
# 对方 renderer.py:render_frame()
img     = Image.new("RGB", (w, h), context.background_color)
overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
draw    = ImageDraw.Draw(overlay, "RGBA")     # ← 关键：在 RGBA 层上画
self.game_state.draw(draw, self.context)
combined = Image.alpha_composite(img.convert("RGBA"), overlay)
return combined.convert("RGB")
```

于是所有 Drawable 都能用 **4 元组 `(r, g, b, alpha)`**：

| 效果 | 对方写法 | 观感 |
|------|----------|------|
| 爆炸粒子淡出 | `fill=(*bullet_color, int(255 * fade))` | 粒子平滑消失、**不污染背景** |
| 飞船机翼半透明 | `fill=(*ship_color, 128)` | 有玻璃/能量翼质感 |
| 子弹拖尾渐隐 | `fill=(*bullet_color, int(fade_factor * 255))` | 速度线自然衰减 |
| 水印 | `fill=(100,100,100,128)` | 若隐若现，不喧宾夺主 |

**我们的现状**（`engine.py`）：

```python
alpha = p.life / p.max_life
col = tuple(int(v * alpha + 0 * (1 - alpha)) for v in p.color)   # ← 把 RGB 乘向黑色
d.rectangle(..., fill=col)
```

这是「**伪透明**」：粒子不是淡出消失，而是**逐渐变成一块深色方块**再被背景覆盖。
叠在星空/网格上时会留下一块块脏斑 —— 这正是我们画面显得廉价的首要原因。

> ⚠️ 这条决定了要不要动手：只要把渲染改成 RGBA 合成，**以下 4 条的效果会自动跃一个类档**。

### 2.2 次要差距（每条都很便宜）

| # | 对方做法 | 源码位置 | 我们的对应代码 |
|---|----------|----------|----------------|
| 1 | `draw.rounded_rectangle(radius=2)` 画格子 | `drawables/enemy.py:draw` | `_draw_targets` 用 `d.rectangle` |
| 2 | **血量映射颜色**：`enemy_colors.get(self.health, ...)`，health 1..4 → 4 级绿 | `enemy.py:draw` + `render_context.darkmode()` | `COLORS[min(4, level-1)]` 只看 level；`hp>1` 仅画 1 个 `BG` 点 |
| 3 | 子弹 **3 段拖尾**：`for i in range(BULLET_TRAILING_LENGTH)` 逐段降 alpha | `drawables/bullet.py:draw` | `_draw_bullets` 单矩形 + 单像素点 |
| 4 | Galaga 飞船：左侧/右侧半透明三角翼 + 1px 描边 + 菱形机身 | `drawables/ship.py:draw` | `_draw_ship` 梯形 + 椭圆舱 |
| 5 | 爆炸分两档：**small**(4 粒子/半径 10/0.12s) 用于命中、**large**(8 粒子/半径 20/0.4s) 用于击杀 | `constants.py` + `explosion.py` | `_explode` 一次最多 `10+level*6` = 40 个粒子（**我们粒子过多，恰好是体积主因**） |
| 6 | 所有速度写成 **cells/second**，用 `delta_time` 缩放 | `constants.py` 注释 + `animator.delta_time = 3.0/fps` | 每帧 `-5.0` 等硬编码常量 |
| 7 | 坐标一律用**格子坐标**（x∈weeks, y∈days），由 `RenderContext.get_cell_position()` 转像素 | `render_context.py` | 像素坐标硬编码，`size = min(CELL+level-1, CELL+GAP+1)` 这类魔数 |
| 8 | **策略 → Action**：`Action(x, shoot)`；飞船先到位（`while ship.is_moving()`），再等冷却，再射击 | `strategies/base_strategy.py` + `animator._generate_frames` | ✅ **已移植**（见 §2.4）：飞船改为 goto 目标列 → 到位 → 开火 → 再选下一列 |
| 9 | 播放帧间隔 `frame_duration = 1000*2 // fps` = 50ms → **实际 20fps 回放**（比渲染 fps 慢一半） | `animator.py:__init__` | `frame_ms = round(1000/fps)` = 25ms（40fps 回放） |
| 10 | 右下角半透明水印 `by czl9707/gh-space-shooter` | `renderer._draw_watermark` | 无 |

> 第 9 条容易被忽略：**他们的动画实际以半速播放**。动作更慢更从容 → 更「好看」且更可读。
> 这对我们是一条**零成本观感提升**（不增加帧数、不增加体积）。

### 2.4 已移植的飞船行为模型（第 8 条）

原来我们的飞船是**无限匀速巡航 + 每走过一列必开一枪** —— 一条没有起伏的直线。
参考项目的模型是「动作队列」：飞船 `move_to(列)` → 到位 → 由 `can_take_action()`
判定（停稳 + 冷却结束）→ 开火 → 拉下一个动作。移植后：

| 参考项目 | 我们的对应实现 |
|----------|----------------|
| `Ship.move_to(x)` + 匀速趋近 `target_x` | `_pick_goal()` 算出目标列 → `_update_ship()` 匀速 goto |
| `can_take_action()` = 停稳 + 冷却好 | `self.arrived` + `self.shoot_cd` |
| `RandomStrategy`：候选 = **有敌人的列**，取最近 8 个，按距离加权（0/1-3/4+ → 10/100/1） | `_pick_goal()` 的 `RANDOM` 分支，权重照抄 |
| `ColumnStrategy`：`while flying_bullets < total_health` 才继续射击 | `_col_in_flight() * BULLET_PIERCE >= hp` 就不补枪 |
| 飞船初始 `x = 25`（52 列的中点） | `ship_x = (WIDTH - SHIP_W) / 2`，**从中间起飞** |

**三条必须自己改的地方**（照抄会翻车）：

1. **他们子弹穿透为 1，我们是 8。** 他们的飞船必须停下来一个个点名；
   我们一发就能穿一整列，所以保留「移动途中顺手清」——
   实测关掉它（严格只到位开火）单场要 1226 帧（61s），开了只要 707 帧。**这条不能抄。**
2. **沿途清光会让轨迹退化成单向扫荡。** 前方永远有目标、后方永远空，
   于是无论怎么随机选目标，实际都只是「一路推到底再折返」（变向 2.5 次/场），
   也就是之前那种机械感。所以加了 `SKIP_CHANCE`：掠过某列时有 15% 概率放过它，
   留到回头再补 → 变向升到 6.6 次/场，出现「扫过去 → 掉头补两列 → 继续」的起伏。
3. **方向惯性（给顺路的列加权）是负收益。** 不放过列时它能省 19% 时长
   （709 → 572 帧），但一旦允许放过列，省时效果消失（715 vs 715），
   只剩压平随机性的副作用（变向 6.6 → 3.0）。默认关闭（`GOAL_DIR_BIAS = 1`）。

代价要说清楚：**随机性是用时长换的**。旧匀速巡航 480 帧（24s），
新模型 random 约 707 帧（35s）——多出来的 227 帧就是「路径不再是直线」的成本。

### 2.3 巧合

两者画布尺寸完全一致：**860 × 230**（对方 `cell_size=12 + spacing=3 → 15`，`52*15+2*40 = 860`，`(7+3)*15+2*40 = 230`）。
飞船 y 也几乎重合（对方 ≈190，我们 193）。说明两者对齐的是同一个参考稿，`--geometry` 不必改。

---

## 3. 绝对不能抄的部分（我们反而更强）

### 3.1 他们的 GIF 编码毫无优化 → `example.gif` 12.4 MB

```python
# 对方 output/gif_provider.py:encode()
frame_list = list(frames)                     # ← 全量驻留，且 generators 失效
frame_list[0].save(buffer, format="gif", save_all=True,
                   append_images=frame_list[1:],
                   duration=frame_duration, loop=0, optimize=True)
# 无共享调色板 / 无 quantize / 无 dither 控制
```

对比我们有（`gif.py`）：

| 优化 | 我们 | 对方 |
|------|------|------|
| 生成器流式消费（不全量驻留 RGB） | ✅ | ❌ `list(frames)` |
| 首帧生成**共享调色板**，全片复用 | ✅ `build_palette` | ❌ Pillow 每帧各自适配 → 色闪 + 体积膨胀 |
| 可调色数 `--colors`（默认 32） | ✅ | ❌ 无 |
| 关闭抖动 `Image.Dither.NONE` | ✅ | ❌ 默认抖动 → 高频噪声撑大文件 |
| 不设 `disposal=2` | ✅（注释说明会翻倍） | ✅（同样没设） |
| **逐帧解码一致性回归测试**（防残影） | ✅ `test_roundtrip_matches_source_frames` | ❌ 未见 |
| 结果 | **~3 MB** | **12.4 MB** |

> **结论：保留我们的编码层，一行都别动。** 对方的 921 star 不是靠工程品质拿的。

### 3.2 依赖与可移植性

```
对方：typer + httpx + python-dotenv + rich + pillow，requires-python >= 3.12，用 uv workspace
我们：pillow，requires-python >= 3.9，含 __init__/__main__/cli 三文件
```

引入 typer/httpx 会**直接摧毁我们「唯一依赖是 pillow」的分发优势**
（拆包后单文件 curl 用法已改为 git 直装，见 [01](./01-architecture.md) §1.1）。
`urllib` + `argparse` 必须留下。

### 3.3 离线兜底与可复现

对方 README 第一步就是「去生成一个 PAT，`read:user`」，无 token 无法产出。
我们的 `generate_dummy()` + `--seed` + `crc32` 播种是**实打实的优势**（也是 [`--offline` 文档](./05-running.md) 的核心卖点）。

---

## 4. 改进清单（按 收益 / 成本 排序）

> 坐标均已对应我方 `gh_pixel_pulverizer/`（几何常量在 `config.py`，绘制在 `render.py`）。

### P0 🔴 RGBA 渲染管线 —— 单点改动，全局观感跃升

**改** `_render_frame()`（`engine.py`）：

```python
def _render_frame(self, celebration=False) -> Image.Image:
    base    = Image.new("RGB", (WIDTH, HEIGHT), BG)
    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay, "RGBA")
    # ... 原绘制顺序不变，但颜色一律改写成 (r, g, b, a) 四元组
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
```

随后同步改写三处：
- `_draw_particles`（`664-671`）：`fill=(*p.color, int(255 * p.life / p.max_life))`，删掉乘黑写法；
- `_draw_ship` 尾焰（`652-662`）：外层/内层用不同 alpha 做渐变；
- 新增 `_draw_watermark()`（可选，`--watermark` 开关，默认关）。

**成本**：约 40 行。**风险**：每次合成多一次全画布运算（860×230，可忽略）；
输出仍是 RGB，`--colors` 量化链路不受影响。
**注意**：GIF 只有 1 位「透明」不支持半透明 —— 半透明必须在**合成阶段**落到背景上，不能指望编码器。

### P1 🔴 格子视觉升级（约 10 行）

`_draw_targets`（`583-595`）：

```python
d.rounded_rectangle([x0, y0, x1, y1], radius=2, fill=col)     # 替代 rectangle
```

并把 **剩余 HP 映射为颜色**（对齐 GitHub 官方 4 级绿，取代现在的 `d.point(...)` 脏点）：

```python
# level 决定初始最大 HP 与色调，hp 下降时降一档颜色 → 受击有可见反馈
COLOR_BY_HP = {1: (0,109,50), 2: (38,166,65), 3: (57,211,83), 4: (87,242,135)}
```

### P2 🟠 子弹拖尾（约 15 行）

`_draw_bullets`（`597-606`）改为沿运动反向画 3 段递减 alpha：

```python
for i in range(BULLET_TRAIL_SEGMENTS):          # 新增常量 = 3
    trail_y = b.y + (i + 1) * BULLET_TRAIL_SPACING
    fade    = (i + 1) / BULLET_TRAIL_SEGMENTS / 2
    # fill=(*BULLET, int(fade * 255))
```

> 依赖 P0（需要 alpha）。

### P3 🟠 半速回放（1 行）

`Engine.__init__` 的 `frame_ms`：`max(8, round(1000/fps))` → `round(2000/fps)`。
**不增加帧数、不增加体积、不影响内存**，只让动作慢一倍更可读。可作为默认值，或加 `--half-speed` 开关。

### P4 🟠 爆炸重做：更少粒子 + 真淡出（体积与观感双赢）

现 `_explode`（`527-559`）一次最多 40 粒子，是每帧脏矩形变大的主因。
对齐对方量级并配合 P0 的淡出：

| 场景 | 现 | 改后 |
|------|-----|------|
| 命中未死（tiny） | 3 | 4，半径 10，0.12s 淡出 |
| 击杀（普通） | `10+level*6`（最多 40） | 8，半径 20，0.4s 淡出 |
| BOSS / 通关烟花（big） | 34 | 保持（这是高潮，值得多花字节） |

预期：GIF 体积下降 25~40%，观感**上升**（因为真的会淡出而不是变黑块）。

### P5 🟡 引入 `RenderContext`：格子坐标 + 主题

新增轻量 dataclass：

```python
@dataclass
class RenderContext:
    cell_size: int; cell_spacing: int; padding: int
    background_color; grid_color; ship_color; bullet_color
    enemy_colors: dict
    def get_cell_position(self, x: float, y: float) -> tuple[float, float]: ...
    @staticmethod
    def darkmode() -> "RenderContext": ...
```

收益：
- 消灭 `size = min(CELL+level-1, CELL+GAP+1)` 这类魔数，顺手修掉
  **「level 4 与 level 5 实际同尺寸」** 的已知瑕疵（见 [07](./07-design-decisions.md) §2.1 #2）；
- 为后续主题（light/dark/高对比）留出扩展点；
- 与 `strategy` 的解耦更干净。

### P6 🟡 时间步长化（物理与 fps 解耦）

把 `vy=-5.0`、`vy+=0.04`、`SHIP_TRACK=0.18`、`STAR_SPEEDS` 等逐步改为 `*_PER_SEC`，
每帧乘 `self.delta_time`。使 `--fps` 只改变刷新粒度，不改变游戏节奏。

> ⚠️ **必须同步更新 `test_seed_is_deterministic` 与 `test_auto_max_frame_...` 的基准**（帧数会变）。

### P7 🟢 策略 → Action（可选，慎做）

把「每帧追 mesh + 每帧开火」改成对方那样 `Strategy.generate_actions()` 产出
`Action(x, shoot)`、飞船到位等待 + `SHIP_SHOOT_COOLDOWN`。

> ⚠️ **代价巨大**：飞船要走到位才射击 → **帧数暴涨**（对方 `example.gif` 会到 12 MB 就是这个原因之一）。
> 建议只做成 `--mode galaga` 可选行为，默认仍是我们的「高速清场」模式 ——
> 那是我们在体积上的立身之本。

### P8 🟢 Web 生成器（对方最大的产品优势）

对方有 `https://gh-space-shooter.kiyo-n-zane.com` + `app/`（FastAPI，含 favicon/OG image/manifest）。
这是拉开传播差距的地方，但**与画质无关**，属于独立产品线，另行规划。

---

## 5. 建议执行顺序

```
第一批（1 次 PR，可见巨变，零体积代价）✅ 已完成（v0.2.x RGBA 重构）
  P0 RGBA 渲染 + P1 圆角格子/HP 配色 + P2 子弹拖尾 + P3 半速回放
  → 观感基本追平对方，且 GIF 仍然只有 ~3 MB（实测 octocat seed=7：479 帧 / 3.20 MB）

第二批（同 PR 或下一 PR）
  P4 爆炸重做 → 体积再降 25~40%，观感继续上升

第三批（重构，需同步更新测试基准）
  P5 RenderContext + P6 delta_time

长期 / 可选
  P7 galaga 模式、P8 Web 生成器
```

---

## 6. 改进后的预期对比

| 指标 | 现在 | 第一批后 | 第二批后 |
|------|------|----------|----------|
| 观感（主观） | 廉价色块 | 接近对方 | 持平 / 局部超过（BOSS + 星舰主题） |
| GIF 体积 | ~3.0 MB | ~3.0 MB | **~1.8–2.2 MB** |
| 依赖数 | 1 | 1 | 1 |
| Python | ≥3.9 | ≥3.9 | ≥3.9 |
| 独有优势 | BOSS / chaos / 离线 / seed | 全部保留 | 全部保留 |

**核心策略：拿他们的渲染美术，守我们的体积与依赖护城河。**
