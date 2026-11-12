# 待办与已知限制

> 记录日期：2026-11-12
>
> 本文件只记**尚未改动**的事项与改法，避免结论散落在对话里丢失。
> 决策基线见 `docs/adr/0000-rewrite-baseline.md`（第 9 节验收清单、第 12~16 节执行结果），
> 迁移与归档状态见 `docs/05-migration.md`。

---

## 1. 清场顺序导致构图偏右（待改）

**状态**：未改，按约定刻意未越界
**来源**：ADR 0000 第 15 / 16 节「已知限制」

### 现象

`invader` 与 `classic` 两种渲染器的中段帧里，剩余敌人集中在画面右半边；
左侧只剩网格、清空标记（`invader`）或暗格（`classic`）与星云，构图失衡。

### 根因

`src/domain/simulate.ts` 按 `Level.waves` 的列序 `0..N` 推进动作，飞船从左往右清场。
渲染层只如实绘制 `remaining`；按 ADR 0000 第 4 节「`render/` 不 import 具体玩法」，
它无权改动作顺序。**这是玩法层决策，不是渲染缺陷。**

### 建议改法

- **A（推荐）**：在 `src/domain/rules.ts` 增加一条清场顺序规则，通过 `CONTRIB_RULE` 切换：
  按热度降序 / 从中心向两侧扩散 / 分块交错，三选一。
  **新增 rule id，不改默认 `waves`** —— 现有黄金帧与四张效果图仍可复现，
  确认效果后再决定是否换默认。
- **B（不推荐）**：渲染层做镜头跟随 / 视口滚动，不动 `domain/`。
  与用户选定的「全览大画布、全年一屏」冲突，工作量大。

### 前置与风险

- 新增 rule 符合第 3 节「加玩法 = 加注册项」，不违反基线；但要在 ADR 补一条实施记录。
- 若改默认顺序，`test/golden/mock.json` 与四张 `docs/assets/*.gif` 都要重出，
  `CHANGELOG` 记为破坏性变更。
- 静态拦截仍须生效：`domain/` 不 import `sources/`；规则文件不含上游常量 / 策略名 / 参考节奏。

### 验收

- 中段帧左右半区敌人像素比明显改善（当前严重右偏），给出量化值。
- `npm run check` 全绿；四张效果图重出并目视确认；Pillow 解码 GIF 中段帧无残影。

---

## 2. GitHub 分发端点滞后，新内容在 GitHub 侧看不到（待同步）

**状态**：未同步，缺凭据
**来源**：ADR 0000 第 12 / 16 节

### 现象

CNB 主仓 `main` = `7c6c1ec`，GitHub 分发端点 `h1s97x/space-invaders` 的
`main` / `latest` 仍停在 `f240167`。新 README、`classic` 渲染器、四张效果图
在 GitHub 侧网页均不可见。

### 根因

`sync-github.sh` 需要 `GITHUB_TOKEN`（`contents:write`），单向强推
`main` / `latest` / tags；此前签发的 PAT 已按要求吊销，本地无凭据。
CNB 主仓是唯一源，不受影响。

### 待办动作

1. 签发短期 GitHub PAT（`contents:write`），以环境变量或 600 权限文件提供，
   **不要贴进对话**。
2. 运行 `GITHUB_TOKEN=... ./sync-github.sh`，同步 `main` / `latest`。
3. 复测 `uses: h1s97x/space-invaders@v0.1.0` 的 301 与新 `action.yml` 是否生效。
4. 可选：把 `legacy/pre-rewrite` 也推到分发端点（目前只有 CNB 主仓有该分支）。
5. 核对三处 HEAD 一致，并确认 GitHub Actions CI 跑的是新代码。

### 验收

- GitHub 侧 `HEAD` 等于 CNB 主仓 `HEAD`；README 里四张图可见；CI success。
- 用完立即吊销该 PAT；本地不留副本。

---

## 不做的事

- 不为改构图而破坏现有产物的可复现性（默认 rule 保持不变，先新增再评估）。
- 不为同步分发端点而在仓库里存长期凭据或加回反向同步工作流
  （ADR 0000 第 3 节明确否决项）。
- 不把 `legacy/pre-rewrite` 分支合并回 `main`；它只作历史入口。
