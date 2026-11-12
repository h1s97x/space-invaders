# 02 · 对外契约（冻结）

> 本文是 ADR 0000 第 4 节的可执行版本。**契约先于实现**：改这里，再改 `src/`。
> 内核不认识 GitHub Actions，也不认识 CNB；平台差异只存在于两侧 YAML 的参数映射里。

## 1. 输入：唯一入口 `CONTRIB_*`

`src/cli/args.ts` 是全项目唯一的参数声明处；`scripts/docs.ts` 由它生成 README 参数表，CI 用 `--check` 拒绝「改了默认值忘改文档」。

| 环境变量 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `CONTRIB_SOURCE` | `github` \| `cnb` \| `file` \| `mock` | `mock` | **显式指定，没有 `auto`**：内核不做平台探测 |
| `CONTRIB_USER` | string | `''` | 目标用户名；`file` / `mock` 可为空 |
| `CONTRIB_TOKEN` | string | `''` | 由平台 YAML 注入，内核不判断它来自哪个平台 |
| `CONTRIB_ENDPOINT` | string | `''` | 可选 API 基址覆盖，用于自托管或测试 |
| `CONTRIB_CALENDAR` | string | `''` | `file` 源读取的归一化日历路径 |
| `CONTRIB_OUTPUT` | string | `game.gif` | 唯一产物路径（相对工作目录） |
| `CONTRIB_SEED` | number ≥ 0 | `1` | 固定随机种子，保证同一输入得到同一 GIF |
| `CONTRIB_FPS` | number 10..50 | `20` | 播放帧率 |
| `CONTRIB_SCALE` | number 1..8 | `1` | 整数倍放大（画布已够大，默认不放大） |
| `CONTRIB_WIDTH` | number 32..2048 | `1024` | 低分辨率画布宽（放大前，53 列 × 16px 全览） |
| `CONTRIB_HEIGHT` | number 16..1024 | `256` | 低分辨率画布高（放大前，含 HUD、地平线与飞船区） |
| `CONTRIB_MAX_FRAMES` | number 1..20000 | `4800` | 帧数硬上界，保证流水线有界 |
| `CONTRIB_RULE` | string | `waves` | 规则注册表 id |
| `CONTRIB_RENDERER` | string | `invader` | `invader`（像素外星人）或 `classic`（贡献绿方块方阵），两种输出切换 |

约定：

- 空字符串按「未配置」处理，取默认值；数值非法、枚举非法、越界一律**报错并列出可选值**，不静默回落。
- 布尔值不存在：本项目没有布尔参数，避免 `true`/`on`/`1` 这类解析分歧。
- `CONTRIB_SOURCE` 由平台 YAML 显式给出，这是「零平台」的关键：内核只有 `registry.get(id)`，没有 `if (platform === ...)`。

平台侧映射（内核不参与，详见 ADR 0000 第 11 节）：

```yaml
# GitHub Actions：action.yml 的 runs.env
runs:
  using: docker
  image: Dockerfile
  env:
    CONTRIB_SOURCE: ${{ inputs.source }}
    CONTRIB_USER: ${{ inputs.user }}
    CONTRIB_TOKEN: ${{ inputs.token || github.token }}

# CNB：用户侧仍是熟悉的 settings
settings:
  source: cnb
  user: h1s97x
# 插件规范注入 PLUGIN_SOURCE / PLUGIN_USER，镜像入口 entrypoint.sh 无脑改名为 CONTRIB_*
# CNB_TOKEN 由流水线内置，需要时显式写 settings.token 或在 stage env 里映射
```

## 2. 数据模型：`Calendar`

见 `src/contract/calendar.ts`。要点：

| 字段 | 含义 |
|---|---|
| `from` / `to` | 覆盖区间（含两端），`YYYYMMDD`；决定铺盘的周范围 |
| `days[]` | **只含有活动的日期**，升序、不重复；稀疏合法 |
| `days[].metrics` | `commits` / `pullRequests` / `issues` / `reviews` / `score`，全为≥0 整数，缺失填 0 |
| `total` | 所有 metrics 之和，source 归一时一次算出 |

字段是中性语义，**不是任何一方的 API 字段名**：`contributionCount`、`commit_count`、`YYYYMMDD` 稀疏对象只能出现在 `sources/` 里。
`heatOf(metrics)` 是活跃值的唯一求和定义；`DATE_KEY_PATTERN` 是日期键的唯一形状定义。

## 3. 层间契约

| 接口 | 位置 | 职责 |
|---|---|---|
| `Source.read(ctx) → Calendar` | `src/contract/registry.ts` | 唯一允许知道平台的一层；`fetch` 可注入 |
| `Rule.build(calendar, seed) → Level`<br>`Rule.simulate(level) → Action[]` | 同上 | 纯函数、零 IO、可复现 |
| `Renderer.frames(level, actions, ctx) → Frame[]` | 同上 | 只认 `Level` / `Action`，不 import 具体玩法 |

`Level` / `Target` / `Wave` / `Action` / `Frame` 定义在 `src/contract/action.ts`。自研玩法用「波次 + 热度 + 连击」，
`Target.kind` 是 `drone` / `cluster` / `boss` 三种自研敌人类型，由 `enemyKindOf(tier)` 映射。
**不使用**参考项目的 `hp=1..4`、`column/row/random` 策略、`3.0/fps` 节奏或 `860×230` 几何。

`SourceContext` 另有一个可注入的 `now?: Date`：两个在线源用它确定同一个「滚动一年」窗口
（`rollingWindow(now)` 定义在 `src/contract/calendar.ts`），默认取系统时间。注入后测试可完全复现，
也保证不同平台对同一时间范围给出可比较的日历。

## 4. 输出契约

镜像只做一件事：`日历 → GIF 文件`，写完退出。

- **产物**：只写 `CONTRIB_OUTPUT` 指定的一个文件；父目录不存在时创建。
- **stdout**：一行摘要（源 id、目标数、帧数、字节数、路径），供人读，不供机器解析。
- **禁止**：不写 `GITHUB_OUTPUT`、不打印 `##[set-output`、不自己 `git commit`、不上传制品。
  提交与输出变量全部由平台流水线负责。

退出码：`0` 成功；非 `0` 失败，错误写到 stderr 并说明是哪个参数/源出错。

## 5. 阶段 0 验收

- [x] 三张注册表签名可编译（`npx tsc --noEmit`）
- [x] `Calendar` 不含任何平台 API 字段名
- [x] `CONTRIB_*` 每条都有类型 / 默认值 / 范围
