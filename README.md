# gh-pixel-pulverizer 💥

> **Pixel Pulverizer** — 把你的 GitHub 贡献图炸成一场像素射击 GIF。
> 贡献越多 → 格子越大、血越厚、爆炸粒子越多；高产周（level ≥ 4）有几率飞出 **BOSS 外星人** 往下俯冲，还会向你射子弹。

<div align="center">
  <img src="https://img.shields.io/badge/python-3.9%2B-3776AB?style=flat&logo=python&logoColor=white">
  <img src="https://img.shields.io/badge/license-MIT-green.svg">
  <img src="https://img.shields.io/badge/pillow-10%2B-blue">
  <img src="https://img.shields.io/badge/💥-Pixel%20Pulverizer-FF6B6B">
</div>

---

## ✨ 它好在哪

| 特色 | 说明 |
|------|------|
| 🎯 **真实贡献图** | 通过 GraphQL 拉最近 53 周 × 7 天的提交记录，每个非空格子都是一个靶子 |
| 💪 **贡献 = 血量** | 每天提交越多，格子越大、HP 越厚、爆炸越绚丽 |
| 🐉 **BOSS 机制** | 高贡献格被打爆时，有几率飞出红色 BOSS 往下俯冲 + 射子弹 |
| 🔥 **动态飞船** | 剩余敌占比 < 40% 自动开三发散射；尾焰随战况变化 |
| 🎲 **4 种策略** | `column` / `row` / `random` / `chaos`（先揍最狠的） |
| 🌌 **3 层视差星空** | 不同速度不同亮度，像素感拉满 |
| 📡 **离线兜底** | 没 token 自动生成模拟贡献图（工作日高产、周末摸鱼） |
| 🧩 **无外部依赖** | 纯 Python + `pillow`，一个文件搞定 |

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
# 1. 克隆
git clone https://github.com/h1s97x/gh-pixel-pulverizer.git
cd gh-pixel-pulverizer

# 2. 装依赖（或 pip install -e .）
pip install pillow

# 3. 离线试一把（不用 token）
python -m gh_pixel_pulverizer octocat --offline -o demo.gif

# 4. 用真实 GitHub 数据
export GH_TOKEN=ghp_xxx
python -m gh_pixel_pulverizer your-username -o game.gif

# 5. 试其他策略
python -m gh_pixel_pulverizer linus -s column           # 从右向左清场
python -m gh_pixel_pulverizer torvalds -s chaos --boss-chance 0.35   # 先揍高产周
```

也可以 pip 装完直接：
```bash
gh-pixel-pulverizer yourname -o game.gif --fps 12 --max-frame 200
```

## ⚙️ 命令行

| 参数 | 默认 | 说明 |
|------|------|------|
| `username` | `octocat` | GitHub 用户名 |
| `-o, --output` | `game.gif` | 输出路径 |
| `-s, --strategy` | `random` | `column` / `row` / `random` / `chaos` |
| `--fps` | `40` | 帧率（影响观感，不太影响体积） |
| `--max-frame` | `300` | 最大帧数（提前打完提前停 + 庆祝烟花） |
| `--offline` | `false` | 不用 API，跑假数据 |
| `--seed` | 随机 | 固定随机种子（方便复现） |
| `--boss-chance` | `0.18` | 高贡献格出 BOSS 的概率 |

## 🔌 接入 GitHub Profile README

**README.md:**
```markdown
<details>
  <summary>💥 点我启动 Pixel Pulverizer</summary>
  <br>
  <p align="center">
    <img src="game.gif" alt="Pixel Pulverizer">
  </p>
  <p align="center">
    <sub>你造的贡献，你得自己炸 🐉</sub>
  </p>
</details>
```

**`.github/workflows/pixel-pulverizer.yml`:**
```yaml
name: Pixel Pulverizer

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

      - name: 🐍 Install
        run: pip install --quiet pillow

      - name: 💥 Generate GIF
        run: |
          curl -sSL https://raw.githubusercontent.com/h1s97x/gh-pixel-pulverizer/main/gh_pixel_pulverizer/cli.py \
               -o pixel_pulverizer.py
          python pixel_pulverizer.py ${{ github.repository_owner }} \
            -o game.gif --fps 12
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: 📦 Commit if changed
        run: |
          git config user.name  "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add game.gif
          if git diff --cached --quiet; then
            echo "game.gif 没变化，跳过"
          else
            git commit -m "💥 pixel-pulverizer: update ${GITHUB_RUN_ID}"
            git push
          fi
```

## 🏗️ 架构

```
gh_pixel_pulverizer/
├── cli.py          # 全部逻辑：API 抓取 + 游戏循环 + PIL 渲染（~700 行）
├── __main__.py     # python -m 入口
└── __init__.py
```

数据流：
```
GitHub GraphQL  ──▶  Target[]  ──▶  Engine.run()  ──▶  PIL 渲染  ──▶  GIF
    or dummy           (贡献格)        (游戏循环)         (每帧)
```

核心类：
- `Engine` — 游戏循环，管理 target/bullet/enemy/particle
- `Target` — 贡献格靶子，level 越高越硬越亮
- `Enemy` — BOSS 外星人，往下俯冲还会射子弹
- `Bullet` / `Particle` — 子弹和爆炸粒子
- `fetch_contributions()` — GraphQL 抓贡献
- `generate_dummy()` — 离线假数据

## 📄 License

MIT — 随便用随便改。改出好玩的 fork 告诉我一声就行 ✌️
