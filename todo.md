# 待办与交接记录

> 最后更新：2026-11-12
>
> **背景**：本次工作环境会销毁。本文件是跨环境的唯一交接入口 —— 所有未完成事项、
> 关键坐标、决策摘要、环境重建方法都写在这里，不依赖对话上下文、本地临时文件或记忆。
> **唯一持久位置**：CNB 主仓 `h1s97x/plugins/space-invaders` 的 `main` 分支（本文件已提交推送）。
> 本地的 `dist/`、`node_modules/`、临时凭据、Python 包、`/tmp` 数据全部会随环境消失。
>
> 决策基线：`docs/adr/0000-rewrite-baseline.md`（第 1~9 节决策与验收清单、第 10 节计划、
> 第 11~16 节实施记录）。迁移归档：`docs/05-migration.md`。归属核验：`docs/04-rewrite-record.md`。
> 契约：`docs/02-contract.md`。扩展指南：`docs/03-extending.md`。

---

## 0. 下班前速览

- **全部成果已在 CNB 主仓**：`main = d546791`，工作区干净，33 个测试全绿，
  `docs:check` 通过，CNB CI `cnb-l4g-1k77k619n` success。
- 两个旧仓（`cnb-space-invaders`、`cnb-profile-3d-contrib`）已归档（`status: 1`），
  公告已贴、`#13` / `#18` 已带结论关闭；重写前历史保存在 `legacy/pre-rewrite`（`8d63e8a`）。
- **三件最紧急的人工动作**（详见第 4 节 P0）：
  1. 打 `v*` tag 触发 `.cnb.yml` 发布插件镜像 —— 目前 `space-invaders:latest` **根本不存在**。
  2. 统一版本号并补 tag —— 文档引用的 `uses:...@v0.1.0` 这个 ref **不存在**。
  3. 用新的 `contents:write` PAT 同步 GitHub 分发端点（仍停在 `f240167`）。
- **安全**：本次对话里明文出现过 3 个令牌（两个 CNB、一个 GitHub），
  本地副本已删，但都应视为已泄露，需在平台侧吊销/轮换。

---

## 1. 关键坐标与凭据（环境恢复用）

| 项 | 值 / 状态 |
|---|---|
| 唯一源（CNB 主仓） | `https://cnb.cool/h1s97x/plugins/space-invaders`，`main = d546791` |
| 本地 `git remote` | 仍是旧 slug `.../gh-space-invaders.git`，靠 301 重定向工作；**新环境请 clone 新 slug** |
| 历史分支 | `legacy/pre-rewrite` → `8d63e8a`（只在 CNB 主仓） |
| tag | **无任何 tag**（`git ls-remote --tags origin` 为空） |
| GitHub 分发端点 | `h1s97x/space-invaders`，`main` / `latest` = `f240167`（滞后） |
| 制品库新镜像 | `docker.cnb.cool/h1s97x/plugins/space-invaders:latest` —— **未发布** |
| 制品库旧镜像 | `docker.cnb.cool/h1s97x/plugins/cnb-space-invaders:latest` —— 仍可拉取（归档后冻结） |
| 两个旧仓 | `status: 1` 已归档、只读 |
| CNB CI | 每次 push 跑 `npm run check` + 镜像契约检查 + mock 冒烟，最新 success |

**凭据状态（交接时）**

- `CNB_TOKEN`：环境内置，**流水线临时令牌**。可读日历、写 issue/评论、push 代码；
  **归档等仓库管理接口会 403**（缺 `repo-code:rw,repo-manage:rw`），需个人访问令牌。
- `CNB_API_ENDPOINT`：`https://api.cnb.cool`。
- `GITHUB_TOKEN` / `GH_TOKEN`：**无**。`sync-github.sh` 需要 `contents:write` 的 PAT。
- 个人 CNB PAT、GitHub PAT：本次签发过，**用完后要求吊销**；本地临时文件已删除，
  仓库内容里扫不到任何令牌字符串。
- `cnb` CLI 已登录，Token 来源就是 `CNB_TOKEN` 环境变量；个人 PAT 可用
  `CNB_TOKEN=<pat> cnb ...` 临时覆盖。

**新环境恢复命令**

```bash
git clone https://cnb.cool/h1s97x/plugins/space-invaders.git && cd space-invaders
npm ci
npm run check                 # typecheck + 33 个测试 + docs:check
npm run build
docker build -t space-invaders:local .
CONTRIB_SOURCE=mock CONTRIB_MAX_FRAMES=10 CONTRIB_OUTPUT=/tmp/smoke.gif \
  node dist/src/cli/index.js
```

**提交与推送的两个环境陷阱**（否则会卡住）

```bash
# 仓库启用了 cnb-gpgsign，作者与内置令牌用户不一致会 403：必须 --no-gpg-sign
git -c user.name=h1s97x -c user.email=1297656998@outlook.com commit --no-gpg-sign -m "..."

# push 用 CLI 提供的凭据 helper（不要改全局 git config）
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper \
GIT_CONFIG_VALUE_0='!cnb git-credential' git push origin HEAD:main
```

`sync-github.sh` 对分发端点用 `git push --force` 单向覆盖 `main` / `latest` / tags，
不会碰其它分支（这是设计，但因此**必须先有归档分支再同步**，见 `legacy/pre-rewrite`）。

---

## 2. 已完成快照（别重复做）

- 阶段 0~5 全部执行完毕，`docs/adr/0000-rewrite-baseline.md` 第 9 节 10 条验收清单**全部打勾**。
- 平台无关内核：`contract/` / `sources/` / `domain/` / `render/` / `cli/` 五层，
  三张注册表，**零运行时依赖**（devDeps 仅 `typescript` + `@types/node`）。
- 四个数据源 `github` / `cnb` / `file` / `mock`；两个渲染器 `invader`（默认）/`classic`；
  `CONTRIB_RENDERER` 显式枚举切换。
- 自研 codec：手写光栅、调色板量化（含 `reserve` 预留色）、GIF89a + LZW、
  脏矩形差分 + 处置方式 1（保留上一帧）。
- `args.ts` 单点声明 → `docs:check` 拒绝文档漂移；黄金帧摘要锁定 10 帧 mock 产物。
- 四张 `1024×256` 真数据效果图（两渲染器 × 两平台）+ 四张 PNG 预览已入库 `docs/assets/`。
- 双平台契约：`action.yml`（container action）、`plugin-meta.json`、`entrypoint.sh`
  （`PLUGIN_*` → `CONTRIB_*` 前缀归一）、`.cnb.yml`、`.github/workflows/ci.yml`、
  `sync-github.sh`、两段示例 YAML。
- 两个旧仓迁移公告、issue 关闭、归档；空仓 `cnb-profile-3d-contrib` 一并归档。
- 重写前历史独立分支 `legacy/pre-rewrite`（含 `src/engine.ts`、`demo.gif`、32 个旧测试）。

---

## 3. 关键决策摘要（细节见 ADR，不要凭印象改）

1. **不是合并两个旧仓，是整体重写**；两个旧仓只是行为参考 / 待归档资产 / 迁移来源。
2. **代码与玩法设计 100% 自有**：不继承 `czl9707/gh-space-shooter` 的常量、坐标系、
   三种策略、节奏；只搬入自己手写的 `raster/pixels/gif` 约 660 行编解码器，
   以及两个自有旧仓的美术画法（字形、外星人轮廓、飞船/星空/爆炸，见 `04-rewrite-record.md` 第 6 节）。
3. **零平台内核**：镜像只写 GIF 文件、只认 `CONTRIB_*`，不写 `GITHUB_OUTPUT` /
   `##[set-output`，无 `platform ===` 判断；平台差异只在两侧 YAML 与 `entrypoint.sh`。
4. **CNB 是唯一主仓，GitHub 仅作 `uses:` 分发端点**，单向同步，禁止反向工作流。
5. 用户选定的画面方向：**全览大画布**（`1024×256`、53 列 × 16px）+ **深空分层背景**；
   外加 `classic` 渲染器保留重写前的绿方块观感。
6. 分层硬约束：`domain/` 不 import `sources/`，`render/` 不 import 具体玩法，
   层间只过自研 `Calendar` / `Level` / `Action`；加平台/加输出 = 加注册项。
7. 默认规则 `waves`、默认渲染器 `invader` 都保持可复现；改默认视为破坏性变更。
8. `LICENSE` 只有 `h1s97x`，`NOTICE` 只写灵感致谢。

---

## 4. 未完成事项（按优先级，含背景）

### P0-1 · 新插件镜像从未发布（新发现，最紧急）

**现象**：`docker manifest inspect docker.cnb.cool/h1s97x/plugins/space-invaders:latest` 失败；
`examples/pipelines/cnb.yml` 与 `plugin-meta.json` 指向的坐标目前拉不到。
**根因**：`.cnb.yml` 的发布流水线挂在 `v*: tag_push` 上，而仓库**没有任何 tag**，
所以 `build-and-push` 阶段从未触发过。旧镜像（`cnb-space-invaders:latest`）还在，但已冻结。
**影响**：CNB 侧用户按示例写流水线会直接失败；这是「归档旧仓 + 新镜像坐标迁移」里最实质的一环。
**动作**：确定版本号 → 打 `v*` tag 并推送 → 等 `.cnb.yml` 的 `publish-plugin-image` 成功 →
`docker manifest inspect` 确认 `:latest` 与版本 tag 都可拉取 → 必要时手动构建补推。
**验收**：新镜像可拉取；`examples/pipelines/cnb.yml` 能跑通一次；旧镜像仍可拉取。

### P0-2 · 版本与 tag 不一致，`@v0.1.0` 引用不存在（新发现）

**现象**：`package.json` 是 `0.1.0`，`CHANGELOG.md` 最新是 `0.4.0`；
`README.md` 第 88 行与 `examples/pipelines/github-actions.yml` 第 16 行写
`uses: h1s97x/space-invaders@v0.1.0`，但 `git ls-remote --tags` 为空。
`sync-github.sh` 用 `git describe --tags` 找 tag，无 tag 时 `TAGS=none`，分发端点也永远没 tag。
**影响**：GitHub Action 示例照抄必然失败；版本号三处不一致。
**动作（需先定版本，建议统一到 `0.4.0`）**：同步 `package.json`、README/示例的 `uses:`
引用、`CHANGELOG` → 打 `v0.4.0` tag → 推 CNB 主仓 → 同步 tag 到分发端点。
**验收**：`git ls-remote --tags origin` 有 `v0.4.0`；`uses:...@v0.4.0` 可解析；三处版本号一致。
**关联**：这一条做完才能做 P0-1（tag 同时是镜像发布触发器）。

### P0-3 · GitHub 分发端点滞后（原待办，扩展）

**现象**：CNB 主仓 `main = d546791`，分发端点 `main` / `latest` = `f240167`；
新 README、`classic` 渲染器、四张图在 GitHub 侧网页都看不到。
**根因**：`sync-github.sh` 需要 `contents:write` 的 `GITHUB_TOKEN`；此前签发的 PAT 已吊销，
本地无凭据。CNB 主仓是唯一源，不受影响。
**动作**：
1. 签发短期 PAT（`contents:write`），用环境变量或 600 权限文件提供，**不要贴进对话**。
2. `GITHUB_TOKEN=... ./sync-github.sh`，同步 `main` / `latest`（以及 P0-2 之后的 tag）。
3. 复测旧 `uses:` 的 301 与新 `action.yml`（container action）是否生效。
4. 可选：把 `legacy/pre-rewrite` 也推到分发端点（目前只有 CNB 主仓有）。
5. 核对三处 HEAD 一致、GitHub Actions CI 跑的是新代码。
**验收**：GitHub `HEAD` == CNB `HEAD`；README 四张图可见；CI success；用完吊销 PAT。

### P1-1 · 清场顺序导致构图偏右（原待办）

**现象/背景**：`invader` 与 `classic` 的中段帧里，剩余敌人集中在右半边，
左侧只剩网格、清空标记 / 暗格与星云，构图失衡。
**根因**：`src/domain/simulate.ts` 按 `Level.waves` 的列序 `0..N` 推进，飞船从左往右清场；
渲染层只如实绘制 `remaining`，按 ADR 第 4 节无权改动作顺序。**这是玩法层决策，不是渲染缺陷。**
**推荐改法**：在 `src/domain/rules.ts` **新增 rule id**（`CONTRIB_RULE` 切换，热度降序 /
中心扩散 / 分块交错三选一），**不改默认 `waves`**，保证黄金帧与四张图仍可复现；
确认效果后再决定是否换默认。镜头跟随 / 视口滚动与「全览大画布」冲突，不推荐。
**前置风险**：新增 rule 不违反基线但要在 ADR 补记录；若改默认，`test/golden/mock.json`
与四张 GIF 都要重出，`CHANGELOG` 记破坏性变更；静态拦截仍须生效。
**验收**：中段帧左右半区敌人像素比明显改善（给量化值）；`npm run check` 全绿；
四张图重出且 Pillow 解码无残影。

### P1-2 · 平台内真数据端到端未跑

**背景**：CNB CI 与 GitHub Actions CI 都只跑 `npm run check` + `mock` 10 帧冒烟；
真数据 `source=cnb` / `source=github` 的完整动画只在**本机**生成过。
GitHub 侧 container action 因分发端点滞后 + 无 tag，**从未真正运行过**。
**动作**：P0-1/P0-2/P0-3 完成后，在示例仓库各跑一次真实流水线
（GitHub `uses:@v0.4.0`、CNB `examples/pipelines/cnb.yml`），确认容器入口、
`runs.env` / `PLUGIN_*` 前缀归一、产物落盘与提交都正常。
**验收**：两侧各一次真数据端到端，产物 GIF 可解码。

### P1-3 · `source=github` 的完整图不是 GraphQL 真数据

**背景**：当前 `docs/assets/contrib-github.gif` 与 `classic-github.gif` 用的是
GitHub 公开贡献页（无需 PAT）解析出的 369 天 / 9,420 次贡献，归一成
`calendar.json` 后走 `file` 源生成；`source=github` 的 GraphQL 路径只在有 PAT 时
跑过 10 帧冒烟（221 个目标，与公开页的 222 差 1 天，是滚动窗口边界）。
**动作**：拿到新 PAT 后用 `CONTRIB_SOURCE=github` 重出一次完整图，与现有图对比。
**验收**：两条路径的 `Calendar` 在相同窗口内一致；差异只能是窗口边界。

### P2-1 · 坐标与文档复核

- 本地 `git remote` 仍是旧 slug，靠 301；新环境一律用 `space-invaders.git`。
- `plugin-meta.json` 的 `images` 指向 `/-/packages`，但制品库尚无镜像（随 P0-1 解决）。
- `examples/pipelines/cnb.yml` 的镜像坐标在 P0-1 前不可用。
- `README` 里 `npm run check` 标注 33 个测试；新增测试后记得同步该数字。
- `SECURITY.md` 的私密漏洞链接指向 `h1s97x/space-invaders`（已改），可顺手确认。

### P2-2 · 可选：分发端点补历史分支

`legacy/pre-rewrite` 目前只在 CNB 主仓；若希望 GitHub 侧也能检出旧实现，
在 P0-3 有 PAT 时显式推一次该分支即可。

---

## 5. 环境临时资产与重建方法（销毁后要重装）

| 项 | 交接时版本 / 状态 | 用途 |
|---|---|---|
| Node / npm | `v24.22.2` / `11.19.1`（项目要求 ≥22） | 编译、测试、CLI |
| Pillow | `13.0.0`，`python3 -m pip install --break-system-packages pillow` | 解码 GIF 生成 PNG 预览、统计像素（验证脏矩形与特效） |
| PyYAML | `python3 -m pip install --break-system-packages pyyaml` | 校验 5 份 YAML 语法 |
| docker / `cnb` CLI | 均可用，CLI 已登录（`CNB_TOKEN`） | 镜像构建、远端仓库操作 |

**GitHub 公开贡献数据（无 PAT 也能拿到，用于生成 GitHub 效果图）**

```bash
curl -sS -o /tmp/gh-contrib.svg https://github.com/users/h1s97x/contributions
# 解析：data-date="YYYY-MM-DD" 与 tool-tip 里的 "N contributions on ..." / "No contributions on ..."
# 生成 { from, to, total: 0, days: [{ date: "YYYYMMDD", metrics: { commits: N, ... } }] }
# 窗口 from/to 用所有日期键的 min/max（不要用 dates[0]/dates[-1]，多年度区块不是有序的）
CONTRIB_SOURCE=file CONTRIB_CALENDAR=/tmp/gh-calendar.json \
  CONTRIB_OUTPUT=docs/assets/contrib-github.gif node dist/src/cli/index.js
```

**四张效果图的生成命令**（临时预览脚本已删，需要时按上述格式重建）

```bash
# invader（默认）
CONTRIB_SOURCE=cnb CONTRIB_USER=h1s97x CONTRIB_TOKEN="$CNB_TOKEN" \
  CONTRIB_ENDPOINT="${CNB_API_ENDPOINT:-https://api.cnb.cool}" \
  CONTRIB_OUTPUT=docs/assets/contrib-cnb.gif node dist/src/cli/index.js
# classic
CONTRIB_RENDERER=classic CONTRIB_SOURCE=file CONTRIB_CALENDAR=/tmp/gh-calendar.json \
  CONTRIB_OUTPUT=docs/assets/classic-github.gif node dist/src/cli/index.js
# 预览：Pillow 打开 GIF、seek 到首帧或中段帧、convert('RGBA').save(...png)
```

默认画布 `1024×256`、`scale=1`；`CONTRIB_RENDERER=invader|classic`；
真数据 CNB 98 目标 / 301 帧，GitHub 222 目标 / 668 帧。

**验证 GIF 正确性的固定做法**（避免再次出现「渲染好看但 GIF 全黑」）

1. Pillow 解码中段帧并生成 PNG，目视确认网格 / HUD / 精灵 / 飞船 / 星云都在。
2. 统计暖色像素，确认激光 / 尾焰 / 爆炸没有被调色板挤掉（预留色机制）。
3. 数 GCE 帧数、检查 `GIF89a` 头、逻辑屏尺寸、Trailer。
4. 若改了 `graphicControl`，确认 disposal 是 1（保留上一帧），不是 2（恢复背景）。

---

## 6. 不做的事（约束）

- 不为改构图而破坏现有产物可复现性（默认 rule 保持不变，先新增再评估）。
- 不在仓库里存长期凭据，也不加回反向同步工作流（ADR 0000 第 3 节否决项）。
- 不把 `legacy/pre-rewrite` 合并回 `main`；它只作历史入口。
- 不重新引入 `@napi-rs/canvas` / `gifenc` 或任何运行时依赖；不复制上游玩法设计。
- 不为「跑通」绕过 ADR：与本文件 / ADR 冲突的提案，先改文档再改代码。
