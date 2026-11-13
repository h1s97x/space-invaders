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

- **【2026-11-13 更新 · 发布冻结】** 用户判定当前画面不合格，**P0-1 / P0-2 暂停**：
  先删两个渲染器的 HUD 类装饰与假分数（`SCORE / COMBO / WAVE`、进度条、`CLEAR`、
  classic 的署名与星点），保留深空分层背景、怪物与飞船建模。
  决策与范围见 `docs/adr/0000-rewrite-baseline.md` 第 17 节。
  打 tag / 发镜像 / 统一版本号一律等画面验收通过后再做。
  本轮改动已完成：本地 `npm run check` 33 个测试全绿、四张图重出，
  **尚未提交 / 推送**，CI 结果待推后确认。
- **【2026-11-13 第二轮 · 运行机制对齐】** 用户进一步判定飞船运行逻辑、子弹与射击特效
  仍不合格，要求至少对齐 legacy。按 `docs/adr/0000-rewrite-baseline.md` 第 18 节：
  行为对齐、参数自研，`Action` 契约与 `domain/` 不动，由渲染层逐帧插值；
  **背景本轮不动**（下一轮再定）。发布继续冻结。
  验收：33 个测试全绿、四张图重出（CNB 1416 帧 / GitHub 3137 帧）；
  `invader` GitHub 图 16.8MB 的体积退化已记入 P1-4；改动仍未提交 / 推送。
- **【2026-11-13 第三轮 · 视觉命中 / 中心扩散 / 装饰清零】** 用户指出子弹穿过前排、
  从左到右清场无趣、左侧网格与底部光带不知所谓。按 `docs/adr/0000-rewrite-baseline.md`
  第 19 节：规则层动态选同列最下方活目标、新增 `spread` 规则并设默认、
  删掉全部零数据装饰（P1-1 / P1-4 一并解决）。发布继续冻结。
  验收：33 个测试全绿、四张图重出（CNB 1416 帧 / GitHub 3437 帧）；
  `invader` GitHub 图 16.8MB → 3.4MB、脏矩形 99.4% → 0.4%；
  中段构图受数据分布限制（见新增 P1-5）；改动仍未提交 / 推送。
- **【2026-11-13 第四轮 · 默认改 seed 洗牌】** 用户判定中心扩散仍差，改按 `CONTRIB_SEED`
  确定性洗牌清场顺序（同一 seed 可复现、换 seed 换顺序），`spread` / `waves` 保留可回退。
  见 `docs/adr/0000-rewrite-baseline.md` 第 20 节。发布继续冻结。
  验收：33 个测试全绿、四张图重出（CNB 1506 帧 / GitHub 3491 帧，均低于 4800 上限）；
  中段剩余目标 L/R 16/104 → 35/75；改动仍未提交 / 推送。
- **全部成果已在 CNB 主仓**：`main`（交接时 `d546791`；之后每次文档提交都会前进，
  新环境一律以 `git log -1` 为准），工作区干净，33 个测试全绿，
  `docs:check` 通过，CNB CI `cnb-l4g-1k77k619n` success。
- 两个旧仓（`cnb-space-invaders`、`cnb-profile-3d-contrib`）已归档（`status: 1`），
  公告已贴、`#13` / `#18` 已带结论关闭；重写前历史保存在 `legacy/pre-rewrite`（`8d63e8a`）。
- **剩余两件最紧急的人工动作**（详见第 4 节 P0）：
  1. 打 `v*` tag 触发 `.cnb.yml` 发布插件镜像 —— 目前 `space-invaders:latest` **根本不存在**。
  2. 统一版本号并补 tag —— 文档引用的 `uses:...@v0.1.0` 这个 ref **不存在**。
- **第 3 件已完成**（2026-11-12 晚）：用 GitHub PAT 同步了分发端点
  （同步时 `main` / `latest` = `206c9d3`，后续提交以 `git ls-remote` 为准），
  并补推 `legacy/pre-rewrite`；GitHub Actions CI success。详见 P0-3 / P2-2。
- **安全**：本次对话里明文出现过 3 个令牌（两个 CNB、一个 GitHub），
  其中 GitHub PAT 刚用于同步；本地副本已删，但都应视为已泄露，
  **必须立即在平台侧吊销/轮换**。

---

## 1. 关键坐标与凭据（环境恢复用）

| 项 | 值 / 状态 |
|---|---|
| 唯一源（CNB 主仓） | `https://cnb.cool/h1s97x/plugins/space-invaders`（交接时 `main = d546791`，以 `git log -1` 为准） |
| 本地 `git remote` | 仍是旧 slug `.../gh-space-invaders.git`，靠 301 重定向工作；**新环境请 clone 新 slug** |
| 历史分支 | `legacy/pre-rewrite` → `8d63e8a`（CNB 主仓 + GitHub 分发端点都有） |
| tag | **无任何 tag**（`git ls-remote --tags origin` 为空） |
| GitHub 分发端点 | `h1s97x/space-invaders`，`main` / `latest` 已同步（同步时 `206c9d3`，以 `git ls-remote` 为准；仍无 tag） |
| 制品库新镜像 | `docker.cnb.cool/h1s97x/plugins/space-invaders:latest` —— **未发布** |
| 制品库旧镜像 | `docker.cnb.cool/h1s97x/plugins/cnb-space-invaders:latest` —— 仍可拉取（归档后冻结） |
| 两个旧仓 | `status: 1` 已归档、只读 |
| CNB CI | 每次 push 跑 `npm run check` + 镜像契约检查 + mock 冒烟，最新 success |

**凭据状态（交接时）**

- `CNB_TOKEN`：环境内置，**流水线临时令牌**。可读日历、写 issue/评论、push 代码；
  **归档等仓库管理接口会 403**（缺 `repo-code:rw,repo-manage:rw`），需个人访问令牌。
- `CNB_API_ENDPOINT`：`https://api.cnb.cool`。
- `GITHUB_TOKEN` / `GH_TOKEN`：**无**（环境变量未设置）；本次同步用 600 权限临时文件里的
  PAT 完成，文件已删除。`sync-github.sh` 仍需要 `contents:write` 的 PAT。
- 个人 CNB PAT、GitHub PAT：本次签发并使用过，**必须吊销**；仓库内容里扫不到任何令牌字符串。
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
- 四张 `1024×256` 真数据效果图（两渲染器 × 两平台）+ 四张 PNG 预览已入库 `docs/assets/`
  （2026-11-13 用新渲染器重出，见 ADR 0000 第 17 节）。
- 两个渲染器的 HUD 类装饰与假分数已全部移除，深空分层背景、怪物 / 飞船建模保留。
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

> **【2026-11-13】P0-1 / P0-2 冻结中**：画面按 ADR 0000 第 17 节重做完成，
> 尚待用户目视验收；验收通过前不打 tag、不发镜像。其余 P1 / P2 照旧。
> P0-3 与 P2-2 已完成。

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

### P0-3 · GitHub 分发端点同步 —— 已完成（2026-11-12 晚）

**执行**：用户提供有效 GitHub PAT（`scopes: repo, user, workflow`，目标仓 `push=true`），
运行 `sync-github.sh` 同步 `main` / `latest`，并单独推送 `legacy/pre-rewrite`。
**实测**（同步完成时快照，后续文档提交会让 HEAD 前进）：三处 `HEAD` 均为 `206c9d3`；
分发端点分支为 `main` / `latest` / `legacy/pre-rewrite`（后者 = `8d63e8a`）；
GitHub Actions `CI` 在 `206c9d3` 上 `completed / success`。

**仍未做（不阻塞下班）**：
- 旧 `uses:` 的 301 与新 `action.yml`（container action）在真实工作流里跑一次，见 P1-2。
- P0-2 打 tag 后需再跑一次 `sync-github.sh` 把 tag 带过去（当前 `tags [none]`）。
- **立即吊销本次使用的 GitHub PAT**（明文出现在对话中）。

### P1-1 · 清场顺序与视觉命中 —— 已完成（2026-11-13，ADR 0000 第 19、20 节）

`CONTRIB_RULE=shuffle` 已是默认：按 `CONTRIB_SEED` 洗牌列序（第 20 节把默认从
`spread` 换掉）；`spread` / `waves` 保留为可回退项。
`domain/simulate.ts` 每次 `fire` 动态选同列 `row` 最大（最下方）的活目标，
子弹不再穿过前排打后面的怪物。回归已锁住列序与命中顺序，黄金帧与四张图已重出。
残留的数据分布问题另见 P1-5。

### P1-2 · 平台内真数据端到端未跑

**背景**：CNB CI 与 GitHub Actions CI 都只跑 `npm run check` + `mock` 10 帧冒烟；
真数据 `source=cnb` / `source=github` 的完整动画只在**本机**生成过。
分发端点已同步到新代码，但**无任何 tag**，`uses:@v0.x` 仍不可解析，
container action 在真实工作流里**从未运行过**。
**动作**：P0-1/P0-2 完成后，在示例仓库各跑一次真实流水线
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

### P1-4 · 背景与零数据装饰 —— 已完成（2026-11-13，ADR 0000 第 19 节）

渐变、星云、CRT 扫描线、地平线光带与滚动透视线、网格框与清空列十字标记、
三层视差星点、飞船残影、尾焰、全盘精灵切帧全部删除；
改为纯色底 + 60 颗固定灰度星点，只留怪物 / 飞船 / 子弹 / 爆炸四类数据层。
`ACCENT_COLORS` 精简为 10 个主题色。

体积实测（`contrib-github`，3437 帧）：16.8MB → 3.4MB，每帧 5,360 B → 992 B，
脏矩形 99.4% → 0.4% 画布，首帧用色 177+ 色阶 → 91 色。
重写前 `8d63e8a:demo.gif` 是 `860×230` / 2661 帧 / 4.1MB，现已明显低于它。

### P1-5 · CNB 图左侧天然空白（数据源问题，非清场顺序）

**已缓解**：第 20 节把默认清场顺序改为 `CONTRIB_SEED` 洗牌后，GitHub 图中段
左右怪物像素 6,184 / 11,072（此前 2,504 / 16,256），按目标数 L/R 16/104 → 35/75，
怪物散布整个画布宽度。中心扩散与按活跃度加权都已弃用，不必再调顺序。

**仍存在**：CNB 图中段帧左侧仍 0 个怪物像素。诊断确认 CNB 数据源的 99 个目标
**初始 L/R = 0 / 99**，全部落在右半画面 —— 早期周没有任何目标，
清场顺序不可能让左侧出现不存在的怪物。

**动作（下一轮）**：核查 `src/sources/cnb.ts` 的取数窗口与
`src/contract/calendar.ts` 的 `rollingWindow` / `buildLevel` 列坐标对齐，
确认 CNB 是否只返回近 N 周数据；若要「全年一屏」，应把取数窗口补齐到 53 周
（稀疏补零），而不是继续改渲染层。本轮按用户要求只换顺序，未越界改 `sources/`。
**验收**：CNB `Level` 的目标列覆盖左右两侧，中段帧左右都有怪物。

### P2-1 · 坐标与文档复核

- 本地 `git remote` 仍是旧 slug，靠 301；新环境一律用 `space-invaders.git`。
- `plugin-meta.json` 的 `images` 指向 `/-/packages`，但制品库尚无镜像（随 P0-1 解决）。
- `examples/pipelines/cnb.yml` 的镜像坐标在 P0-1 前不可用。
- `README` 里 `npm run check` 标注 33 个测试；新增测试后记得同步该数字。
- `SECURITY.md` 的私密漏洞链接指向 `h1s97x/space-invaders`（已改），可顺手确认。

### P2-2 · 分发端点补历史分支 —— 已完成

`legacy/pre-rewrite`（`8d63e8a`）已推到 GitHub 分发端点，
`git ls-remote --heads https://github.com/h1s97x/space-invaders.git` 可见。
两端都有重写前历史，旧 `main` 被强推覆盖的问题已消除。

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
真数据 CNB 99 目标 / 1506 帧（2026-11-13 抓取），GitHub 222 目标 / 3491 帧。

**验证 GIF 正确性的固定做法**（避免再次出现「渲染好看但 GIF 全黑」）

1. Pillow 解码中段帧并生成 PNG，目视确认网格 / 精灵 / 飞船 / 星云都在，
   顶部留白无 HUD 文字或进度条。
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
