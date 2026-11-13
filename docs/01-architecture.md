# 01 · 架构

> 决策依据见 [ADR 0000](adr/0000-rewrite-baseline.md)，对外契约见 [02](02-contract.md)。

## 五层与依赖方向

```text
CONTRIB_* env / calendar.json        ← 唯一对外契约，自己定义，不照抄任何 API 形状
        ↓
sources/   github | cnb | file | mock → Calendar   ← 唯一允许知道平台的一层
        ↓
domain/    Calendar → Level → Action[]            ← 纯函数、零 IO、seed 可复现
        ↓
render/    自研光栅 + 自研 GIF89a/LZW → Frame     ← 注册表：invader / 未来别的输出
        ↓
pack/      Dockerfile · entrypoint.sh · action.yml · plugin-meta.json · 两侧 YAML
```

硬约束（CI 与测试双重拦截）：

- `domain/` 不 import `sources/`；`render/` 不 import 具体玩法；层间只过 `contract/` 的模型。
- `src/cli/env.ts` 只认 `CONTRIB_*`；`src/cli/outputs.ts` 只落盘 + 打印一行摘要。
- `src/` 全文不得出现 `platform ===`、`INPUT_`、`PLUGIN_`、`GITHUB_OUTPUT`、`##[set-output`。
- `package.json` 的 `dependencies` 恒为 `{}`。

## 目录职责

| 目录 | 职责 | 不应包含 |
|---|---|---|
| `src/contract/` | `Calendar` / `Level` / `Action` / `Frame`、注册表接口、日期工具 | 平台字段名、IO |
| `src/sources/` | 协议归一、按年取数、稀疏补零、失败报错 | 玩法、渲染、参数解析 |
| `src/domain/` | 分位分档、波次、连击、确定性洗牌 | 任何 `import` 到 sources、任何 IO |
| `src/render/` | 主题、精灵、帧序列、调色板与 GIF 编码 | 具体玩法模块、平台概念 |
| `src/cli/` | 参数声明与解析、编排、落盘 | 平台判断、提交动作 |
| `scripts/` | 参数表生成、黄金摘要 | 运行时依赖 |
| `test/` | 契约、数据源、玩法、编解码、端到端 | 真网络请求 |

## 两遍流式编码

`cli/index.ts` 的 `encodeSequence()` 跑两遍 `renderer.frames()`：

1. `buildPaletteFromFrames()` 遍历第一遍，跨帧统计颜色、建 256 色调色板；
2. `encodeGif()` 遍历第二遍，逐帧 `upscale → toIndices → LZW`，边生成边写码流。

帧不驻留内存，`CONTRIB_MAX_FRAMES` 是硬上界。调色板全片共用一张，
索引 0 固定为透明，索引 255 为溢出色兜底（`FALLBACK_INDEX`）。

第二遍同时计算与上一帧的**脏矩形**：未变化像素写透明索引，只把变化区域交给 LZW，
GIF 处置方式必须是 1（保留上一帧）；用 2（恢复背景）会清掉画布，只剩碎片。

调色板支持 `reserve` 预留色：怪物、飞船、子弹与爆炸的像素少但不能变色，
纯按频次建表会被抗锯齿边缘挤出去。`src/cli/index.ts` 把主题里的 10 个数据层主色
优先写入色表，再由 `buildPaletteFromFrames` 按频次补满剩余槽位。
背景是 8 色带深渐变 + 分档静态星点，色阶有限、不产生数百种颜色
（ADR 0000 第 19、26 节）。

## 运行层

`Dockerfile` 两阶段：构建层装 devDeps 并 `tsc`，运行层只有
`/app/dist/src/`、`/app/entrypoint.sh` 和一份 `dependencies: {}` 的 `package.json`，
**没有 `node_modules`**。因此多架构镜像不涉及任何原生二进制。

`entrypoint.sh` 只做 `PLUGIN_* → CONTRIB_*` 的无条件前缀归一（见 ADR 0000 第 11 节），
GitHub 侧等价映射在 `action.yml` 的 `runs.env`。

## 分发

| 平台 | 契约 | 取数 | 提交 |
|---|---|---|---|
| GitHub | `action.yml` container action（`image: 'Dockerfile'`） | `source: github` + `github.token` | 用户工作流 |
| CNB | 制品库插件镜像（`plugin-meta.json`） | `source: cnb` + `CNB_TOKEN` | 用户流水线 |
| 本地 | `node dist/src/cli/index.js` | `mock` / `file` | 无 |

CNB 主仓是唯一源；`sync-github.sh` 单向推 GitHub 分发端点，没有反向同步工作流。
