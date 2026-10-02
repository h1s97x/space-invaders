# 07 · 设计决策 · 坑 · 已知限制

> 本文记录「为什么代码长这样」。每条都对应源码中的某处注释或某次修复提交 ——
> **改代码前先读这里**，可以避开已经踩过的坑。

---

## 1. 关键设计决策（ADR 摘要）

### ADR-1：拆成 7 个模块，且 `engine.py` 不碰 PIL（取代旧的「单文件」决策）

- **决策**：`config / models / data / engine / render / gif / cli` 七个模块，
  `engine.py` 只管玩法、`render.py` 只管画面，边界是 `Renderer(game)` 单向读取。
- **理由**：原 `cli.py` 868 行把常量、数据结构、抓数据、引擎、渲染、编码、CLI 混在一起，
  改「格子圆角」要在 300 行玩法代码之间翻找。拆分后最大模块 368 行，
  且**调玩法与调观感不再互相踩脚**。
- **代价**：放弃了「curl 单个 `cli.py` 直跑」的用法（它依赖零包内导入）。
  替代方案：`pip install "gh-space-invaders @ git+..."` + console script；
  Action 内部改为 `python3 -m gh_space_invaders`。
- **兼容性**：`cli.py` 仍 re-export 旧符号，`from gh_space_invaders.cli import X` 不破；
  包根 `__init__.py` 统一导出公共 API。
- **守护**：拆分是纯移动，不改任何行为 —— 验收标准是同一 seed 下 GIF 的
  **md5 与拆分前逐字节一致**。

---

### ADR-2：`iter_frames()` 必须是生成器，不得改为返回 `list`

```python
def iter_frames(self, verbose=True) -> Iterator[Image.Image]:
    ...
    yield self._render_frame()
```

- **理由**：400 帧 × 860×230×3 B ≈ **230 MB**。改成 `list` 会让 CI runner 内存吃紧。
- **守护**：`TestGifEncoding.test_accepts_a_generator` 会传入生成器。
- **遗留**：`Engine.run()` 仍返回 `list`（注释明确标注「兼容旧接口…建议改用 iter_frames」），新代码不要调用。

---

### ADR-3：每帧末尾必须 `_prune()`

- **问题**：原先死亡对象只被标记 `alive = False` 却永远留在列表里，**每帧仍被完整遍历**，帧数一多是无界增长。
- **决策**：帧末用列表推导真正移除。注意 `particles` 的存活判据是 `life > 0`（而非 `alive` 字段，Particle 没有该字段）。
- **守护**：`TestEngine.test_dead_objects_are_pruned`。
- **位置**：必须在 `_collide()` **之后**，否则当帧死亡的实体要延迟一帧才回收。

---

### ADR-4：`max_frame` 自动推算，而不是固定值

- **问题**：旧的固定 300 帧上限下，**通关动画永远触发不了**（靶子打不完，用户看不到烟花）。
- **决策**：`max(240, int(total_hp * 2.4) + 90)`。系数 2.4 来自「实测约 1.6 帧/HP」并留 ~50% 余量。
- **作用位置**：这只是**天花板**；真打完会提前 `return`，因此宽松的上限不影响正常产物体积。
- **特判**：空贡献图（`total_hp == 0`）返回 60 帧。
- **守护**：`test_auto_max_frame_actually_clears_the_board`。

---

### ADR-5：level 用「用户自身分位数」而非绝对阈值

- **问题**：旧实现是 `count // 5`，真实数据中绝大多数格子落在 level 1 → 整图一片深绿、也几乎凑不出 BOSS 格。
- **决策**：收集所有非零贡献值排序后用 `bisect_left` 求分位，阈值 25/50/75/90 → level 1..5。
- **为什么用 `bisect` 而不是手写遍历**：注释指出「避免重复值扎堆时全挤进同一档」——`bisect_left` 给出的是严格小于
  当前值的个数，语义精确。
- **守护**：`test_levels_are_spread_out`（要求至少出现 3 档）。

---

### ADR-6：`generate_dummy()` 用 `zlib.crc32` 而非 `hash()` 播种

- **问题**：CPython 的 `str.__hash__` 每进程带随机盐（`PYTHONHASHSEED` 随机化），
  会让 `--seed` **完全失去复现能力**。
- **决策**：`random.Random(zlib.crc32(username.encode("utf-8")))`。
- **副作用**：同一用户名永远得到同一张假贡献图（与 `--seed` 无关，后者只影响 `Engine`）。
- **守护**：`TestDummyData.test_reproducible`。

---

### ADR-7：网络失败只能降级，不能抛出

- **决策**：`fetch_contributions()` 有 **5 个失败分支全部 `print` 后 `return None`**，由 `main()` 回退假数据。
- **理由**：这是跑在别人 CI 里的工具，**任何网络抖动都不该让 `jobs` 变红**；宁可产出假数据的 GIF，也不要失败。
- **代价**：用户可能意识不到自己看到的是假数据 → 依赖日志（`[warn]`、`→ 回退假数据`）排查。

---

### ADR-8：GIF 共享调色板 + 关闭抖动 + 不设 `disposal=2`

| 决策 | 反向后果 |
|------|----------|
| 用**首帧**生成一张调色板给所有帧复用 | 每帧各自 `quantize` 会因索引漂移产生色闪（跑马灯） |
| `dither=Image.Dither.NONE` | 抖动会在大色块里塞高频噪声 → 体积明显增大、观感几乎不变 |
| **不指定 `disposal=2`** | 强制每帧全量编码，实测体积**直接翻倍** |
| `optimize=True`（脏矩形差分） | 因为每帧都是不透明整图，差分**不会产生残影** |

- **守护**：`test_roundtrip_matches_source_frames` 逐帧比对解码结果与量化后源帧，
  一旦有人引入 `disposal=2` 之外的错误改动导致残影，测试会立刻失败。
- **注意**：`build_palette` 里把调色板**补齐到 768 字节**（`putpalette` 要求完整 256×3）。

---

### ADR-9：单发子弹可穿透 3 个靶子（`BULLET_PIERCE = 3`）

- **问题**：贡献图有 200~350 个非空格子，「一发一杀」打不完 → 帧数失控、GIF 过大。
- **决策**：`Bullet.max_hits = 3`；命中后 **`b.y = ry - 1`** 立刻把子弹移出该格的高度带。
- **为什么这行赋值是关键**：否则子弹会在同一格子的 y 区间停留数帧，**被重复判定多次**（HP 秒掉、穿透数异常消耗）。
- **配套**：只有 level 5 有 `hp = 2`；若给更多档加血，清场帧数会显著上升。

---

### ADR-10：Action 中用户可控输入只经 `env:` 传递

- **问题**：直接在 `run:` 里写 `${{ inputs.username }}` 时，攻击者可用输入值中的 `$(...)` 实现**远程命令执行**。
- **决策**：所有 inputs 先映射为 `INPUT_*` 环境变量，脚本内以 `"$INPUT_X"` 引用。
- **历史**：提交 `94f4237` 「修正 action.yml 取反的提交判断与脚本注入风险」。
- **反向指引**：新增 input 时**必须**同步加一行 `env:`，绝不能偷懒内插。

---

### ADR-11：Action 默认 amend 上一条自己的 commit

- **问题**：每天定时跑一次，若每次新建 commit，用户的贡献历史会被自己的机器人刷屏。
- **决策**：三重条件下 amend（见 [02](./02-modules.md) §5.5）：
  ① 未显式关闭 amend；② 暂存区/工作区没有**除 GIF 之外**的改动；③ 上一条 commit message 以 `💥` 开头且含 `space-invaders`。
- **为什么需要 ②③**：确保 amend 绝不会把他人的改动卷进 GIF 的那个 commit，
  也绝不会 amend 掉一条不属于本 Action 的 commit。
- **退出**：`no-commit: 'true'` 可完全跳过；`no-amend: 'true'` 保留传统的新建 commit 行为。

---

### ADR-12：版本号单一来源

- **问题**：版本号同时写在 `pyproject.toml` 与代码里必然漂移。
- **决策**：`__init__.py:__version__ = "0.2.0"` 为唯一来源，由
  `[tool.setuptools.dynamic] version = {attr = "gh_space_invaders.__version__"}` 反射读取。
- **发版**：只改 `__init__.py` 一行。
- **历史**：提交 `7a5cfd4` 「统一版本号来源」。

---

### ADR-13：绘制顺序敏感

- `_draw_grid_bg` **必须**在 `_draw_stars` 之前：网格底板是不透明整块矩形，顺序颠倒会把整片星空盖掉。
- `SHIP_Y = GRID_BOTTOM + 70 = 193` 是**刻意上移 10px** 的结果，否则尾焰最高时会压住 `y=222` 的底部 HUD 进度条。
- `_explode()` 的粒子数同时是「观感」与「体积」旋钮：全屏粒子会撑大每帧脏矩形，砍半粒子 ≈ 省 25% 体积。

---

## 2. 已知限制与改进建议

### 2.1 已确认的代码瑕疵

| # | 位置 | 问题 | 影响 |
|---|------|------|------|
| 1 | `config.py` | `GR_L0 = (33, 38, 45)` **定义后从未使用** | 无害；属于可清理的死常量 |
| 2 | `config.py` | `WIDTH` 先算成 861 再硬写 `860`，注释「硬对齐原始」 | 坐标系统含一份隐性魔数；改布局时容易漏看 |
| 3 | `config.py / 76` | `PADDING = 34` 被 `PADDING_LR = 33` 取代，前者已无用 | 命名易混淆 |
| 4 | ~~`engine.py`~~ | ~~`int(v * alpha + 0 * (1 - alpha))` 冗余写法~~ | ✅ 已随 RGBA 渲染重构移除（改为 `_rgba(p.color, alpha)` 真淡出） |
| 5 | `engine.py` | `ImageFont.load_default()` **每帧调用**（400 帧 = 400 次） | 轻微性能损耗；提到模块级或 `lru_cache` 即可 |
| 6 | 碰撞判定 | 用**点**判定（子弹单点 vs 矩形），子弹速度 `-5.0` 会跳过高速下的小目标；飞船撞 BOSS 子弹用的是近似矩形 | 当前格子 ≥13px 暂不触发；改高 `BULLET_PIERCE` 速度时需留意隧穿 |
| 7 | `Bullet.max_hits` | 敌方子弹创建时不传 `max_hits`（保持默认 1）但从未被使用 | 语义噪声 |
| 8 | `celebration` 帧 | 内部循环不再递增 `self.frame` → HUD 帧号停住 | 无害，属观感细节 |

### 2.2 已知限制

| # | 限制 | 说明 / 影响 | 建议 |
|---|------|-------------|------|
| 1 | **`encode_gif` 并非真·流式写出** | 尽管 docstring 强调「RGB 原帧用完即丢」，实现里仍把所有**量化后**帧 `append` 进 `quantized` 列表（`gif.py`），因为 Pillow 的 `save_all=True` 需要完整序列。它只把峰值从「RGB 全驻留」降到「约 1/3」 | 若需真正流式，可考虑 `imageio` 的 writer 或手工写 GIF 字节流 |
| 2 | **level 4 与 level 5 视觉同尺寸** | `size = min(CELL+level-1, CELL+GAP+1)` 使两者都为 16px，只能靠颜色 + 皇冠条区分 | 想进一步区分可放宽 `size` 上限或给 level 5 加描边 |
| 3 | **无 `--version` 参数** | 用户无法从 CLI 查版本 | 可从 `__init__.__version__` 注入 argparse |
| 4 | **CI 未覆盖联网成功路径** | `fetch_contributions` 的 200 成功分支从未在 CI 执行 | 用录制回放（vcrpy）或本地 HTTP stub |
| 5 | **无 lock 文件 / 无版本上限** | `pillow>=10.0` 只设下限，无 `requirements.txt` 锁定 | 需要确定性构建时自行锁定 |
| 6 | **不支持代理配置** | 用裸 `urllib.request`，企业内网可能需要更复杂代理隧道 | 必要时允许传 `proxies` 或换 `urllib.request.ProxyHandler` |
| 7 | **`.gitignore` 忽略 `*.gif`** | Profile README 场景需 `git add -f` | 项目提示中说明即可 |

### 2.3 推荐的改进方向（按性价比排序）

1. **把 `ImageFont.load_default()` 提到模块常量** —— 一行改动，每帧省一次调用。
2. **加 `--version`** —— 从 `__init__.__version__` 读取，成本极低。
3. **清理死常量** `GR_L0` / `PADDING`，合并 `WIDTH` 的双步赋值。
4. **给 `fetch_contributions` 补「成功路径」测试**（本地 stub 或录制回放）。
5. **CI 增加一步 `pip install .` + `gh-space-invaders --help`** —— 守护打包元数据与 console script。
6. **为 `action.yml` 增加自检 workflow**（`uses: ./`）或引入 `act`。
7. ~~**若做较大重构**：先将 `cli.py` 拆分为多个模块~~ —— **已完成**（见 ADR-1）：
   `config / models / data / engine / render / gif / cli`，验收标准是同 seed 下 GIF 的 md5 与拆分前一致。
   下一步可考虑：把 `ImageFont.load_default()` 提到模块常量、给抓取成功路径补测试。

---

## 3. 修改禁忌清单（Review 时请重点检查）

```
✗ 把 iter_frames() 改成返回 list
✗ 删除帧末的 _prune()，或把 _prune() 移到 _collide() 之前
✗ 在 _draw_stars() 之前调用 _draw_grid_bg() 之外的不透明底图
✗ 让 fetch_contributions() 抛出异常而非返回 None
✗ 给 encode_gif() 加上 disposal=2
✗ 重新给 quantize 打开抖动
✗ 让 engine.py import PIL（玩法与绘制必须分离，绘制只在 render.py）
✗ 在 render.py 里修改游戏状态（Renderer 必须只读地消费 Engine）
✗ 让 config.py import 任何包内模块（它必须是依赖图的叶子，否则必成环）
✗ 在 action.yml 的 run: 里直接内插 ${{ inputs.* }} 或 ${{ github.event.* }}
✗ 放宽 netdev setTimeout > 15s 或移除超时（Action 会长时间挂起）
✗ 给更多 level 加 HP（会显著推高清场帧数与 GIF 体积），除非同步调大 max_frame
```

> **一条硬规则**：任何涉及 GIF 编码参数的改动，务必先让
> `TestGifEncoding.test_roundtrip_matches_source_frames` 保持绿色。
