# 06 · 测试与 CI

---

## 1. 测试哲学

| 原则 | 体现 |
|------|------|
| **全离线可跑** | 唯一的联网用例 `TestNetworkFailurePaths` 也**容忍网络不存在**（`URLError → None`），因此在断网沙箱里依然通过 |
| **守护历史 bug** | 多段 doctext 明确写出「这里曾经用内置 `hash()`…」「旧的固定 300 帧上限下通关动画永远触发不了」，说明用例是**被真实故障倒逼出来的回归测试** |
| **断言「能否跑完」而非快照** | 断言清场、断言对象被回收、断言逐帧一致，避免脆弱的像素快照 |
| **零额外依赖** | 只用 `unittest` + Pillow，`python -m unittest discover` 即可 |

---

## 2. 运行测试

```bash
# 标准（推荐，CI 用的就是这条）
python -m unittest discover -s tests -v

# 直接执行文件
python tests/test_smoke.py

# 单个用例
python -m unittest tests.test_smoke.TestEngine.test_dead_objects_are_pruned -v
```

**无需安装本项目**：`tests/test_smoke.py:16` 手动把仓库根插入 `sys.path`：

```python
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
```

因此 CI 只需 `pip install pillow` 即可跑测试。

---

## 3. 测试用例清单（18 例）

### `TestDummyData`（3）— 假数据生成器

| 用例 | 断言 | 守护的问题 |
|------|------|-----------|
| `test_shape` | `len(rows) == ROWS`，每行 `len == COLS`，`total == 元素和` | 矩阵形状契约 |
| `test_reproducible` | 同 username 两次调用 `rows` 完全相等 | **曾用内置 `hash()` 播种**，每进程随机盐导致 `--seed` 失去复现能力 |
| `test_different_users_differ` | `"alice"` 与 `"bob"` 的矩阵不相等 | 用户名确实参与播种（防误用常量种子） |

### `TestTargets`（3）— 分档合法性

| 用例 | 断言 | 守护的问题 |
|------|------|-----------|
| `test_levels_and_hp_are_valid` | `total_targets > 0`；所有 `1 <= level <= 5`；所有 `hp >= 1` | 分档不越界 |
| `test_levels_are_spread_out` | 出现的 level 种类 **≥ 3** | **旧实现整图一片深绿**、凑不出 BOSS 格 |
| `test_targets_stay_inside_the_canvas` | 每个靶子 `x,y >= 0` 且 `x+size <= WIDTH`、`y+size <= HEIGHT` | 坐标计算不溢出画布 |

### `TestEngine`（7）— 核心引擎

| 用例 | 断言 | 守护的问题 |
|------|------|-----------|
| `test_auto_max_frame_actually_clears_the_board` | 默认 `max_frame=0` 跑完生成器后，存活靶子为 `0`，且 `defeated == total_targets` | **旧的固定 300 帧上限导致通关动画永远触发不了** |
| `test_explicit_max_frame_is_respected` | `e.max_frame == 40`；总帧数 `<= 55`（打不完 40 帧；若提前清场则含 15 帧庆祝） | 显式上限语义正确 |
| `test_dead_objects_are_pruned` | 跑完后 `particles` 无 `life<=0`、`bullets` 无 `not alive`、`enemies` 无 `not alive` | 死亡对象被真正回收，列表不会无界增长 |
| `test_frame_size` | `max_frame=5` 恰好产出 5 帧；均为 `Image.Image`；尺寸 `(860, 230)` | 帧数与画布契约 |
| `test_seed_is_deterministic` | 同 seed 两次 `max_frame=30` 的帧字节流完全相等 | `--seed` 复现性 |
| `test_every_strategy_runs` | 遍历 `Strategy` 全部成员（`subTest` 隔离），各产 30 帧 | 4 种策略均可运行 |
| `test_empty_contributions_do_not_crash` | 全 0 矩阵下 `total_targets == 0` 且仍能产出帧 | `_auto_max_frame()` 空图分支不崩 |

### `TestGifEncoding`（4）— 编解码

| 用例 | 断言 | 守护的问题 |
|------|------|-----------|
| `test_roundtrip_matches_source_frames` | 编码 25 帧后逐帧解码，与**量化后**的源帧 `tobytes()` 完全相等（附 `msg` 说明这可能是残影/差分错误） | **守护「不指定 `disposal=2`」这个体积优化不会引入残影**；注意是与量化后帧比较，因为减色本身有损 |
| `test_accepts_a_generator` | `encode_gif(engine.iter_frames(), ...)` 正常返回 4 | 流式接口不被破坏（防有人改成要求 list） |
| `test_colors_are_clamped` | 传 `--colors 999` 仍能产出 3 帧 | `_clamp_colors` 限幅生效 |
| `test_empty_input_raises` | `encode_gif(iter([]), os.devnull, 25)` 抛 `RuntimeError` | 空输入有明确错误 |

### `TestNetworkFailurePaths`（1）— 降级

| 用例 | 断言 | 说明 |
|------|------|------|
| `test_bad_credentials_return_none` | `fetch_contributions("<不存在用户>", None)` 返回 `None` | 注释说明：无 token → 401；网络不可达 → `URLError`。**两者都应返回 None**，故断网环境同样通过 |

---

## 4. 测试基础设施

```36:37:tests/test_smoke.py
def _engine(seed: int = 7, **kwargs) -> Engine:
    return Engine(generate_dummy("octocat"), seed=seed, **kwargs)
```

统一的引擎工厂：假数据 + 固定默认 seed（7），各用例通过 `**kwargs` 覆盖策略/帧数/seed。

**引入的 12 个符号**（`tests/test_smoke.py:20-33`）：
`COLS, HEIGHT, ROWS, WIDTH, Contributions, Engine, Strategy, build_palette, encode_gif, fetch_contributions, generate_dummy, quantize_frame`
—— 这实际上是项目对外承诺的**稳定公共 API**（见 [03](./03-api-reference.md) §7）。

---

## 5. CI 流水线（`.github/workflows/ci.yml`）

```mermaid
flowchart TD
    A[push to main / PR / manual] --> B[matrix: py3.9 & py3.12, fail-fast false]
    B --> C[checkout@v4]
    C --> D[setup-python@v5]
    D --> E[pip install -U pip pillow]
    E --> F[python -m unittest discover -s tests -v]
    F --> G[python -m gh_pixel_pulverizer octocat --offline -o game.gif --seed 7]
    G --> H{size > 0 ?}
    H -- yes --> I[upload-artifact@v4 → game-gif-py*]
    H -- no --> J[failure]
```

| 配置 | 值 | 备注 |
|------|-----|------|
| 触发 | `push`(main)、`pull_request`、`workflow_dispatch` | |
| `permissions` | `contents: read` | 最小权限 |
| 矩阵 | `python-version: ["3.9", "3.12"]` | `fail-fast: false` 保证两个都跑完 |
| Step 4 | `python -m unittest discover -s tests -v` | |
| Step 5 | 端到端 + Python 断言 `size > 0` | 覆盖「能否真的产出文件」这条单测不覆盖的路径 |
| Step 6 | `upload-artifact@v4`，`retention-days: 7` | 便于人工查看产物视觉 |

### CI 未覆盖的部分

| 缺口 | 影响 | 建议 |
|------|------|------|
| **联网路径未真实验证** | `fetch_contributions` 的成功分支（`200 + data.user`）从未在 CI 中被执行 | 可用 vcrpy 或本地 HTTP stub 录制一次真实响应做回放测试 |
| **未安装本项目包** | `pyproject.toml` 的 `[project.scripts]` 与 `dynamic.version` 从未被验证 | 加一步 `pip install .` + `gh-pixel-pulverizer --help` |
| **`action.yml` 未被测试** | Composite Action 的 inputs/提交逻辑完全靠人工验证 | 可用 `act` 或另建 workflow `uses: ./` 做自测 |
| **无 lint / 类型检查** | 无 ruff/flake8/mypy 关卡 | 可选；仓库内有 `# noqa: E402` 注释，说明历史上用过 flake8 |

---

## 6. 本地一键复现 CI

```bash
python -m pip install pillow
python -m unittest discover -s tests -v
python -m gh_pixel_pulverizer octocat --offline -o game.gif --seed 7
python -c "import os; assert os.path.getsize('game.gif') > 0; print('OK')"
```

> `.gitignore` 忽略 `*.gif`，因此本地跑出的 `game.gif` 不会被误提交。

---

## 7. 添加新测试的建议位置

| 你想验证什么 | 加到哪个类 |
|--------------|-----------|
| 假数据的分布/权重 | `TestDummyData` |
| 新的分档规则（如调整阈值） | `TestTargets` |
| 新策略、新实体（如新的敌人类型） | `TestEngine`（记得加进 `test_every_strategy_runs` 的等价遍历） |
| 编码参数（`disposal`、`optimize`、色彩空间） | `TestGifEncoding`（**务必先跑 `test_roundtrip_matches_source_frames`**） |
| 网络错误处理的新分支 | `TestNetworkFailurePaths`（保持「不假设有网」） |

> 任何涉及 GIF 编码参数的改动，**都必须让 `test_roundtrip_matches_source_frames` 保持绿色**，
> 否则用户会看到残影（上一帧的画面残留在本帧背景里）。
