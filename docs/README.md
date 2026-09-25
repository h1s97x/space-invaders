# gh-pixel-pulverizer · Code Wiki

> 把 GitHub 贡献图（53 周 × 7 天）变成一场像素射击游戏的 GIF 生成器。
> 贡献越多 → 格子越大越亮、血越厚、爆炸越绚丽；高产格还有几率飞出 BOSS 外星人。

本文档是仓库的**结构化技术 Wiki**，面向需要阅读、修改或扩展代码的开发者。
所有描述均对应当前仓库代码（版本 `0.2.0`），并给出精确的文件行号引用。

---

## 0. 一分钟速览

| 维度 | 结论 |
|------|------|
| 语言 / 版本 | Python `>=3.9`（CI 验证 3.9 与 3.12） |
| 运行时依赖 | **仅 1 个**：`pillow>=10.0` |
| 核心代码 | `gh_pixel_pulverizer/cli.py`（868 行，含全部渲染与游戏逻辑） |
| 测试 | `tests/test_smoke.py`，18 个用例，**全离线可跑** |
| 输入 | GitHub GraphQL v4 贡献日历，或缺 token 时的本地伪随机「假数据」 |
| 输出 | 单张动画 GIF（860×230，共享调色板，帧差分压缩） |
| 交付形态 | Python 包（`pip install -e .`）+ 控制台脚本 + **GitHub Composite Action** |
| 无状态性 | 纯函数式 pipeline，**不写数据库、不缓存、不落盘中间产物** |

### 文档索引

| 文档 | 内容 |
|------|------|
| [01-architecture.md](./01-architecture.md) | 整体架构、分层、数据流、坐标系统、渲染管线、内存模型 |
| [02-modules.md](./02-modules.md) | 各模块/文件职责矩阵、逐文件说明、CI 与 Action 配置 |
| [03-api-reference.md](./03-api-reference.md) | 常量表、**全部关键类与函数**签名、行为契约、副作用 |
| [04-dependencies.md](./04-dependencies.md) | 外部依赖、标准库依赖、内部依赖图、打包与分发链路 |
| [05-running.md](./05-running.md) | 本地运行、CLI 参数、pip 安装、GitHub Action 接入、调参指南 |
| [06-testing-and-ci.md](./06-testing-and-ci.md) | 测试策略、用例清单、CI 流水线、本地复现命令 |
| [07-design-decisions.md](./07-design-decisions.md) | 设计决策（含踩过的坑）、已知限制与改进建议 |
| [08-competitive-analysis.md](./08-competitive-analysis.md) | 对标 gh-space-shooter 的差距根因分析与改进路线图 |

---

## 1. 仓库全景

```
gh-pixel-pulverizer/
├── gh_pixel_pulverizer/          # 唯一的 Python 包
│   ├── __init__.py               # 3 行：__version__ = "0.2.0"（版本号唯一来源）
│   ├── __main__.py               # 4 行：python -m 入口
│   └── cli.py                    # 868 行：常量 + 数据结构 + 引擎 + GIF 编码 + CLI
├── tests/
│   └── test_smoke.py             # 184 行：18 个离线冒烟用例
├── .github/workflows/ci.yml      # 52 行：测试 + 端到端生成 GIF + 上传产物
├── action.yml                    # 150 行：Composite Action（供他人 workflow 引用）
├── pyproject.toml                # 打包元数据（PEP 621）
├── README.md                     # 面向用户的说明
├── LICENSE                       # MIT
└── .gitignore                    # 忽略 *.gif 等产物
```

**规模**：生产代码 875 行，测试 184 行，配置 202 行。属于典型的
「单文件核心 + 薄入口 + 单一依赖」微型项目，**全量阅读成本 < 30 分钟**。

---

## 2. 核心概念（读代码前必知）

| 概念 | 含义 | 代码位置 |
|------|------|----------|
| **Contributions** | 二维贡献矩阵 `rows[7][53]`，`rows[weekday][week_index]` = 当天提交数 | `cli.py:160-164` |
| **Target** | 每个非空格子转换成的靶子，含 `level`(1-5)、`hp`、`alive` | `cli.py:106-122` |
| **level 分档** | 按**用户自身贡献分位数**（而非绝对阈值）划分 5 档 | `cli.py:309-347` |
| **Engine** | 游戏状态机 + 渲染器，拥有 `targets/enemies/bullets/particles/stars` | `cli.py:263-748` |
| **frame** | 一帧 = 一次逻辑更新 + 一张 PIL Image；`frame_ms = 1000/fps` | `cli.py:711-744` |
| **iter_frames()** | 生成器：边产帧边被消费，避免全量驻留内存 | `cli.py:711` |
| **共享调色板** | 用首帧生成一张 P 模式调色板，所有帧复用 → 不闪烁 | `cli.py:757-765` |
| **Strategy** | 飞船选靶策略：`column` / `row` / `random` / `chaos` | `cli.py:167-171` |
| **BOSS（Enemy）** | level ≥ 4 的格子被打爆时有几率生成，俯冲 + 向飞船射击 | `cli.py:125-132` |
| **celebration** | 全部清场后追加的 15 帧烟花动画 | `cli.py:734-744` |

---

## 3. 端到端链路（一句话版）

```
GitHub GraphQL ──▶ Contributions ──▶ Target[] ──▶ Engine.iter_frames() ──▶ 逐帧量化 ──▶ GIF
      or 假数据      (7×53 矩阵)      (按分位分档)    (生成器·游戏循环)      (共享调色板)
```

展开：

1. `main()` 解析 CLI 参数，确定 `username` 与 `token`；
2. **有 token** → `fetch_contributions()` 走 GraphQL；**无 token / `--offline` / 任何失败** → `generate_dummy()` 兜底；
3. `Engine.__init__()` 用 `_build_targets()` 把矩阵转成靶子列表，`_spawn_stars()` 生成星空，并按总血量推算 `max_frame`；
4. `Engine.iter_frames()` 每帧推进物理与碰撞，`yield` 一张 RGB `Image`；
5. `encode_gif()` 消费该生成器，逐帧 `quantize_frame()` 映射到共享调色板后一次性写出 GIF；
6. `main()` 打印战报，并在 `$GITHUB_OUTPUT` 存在时追加 Action 输出。

---

## 4. 设计信条（项目的隐含约定）

修改代码前请务必理解这四条，它们解释了源码里多处「反直觉」的写法：

1. **不要破坏流式处理** —— `iter_frames()` 必须是生成器；`encode_gif()` 必须能消费生成器。
   理由：400 帧 RGB 原图 ≈ 230 MB，一次性驻留会撑爆 CI runner。
2. **不要移除每帧的 `_prune()`** —— 死亡对象必须真正从列表移除，否则每帧遍历成本随帧数**无界增长**。
3. **网络失败只能降级，不能抛出** —— `fetch_contributions()` 的所有异常分支都 `return None`，由上层回退假数据。
4. ** Action 里用户可控输入只经 `env:` 传递** —— 绝不把 `${{ inputs.* }}` 直接内插进 `run:`，防脚本注入。

详见 [07-design-decisions.md](./07-design-decisions.md)。

---

## 5. 变更历史（来自 git log，读懂「为什么这样写」的捷径）

| 提交 | 说明 | 对本文档的意义 |
|------|------|----------------|
| `33b9b14` | 初始提交：核心 `cli.py` | 全部基础能力 |
| `0c6a8bd` | 新增 `action.yml` Composite Action | GitHub Actions 集成形态 |
| `94f4237` | 修正 Action 判反 + 修复脚本注入风险 | 解释 `action.yml` 的 `env:` 写法 |
| `1318a2c` | 修复 seed 复现、清场可达、渲染健壮性 | 解释 crc32 播种、`_auto_max_frame()`、`_prune()` |
| `7a5cfd4` | 补齐 LICENSE / 测试 / CI，统一版本号来源 | 解释 `__init__.py` 作为版本唯一来源 |
| `41db9aa` | Action 新增 `colors` 输入，`max-frame` 默认改为自动 | 解释体积调节旋钮 |

---

## 6. 快速开始（更多见 [05-running.md](./05-running.md)）

```bash
python -m pip install pillow                     # 或 pip install -e .
python -m gh_pixel_pulverizer octocat --offline -o demo.gif      # 离线
GH_TOKEN=ghp_xxx python -m gh_pixel_pulverizer yourname -o game.gif
python -m unittest discover -s tests                              # 测试
```

MIT License。
