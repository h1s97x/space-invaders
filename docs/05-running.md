# 05 · 运行方式

---

## 1. 环境要求

| 项目 | 要求 |
|------|------|
| Python | `>= 3.9`（CI 验证 3.9 / 3.12） |
| Pillow | `>= 10.0` |
| 操作系统 | 任意（纯 Python + Pillow，无编译产物） |
| 网络 | **可选**。无网络 / 无 token 时自动回落离线假数据 |
| 磁盘 | 产出单个 GIF，默认参数下约 2.8~3.3 MB |
| 内存 | 峰值约 200~250 MB（取决于帧数），建议 ≥ 512 MB |

---

## 2. 安装

### 2.1 最轻量（推荐用于尝鲜与 CI）

```bash
python -m pip install pillow
```

无需安装本项目包，从仓库根目录直接 `python -m` 运行即可。

### 2.2 可编辑安装（推荐用于开发）

```bash
git clone https://cnb.cool/h1s97x/plugins/gh-space-invaders.git
cd gh-space-invaders
python -m pip install -e .
```

安装后获得 console script：

```bash
gh-space-invaders yourname -o game.gif --fps 12
```

### 2.3 隔离环境

```bash
python -m venv .venv && source .venv/bin/activate
python -m pip install -e .
```

> `.gitignore` 已忽略 `.venv/`。

### 2.4 免克隆安装（从 git 直接装）

拆分后不再支持「curl 单个 `cli.py` 直跑」（它依赖零包内导入），改为从 git 安装：

```bash
python -m pip install --break-system-packages \
  "gh-space-invaders @ git+https://cnb.cool/h1s97x/plugins/gh-space-invaders.git"
gh-space-invaders "$USERNAME" -o game.gif --fps 12 --colors 24
```

> 依赖仍然只有 pillow，会自动一起装上。

---

## 3. 命令行用法

### 3.1 三种入口等价

```bash
python -m gh_space_invaders <args>          # 源码目录内
gh-space-invaders <args>                    # pip install -e . 之后
python -m gh_space_invaders <args>          # Action 用的就是这种
```

> 注：`python gh_space_invaders/cli.py` 直跑在拆分后已不可用（需要包上下文解析相对导入）。

### 3.2 参数完整表

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `username` | 位置参数，可选 | 见 §3.3 | GitHub 用户名 |
| `-o, --output` | str | `game.gif` | GIF 输出路径 |
| `-s, --strategy` | `column`/`row`/`random`/`chaos` | `random` | 攻击策略 |
| `--fps` | int | `20` | 播放帧率。**只决定播放快慢，不改变体积**（帧数不变，仅每帧时长变；20fps = 50ms/帧，动作更从容可读） |
| `--max-frame` | int | `0` | 帧数上限；`0` = 按总 HP 自动推算（保证能打完） |
| `--offline` | flag | `False` | 强制假数据 |
| `--seed` | int | 随机 | 固定随机种子 → 整局过程完全可复现 |
| `--colors` | int | `32` | GIF 调色板色数（内部 clamp 到 `2..256`） |
| `--boss-chance` | float | `0.18` | level ≥ 4 格子被打爆后飞出 BOSS 的概率 |

> **没有 `--version` / `--help` 之外的隐藏参数**，`--help` 由 argparse 自动生成。

### 3.3 环境变量与优先级

**用户名解析顺序**（先命中者胜）：

```
1. 命令行 username
2. $GITHUB_USER
3. $GITHUB_REPOSITORY_OWNER      ← Actions 场景自动填充
4. "octocat"                     ← 最终兜底
```

**token 解析顺序**：

```
1. $GITHUB_TOKEN
2. $GH_TOKEN
```

**其他环境变量**：

| 变量 | 作用 |
|------|------|
| `GITHUB_OUTPUT` | 存在时向其**追加** `output= / frames= / score= / username=` 四行 |
| `GITHUB_REPOSITORY_OWNER` | Actions 默认用户名 |

---

## 4. 典型场景命令

```bash
# ✅ 离线试跑（不需要任何凭据，最安全的第一步）
python -m gh_space_invaders octocat --offline -o demo.gif

# 🌐 真实数据
export GH_TOKEN=ghp_xxx
python -m gh_space_invaders your-username -o game.gif

# 🎲 换策略
python -m gh_space_invaders linus  -s column                     # 从右往左清场
python -m gh_space_invaders torvalds -s chaos --boss-chance 0.35 # 先揍高产周，BOSS 变多
python -m gh_space_invaders you -s row                           # 自上而下逐行清

# 📦 压体积
python -m gh_space_invaders yourname -o small.gif --colors 16 --max-frame 200

# 🔁 完全可复现（CI / 回归测试）
python -m gh_space_invaders octocat --offline --seed 7 -o fixed.gif
```

---

## 5. 输出与退出码

**标准输出示例**：

```
🌱 离线模式 — 假数据模拟 @octocat
📊 非空格子: 274  总贡献: 1234
🎬 渲染 strategy=random fps=40 max_frame=746 size=860x230
💾 编码 GIF (25ms/帧, 32 色)…
  frame   0  alive=274/274  score=0  enemies=0
  frame  50  alive=241/274  score=980  enemies=2
  ...
  ✅ game.gif  (612 帧, 3,142,857 bytes)
🏁 score=7420  击败 274/274
```

**失败 / 降级提示**：

| 日志 | 含义 |
|------|------|
| `🌱 离线模式 — 假数据模拟 @x` | 显式 `--offline` 或没有 token |
| `  [warn] API 返回 401: Unauthorized` | token 无效或缺失 → 随即回退 |
| `  [warn] API 请求失败: <URLError>` | 网络不可达 / 超时 |
| `  [warn] GraphQL 错误: <msg>` | GraphQL `errors` 字段（限流、权限、用户不存在） |
| `  [warn] 找不到用户 'x'` | `data.user` 为空 |
| `  → 回退假数据` | 已触发离线兜底 |

**退出码**：正常完成为 `0`。`argparse` 校验失败为 `2`。
当 `encode_gif` 拿不到任何帧时会 `raise RuntimeError("没有帧")`（仅空输入触发，实践中被 `_auto_max_frame` 的空图特判规避）。

---

## 6. GitHub Actions 集成

### 6.1 方式 A：Composite Action（推荐）

`.github/workflows/space-invaders.yml`：

```yaml
name: Space Invaders

on:
  schedule:
    - cron: '0 3 * * *'        # 每天 UTC 03:00
  workflow_dispatch:

permissions:
  contents: write              # 需要提交 GIF

jobs:
  pulverize:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: h1s97x/gh-space-invaders@main
        id: space-invaders
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # username 留空 → 使用仓库 owner
          fps: '12'
          colors: '24'

      - run: echo "生成于 ${{ steps.space-invaders.outputs.output }}，共 ${{ steps.space-invaders.outputs.frames }} 帧，得分 ${{ steps.space-invaders.outputs.score }}"
```

**inputs 默认值速查**

| input | 默认 |
|-------|------|
| `github-token` | 必填 |
| `username` | `""` → 退化为 `${{ github.repository_owner }}` |
| `output-path` | `game.gif` |
| `strategy` | `random` |
| `fps` | `40` |
| `max-frame` | `0`（自动） |
| `boss-chance` | `0.18` |
| `colors` | `32` |
| `seed` | `""`（留空 = 每次随机） |
| `no-amend` | `false` |
| `no-commit` | `false` |

> ⚠️ **所有 inputs 都是字符串**（例如 `'12'` 而非 `12`），因为 GitHub Actions 的 `with:` 不支持数字类型。

**提交行为控制**：

| 组合 | 行为 |
|------|------|
| 默认 | GIF 有变化时：若上一条 commit 是本 Action 写的且工作区无其他改动 → `commit --amend` + `push --force-with-lease`；否则新建 commit |
| `no-amend: 'true'` | 总是新建 commit（每日一条历史记录） |
| `no-commit: 'true'` | 只生成文件到 workspace，**不** add / commit / push |

### 6.2 方式 B：自己拼 workflow step

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
          git diff --cached --quiet || git commit -m "💥 space-invaders: update ${GITHUB_RUN_ID}"
          git push
```

> 🔒 **安全铁律**：`${{ inputs.* }}`、`${{ github.event.* }}` 这类用户可控值，
> **必须先经 `env:` 传参，再以 `"$VAR"` 在脚本中引用**。绝对不要直接内插进 `run:`，
> 否则攻击者可通过 issue 标题等渠道注入 `$(...)` 执行任意命令。

### 6.3 接入 Profile README

把生成的 GIF 放进 `<details>`，避免直接铺开大图：

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

> 注意 `.gitignore` 忽略了 `*.gif`；若用于 Profile README 需 `git add -f game.gif`
> 或从 `.gitignore` 中移除该规则。

---

## 7. 调参指南

### 7.1 目标：文件更小

| 优先级 | 手段 | 预期收益 | 代价 |
|--------|------|----------|------|
| 1 | `--max-frame 180` | 最大（线性） | 可能打不完、看不到通关烟花 |
| 2 | `--colors 16` | 线性 | 几乎无视觉损失 |
| 3 | 改 `_explode()` 的粒子数 | 约 25% | 观感略减 |
| 4 | `--fps 12` | **无收益** | 只让播放变慢（帧数不变） |

### 7.2 目标：更好看

| 手段 | 效果 |
|------|------|
| `--boss-chance 0.35` | BOSS 更频繁，画面更热闹（也会拉长帧数） |
| `-s chaos` | 先揍最亮的格子，节奏感更强 |
| `--fps 40` | 动作更快更紧凑（文件体积不变）；默认 20 偏从容 |
| `--colors 64+` | 渐变更细腻（星空衰减更平滑），体积上升 |

### 7.3 目标：可复现 / 做回归基准

```bash
python -m gh_space_invaders someone --offline --seed 7 -o a.gif
python -m gh_space_invaders someone --offline --seed 7 -o b.gif
# a.gif 与 b.gif 逐字节一致
```

> **注意**：`--seed` 只影响 `Engine` 的随机数；`generate_dummy()` 的随机源是
> `zlib.crc32(username)`，因此**同一用户名永远得到同一张假贡献图**，与 `--seed` 无关。

### 7.4 性能预期

README 实测（默认参数、3 个不同用户）：

| 指标 | 数值 |
|------|------|
| 帧数 | 约 320 ~ 480 帧（含 15 帧通关动画） |
| 文件 | 约 2.8 ~ 3.3 MB |
| 峰值内存 | 约 230 MB |
| 耗时 | 数十秒量级（取决于 CPU 与帧数） |

---

## 8. 本地验证清单（改完代码后）

```bash
# 1. 单元测试（离线、18 例）
python -m unittest discover -s tests

# 2. 端到端生成（产出非空 GIF）
python -m gh_space_invaders octocat --offline --seed 7 -o /tmp/game.gif

# 3. 检查尺寸与帧数
python - <<'PY'
from PIL import Image
im = Image.open("/tmp/game.gif")
print(im.size, im.n_frames)
PY

# 4. 四种策略都跑一遍（各 30 帧，快速）
for s in column row random chaos; do
  python -m gh_space_invaders octocat --offline -s $s --max-frame 30 -o /tmp/$s.gif
done
```

四项全绿才算改动安全。详见 [06-testing-and-ci.md](./06-testing-and-ci.md)。
