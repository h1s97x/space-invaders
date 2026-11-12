# ADR 0001 · 用镜像消灭平台差异，而不是支持两个平台

- 状态：已认可（ADR 0000 第 4 节的展开）
- 日期：2026-11-12

## 背景

两个旧仓库按平台各做一套：`gh-space-invaders` 用 GitHub GraphQL + composite action，
`cnb-space-invaders` 用 CNB Open API + Docker 插件。每加一个平台，就要在代码里加一层
`detectPlatform`、双 token、双参数前缀、双输出变量 —— 平台差异渗进内核，越维护越重。

## 决策

**内核零平台。** 镜像只负责 `日历 → GIF 文件`，写完退出。

1. 输入只有 `CONTRIB_*` 环境变量（和可选的归一化 `calendar.json`）。
2. 平台差异压到三处：取数放进可插拔 `source` 注册表；参数由 GitHub 侧 `action.yml` 的 `runs.env`
   与 CNB 侧镜像内 `entrypoint.sh` 的前缀归一映射到 `CONTRIB_*`（详见 ADR 0000 第 11 节）；
   提交与输出变量全部交给平台流水线。
3. **`CONTRIB_SOURCE` 没有 `auto`**：内核只有 `registry.get(id)`，不按 token 存在性猜平台。
   猜测看起来方便，实际上会把「平台」重新变成架构的一层。
4. `action.yml` 与 `plugin-meta.json` 只是同一份 `Dockerfile` 的两张门票；GitHub 侧仓库是纯分发端点。

## 后果

- 正面：新增平台 = 加一个 `sources/*.ts` 并注册，核心零改动；两侧 YAML 各约 10 行；内核全文不该出现
  `platform ===`、`INPUT_`、`PLUGIN_`、`GITHUB_OUTPUT`、`##[set-output`（已列入 ADR 0000 第 9 节验收）。
- 负面：用户要多写几行 YAML 显式指定 source；首次接入必须在两个平台各跑一次端到端。
- 约束：`sources/` 是唯一允许出现平台名与 API 字段的目录；`domain/` 与 `render/` 不得 import 它。
