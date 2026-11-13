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
│       ├── motion.ts               # Action → 逐帧阶段（第 18 节）
│       ├── invader/
│       │   ├── index.ts            # Action[] → 帧 → 编码
│       │   ├── theme.ts            # 自研几何与配色（不沿用 860×230 / 3.0÷fps）
│       │   ├── sprites.ts          # 自绘精灵
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

---

## 13. 效果图与长窗口修复（2026-11-12）

- 为回答「效果图在哪」，两张完整图作为**文档资产**入库 `docs/assets/`：
  `contrib-cnb.gif`（98 目标 / 394 帧 / 480×160）、
  `contrib-github.gif`（222 目标 / 885 帧 / 480×160），另附两张 PNG 静态预览。
  `.gitignore` 只对这四个文件开口子，`dist/` 与临时 GIF 仍不入库。
- **首次出图发现缺陷**：一年 53 列 × `cellMin=6` = 318px 超出默认 240px 画布，
  后面的列被画到画布外，CNB 图中段帧几乎空白。把 `cellMin` 改为 2，
  让列宽由 `floor(usableWidth / columns)` 决定；短窗口（columns=2）仍受 `cellMax` 约束，
  所以黄金帧不变，`npm run check` 22 个测试全绿。
- 校验：两张 GIF 均为 `GIF89a` / 480×160 / 帧数与生成器一致 / Trailer 存在；
  第 200 帧非背景像素 4527 与 4610、颜色数 13 与 14，画面非空。
- GitHub 图的数据来自公开贡献页（369 天、9,420 次贡献、222 个有贡献日），归一成
  `calendar.json` 后走 `file` 源 —— GitHub PAT 已按用户要求删除，本地无凭据。
  `source=github` 的 GraphQL 路径此前已用 PAT 验证（221 个目标），两者因滚动窗口边界差 1 天。

---

## 14. 渲染层 v2 与 GIF 编码修复（2026-11-12 晚）

**起因**：首版真数据效果图判定不可用——一年 53 列被压进 240px 画布，敌人退化成 1px 竖线、
飞船三角形塌成一个点、中段帧几乎空白。上一轮只修了「列跑出画布」，没修「列太窄画不出形状」。

**改动范围**：`src/render/invader/` 与编码层；`contract/` / `sources/` / `domain/` / 平台契约不变。

- 默认画布 `240×80 → 512×128`（`args.ts` / `docs/02` / `action.yml` 同步），格子接近正方形，
  53 列仍完整入画。属破坏性变更，产物尺寸 `480×160 → 1024×256`。
- 8×8 三型两帧像素外星人、菱形机身 + 半透明机翼、子弹拖尾、粒子爆炸、视差星空、
  HUD（分数 / 连击 / 波次 / 进度条）、已清空列十字标记；裁掉 `rest` 空转帧。
- 编码改为**脏矩形差分**，并把 GIF 处置方式从 `0x09`（2＝恢复背景）改为 `0x05`
  （1＝保留上一帧）。否则每帧只画变化区域会把画布清空，Pillow 解码中段帧几乎全黑——
  这是实施中实测发现并修掉的第二个硬缺陷。
- 体积：CNB `5.8MB → 1.5MB`、GitHub `17MB → 3.4MB`；两张图 1024×256、301 / 668 帧。

**验收**：`npm run check` 27 个测试全绿（新增 5 个渲染回归：格子 ≥8px、三型两帧有面积、
飞船不退化、HUD/星空落像素、整年盘面中段帧非空）；用 Pillow 解码真实 GIF 的中段帧，
目视确认网格、HUD、精灵、飞船、星空均正确且无残影。

**美术来源**：见 `docs/04-rewrite-record.md` 第 6 节，仅取两个自有旧仓的美术资产，不取玩法设计。

**已知限制**：清场顺序仍由 `domain/` 按列推进，剩余敌人集中在画面右半边；左侧靠网格、
星空与清空标记填充，不再是空白。若要改构图顺序需要动 `domain/`，本轮刻意没有越界。

---

## 15. 渲染层 v3（2026-11-12 晚，方向由用户选定）

**用户选定**：① 全览大画布 `1024×256`、每格 16px，全年一屏看完；
② 深空分层背景（渐变星云 + 三层视差星点 + 地平线光带 + 扫描线）。
飞船轨迹按第 14 节承诺直接重做，不再询问。

**三个问题的根因与修复**

- **怪物模糊是绘制越界**：`cell=9` 时 `drawEnemy` 用 `Math.ceil(9/8)=2px` 画每个点，
  8×8 实际占 16px，溢出 9px 格子并盖到邻格。改成 `px = cell/8` 精确缩放；
  默认 `cell=16` 时每点 2px，正好填满且不重叠。
- **飞船轨迹**：原先每 action 一帧 + 0.36 比例逼近，`move` 时一帧跳 36%、连续 `fire` 时
  完全不动。改为每帧持续滑行、最近 4 帧残影、抖动尾焰、从飞船到目标的完整激光束与
  命中闪光（用强度淡出，不额外增加帧数）。
- **背景单薄**：新增 `src/render/invader/backdrop.ts` —— 16 级渐变、4 团星云光斑、
  固定色扫描线、三层视差星点、地平线光带与滚动透视线；网格水平居中，两侧留给星云。

**实施中发现的第四个硬缺陷**：深空渐变 / 星云 / 抗锯齿会产生数百种色阶，
纯按频次建 255 色表时，低频的激光、尾焰、爆炸暖色被全部挤出，
Pillow 解码 GIF 后暖色像素为 **0**（渲染帧里实际有 535 个）。
解法：`buildPalette` / `buildPaletteFromFrames` 增加 `reserve` 第三参数，
CLI 预留 13 个主题特效色；背景同时量化成 16 级色带，扫描线与地平线改固定色，
避免 alpha 混合继续造色。实测量化后暖色像素 `0 → 289`。

**验收**：`npm run check` 30 个测试全绿（新增 6 个：16px 格子、精灵不溢出、
残影/尾焰/激光、分层背景、预留色保真）；GIF `1024×256`，CNB 301 帧 / 1.7MB、
GitHub 668 帧 / 3.8MB；Pillow 解码中段帧目视确认怪物轮廓、HUD、渐变、星云、
地平线、飞船与尾焰；连续帧统计确认飞船 x 从 543 滑行到 650、暖色特效逐帧出现。

**未变**：`contract/` / `sources/` / `domain/` / 平台契约 / 零运行时依赖；
美术资产仍只参考两个自有旧仓（见 `docs/04-rewrite-record.md` 第 6 节）。
**已知限制照旧**：清场顺序按列，敌人集中在右半边，本轮仍未越界改 `domain/`。

---

## 16. 历史分支与双渲染器（2026-11-12 晚）

**用户指出**：重写前的历史应该单独开分支保存；`sync-github.sh` 用了 `--force`，
不该没先建归档分支就推。这一点成立，属于我的疏忽。

### 事实核对

- CNB 主仓（唯一源）一直是普通 fast-forward push：`8d63e8a` 仍在 `main` 的父链里，
  旧实现、32 个回归测试、`demo.gif` 从未丢失，git 历史完整。
- 被强推覆盖的只有 **GitHub 分发端点**的 `main` / `latest`（单向镜像，非唯一源），
  目前停在 `f240167`；该端点没有其它分支。
- 但「有历史」不等于「有明确可检出入口」，用户要求的独立分支此前确实不存在。

### 补救

- 新建并推送 `legacy/pre-rewrite` → `8d63e8a`，分支内含 `src/engine.ts` / `demo.gif` /
  旧 README 与 32 个回归测试，随时可 checkout 运行。`sync-github.sh` 只推
  `main` / `latest` / tags，不会碰该分支。
- GitHub 分发端点暂不建该分支（需要 `contents:write` PAT，用户已吊销旧令牌）；
  旧历史以 CNB 主仓为准。若要两端都有，后续显式推一次即可。

### 「两个都做到」的落地

主干新增 `src/render/classic/`，与 `invader` **并存**：

| | `classic` | `invader`（默认） |
|---|---|---|
| 观感 | 深黑底 + 星点 + 四档绿方块方阵 + `SCORE` / `@h1s97x` + 蓝色小飞船 | 8×8 外星人精灵 + 深空分层背景 + 轨迹特效 |
| 共享 | 同一份 `Calendar` / `Level` / `Action` / `RenderContext`、同一套 codec | 同左 |
| 改动面 | 只新增 `render/classic/` 三个文件 + 注册表一行 + `args.ts` 枚举 | 不变 |

`CONTRIB_RENDERER=classic|invader` 切换，`domain/`、`sources/`、`cli/`、平台契约全部零改动，
零新增依赖 —— 这是第 7 节「三个注册表」可执行性的实证，也回答了「加输出只加一个模块」。
classic 为自研实现，未复制旧仓源码，也不沿用 `860×230` 等上游几何常量。

### 验收

`npm run check` 33 个测试全绿（新增 3 个 classic 回归：两渲染器并存、绿方块/星点/HUD/飞船、
非法 renderer 报错）；四张 `1024×256` 效果图（两渲染器 × 两平台）已入库：
classic CNB 301 帧 / 717KB、classic GitHub 668 帧 / 1.6MB，
invader CNB 301 帧 / 1.7MB、invader GitHub 668 帧 / 3.8MB。
classic 首帧经 Pillow 解码目视确认绿方阵观感成立。

---

## 17. 移除 HUD 类装饰（2026-11-13，用户反馈后决定）

**用户反馈**：当前画面不合格，不应发布；怪物与飞船的建模保留，
但 `SCORE / COMBO / WAVE`、进度条、`CLEAR` 这类东西「无足轻重，加了反而拉低项目价值」。

**判定**：成立。这些数值全部由渲染层编造 —— `score += 10 + combo`、`combo` 是动作序号、
`wave` 就是列号，与 `Calendar` 数据没有任何语义关系，却占据画布顶部 22px，
还会让人误以为分数来自贡献数据。第 14 / 15 节中「HUD（分数 / 连击 / 波次 / 进度条）」
与第 16 节表格中「`SCORE` / 署名 / 星点」的描述，由本节取代。

**决策（用户二选一确认后的范围）**：

- 保留第 15 节用户选定的「全览大画布 + 深空分层」：渐变星云、扫描线、三层视差星点、
  地平线光带与滚动透视线、网格框及已清空列十字标记**全部不变**。
- `invader` 删除 `SCORE / COMBO / WAVE`、进度条、结束时的 `CLEAR` 及全部相关状态。
- `classic` 同步精简（用户选定）：删除 `SCORE`、署名、星点、结束时的 `CLEAR`，
  只留四档绿方块、飞船、子弹。
- 5×7 点阵字形只服务于 HUD，随之移除。主题里 `hud` 删除，`hudDim` 改名
  `clearedMark`（仍供十字标记用），`hudHeight` 改名 `topInset`（仍是网格上方留白，
  数值 22 不变，避免顺带动构图）；`Layout.hudY` 删除。
- 渲染层不再维护 `score` / `combo` / `wave` / `cleared`；`Action.combo` 契约不变，
  只是渲染层忽略它。两个渲染器的顶层留白 / 飞船区 / 地平线坐标都不动。
- **发布冻结**：`todo.md` 的 P0-1（发镜像）与 P0-2（打 tag / 统一版本）暂停，
  等画面验收通过后再执行。

**约束**：默认 `waves` 规则、黄金帧可复现性、零运行时依赖、平台契约一律不动；
本轮不改 `domain/`，P1-1 的构图偏右仍是独立待办。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要已重生成。
- 四张 `1024×256` 效果图与四张 PNG 预览用新渲染器重出并入库：
  CNB 99 目标 / 304 帧（数据取自 2026-11-13），GitHub 222 目标 / 668 帧，两渲染器帧数一致。
- Pillow 解码中段帧：`GIF89a` / 1024×256 / Trailer / 帧数均正确；顶部 30 行亮像素为 0，
  确认 HUD 文字与进度条确实消失；invader 中段帧仍有 12 / 24 个暖色像素，
  激光 / 尾焰 / 爆炸未被调色板挤掉。
- 目视确认：怪物精灵、飞船、深空渐变、星点、地平线、网格仍在；
  classic 只剩绿方块、飞船、子弹。
- 已知限制不变：按列清场导致中段帧敌人集中在右半边（P1-1），本轮未改 `domain/`。

---

## 18. 运行机制对齐 legacy 的行为模型（2026-11-13，第二次反馈）

**用户反馈**：飞船的运行逻辑、子弹、射击特效「完全不行」，至少要跟 legacy 对齐。
本轮「玩法优先」：背景不动，下一轮再定。

**事实核对**（重写前提交 `8d63e8a` 的 `engine.ts` / `render.ts` / `config.ts` / `types.ts`；
该提交仍在 `main` 父链里，本地无 `legacy/pre-rewrite` 分支也能读）：

- 旧主循环：`ship.moveTo(x)` → `while (!canTakeAction()) { animate(); render(); }` → 才 `shoot()`；
  `canTakeAction()` = 飞船停稳 && 冷却结束。移动中的每一帧都出画面。
- 子弹是实体：`x` 整数列、`y` 浮点行，逐帧上移，命中判定
  `enemy.x === bullet.x && enemy.y >= bullet.y`，**命中才**结算伤害；
  打爆放大爆炸、没打爆放小爆炸。
- 弹体画法：竖直黄色胶囊 + 3 段递减拖尾（在下方）+ 本体 4 层叠色；
  收尾等在飞子弹落完再补几帧让爆炸散完。
- 对照第 14 / 15 节的当前实现：`move` 与 `fire` 同一拍，`step()` 用指数逼近，
  `fire` 直接把一整条激光束从飞船画到目标并当场扣血 —— 没有「在途」概念，
  这是观感崩坏的根因，不是建模问题。

**用户选定范围**：玩法优先（背景本轮不动）；行为对齐、参数自研。

**决策**：

- **不动** `Action` 契约与 `domain/`：`move / fire / rest / finish` 语义不变，
  `simulateLevel` 一行不改。
- 新增 `render/motion.ts`：把 Action 展开成逐帧阶段
  `start → travel（匀速插值）→ launch → flight → impact → cooldown → tail`。
  命中仍由 `fire` 决定，只是**延迟到弹道走完**；渲染层不决定打谁、不改变关卡语义。
- 参数全部以「帧」为单位、本项目自定：`shipStep` / `bulletProgressStep` /
  `cooldownFrames` / `tailFrames`。**不引入**格/秒速度、`delta_time`、`3.0/fps`、
  在飞子弹数策略或任何上游常量；第 1、6、9 节的「无上游血缘」约束继续成立。
- 子弹改为逐帧上移的实体（胶囊 + 递减拖尾），移除整条瞬发激光；
  命中才扣血并触发大 / 小爆炸；飞船匀速到位后才允许下一发。
- 背景（渐变星云、扫描线、三层星点、地平线、网格）与 `classic` 的纯色底全部原样保留，
  第 15 节与第 17 节的背景决策本轮不推翻。

**已知代价**：帧数从 CNB 304 / GitHub 668 涨到数倍，GIF 体积上涨；
黄金帧、四张效果图与回归测试都要重出。发布继续冻结。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；新增回归断言覆盖
  「飞船先匀速到位 → 发射 → 飞行 → 命中」的阶段顺序与两渲染器阶段数一致。
- 黄金帧摘要重生成；四张 `1024×256` 效果图与四张 PNG 预览重出：
  CNB 99 目标 / 1416 帧，GitHub 222 目标 / 3137 帧，两渲染器帧数一致，
  均低于 `CONTRIB_MAX_FRAMES` 默认 4800。
- Pillow 校验：`GIF89a` / 尺寸 / Trailer / GCE 帧数一致；中段帧含子弹或爆炸的暖色像素
  （invader 94、classic 22），顶部 30 行亮像素仍为 0（HUD 未回归）。
- 目视确认：子弹是逐帧上移的黄色胶囊（带拖尾），命中处有爆炸，飞船停在目标列下方；
  深空渐变、星点、地平线、网格与怪物 / 飞船建模原样保留。
- **已知退化**：帧数从 304 / 668 涨到 1416 / 3137，`invader` GitHub 图 3.8MB → 16.8MB。
  重写前 `8d63e8a:demo.gif` 是 860×230 / 2661 帧 / 4.1MB。
  体积主因是深空背景每帧大面积变化（星点漂移、地平线滚动、尾焰抖动），
  属 P1-4「背景下一轮」的范围，本轮未擅自精简。
- 发布继续冻结；改动未提交 / 未推送。

---

## 19. 视觉命中、中心扩散与装饰清零（2026-11-13，第三次反馈）

**用户反馈**：子弹会穿过前排打后面的怪物；逐列从左到右清场太无趣；
左侧空网格 / 十字标记与底部地平线光带「这都是干什么的」。用户确认按整套方案执行。

**实测依据**（改动前的 `docs/assets/contrib-github.gif`，3137 帧）：

- 每帧 5,360 B → 16.8MB；`classic` 同帧数仅 912 B/帧 → 2.9MB。
- 每帧实际变化 4,217 px（画布 1.6%），但脏矩形平均 260,477 px = **99.4% 画布**：
  星点散布全屏逐帧漂移、地平线区每帧滚动 1,432 px，把包围盒撑成整屏。
- 首帧网格区 177 色、飞船区 136 色，256 色调色板打满，逼出 13 个预留色补丁。

**决策**：

1. **视觉命中**：`domain/simulate.ts` 每次 `fire` 动态选当前列 `row` 最大（最下方）的活目标，
   `Action.target` 天然是子弹路径上第一个敌人；契约形状不变，渲染层仍不决定打谁。
2. **清场顺序**：新增 `spread` 规则（列按到中心距离交替推进）并设为默认，
   `CONTRIB_RULE=waves` 保留旧逐列行为可回退；两规则共享视觉命中。
   改默认属破坏性变更，`CHANGELOG` 记录。
3. **装饰清零**：删渐变 / 星云 / CRT 扫描线 / 地平线光带与透视线 / 网格框与清空标记 /
   三层视差星点 / 飞船残影 / 尾焰 / 全盘 bob 切帧；改为纯色底 + 少量静态灰度星点。
   保留怪物精灵（固定帧、按剩余强度变形）、子弹、大小爆炸、飞船建模与匀速移动。
4. `ACCENT_COLORS` 精简为数据层实际用到的主题色；`classic` 的方块语义不动
   （空格子是日历本身，不是装饰）。
5. `render/motion.ts` 的逐帧阶段、`Action` 契约、零运行时依赖、平台契约一律不动；
   不引入上游常量 / 节奏，第 18 节的行为对齐继续成立。

**验收目标**：脏矩形 < 10% 画布、每帧 < 1,500 B、GitHub 图 3–5MB、
中段帧两侧都有怪物、子弹命中同列最下方活目标。发布继续冻结。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  回归新增「同列先打最下方活目标」「中心扩散列序」「装饰绘制函数已移除」断言。
- 四张 `1024×256` 效果图与 PNG 预览重出：CNB 99 目标 / 1416 帧，
  GitHub 222 目标 / 3437 帧（两渲染器帧数一致）。
- **体积目标全部达成**（`contrib-github`）：每帧 5,360 B → 992 B；
  总体积 16.8MB → 3.4MB；脏矩形 99.4% → 0.4% 画布；
  每帧变化 4,217 px → 187 px；首帧用色 177+ 色阶 → 91 色（`classic` 18 色）。
  顶部 / 底部非背景像素 21（仅静态星点），网格与地平线确实消失。
- 目视确认：纯色深底 + 稀疏静态星点，只剩怪物、飞船、飞行中的子弹与命中爆炸；
  无 HUD、网格、清空标记、光带、扫描线、残影、尾焰。
- **未完全达成**：中段画面「两侧都有怪物」受数据分布限制。GitHub 图中段帧左右怪物像素
  2,504 / 16,256（两边都有），CNB 图 0 / 7,853（左侧已清空）—— 两份真数据都是
  右侧活跃日明显更多（GitHub 初始左 75 / 右 147），而「先清中间、后清两端」
  必然让中段只剩两端。试过按列强度、按侧总强度加权，中段 L/R 仅从 16/104 变到
  17/100，已回退掉无效复杂度。若要强制均衡需改成按活跃度交错清场，已登记 `todo.md` P1-5。
- 第 15 / 17 / 18 节中「深空分层背景与装饰保留」的描述由本节取代；其余决策不变。
  发布继续冻结；改动未提交 / 未推送。

---

## 20. 默认清场顺序改为 seed 洗牌（2026-11-13，第四次反馈）

**用户反馈**：中心扩散效果仍很差，改用「随机 seed」。

**理解与决策**：这里的随机是**由 `CONTRIB_SEED` 决定的确定性洗牌**，不是每次运行掷骰子 ——
黄金帧、回归测试与「同一输入同一 GIF」的基线要求必须保持。换 seed 即换一套清场顺序。

- 新增 `shuffle` 规则并设为默认：`domain/simulate.ts` 用自研 xorshift + Fisher-Yates
  按 `level.seed` 打乱有目标列的顺序；每次 `fire` 仍动态选同列最下方活目标（视觉命中不退化）。
- `spread`（中心扩散）与 `waves`（逐列）都保留为 `CONTRIB_RULE` 可回退项。
- 第 19 节的装饰清零、纯色底、逐帧子弹、`Action` 契约与 `render/motion.ts` 一律不动；
  不引入上游常量 / 策略 / 节奏。
- 预期：剩余目标不再按位置连续清空，动画中段左右都还有敌人；飞船横跳变多，
  需实测 `CONTRIB_MAX_FRAMES` 与体积，必要时只调 `motion.ts` 的 `shipStep`。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  回归新增「同 seed 可复现 / 不同 seed 不同列序 / 列集合完整 / 不退化成逐列」断言，
  视觉命中与回退规则断言保持。
- 四张 `1024×256` 效果图与 PNG 预览重出：CNB 1506 帧 / 1.5MB，
  GitHub 3491 帧 / 3.5MB（invader），两渲染器帧数一致，均低于 `CONTRIB_MAX_FRAMES` 4800
  （travel 412 帧，无需调 `motion.ts` 的 `shipStep`）。
- 每帧 987–994 B、脏矩形 0.5% 画布、首帧用色 91–97（`classic` 18），与第 19 节持平。
- **中段构图明显改善**：GitHub 图动画中段的剩余目标 L/R 从中心扩散的 16/104
  变为 **35/75**（按目标数），中段帧怪物像素 6,184 / 11,072（此前 2,504 / 16,256）；
  PNG 目视确认怪物散布整个画布宽度，列序如 `18,24,36,44,41,15,25,49,31,22,37,28`。
- **仍未解决**：CNB 图中段左侧依旧空白。诊断发现 CNB 数据源的 99 个目标
  **初始 L/R = 0 / 99**，全部落在右半画面 —— 这是取数窗口 / 列坐标对齐问题，
  不是清场顺序能改变的。已记入 `todo.md` P1-5，本轮不越界改 `sources/`。
- 发布继续冻结；改动未提交 / 未推送。

---

## 21. 怪物错峰波浪与按发随机点射（2026-11-13，第五次反馈）

**用户反馈**：之前怪物还会动，现在不会动了；飞船不该必须清完一整列才走，
「这和我想的随机区别还比较大」。背景重设计暂缓，本轮只做这两项。

**事实核对**：第 19 节为压体积把怪物固定成单帧、删掉全盘 bob 切帧；
第 20 节的 `shuffle` 只洗牌「列顺序」，但每列仍在 `runColumns` 里被整列清空后才 `move`，
所以飞船实际还是在一列一列扫，只是列的出现顺序随机 —— 与用户要的随机不符。

**决策**：

1. 怪物恢复两帧，但**按列错峰**：`phase = (frameIndex + column) % 18`，
   每列相位差 1 帧，形成缓慢扫过的波浪；每帧只有约 1/18 的列发生切帧，
   不会回到旧版「全盘同步切帧」（旧版网格区 2,375 px/帧变化的元凶）。
2. `shuffle` 从「洗牌列顺序」改为「**洗牌每一发**」：每列按其总强度重复成发射计划，
   用 seed 洗牌后逐发消费；列变化才 `yield move`，每发仍打该列最下方活目标
   （视觉命中不退化）。每列出现次数 = 该列总强度，因此一定清完。
   `spread` / `waves` 仍按列连续发射，作为可回退对照。
3. `motion.ts` 给单次横移加 `maxTravelFrames` 上限：飞船频繁跳跃时，
   长距离不再按 `shipStep` 拖成十几帧；仍是匀速，只是每帧步长更大。
   参数自研，不引入上游节奏。
4. 背景、子弹、爆炸、装饰清零、`Action` 契约、零运行时依赖一律不动。

**验收目标**：`npm run check` 全绿；帧数 < `CONTRIB_MAX_FRAMES` 4800；
中段剩余怪物散布全画面；怪物有可见动画但脏矩形不回到全屏。发布继续冻结。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  回归新增「按发点射：同一列被分批多次访问」「错峰动画：相邻帧有局部变化且非全盘」断言。
- 四张 `1024×256` 效果图与 PNG 预览重出：CNB 1864 帧 / 2.6MB，
  GitHub 4270 帧 / 8.2MB（invader），帧数低于 `CONTRIB_MAX_FRAMES` 4800（余量 530 帧）。
- 飞船移动 427 次、列序如 `51,27,25,46,35,36,37,13,41,26,47,22,17,26,44,29`，
  不再清完一列才走；中段剩余目标 L/R 36/65，中段帧怪物像素 6,528 / 11,720。
- 怪物动画确认生效：invader 网格区每帧变化 2,205 px（GitHub）/ 1,002 px（CNB），
  classic 同区仅 2 px（无动画，作对照）；脏矩形 20.6% / 6.1% 画布，
  远低于旧版全盘同步切帧 + 全屏漂移时的 99.4%。
- **代价**：帧数 3491 → 4270、每帧 994 B → 1,915 B，`invader` GitHub 图 3.5MB → 8.2MB。
  比方案预估的 4–6MB 高，主因是怪物两帧差异本身产生每帧上千像素变化 + 帧数增加；
  仍明显低于第 19 节之前的 16.8MB。把错峰改成相邻 3 列分组后仅从 8.7MB 降到 8.2MB，
  说明主因不是切换列散布，未再做牺牲动画的压缩。
- 背景重设计按用户要求暂缓；发布继续冻结。
- 前四轮改动已按主题分 5 笔提交（`c17c8db` … `b4d9d9c`），本轮改动未提交、未推送。

---

## 22. 收紧飞船横移与射击节奏（2026-11-13，第六次反馈）

**用户反馈**：飞船漂得太厉害，射击速度太慢。

**事实核对**：第 21 节按发点射后飞船几乎每发都换列，单次横移常跨十几列；
`maxTravelFrames=3` 让它用 3 帧滑过全屏，观感飘忽。每发同时要
`launch + 3 flight + impact + 2 cooldown = 7 帧`（20fps 下 350ms），节奏拖沓。

**决策**（只调 `motion.ts` 的自研参数，玩法与渲染逻辑不动）：

- `maxTravelFrames: 3 → 1`：单次横移一帧到位，不再长距离滑行；仍保留 `travel` 阶段，
  「到位才开火」的结构保证不变。
- `bulletProgressStep: 0.25 → 0.5`：弹道从 5 帧缩到 3 帧（发射 / 飞行 / 命中），
  子弹仍是逐帧上移的实体，不退回瞬发激光。
- `cooldownFrames: 2 → 0`：去掉两帧空转，射击连续。
- 每发 7 帧 → 3 帧（20fps 下 150ms）；`CONTRIB_FPS` 默认不变，
  想整体再快仍可调它（上限 50）。
- `Action` 契约、按发点射、视觉命中、怪物错峰波浪、纯色底与装饰清零一律不动。

**验收（2026-11-13 完成，产物随第 23 节一并重出）**：

- `motion.ts` 参数已收紧；`npm run golden` / `npm run check` 33 个测试全绿。
- `invader` CNB 784 帧 / 1.2MB、GitHub 1750 帧 / 3.6MB
  （此前 1864 / 4270 帧、2.6 / 8.2MB）；每发 7 → 3 帧、横移一帧到位。
  第 21 节遗留的体积代价被这次节奏收紧抵消。

---

## 23. classic 按 legacy 比例对齐节奏与飞船（2026-11-13，第七次反馈）

**用户反馈**：legacy（`8d63e8a`）的参数很好，要求把当前 `classic` 的节奏与飞船对齐 legacy。

**参数核对**（`8d63e8a:src/config.ts`）：`fps=40`、`deltaTime=3/fps=0.075s`、
`frameMs=floor(2000/fps)=50ms`；`SHIP_SPEED=12.5 格/秒` → 0.94 格/帧；
`BULLET_SPEED=7.5` → 0.56 格/帧；`SHIP_SHOOT_COOLDOWN=0.2s` → 2.7 帧；
拖尾 3 段 / 0.15 格；爆炸小 4 粒 / 0.12s、大 8 粒 / 0.4s；`TAIL_FRAMES=5`。
当前项目 20fps → 50ms/帧，与 legacy 完全一致，因此节奏可直接用「帧」表达，无需改 fps。

**归属记录（重要）**：第 1 / 6 / 9 节曾否决「沿用上游常量、节奏（`3.0/fps`、`860×230` 等）」，
legacy `config.ts` 头部也声明其数值参考 `czl9707/gh-space-shooter`。
本次由用户明确认可从**自有旧仓** `8d63e8a` 取回节奏数值，记为**主动放宽该约束**；
取回范围仅限 classic 的节奏与飞船 / 子弹 / 爆炸画法，不引入 `860×230` 画布、
`hp=1..4` 口径、column/row/random 策略或 `delta_time` 字面量。
飞船等画法本就属于第 6 节允许取用的「自有旧仓美术资产」。
`LICENSE` 只有 `h1s97x`、`NOTICE` 只写灵感致谢，均不变。

**用户选定：A 比例对齐**（不是完整照搬）。完整照搬会让帧数爆炸：
当前按发点射 439 发 / 427 次换列，若按 0.94 格/帧跨全屏需 ~18 帧/次，
travel 约 7,700 帧，加每发弹道 + 冷却约 5,700 帧，合计 ~13,400 帧
> `CONTRIB_MAX_FRAMES` 4800，动画会被截断。legacy 自己 2661 帧靠的是
「按列连续发射 + 多弹齐飞」，本轮不重写架构。

**决策**：

1. `motion.ts` 新增 `classicMotion`（classic 专用，invader 仍用第 22 节的 `defaultMotion`）：
   `shipStep=4` / `maxTravelFrames=4`（长跳 3–4 帧匀速）、`bulletProgressStep=0.25`
   （弹道 5 帧）、`cooldownFrames=1`、`tailFrames=5`。
   保持 legacy「飞船比子弹略快、有冷却、收尾等爆炸散完」的相对关系，
   帧数预算约 4,000–4,600。
2. `classic` 飞船改画 legacy 的 Galaga 风：半透明双翼三角 + 翼尖竖条 + 菱形机身
   （按 `cell` 缩放，不照搬 12px 绝对尺寸）；子弹改 3 段递减拖尾 + 4 层叠色胶囊；
   爆炸改小 4 粒 / 2 帧、大 8 粒 / 5 帧，粒子随进度缩小淡出。
3. `classicTheme.ship` / `bullet` 对齐 legacy 的 `[68,147,248]` / `[255,223,0]`；
   四档绿方块、背景、布局与 `Action` 契约不动。
4. `invader` 不做任何改动（保持第 22 节快节奏与第 21 节错峰波浪）。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  classic 回归改为验证「两套节奏分离后 classic 帧数更多」。
- 第 22 节的快节奏一并落地：`invader` CNB 784 帧 / 1.2MB、GitHub 1750 帧 / 3.6MB
  （此前 1864 / 4270 帧、2.6 / 8.2MB），每发 3 帧、单次横移一帧到位；
  第 21 节遗留的体积代价被这次节奏收紧抵消。
- `classic`：CNB 1549 帧 / 1.6MB、GitHub 3877 帧 / 4.0MB，
  低于 `CONTRIB_MAX_FRAMES` 4800（余量 923 帧）；每帧约 1,010–1,022 B、
  脏矩形 0.7–1.1% 画布、首帧 30 色。
- 目视确认：classic 飞船为 Galaga 风双翼 + 翼尖竖条 + 菱形机身，
  子弹为黄色胶囊 + 3 段拖尾，爆炸有大小两型；invader 保持错峰波浪与快节奏。
- 中段构图：invader GitHub 帧左右怪物像素 6,528 / 11,720；
  CNB 左侧仍空（P1-5，数据源 0/99，非本轮范围）。
- 归属：第 1 / 6 / 9 节约束的放宽范围已按上文记录，仅限 classic 节奏与画法；
  `LICENSE` / `NOTICE` 未改。
- 发布继续冻结；第五轮起的所有改动未提交、未推送
  （前四轮 5 笔提交 `c17c8db` … `b4d9d9c` 也仍未推送）。

---

## 24. 多弹齐飞：解除「一发一命中」的串行阻塞（2026-11-13，第八次反馈）

**用户纠正**：不是子弹太慢，而是「在前一颗子弹打到怪物之前不会再输出子弹」。
上一轮把问题误判成射速参数，给出的「均衡档」未实施、已作废。

**根因**：第 18 节的 `expand()` 把每个 `fire` 动作展开成阻塞阶段
`launch → flight×N → impact → cooldown`，一串出完才读下一个动作；
两个渲染器的 `State` 也都只有单个 `bullet` 槽。
所以任何时刻画面上最多一颗子弹 —— 这是结构限制，
调 `bulletProgressStep` / `cooldownFrames` 都不会改变。

**决策**（架构级，风格零改动）：

1. `motion.ts` 从「按动作展开阻塞阶段」改为「**按帧推进的时间线**」：
   `expand()` 产出的每帧携带「飞船所在列 / 本帧所有在飞子弹及其进度 /
   本帧到达目标需结算的 `fire`」。在飞子弹列表可同时有多颗。
2. 发射与命中解耦：新子弹按自研最小间隔 `shotInterval=2 帧` 注入，
   **不等前一颗命中**；扣血与爆炸只在该子弹的到达帧发生。
3. 保留「到位才开火」：`move` 启动的匀速横移期间不发射新的，
   但在飞子弹继续飞、可在此期间命中；横移仍受
   `shipStep` / `maxTravelFrames` 约束。
4. 弹道帧数保持现状：`classic` 5 帧、`invader` 3 帧；
   `tailFrames=5` 让爆炸散完；50ms 帧时长不变。
5. 渲染层 `State.bullet` → `bullets[]`，按帧事件重建；
   每颗子弹打谁仍由 `Action.target` 决定，渲染层不重新挑目标。
6. **视觉命中不乱序**：`domain/` 每次 `fire` 选当前列最下方活目标，
   而弹道帧数固定，所以命中顺序必然等于发射顺序，
   不会出现「后弹穿过前排」。
7. `Action` 契约、`domain/`、按发随机点射、两套画法 / 配色 / 错峰波浪 /
   纯色底、零运行时依赖一律不动。

**预期收益**：总帧数从「每发弹道帧数 × 发数」变为
「发射间隔 × 发数 + 最后一颗弹道」，帧数与体积同时下降；
画面上同时有多颗子弹，射击连续。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  回归改为验证「多颗子弹可同时在飞」「每发都在到达帧结算且命中顺序 = 发射顺序」。
- 实测（GitHub 222 目标 / 439 发）：`invader` 最大在飞 2 颗、438 帧带 ≥2 颗；
  `classic` 最大在飞 3 颗、483 帧带 ≥2 颗；`impacts` 439/439，顺序与 `fire` 完全一致。
- 四张图重出：`invader` CNB 404 帧 / 0.8MB、GitHub 886 帧 / 2.2MB；
  `classic` CNB 577 帧 / 0.9MB、GitHub 1698 帧 / 2.6MB。
  帧数较第 23 节下降约 50–60%，体积同步下降，全部 ≤ 2.7MB，远低于 4800 上限。
- 每帧字节上升（`invader` 2,512 B、`classic` 1,559 B）是因为同帧变化区域变大
  （多弹 + 爆炸叠加），但总帧数降得更多，所以总体积反而下降。
- 目视确认：同一帧可见多颗黄色胶囊在不同列飞行；classic 的 Galaga 飞船、
  invader 的错峰波浪与纯色底全部保留。CNB 左侧仍空（P1-5 数据源问题，非本轮范围）。
- 风格、画法、配色、`Action` 契约、`domain/`、零运行时依赖均未改。
- 发布继续冻结；第五轮起所有改动未提交、未推送。

---

## 25. 飞船横移改为多帧匀速滑行（2026-11-13，第九次反馈）

**用户反馈**：飞船速度还是太快，移动起来像瞬移。

**根因**：第 24 节时间线里 `defaultMotion.maxTravelFrames=1` ——
任何跨列移动都被压成 1 帧到位；`classicMotion` 是 `shipStep=4 / maxTravelFrames=4`，
长跳 4 帧跨全屏、每帧 4+ 列。两者都没有可见的匀速滑行过程。
第 22 节为压帧数把横移压到 1 帧，第 23 节的「均衡档」又因误判问题类型未实施，
飞船减速的诉求一直没落地。

**决策**（只改 `motion.ts` 的 4 个数字，风格 / 玩法 / 多弹齐飞不变）：

| 参数 | 旧 | 新 |
|---|---|---|
| `defaultMotion.shipStep` | 1.5 | 2.5 |
| `defaultMotion.maxTravelFrames` | 1 | 8 |
| `classicMotion.shipStep` | 4 | 2 |
| `classicMotion.maxTravelFrames` | 4 | 10 |

- 长跳约 7 帧（invader）/ 9 帧（classic）匀速滑行、每帧约 2 列；
  短距离仍 1–2 帧到位，不拖沓。
- 保持「到位才开火」、多弹齐飞、发射间隔 2 帧、弹道 3 / 5 帧、尾帧 5；
  `Action` 契约、`domain/`、两套画法 / 配色 / 错峰波浪、零依赖一律不动。
- **代价**：travel 帧随横移次数累加，帧数与体积上涨；实测后确认仍低于
  `CONTRIB_MAX_FRAMES` 4800，否则收紧 `maxTravelFrames`。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
- 实测（GitHub 222 目标 / 439 发、427 次换列）：`invader` 2614 帧、
  `classic` 3075 帧，均低于 `CONTRIB_MAX_FRAMES` 4800；`impacts` 439/439。
  滑行段中位数 5 / 6 帧、最长 8 / 10 帧，不再是一帧到位。
- Pillow 逐帧追踪飞船横坐标：前 40 帧里有 28–35 帧发生连续渐变位移
  （`contrib-github` 32/39、`classic-github` 35/39），确认不是瞬移。
- 四张图重出：`invader` CNB 760 帧 / 1.4MB、GitHub 2614 帧 / 5.8MB；
  `classic` CNB 846 帧 / 1.2MB、GitHub 3075 帧 / 4.0MB。
  **代价**：帧数与体积上涨（`invader` GitHub 2.2MB → 5.8MB），
  仍远低于第 19 节之前的 16.8MB。
- 多弹齐飞、到位才开火、发射间隔、弹道帧数、画法 / 配色 / 错峰波浪、
  `Action` 契约与零依赖均未改。CNB 左侧仍空（P1-5 数据源问题，非本轮范围）。
- 发布继续冻结；第五轮起所有改动未提交、未推送。

---

## 26. 背景改为克制的静态深空（2026-11-13，第十次反馈）

**用户反馈**：画面「现在很好了」，但还缺少背景；在 A / B / C 三方向中选定 **B 静态深空**。

**约束**：

- 第 25 节后飞船每帧滑行、怪物错峰波浪、多弹齐飞，逐帧变化像素已不少；
  任何逐帧漂移 / 滚动 / 脉动的背景都会把脏矩形横向拉大，
  `invader` GitHub 已 5.8MB。背景必须**全静态**。
- 第 19 节删掉的占位网格、清空十字标记、地平线光带与滚动透视线、星云、
  CRT 扫描线、三层视差星点一律不加回；用户曾明确问「这都是干什么的」。
- `classic` 不动：它是重写前极简观感的对照，第 17 节已删其星点。

**决策**：

1. `invader` 底图从纯色改为 **8 色带极淡深渐变** `[9,13,22] → [18,26,42]`
   （明度差刻意压小，不抢怪物），色带有限、不产生数百色阶。
2. 静态灰度星点 60 → **140 颗**，亮度改为**固定 4 档**（避免每颗一个灰度值
   打满调色板）；位置仍由固定种子生成、逐帧不变。
3. 新增 **1px 静态水平基准线**（`[30,42,64]`，y≈216）；无光晕、无滚动、
   无透视线，与被否掉的地平线光带划清界限。
4. 底色、渐变、星点、基准线全部在 `createBackdrop()` 里只算一次，
   之后每帧 `data.set(backdrop)` 复用 → **零差分、零逐帧开销**。
5. `ACCENT_COLORS` 预留机制不动；`Action` 契约、玩法、多弹齐飞、
   匀速滑行、画法 / 配色 / 错峰波浪、零依赖一律不动。

**验收目标**：脏矩形涨幅 < 2 个百分点（当前 `invader` 23.1%）、体积涨幅 < 5%、
首帧用色 < 120、四张图重出且 `npm run check` 全绿；目视确认渐变与星点可见但不抢主体，
画面无网格框 / 光带 / 滚动线。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  背景回归改为验证「有限色带渐变 / 分档星点 / 1px 静态基准线 / 旧装饰未回归」。
- 四张 `1024×256` 效果图与 PNG 预览统一用 2026-11-13 抓取的数据重出
  （GitHub 公开贡献页今日返回 221 个活跃日，上一轮为 222，属滚动窗口边界变化）：
  `invader` CNB 760 帧 / 1.4MB、GitHub 2619 帧 / 6.1MB；
  `classic` CNB 846 帧 / 1.2MB、GitHub 3081 帧 / 4.0MB。
- Pillow 实测：渐变顶部 `(9,13,22)` → 底部 `(18,26,42)`；
  基准线在 y=216 整行 128/128 采样命中、仅 1px；
  无绘制区域（y=240..255）跨 30 帧完全不变 → 背景全静态、零逐帧差分。
- **体积与色阶**：脏矩形 `invader` CNB 8.9% / GitHub 23.0%
  （改前 8.9% / 23.1%，涨幅≈0，达成 < 2 个百分点目标）；
  首帧用色反而从 97 / 92 降到 **62 / 64**（星点亮度由连续随机改为 4 档）；
  `classic` 色数 30、脏矩形 3.9% / 3.3% 完全不变。
  体积 `invader` CNB +3.9%、GitHub +5.5%，略超 5% 目标 ——
  主因是首帧色阶从 1 增至 13 后 LZW 索引分布变化，不是逐帧差分。
- 目视确认：极淡渐变与静态星点可见但不抢怪物；无网格框、光带、扫描线、滚动线；
  `classic` 渲染器一行未改，保持重写前极简观感。
- 发布继续冻结；本轮改动未提交、未推送（第 5–9 轮那 5 笔提交也仍未推送）。

---

## 27. classic 方块随命中退化一档（2026-11-13，第十一次反馈）

**用户反馈**：子弹打怪物每次攻击后退化一次，但 `classic` 没有。

**事实核对**：`invader/animate.ts` 用 `enemyKindOf(Math.min(3, remaining))`，
每次命中 `remaining-1` → 怪物类型与颜色降级；
`classic/animate.ts:paint()` 却只判断 `remaining > 0`，
颜色恒为 `levelOfHeat(heat)`，清空时才变 `cleared` —— 中间没有掉档。
四档绿只在开局出现一次，之后是「有 → 无」两态。

**决策**（只改 `classic` 渲染器，`domain/` / `invader` / `Action` 契约不动）：

- `theme.ts` 导出 `levelIndexOfHeat()`，`levelOfHeat()` 复用它。
- `State.byCell` 增加 `tier`（初始强度，1..3）。
- 着色公式：`base = max(levelIndexOfHeat(heat), tier - 1)`、
  `index = min(3, base - (tier - remaining))`。
  因 `remaining >= 1`，`tier - remaining <= tier - 1 <= base`，故 `index >= 0`；
  每次命中 `remaining-1` 必使 `index-1` → **严格退化一档**，
  不会出现热度太低而卡在暗档不降的情况。清空（`remaining=0`）仍用 `theme.cleared`。
- 保留 `heat` 参与初始档位（不丢「哪天贡献多」的信息），
  同时保证高血量方块从足够亮的档开始、退化可见；四档绿都能出现。
- 回归：单个方块在整段动画里应出现 ≥ 2 种绿档（改前恒为 1 种）。

**验收（2026-11-13 完成，待用户目视确认）**：

- `npm run check` 33 个测试全绿、`docs:check` 通过；黄金帧摘要重生成。
  回归新增「单个方块在整段动画里出现 ≥ 2 种绿档」（改前恒为 1 种）。
- 两张 `classic` 效果图与 PNG 预览重出（`invader` 未改、产物未动）：
  CNB 846 帧 / 1.19MB、GitHub 3081 帧 / 4.03MB；
  体积 +0.2–0.3%、脏矩形 3.9% / 3.3% 不变。
- Pillow 抽样 200+ 帧统计：四档绿在 CNB 图分别出现 210 / 206 / 182 / 203 帧、
  GitHub 图 205 / 202 / 191 / 149 帧 —— 四档都在动画过程中可见，
  不再只有开局的热度分色。
- 目视确认：方块随命中由亮绿逐档变暗，清空后转为 `cleared` 暗格；
  热度高的日子起始更亮这一信息仍保留。
- `domain/`、`invader`、`Action` 契约、背景、节奏、零依赖均未改。
- 发布继续冻结；本轮改动未提交、未推送。
