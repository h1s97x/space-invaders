# 04 · 依赖关系

---

## 1. 一句话总结

```
gh-pixel-pulverizer 的运行时依赖只有一个：pillow。
其余全部使用 Python 标准库，且刻意避免了 requests / numpy / click 等常见选择。
```

这个约束直接服务于项目的两大分发形态：

1. **GitHub Actions 里零成本启动** —— runner 自带 Python，只需补一个 Pillow；
2. **单文件 curl 即用** —— 用户下载 `cli.py` 后 `pip install pillow` 就能跑。

---

## 2. 外部第三方依赖

### 2.1 运行时

| 包 | 版本约束 | 声明位置 | 用途 | 用到的 API |
|----|----------|----------|------|-----------|
| `pillow` | `>=10.0` | `pyproject.toml:[project].dependencies` | 图像生成与 GIF 编解码 | 见下表 |

```14:14:pyproject.toml
dependencies = ["pillow>=10.0"]
```

**Pillow 使用面**（`cli.py:33`）：

| Pillow 对象 | 使用位置 | 用途 |
|-------------|----------|------|
| `PIL.Image.new` | `_render_frame`、`build_palette` | 新建 RGB / P 画布 |
| `PIL.ImageDraw.Draw` | `_render_frame` | 取得绘图上下文 `d` |
| `d.rectangle` | `_draw_grid_bg`、`_draw_targets`、`_draw_bullets`、`_draw_enemies`、`_draw_particles`、`_draw_hud` | 矩形 / 线条填充 |
| `d.point` | `_draw_stars`、`_draw_targets`、`_draw_bullets`、`_draw_enemies` | 单像素点 |
| `d.line` | `_draw_grid_bg` | 网格线 |
| `d.polygon` | `_draw_enemies`、`_draw_ship` | 尖刺、飞船机身、尾焰 |
| `d.ellipse` | `_draw_ship` | 驾驶舱 |
| `d.text` | `_draw_hud` | HUD 文本 |
| `PIL.ImageFont.load_default()` | `_draw_hud` | 内置位图字体（**不依赖系统字体文件**） |
| `Image.quantize` | `build_palette`、`quantize_frame` | RGB → 调色板化（核心） |
| `Image.Dither.NONE` | 同上 | 关闭 Floyd–Steinberg 抖动 |
| `Image.getpalette` / `Image.putpalette` | `build_palette` | 提取 / 写回调色板 |
| `img.save(save_all=True, append_images=..., optimize=True)` | `encode_gif` | 多帧 GIF 写出 |

> **版本要求 `>=10.0` 的实际含义**：依赖 `dither=Image.Dither.NONE` 枚举（Pillow 9.1 之前是 `Image.Dither` 常量语义不同）与稳定的 `quantize(palette=...)` 行为。

### 2.2 构建期依赖

```1:3:pyproject.toml
[build-system]
requires = ["setuptools>=77", "wheel"]
build-backend = "setuptools.build_meta"
```

仅在 `pip install .` / 打包 wheel 时需要，**运行时不需要**。
`setuptools>=77` 是为了 `[tool.setuptools.dynamic] version = {attr = ...}` 的完整支持。

### 2.3 测试 / CI 依赖

无额外依赖。`tests/test_smoke.py` 只用标准库 `unittest` + `PIL.Image`（开图做往返比对）。

---

## 3. 标准库依赖清单

`cli.py` 的 import（`cli.py:20-33`）：

| 模块 | 用途 | 关键使用点 |
|------|------|-----------|
| `argparse` | CLI 参数解析 | `main()` |
| `bisect` | **分位数查表** | `_build_targets.level_of()`：`bisect_left(counts, count)` |
| `json` | GraphQL 请求体序列化 / 响应解析 | `fetch_contributions()` |
| `math` | 三角函数（`sin`/`cos`/`radians`）、`pi` | 爆炸方向、BOSS 横摆、尾焰抖动 |
| `os` | 读环境变量、取文件大小 | `main()`、`encode_gif()` |
| `random` | **实例级**随机数 `random.Random(seed)` | 全局 random 性来源（不用全局 `random.choice`） |
| `urllib.error` | `HTTPError` / `URLError` 分支 | `fetch_contributions()` 错误处理 |
| `urllib.request` | HTTP POST | **唯一网络出口** |
| `zlib` | `crc32` 稳定哈希播种 | `generate_dummy()` |
| `dataclasses` | `@dataclass` 定义 6 个值对象 | 数据结构区 |
| `enum` | `Strategy` | 策略枚举 |
| `typing` | `Iterable/Iterator/List/Optional/Tuple` | 类型注解 |
| `__future__.annotations` | PEP 563 延迟注解求值 | 使 `3.9` 下也能书写宽松注解 |

**刻意回避的依赖**：

| 未使用 | 原因（推测） |
|--------|--------------|
| `requests` | 非标准库，破坏「零依赖即刻可用」与 `curl` 单文件运行 |
| `numpy` | 纯 CPU 像素绘制规模极小，无需向量化；省去重依赖 |
| `click` / `typer` | 项目只需 9 个简单 flag，`argparse` 足够且零依赖 |
| `pytest` | 保持 `python -m unittest discover` 全版本可跑，无安装门槛 |

---

## 4. Python 版本支持矩阵

```10:14:pyproject.toml
requires-python = ">=3.9"
```

| Supported implementations |
|---|
| 3.9 / 3.10 / 3.11 / 3.12 / 3.13（classifiers 声明） |

**CI 实际验证**：Python 3.9 与 3.12（`fail-fast: false`）。

3.9 兼容性相关的写法：
- 类型注解一律用 `typing.List/Optional` 等而非 `list[...] | None`（尽管有 `from __future__ import annotations`，
  为了在 dataclass 与运行期 `get_type_hints` 场景也安全）；
- 不使用 `match` 语句、不使用 `dataclasses(slots=True)`（3.10+）、不使用 `str.removeprefix`（3.9 才有，但项目没用到）。

---

## 5. 内部模块依赖图

```
                 ┌──────────────────────────────┐
                 │  pyproject.toml (build-time) │
                 │  dynamic.version → attr      │
                 └───────────┬──────────────────┘
                             │ 读取 __version__（构建期反射）
                             ▼
     ┌─────────────────────────────────────────────────────┐
     │                gh_pixel_pulverizer.__init__         │
     │                     __version__ = "0.2.0"           │
     └─────────────────────────────────────────────────────┘
                             ▲ (import 包即执行)
                             │
  ┌──────────────┐           │        ┌───────────────────────┐
  │ __main__.py  │           │        │  tests/test_smoke.py  │
  │              │           │        │                       │
  │ from .cli import main ───┼───┐    │ sys.path.insert(根)   │
  └──────────────┘           │   │    │ from gh_pixel_...cli  │
                             │   │    │   import (12个符号)   │
                             │   ▼    └───────────┬───────────┘
                             │  ┌─────────────────▼─────────────────┐
                             └─▶│            cli.py                 │
                                │  ① 常量 ② 常量 ③ 数据结构          │
                                │  ④ 数据获取 ⑤ Engine ⑥ 编码 ⑦ CLI │
                                └─────────────────┬─────────────────┘
                                                  │ import
                                    ┌─────────────┴─────────────┐
                                    ▼                           ▼
                          ┌──────────────────┐      ┌────────────────────┐
                          │ 标准库 (13 个)   │      │  PIL (pillow>=10)  │
                          └──────────────────┘      └────────────────────┘
```

**重要性质：`cli.py` 不 import 同包内任何模块**（即不使用 `from .xxx import` 或 `from gh_pixel_pulverizer.xxx import`）。
这保证它可以被单独下载并以脚本方式运行（`action.yml` 的 step ② 就是这么干的）。

> ⚠️ 反例：`__main__.py` 使用了相对/绝对包导入 `from gh_pixel_pulverizer.cli import main`，
> 因此**只有 `cli.py` 是 standalone 的**。若要把更多逻辑迁移出 `cli.py`，项目必须先放弃
> README 里「curl 单文件」的用法，或为 standalone 场景提供一个打包脚本。

---

## 6. 分发链路

### 6.1 打包元数据（`pyproject.toml`）

| 字段 | 值 | 说明 |
|------|-----|------|
| `name` | `gh-pixel-pulverizer` | PyPI 名 |
| `dynamic.version` | `attr: gh_pixel_pulverizer.__version__` | **版本单一来源** |
| `license` | `MIT` + `license-files = ["LICENSE"]` | |
| `requires-python` | `>=3.9` | |
| `dependencies` | `["pillow>=10.0"]` | 唯一运行时依赖 |
| `[project.scripts]` | `gh-pixel-pulverizer = "gh_pixel_pulverizer.cli:main"` | 安装后可直接命令行调用 |
| `[tool.setuptools.packages.find] include` | `["gh_pixel_pulverizer*"]` | 只打包这一个包，`tests` 不进 wheel |

### 6.2 三种调用形态

```
形态 A  源码直跑        python -m gh_pixel_pulverizer <args>
                          └─ __main__.py → cli.main(argv=None)

形态 B  安装为命令      pip install -e .  →  gh-pixel-pulverizer <args>
                          └─ console_script → gh_pixel_pulverizer.cli:main

形态 C  Actions 复用    uses: h1s97x/gh-pixel-pulverizer@main
                          └─ action.yml step ②: cd $GITHUB_ACTION_PATH
                                                python3 gh_pixel_pulverizer/cli.py <args>
                             （直接执行 cli.py 的 __main__ 分支）
```

三者最终都汇聚到同一个 `cli.main()`，行为完全一致。

---

## 7. 外部系统依赖

| 外部系统 | 协议 / 端点 | 失败时的行为 |
|----------|-------------|---------------|
| GitHub GraphQL API v4 | HTTPS POST `https://api.github.com/graphql` | 见下文降级策略 |

**鉴权**：`Authorization: bearer <token>`（读环境变量 `GITHUB_TOKEN` 或 `GH_TOKEN`）；
无 token 时仍会发匿名请求，通常返回 401 → 降级。

**降级链**（三层，保证「永不失败」）：

```
--offline 显式指定  ──▶ generate_dummy()
            或
没有 token          ──▶ generate_dummy()
            或
fetch_contributions() 返回 None（401/403/超时/非法响应/GraphQL errors/用户不存在）
                   ──▶ print("  → 回退假数据") → generate_dummy()
```

> 这意味着**任何网络或凭据问题都不会让 Action 失败**，只是产出的 GIF 内容来自模拟数据。
> 排查线上「内容不对」问题时，第一步是看日志里有没有 `[warn]` 或 `→ 回退假数据`。

**需要的 token 权限**：仅需读取公开贡献数据的能力。在 Actions 中使用默认
`secrets.GITHUB_TOKEN` 即可（无需额外 scope）。

---

## 8. 依赖风险与审计要点

| 风险 | 评估 |
|------|------|
| 依赖数量 | 极简（1 个），供应链攻击面小 |
| 未锁版本上限 | `pillow>=10.0` 只设下限；Pillow 主版本 API 变动可能影响 `quantize`/`ImageDraw` |
| 无 lock 文件 | 仓库不含 `requirements.txt` / `uv.lock`；CI 每次装最新 Pillow → **可能引入非确定性构建** |
| 无 SBOM / hash pinning | 当前缺失；如需合规可在CI中追加 pip-audit 或 hash 锁定 |
| `urllib` 裸调用 | 无重试、无代理配置、无 TLS 校验定制；企业内网可能需要 `HTTPS_PROXY` 支持（当前**不支持**代理环境变量以外的配置） |

**改进建议**（低优先）：
1. CI 中把 Pillow 版本固定或至少在失败时打印 `pip freeze`；
2. 考虑支持标准 `HTTP(S)_PROXY` 环境变量（`urllib.request` 默认已读 `http_proxy`，但 HTTPS 隧道支持有限）。
