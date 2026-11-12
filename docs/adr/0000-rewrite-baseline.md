# ADR 0000 · 平台无关重写基线（决策锁定）

| 项 | 值 |
|---|---|
| 状态 | **已认可，待实施** |
| 日期 | 2026-11-12 |
| 主仓（目标） | `h1s97x/plugins/space-invaders`（CNB，唯一源） |
| GitHub 侧（目标） | `h1s97x/space-invaders`，仅作存量 `uses:` 的分发端点 |
| 适用范围 | 本仓库后续所有改动 |

> **本文件只记录决策。当前 `src/` 仍是旧的 `gh-space-invaders` 实现，未改动任何代码。**
> 凡与本文件冲突的提案，**先改本文件，再改代码**。禁止以"顺手""先跑通"为由绕过下述约束。

---

## 1. 要解决的问题

用户原话归纳（四条硬要求）：

1. **整个仓库都归属于我** —— 代码与玩法设计都自研、无上游血缘；仓库身份也归自己（CNB 主仓、GitHub 仅分发）。
2. **尽量不引入重度依赖，自研**。
3. **可扩展、维护性强**。
4. **一个仓库多个平台（存疑）** —— 存疑项的结论：不做「多平台支持」，改为**构建一份镜像、去掉平台差异**。

## 2. 结论一句话

**不是合并，是重写。** 两个旧仓库都不是代码基线，只是「行为参考 + 待归档资产 + 用户迁移来源」。
最终产物是一个从数据模型、玩法规则到 GIF 编码器都由自己定义、零运行时依赖、只产出一份镜像的产品。

代价（已接受）：`~660 行`手写编解码器以后自己维护，靠黄金帧测试兜住；旧用户会看到与参考项目不同的 GIF，不能再宣称「与参考一致」。

---

## 3. 明确否决（防偏移清单）

| 否决项 | 原因 |
|---|---|
| 把两个仓库 `git merge`；挑一个引擎为主（"换心不换壳"或"连仓库一起换"） | 两个旧仓都带上游血缘，挑边不解决归属与依赖问题 |
| 在内核做平台抽象：`platform.ts`、`detectPlatform`、按 token 自动判断平台 | 平台差异应在镜像外消失，而不是成为架构的一层 |
| 引入 `@napi-rs/canvas` / `gifenc` / 任何原生二进制 / 任何 runtime 依赖 | 违反第 2 条；原生包在多架构镜像里是主要风险源 |
| 沿用 `czl9707/gh-space-shooter` 的常量、坐标系、三种策略、节奏（`3.0/fps`、`860×230`、`hp=1..4`、column/row/random） | 违反第 1 条；这些是上游「设计」，不能靠"代码是自己写的"糊过去 |
| 镜像直接写 `GITHUB_OUTPUT` / `##[set-output`、读取 `INPUT_*` / `PLUGIN_*` | 会把平台差异漏回内核；只写一个文件即可 |
| 提交 `dist/` / `demo.gif` 等二进制；GitHub ↔ CNB 双向同步；`packages/` monorepo | 分别违反产物一致性、单向源原则、"只定形状不抽包" |

## 4. 架构（五层 + 依赖方向）

```text
CONTRIB_* env / calendar.json        ← 唯一对外契约，自己定义，不照抄任何 API 形状
        ↓
sources/   github | cnb | file | mock → Calendar   ← 唯一允许知道平台的一层
        ↓
domain/    Calendar → Level → Action[]            ← 纯函数、无 IO、seed 可复现；玩法自己定
        ↓
render/    自研光栅 + 自研 GIF89a/LZW → 文件       ← 注册表：invader / 未来别的渲染器
        ↓
pack/      Dockerfile · action.yml · plugin-meta.json · sync 脚本   ← 全是薄壳
```

硬约束（CI 静态检查）：

- `domain/` **不 import** `sources/`；`render/` **不 import** 具体玩法；层间只过自己定义的 `Calendar` / `Level` / `Action` / `Frame`。
- `src/cli/env.ts` **只认 `CONTRIB_*`**，不认 `INPUT_*` / `PLUGIN_*`。
- `src/cli/outputs.ts` **只落盘 + 打印一行摘要**，不写任何平台输出变量。
- 加平台 = `sources/` 加一个文件并注册；加输出 = `render/` 加一个目录并注册；改玩法 = 只动 `domain/`。核心文件不动。
- 参数在 `src/cli/args.ts` **单点声明**，`scripts/docs.ts` 生成 README 参数表，CI 跑 `--check`。

平台差异最终只剩三处，全部在镜像外或注册表内：

| 差异 | 放置位置 |
|---|---|
| 取数 API / token | 可插拔 `source`（或镜像外步骤产出 `calendar.json`，`sources/file.ts` 是现成接口） |
| 参数注入 | GitHub / CNB 的 YAML 各自把 `INPUT_*` / `PLUGIN_*` 映射到 `CONTRIB_*` |
| 产物提交 / 输出变量 | `git commit`、`GITHUB_OUTPUT`、`##[set-output` 全交给平台流水线 |

## 5. 三个定稿选择（按默认锁定；变更须先改本文件）

1. **仓库身份**：原地重写并改中性名 `space-invaders`；GitHub 侧改名后仅作分发端点，旧 `uses:` 靠 301 解析。
2. **取数内置 `source`**（用户一步式），但契约保持可随时切成「镜像只吃 JSON、取数外置」。
3. **只定形状、不抽包**：`Calendar` + 镜像契约定成 `snake` / `card` / `3d` 将来可复用的形状，但**现在不抽共享包、不建 monorepo**，等第二个产品接入时再抽。

## 6. 自研边界（实现 vs 设计）

| 类别 | 处置 |
|---|---|
| **可搬（自研资产）** | `cnb-space-invaders` 的 `src/game/raster.ts` / `pixels.ts` / `gif.ts`（约 660 行）及 LZW / 调色板相关测试 —— 自己手写、MIT 作者是自己、零依赖。整体进 `src/render/codec/` |
| **必须重写（上游设计）** | 旧仓的 `constants.ts`（"数值全部沿用上游 PyPI 2.0.5"）、`strategies.ts`（"逐行对齐上游"）、`entities/` / `animator.ts` 的坐标与节奏。`domain/` 自己定活跃度→关卡规则、敌人类型、波次、连击 |
| **一行不进新仓** | 本项目的 `@napi-rs/canvas`、`gifenc`、`860×230` 几何、`3.0/fps` 节奏、`delta_time` 等参考值 |
| **归属凭证** | `LICENSE` 只有 `h1s97x`；`NOTICE` 只写「灵感致谢」、不写「移植自」；`docs/04-rewrite-record.md` 用可核验方式记录「零代码继承」（如列出未复制的上游文件清单），对齐 `profile-3d-contrib/docs/roadmap/00-takeover.md` 的做法 |

## 7. 最终目录树（锁定）

```text
space-invaders/
├── README.md                        # 平台选择器：GitHub Actions | CNB | 本地；参数表由脚本生成
├── LICENSE                          # MIT © 2026 h1s97x —— 只有你
├── NOTICE                           # 只写「灵感致谢」，不写「移植自」
├── CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md
├── package.json                     # "dependencies": {}；devDeps 仅 typescript + @types/node
├── package-lock.json                # 无平台二进制、无原生包
├── tsconfig.json
├── Dockerfile                       # 两阶段；运行层 = node:22-alpine + dist/，不拷 node_modules
├── action.yml                       # container action，image: 'Dockerfile'（约 20 行薄壳）
├── plugin-meta.json                 # CNB 插件元数据（镜像坐标指向新主仓）
├── .cnb.yml                         # 门禁 + tag_push 推镜像；不含业务逻辑
├── .github/workflows/ci.yml         # 同一套门禁，在 GitHub 侧再跑一遍
├── sync-github.sh                   # 单向：main / latest / tags → 分发端点
├── .gitignore  .dockerignore        # dist/ 与 *.gif 不入库
│
├── src/
│   ├── cli/
│   │   ├── index.ts                 # 唯一 ENTRYPOINT：读 env → 选 source → 生成 → 写文件 → 退出
│   │   ├── args.ts                  # CONTRIB_* 全量声明（唯一参数定义处）
│   │   ├── env.ts                  # 只认 CONTRIB_*；不认 INPUT_* / PLUGIN_*
│   │   └── outputs.ts              # 只落盘 + 打印一行摘要；不写 GITHUB_OUTPUT / ##[set-output
│   ├── contract/
│   │   ├── calendar.ts             # 自己定义的 Calendar / Day / Metrics
│   │   ├── action.ts               # domain ↔ render 之间的 Level / Action / Frame
│   │   └── registry.ts             # source / renderer / rule 三张注册表的类型
│   ├── sources/                    # 唯一允许知道平台的一层
│   │   ├── index.ts                # id → Source 注册表
│   │   ├── github.ts               # GraphQL → Calendar（date 字段直接归一）
│   │   ├── cnb.ts                  # /users/{u}/calendar：稀疏补零、跨年、分位归一
│   │   ├── file.ts                 # 读 calendar.json —— 将来取数外置的现成接口
│   │   └── mock.ts                 # seed 可复现的假日历，测试与离线共用
│   ├── domain/                     # 纯函数、零 IO、不 import sources/
│   │   ├── model.ts                # Calendar → Level（自研规则，无上游常量）
│   │   ├── rules.ts                # 活跃度 → 敌人类型 / 波次 / 连击
│   │   └── simulate.ts             # Level + seed → Action[]（生成器）
│   └── render/
│       ├── index.ts                # renderer 注册表
│       ├── invader/
│       │   ├── index.ts            # Action[] → 帧 → 编码
│       │   ├── theme.ts            # 自研几何与配色（不沿用 860×230 / 3.0÷fps）
│       │   ├── sprites.ts          # 自绘点阵字形与精灵
│       │   └── animate.ts          # 帧序列
│       └── codec/                  # ← 从 cnb-space-invaders 搬来的「自研资产」
│           ├── raster.ts           # 手写光栅（约 170 行）
│           ├── pixels.ts           # 整数倍放大 + 调色板量化（约 250 行）
│           └── gif.ts              # GIF89a + LZW（约 240 行）
│
├── scripts/
│   ├── docs.ts                     # args.ts → README 参数表；--check 供 CI
│   ├── demo.ts                     # mock → docs/assets/demo.gif
│   └── golden.ts                   # 重生成黄金帧摘要
├── test/
│   ├── contract.test.ts            # 归一化边界：稀疏、跨年、未来日期
│   ├── sources.test.ts             # 各 adapter 的假 fetch
│   ├── domain.test.ts              # 纯函数、seed 可复现、规则边界
│   ├── codec.test.ts               # LZW / 调色板 / GIF89a（旧仓迁入的编码用例）
│   ├── golden/*.json               # 帧哈希与尺寸摘要，不存 4MB GIF
│   └── e2e.test.ts                 # 子进程跑 dist/cli：mock → GIF → 校验头/帧数/退出码
│
├── examples/
│   ├── calendar.json               # 「零平台」契约的最小示例输入
│   └── pipelines/
│       ├── github-actions.yml      # env 映射 + 提交，约 10 行
│       └── cnb.yml                 # settings 映射 + 提交，约 10 行
└── docs/
    ├── 01-architecture.md         # 五层与依赖方向
    ├── 02-contract.md             # CONTRIB_* 清单 + Calendar schema
    ├── 03-extending.md            # 加平台 / 加渲染器 / 改规则各动哪几个文件
    ├── 04-rewrite-record.md       # 接管档案：零代码继承的可核验证据
    ├── 05-migration.md            # 两个旧仓的参数映射 + 镜像坐标迁移窗口
    └── adr/
        ├── 0000-rewrite-baseline.md   # 本文件
        ├── 0001-zero-platform-image.md
        ├── 0002-self-owned-design.md
        └── 0003-codec-reuse.md
```

镜像运行层最终只有：

```text
/app/
├── dist/          # 编译产物（含 sources/，但那只是几个 fetch 包装）
└── package.json   # dependencies: {}
```

## 8. 迁移与归档顺序

1. 新镜像在 GitHub 真数据 / CNB 真数据 / offline 三条路径双跑验证。
2. 旧仓 README 置顶迁移公告，`docs/05-migration.md` 提供参数映射表（`days/metric/scale/theme` → 新契约）。
3. 处理 `cnb-space-invaders` 的 open issue #13（帧数上界）、#18（静态网格 / dist 清理），带结论关闭。
4. **归档后 `.cnb.yml` 不再发版，旧 `docker.cnb.cool/.../cnb-space-invaders:latest` 会冻结** —— 必须留迁移窗口，并确认归档不影响制品库旧镜像可拉取。
5. 归档 `cnb-space-invaders`；本仓旧实现由重写覆盖；空仓 `cnb-profile-3d-contrib` 一并归档（同一套收尾流程的历史欠账）。
6. 只有 `sync-github.sh` 单向推 GitHub 分发端点，**不建反向同步工作流**。

## 9. 验收清单（实施时逐条打勾）

- [x] `package.json` 的 `dependencies == {}`；`package-lock.json` 无平台二进制包
- [x] 运行层镜像不拷 `node_modules`；`dist/` 与大体积 GIF 不入库
- [x] 内核全文无 `platform ===`、`INPUT_`、`PLUGIN_`、`GITHUB_OUTPUT`、`##[set-output`
      （检查范围为 `src/` 与 `dist/src/`；唯一例外是根目录 `entrypoint.sh`，见第 11 节）
- [x] `domain/` 不 import `sources/`；`render/` 不 import 具体玩法（`test/domain.test.ts` 静态拦截）
- [x] `args.ts` 单点声明 → `docs:check` 通过
- [x] 黄金帧 + e2e：`mock calendar → 10 帧 GIF`，校验 GIF89a 头、尺寸、帧数、退出码
- [x] GitHub Actions 与 CNB 各一次远端端到端 —— CNB `cnb-0h8-1k778v47n` success（1/1 pipeline）、
      GitHub Actions `43172256193` success，均为 `e8579c4`；真数据源分别为
      `source=cnb targets=98` / `source=github targets=221`
- [x] 玩法规则文件不含上游常量 / 策略名 / 参考节奏
- [x] `LICENSE` 只有 `h1s97x`；`NOTICE` 只有灵感致谢；`04-rewrite-record.md` 齐备
- [x] 两个旧仓 + 空仓归档 —— 用带 `repo-code:rw,repo-manage:rw` 的访问令牌执行 `archive-repo`，
      两仓 `status: 1`（`--status archived` 筛出 2 项）；旧 `:latest` 仍可拉取。
      注意归档标志是 `status`，不是 `freeze`

## 10. 执行计划

> 本节只排**实施顺序**，不改变第 1~9 节的任何决策。
> 规则：每阶段有唯一出口验收，未通过不进入下一阶段；任何阶段不得引入第 3 节的否决项。
> 关键路径是**阶段 1** —— 它一口气验证第 2 条（零依赖）与第 4 条（零平台）。跑不通就在契约层就地调整，不往后堆代码。
> 并行：阶段 0 的契约定义与阶段 1 的 codec 只读搬迁互不依赖，可同时准备；文档统一在阶段 4 写，避免重写两遍。

### 起点（当前工作区实况）

| 待处理 | 处置阶段 |
|---|---|
| `src/` 10 个旧 TS 文件、32 个旧回归测试 | 阶段 1 起逐步替换，阶段 4 清完 |
| `package.json` 的 `@napi-rs/canvas` / `gifenc` 及含 11 个平台二进制的 lock | 阶段 1 清空 runtime、重建 lock |
| `action.yml` composite + 误放在 `runs:` 下的 `token` | 阶段 4 换成 container action |
| `.cnb.yml` 双向同步 + `.github/workflows/sync-cnb.yml` | 阶段 4 删除反向同步 |
| `docs/` 9 份描述旧引擎的文档（与新树同名） | 阶段 4 由新文档覆盖，旧版留在 git 历史，不另建归档目录 |
| `demo.gif`（约 4 MB）、旧 `NOTICE` 的「灵感 / 移植」表述 | 阶段 4 删除 / 重写 |

### 阶段 0 · 契约冻结（不写运行时代码）

产出：`src/contract/{calendar,action,registry}.ts`（仅类型）、`docs/02-contract.md`（`CONTRIB_*` 全量清单 + `Calendar` schema + `Level/Action/Frame` 形状）、`examples/calendar.json`、ADR 0001~0003。

出口验收：三张注册表的接口签名可编译；`Calendar` 不含任何平台 API 字段名；`CONTRIB_*` 每条都有类型 / 默认值 / 范围。

不做：不实现 source、不写玩法、不搬 codec。

### 阶段 1 · 最小切片（关键路径）

产出：`Dockerfile`（运行层无 `node_modules`）、`src/cli/{index,args,env,outputs}.ts`、`src/sources/{index,file,mock}.ts`、`src/domain/` 最小可跑规则、`src/render/codec/{raster,pixels,gif}.ts`（从 `cnb-space-invaders` 只读搬入约 660 行）、`src/render/invader/index.ts` 最小帧、`test/e2e.test.ts`、`scripts/golden.ts`。

出口验收：`mock calendar → 10 帧 GIF`；GIF89a 头 / 尺寸 / 帧数 / 退出码断言通过；`dependencies == {}`；`docker build` 后运行层无 `node_modules`；内核全文无 `platform ===` / `INPUT_` / `PLUGIN_` / `GITHUB_OUTPUT` / `##[set-output`。

不做：不接真 API、不做美术、不写两侧 YAML —— 只在本地跑通。

### 阶段 2 · 双源接入与自研玩法

产出：`src/sources/{github,cnb}.ts`、`src/domain/{model,rules,simulate}.ts`、`test/{contract,sources,domain}.test.ts`。

出口验收：三个源对同一 fixture 归一成同一份 `Calendar`；seed 可复现；静态检查 `domain/` 不 import `sources/`；规则文件不含上游常量 / `column|row|random` / `3.0/fps` / `860×230`。

风险：`cnb-space-invaders` 的 `context.ts` 尺寸与配色和玩法耦合 —— 只搬 `raster/pixels/gif` 三个纯文件，几何与配色在 `render/invader/theme.ts` 重写。

### 阶段 3 · 渲染器与参数体系

产出：`src/render/invader/{theme,sprites,animate}.ts`、`src/render/index.ts` 注册表、`scripts/docs.ts` + `docs:check`、黄金帧摘要、README 参数表自动生成。

出口验收：`docs:check` 通过；黄金帧哈希稳定；**加一个假 renderer 只需注册、不改核心文件**（第 3 条要求的可执行证明）。

### 阶段 4 · 双平台分发、文档与旧资产清理

产出：`action.yml`（`image: 'Dockerfile'`）、`plugin-meta.json`、`.cnb.yml`（门禁 + `tag_push` 推镜像）、`.github/workflows/ci.yml`、`sync-github.sh`、`examples/pipelines/{github-actions,cnb}.yml`（各约 10 行）、`docs/01-architecture.md` / `03-extending.md` / `04-rewrite-record.md` / `05-migration.md`、新 `LICENSE` / `NOTICE`；并完成「起点」表里的全部清理。

出口验收：GitHub Actions 与 CNB 各一次端到端；两侧 YAML 只做 env 映射 + 提交；`sync-github.sh` 单向、无反向工作流；`dist/` 与 GIF 不入库。

### 阶段 5 · 迁移与归档

顺序：三条路径双跑（GitHub 真数据 / CNB 真数据 / offline）→ 旧仓 README 置顶迁移公告 + `05-migration.md` 参数映射 → 处理 `cnb-space-invaders` issue #13 / #18 → 留 `latest` 冻结的迁移窗口并确认制品库旧镜像仍可拉取 → 归档 `cnb-space-invaders` 与空仓 `cnb-profile-3d-contrib`。

出口验收：第 9 节 10 条验收清单全部打勾。

### 需你执行的仓库级动作（不代为操作）

1. CNB 主仓改名 `gh-space-invaders → space-invaders`，并确认改名对 Docker 制品库旧坐标的影响。
2. GitHub 侧改名并复测旧 `uses:` 的 301 解析。
3. 归档仓库、置顶公告、关闭 issue 的最终确认。

### 风险与对策

| 风险 | 对策 |
|---|---|
| CNB 改名后旧镜像坐标失效 | 阶段 4 改名**前**先查证；旧坐标靠阶段 5 的迁移窗口兜底 |
| GitHub `uses:` 的 301 在新仓不生效 | 阶段 4 端到端实测，不照搬 `profile-3d-contrib` 的结论 |
| 手写 codec 搬入后与旧玩法耦合 | 只搬三个纯编解码文件，几何 / 配色在 `theme.ts` 重写 |
| 旧 `docs/` 与新树同名导致覆盖丢信息 | 旧版留在 git 历史，不另建归档目录，避免树偏移 |

### 不排期

第二个渲染器（`snake` / `card` / `3d`）接入与共享包抽取：触发条件是**第二个产品真正接入时**，按第 5 节第 3 点再评估，本计划不安排。

### 开工条件

当前状态：**只记录决策与计划，代码未动**。确认后从阶段 0 开始，每阶段出口验收通过再推进。

---

## 11. 实施期修订记录（2026-11-12）

> 本节记录实施中发现的契约缺口，**第 4 节表格与第 7 节目录树以本节为准**；其余决策不变。

**背景**：CNB 插件规范会把 `settings` 强制注入为 `PLUGIN_<KEY>`，镜像内无法用 YAML 改成
`CONTRIB_*`；而内核（第 4 节）必须只认自有前缀。原计划「两侧 YAML 各自映射」在 CNB 侧不成立。

**修订**：

1. 新增根目录 `entrypoint.sh`（约 10 行 POSIX sh）作为镜像入口，把 `PLUGIN_*` **无脑改名**为
   `CONTRIB_*` 后 `exec` Node。它不含平台判断、不读平台专属变量，只是前缀归一；
   GitHub 侧仍由 `action.yml` 的 `runs.env` 完成映射。
2. 第 7 节目录树新增一行 `├── entrypoint.sh`（与 `Dockerfile` 同级）；`Dockerfile` 运行层
   COPY 该脚本并把它设为 `ENTRYPOINT`。
3. 第 9 节「内核全文无 `PLUGIN_`」的验收范围明确为 **`src/`**：`entrypoint.sh` 是唯一允许出现
   `PLUGIN_` 的文件，属于分发薄壳，不是内核。
4. `CONTRIB_SOURCE` 依旧没有 `auto`：前缀归一脚本不猜平台，source 仍由用户在 settings 里显式给出。

**为什么不算偏移**：平台知识（API 形状、字段名、凭据来源）仍然只在 `src/sources/`；
脚本做的是「任意外部前缀 → 自有前缀」的无条件转换，加第三个平台不需要改它。

---

## 12. 执行结果（2026-11-12）

阶段 0~4 已按第 10 节顺序完成，每阶段出口验收通过后才推进：

| 阶段 | 结果 |
|---|---|
| 0 | `contract/` 三张注册表、`docs/02`、ADR 0001~0003；`tsc` 通过 |
| 1 | 删旧 `src/` / `test/`，搬入约 660 行 codec（注释中性化），零依赖最小切片 + `Dockerfile`；`mock → 10 帧 GIF`、运行层无 `node_modules` |
| 2 | `github` / `cnb` / `file` / `mock` 四源，`domain/` 按树拆成 `model` / `rules` / `simulate`；三源归一成同一 `Calendar`、seed 可复现、`domain/` 不 import `sources/` |
| 3 | `theme` / `sprites` / `animate`、`docs.ts` + `docs:check`、黄金摘要、codec 回归；`npm run check` 全绿（22 个测试） |
| 4 | `action.yml` container action、`plugin-meta.json`、`.cnb.yml`、`ci.yml`、`sync-github.sh`、两侧示例、docs 01/03/04/05、新 `README` / `NOTICE` / `CHANGELOG` / `CONTRIBUTING` / `SECURITY`；旧资产清理完毕；镜像内 `PLUGIN_*` 前缀归一实测通过 |
| 5 | 本地部分完成（迁移公告草案、issue 处置结论、`file` 源离线验证）；远端动作待执行 |

### 阶段 5 执行状态（2026-11-12 晚）

**已完成**

- 用户执行并核验 1、2：CNB 新 slug `h1s97x/plugins/space-invaders`（旧 slug 自动重定向）；
  GitHub 新旧名 301 到同一 HEAD `8d63e8a`。
- 本地真数据源：用环境内置 `CNB_TOKEN` + `CNB_API_ENDPOINT` 跑通 `source=cnb`
  （`targets=98 frames=10`）；`mock` / `file` 源同样通过。
- 补装 PyYAML，5 份 YAML 全部可解析，补齐阶段 4 跳过的语法校验。
- 4：旧仓 README 顶部贴迁移公告并推送（`c4f2a82`）；`#13` / `#18` 带结论评论后关闭，
  open issue 数为 0。
- 归档前置：旧 `:latest` 镜像 manifest 可拉取，已核验。

**后续完成（用户提供 GitHub PAT 后）**

- 主仓重写结果提交并推送：`e8579c4`；`sync-github.sh` 单向同步分发端点（`main` / `latest`），
  CNB 与 GitHub 两侧 HEAD 一致，新 `ci.yml` / `action.yml` 均已到位。
- GitHub 真数据源 `source=github targets=221`；CNB 侧用内置令牌 `source=cnb targets=98`。
- 补装 PyYAML，5 份 YAML 全部可解析。
- 两侧 CI 端到端全绿：CNB `cnb-0h8-1k778v47n`（pipeline 1/1 success）、
  GitHub Actions `43172256193`（completed / success），均为 `e8579c4`。
- 原「3 还需要什么」表中的项至此全部解决：GitHub PAT 已提供、分发端点已同步、CI 已跑通、
  目标用户名 `h1s97x` 已由 `/user` 接口确认为有效账号。

**归档完成（用户重发有效令牌后）**

- 新令牌 27 字符，日历接口返回 403（身份有效、仅缺日历 scope）；`archive-repo` 对两个仓库均返回 200。
- 归档标志是 `status: 1`，`freeze` 字段不表示归档 —— 此前据此判断「未归档」是误读，已更正。
  `--status archived` 筛选返回 `cnb-space-invaders` 与 `cnb-profile-3d-contrib` 两项。
- 归档后旧 `:latest` 镜像 manifest 复查仍可拉取，迁移窗口成立。

**遗留：GitHub 分发端点的一次文档同步**

- 第 3 批状态文档只推送到 CNB 主仓：环境已无 `GITHUB_TOKEN` / `GH_TOKEN`，`gh` CLI 未安装，
  `sync-github.sh` 无法运行。分发端点仍停在 `f240167`（仅落后状态文档，代码与契约一致）。
- 需要具 `contents:write` 的 GitHub PAT 后运行 `./sync-github.sh`，或由维护者手动同步。

当前状态：**第 9 节 10 条验收全部打勾；代码、文档、两侧 CI、归档均完成；仅分发端点一次文档同步待凭据**。
