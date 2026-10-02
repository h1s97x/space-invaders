# gh-space-invaders 💥

> **Space Invaders** — 把你的 GitHub 贡献图炸成一场像素射击 GIF。
> 贡献越多 → 格子越大、越亮、爆炸越绚丽；高产周（level ≥ 4）有几率飞出 **BOSS 外星人** 往下俯冲，还会向你射子弹。默认参数下一局能**真正打完**，收尾还有烟花庆祝。

<div align="center">
  <img src="https://img.shields.io/badge/python-3.9%2B-3776AB?style=flat&logo=python&logoColor=white">
  <img src="https://img.shields.io/badge/license-MIT-green.svg">
  <img src="https://img.shields.io/badge/pillow-10%2B-blue">
  <img src="https://img.shields.io/badge/💥-Space%20Invaders-FF6B6B">
  <img src="https://img.shields.io/badge/status-renamed%20in%20progress-lightgrey">
</div>

---

## ✨ 它好在哪

| 特色 | 说明 |
|------|------|
| 🎯 **真实贡献图** | 通过 GraphQL 拉最近 53 周 × 7 天的提交记录，每个非空格子都是一个靶子 |
| 💪 **贡献 = 血量** | 按你自己贡献的分位数分档，格子越大、越亮、爆炸越绚丽 |
| 🐉 **BOSS 机制** | 高贡献格被打爆时，有几率飞出红色 BOSS 往下俯冲 + 射子弹 |
| 🔫 **穿透弹** | 一发子弹能连穿 3 个格子，所以 200+ 个靶子真的能被打空 |
| 🔥 **动态飞船** | 剩余敌占比 < 45% 自动开三发散射；尾焰随战况变化 |
| 🎲 **4 种策略** | `column` / `row` / `random` / `chaos`（先揍最狠的） |
| 🌌 **3 层视差星空** | 远近决定速度与亮度，像素感拉满 |
| 🌈 **真 alpha 渲染** | 粒子 / 子弹拖尾 / 尾焰走 RGBA 图层合成，真·淡出而非变黑块 |
| 📡 **离线兜底** | 没 token 自动生成模拟贡献图（工作日高产、周末摸鱼） |
| 🧩 **只有一个依赖** | 纯 Python + `pillow`，逻辑按职责拆成 6 个模块（config / models / data / engine / render / gif） |
| ✅ **自带测试与 CI** | 全离线可跑：`python -m unittest discover -s tests` |

## 🎮 演示

```
┌─────────────────────────── HUD ──────────────────────────────────────┐
│ SCORE 440                                 @yourname    F100          │
├─────────────────────────── 贡献图战场 ────────────────────────────────┤
│ ██ ██ ██                                                              │
│ ██ ███████ ██ ██                                                       │
│ ██ ███████ ████ ██  ← 越亮越强（level 5 是 BOSS 格，带皇冠）          │
│ ██ ███████ ████ ██████                                                │
│ ██ ████    ███████ ██                                                  │
├─────────────────────────── 飞船区 ────────────────────────────────────┤
│                           ╱ 飞船 ╲                                    │
│                    ~~~~~~╱  ▲  ╲~~~~~~  ← 尾焰随战况变化              │
│                     🚀🟨🟧                                            │
└───────────────────────────────────────────────────────────────────────┘
```

## 🚀 5 分钟跑起来

```bash
# 1. 克隆（本仓库真身托管在 CNB；GitHub 侧 gh-pixel-pulverizer 为改名前的旧镜像）
git clone https://cnb.cool/h1s97x/plugins/gh-space-invaders.git
cd gh-space-invaders

# 2. 装依赖（或 pip install -e .）
python -m pip install pillow

# 3. 离线试一把（不用 token）
python -m gh_space_invaders octocat --offline -o demo.gif

# 4. 用真实 GitHub 数据
export GH_TOKEN=ghp_xxx
python -m gh_space_invaders your-username -o game.gif

# 5. 试其他策略
python -m gh_space_invaders linus -s column           # 从右向左清场
python -m gh_space_invaders torvalds -s chaos --boss-chance 0.35   # 先揍高产周

# 6. 嫌文件大？压一压（体积主要看帧数）
python -m gh_space_invaders yourname -o small.gif --colors 16 --max-frame 200
```

也可以 pip 装完直接：
```bash
gh-space-invaders yourname -o game.gif --fps 12
```

跑测试：
```bash
python -m unittest discover -s tests
```

## ⚙️ 命令行

| 参数 | 默认 | 说明 |
|------|------|------|
| `username` | 见下 | GitHub 用户名；省略时依次取 `GITHUB_USER` → `GITHUB_REPOSITORY_OWNER` → `octocat` |
| `-o, --output` | `game.gif` | 输出路径 |
| `-s, --strategy` | `random` | `column` / `row` / `random` / `chaos` |
| `--fps` | `20` | 播放帧率（只决定播放快慢，不改变体积；帧数不变） |
| `--max-frame` | `0`（自动） | 帧数上限；`0` = 按靶子血量自动推算，保证能打到通关动画 |
| `--colors` | `32` | GIF 调色板色数，越小体积越小 |
| `--offline` | `false` | 不用 API，跑假数据 |
| `--seed` | 随机 | 固定随机种子（假数据与整局过程完全可复现） |
| `--boss-chance` | `0.18` | 高贡献格出 BOSS 的概率 |
| `--fire-interval` | `2` | 掠过新列时的最小开火间隔（越大射速越慢，也会拉长清场帧数与体积） |

## 🔌 接入 GitHub Profile README

**README.md:**
```markdown
<details>
  <summary>💥 点我启动 Space Invaders</summary>
  <br>
  <p align="center">
    <img src="game.gif" alt="Space Invaders">
  </p>
  <p align="center">
    <sub>你造的贡献，你得自己炸 🐉</sub>
  </p>
</details>
```

**方式 A：直接用 composite Action（推荐）**

**`.github/workflows/space-invaders.yml`:**
```yaml
name: Space Invaders

on:
  schedule:
    - cron: '0 3 * * *'   # 每天 UTC 3 点
  workflow_dispatch:

permissions:
  contents: write

jobs:
  pulverize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: h1s97x/gh-space-invaders@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # username 留空即用仓库 owner
          fps: '12'
          colors: '24'
```

Action 复用地址说明：⚠️ **GitHub 侧仓库尚未就绪** —— `h1s97x/gh-space-invaders` 目前不存在（404），
现有 GitHub 仓库仍是改名前的 `h1s97x/gh-pixel-pulverizer`。因此下面 `uses:` 里的
`h1s97x/gh-space-invaders@main` 在 GitHub 侧仓库建好前装了会失败；CNB 侧可用
`https://cnb.cool/h1s97x/plugins/gh-space-invaders` 复用 Action。

Action 会生成 GIF 并顺手帮你提交：默认会 **amend** 上一次自己的 commit（避免每天刷一条记录），
不想 amend 就设 `no-amend: 'true'`；只想拿到文件、不想提交就设 `no-commit: 'true'`，
产物路径通过 `steps.<id>.outputs.output` 取。

**方式 B：不用 Action，自己拼脚本**

```yaml
      - name: 💥 Generate GIF
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          REPO_OWNER: ${{ github.repository_owner }}
        run: |
          python -m pip install --quiet --break-system-packages \
            "gh-space-invaders @ git+https://cnb.cool/h1s97x/plugins/gh-space-invaders.git"
          gh-space-invaders "$REPO_OWNER" -o game.gif --fps 12 --colors 24

      - name: 📦 Commit if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add game.gif
          if git diff --cached --quiet; then
            echo "game.gif 没变化，跳过"
          else
            git commit -m "💥 space-invaders: update ${GITHUB_RUN_ID}"
            git push
          fi
```

> ⚠️ **别把外部输入直接插进 `run:` 里**。`${{ inputs.* }}`、`${{ github.event.* }}` 这类值
> 一律先经 `env:` 传参再在脚本里引用，否则别人填个 `$(...)` 就能在你的 runner 上执行命令
> （`action.yml` 就是这么做的）。

## 📏 体积 / 画质怎么权衡

体积 ≈ **帧数 × 每帧字节数**，所以旋钮只有两个方向：

| 想更小 | 做法 | 效果 |
|--------|------|------|
| 减帧 | `--max-frame 180` | 最有效，但可能打不完、看不到通关烟花 |
| 减色 | `--colors 16` | 线性见效，像素画几乎看不出差别 |
| 减粒子 | 改 `engine.py` 里 `_explode` 的粒子数 | 全屏粒子是每帧差分区域变大的主因 |

已经默认做了的两件事：**关掉调色板抖动**、**不指定 `disposal=2`**（后者会强制每帧全量编码，
实测体积直接翻倍）。默认参数（`random` 策略）下实测约 700~830 帧（35~42s）、1.8~2.1 MB，
峰值内存约 230 MB。帧数比旧版（约 480 帧）高，是因为飞船不再是匀速直线扫荡 ——
随机选目标必然让路径变长，这一段差价买的是「有起伏、不像节拍器」的观感。

## 🏗️ 架构

```
gh_space_invaders/
├── __init__.py     # 版本号唯一来源 + 公共 API 统一导出
├── __main__.py     # python -m 入口
├── cli.py          # 参数解析 + 串流程（唯一的「胶水」）
├── config.py       # 常量：调色板 / 几何 / 可调参数
├── font.py         # 自绘 5×7 点阵字体（硬边，不用 PIL 默认位图字体）
├── models.py       # 数据结构：Target / Enemy / Bullet / Particle / Flash / Star / Strategy
├── data.py         # GitHub GraphQL 抓取 + 离线假数据
├── engine.py       # 玩法：状态机、每帧更新、碰撞、主循环
├── render.py       # 画面：Renderer，只读消费 Engine 状态
└── gif.py          # 编码：共享调色板 + 逐帧量化
tests/
└── test_smoke.py   # 离线冒烟测试（18 例）
.github/workflows/
├── ci.yml          # 跑测试 + 端到端生成 GIF
```

依赖是单向的，`engine.py` 一行 PIL 都不 import（画什么全交给 `render.py`）：
```
cli.py ─┬─▶ data.py   ──▶ models.py ──▶ config.py
        ├─▶ engine.py ──┬─▶ models.py
        │               └─▶ render.py ──▶ config.py ──▶ font.py
        └─▶ gif.py    ──────────────────▶ config.py
```

数据流：
```
GitHub GraphQL ──▶ Target[] ──▶ Engine.iter_frames() ──▶ 逐帧量化 ──▶ GIF
    or dummy       (贡献格)      (生成器，游戏循环)       (共享调色板)
```

两个关键设计：

- **`Engine.iter_frames()` 是生成器**：渲染一帧就交给编码器消费掉，RGB 原帧用完即丢，
  峰值内存只和「量化后的帧」成正比。**别改回 `list()`**，那样 400 帧要多驻留约 230 MB。
- **每帧末尾 `_prune()`**：回收已死亡的粒子 / 子弹 / 敌人。它们原先只被标记 `alive=False`
  却永远留在列表里，会被逐帧重复遍历，属于无界增长。

核心类：
- `Engine` — 游戏循环，管理 target/bullet/enemy/particle
- `Target` — 贡献格靶子，level 按分位数分档，越高越亮
- `Enemy` — BOSS 外星人，往下俯冲还会射子弹
- `Bullet` / `Particle` — 子弹（可穿透）和爆炸粒子
- `fetch_contributions()` — GraphQL 抓贡献，任何失败都返回 `None`
- `generate_dummy()` — 离线假数据（用 crc32 做种，同用户永远一致）

## 📄 License

MIT — 随便用随便改，见 [LICENSE](LICENSE)。改出好玩的 fork 告诉我一声就行 ✌️
