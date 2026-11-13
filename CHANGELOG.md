# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased] - 2026-11-13

### ⚠️ 破坏性变更（画面产物）

- **移除所有 HUD 类装饰**：`invader` 的 `SCORE / COMBO / WAVE`、进度条、结束 `CLEAR`；
  `classic` 的 `SCORE`、署名、星点、结束 `CLEAR`。这些数值由渲染层编造，与贡献数据无关，
  详见 [ADR 0000 第 17 节](docs/adr/0000-rewrite-baseline.md)。
- 5×7 点阵字形随之移除；`Theme` 的 `hud` / `hudDim` / `hudHeight` 分别删除或改名为
  `clearedMark` / `topInset`，`Layout.hudY` 删除；调色板预留色里的 `hud` 换成 `clearedMark`。
- 渲染产物字节变化：`test/golden/mock.json` 已重生成，四张效果图与四张 PNG 预览已重出。

### 变更

- **运行机制对齐 legacy 的行为模型**（[ADR 0000 第 18 节](docs/adr/0000-rewrite-baseline.md)）：
  新增 `src/render/motion.ts`，把 Action 展开成
  `travel（匀速到位）→ launch → flight → impact → cooldown → tail` 逐帧阶段。
  飞船停稳才开火，子弹是逐帧上移的实体（黄色胶囊 + 3 段递减拖尾），
  **命中才**扣血并触发大 / 小爆炸；整条瞬发激光移除。
  `Action` 契约与 `domain/` 一行未改，参数以帧为单位、全部自研，
  不引入上游速度 / 时间步长 / 节奏常量。
- 该轮先保留深空分层背景、怪物与飞船建模；`classic` 同步对齐逐帧阶段。
  背景随后在第 19 节全部移除，此处仅为过程记录。
- 回归改为验证「不含 HUD / 不含瞬发激光」、阶段顺序（到位 → 发射 → 飞行 → 命中）、
  子弹胶囊与两渲染器阶段数一致；`npm run check` 33 个测试全绿。
- 中途出现的体积退化（`invader` GitHub 图曾到 16.8MB）已由第 19 节的装饰清零解决，
  最终数据见下方。
- **视觉命中 + 中心扩散 + 装饰清零**（[ADR 0000 第 19 节](docs/adr/0000-rewrite-baseline.md)）：
  `domain/simulate.ts` 每次 `fire` 动态选同列最下方活目标，子弹不再穿过前排；
  新增 `spread` 规则并设为默认（`CONTRIB_RULE=waves` 可回退旧逐列行为）。
  删掉渐变 / 星云 / 扫描线 / 地平线光带与透视线 / 网格框与清空标记 /
  三层视差星点 / 飞船残影 / 尾焰 / 全盘精灵切帧，改为纯色底 + 静态稀疏星点；
  保留怪物、飞船、子弹、爆炸四类数据层，`ACCENT_COLORS` 精简为 10 个主题色。
- **改默认规则属破坏性变更**：`CONTRIB_RULE` 默认从 `waves` 改为 `spread`，
  `args.ts` / README 参数表 / `docs/02-contract.md` 已同步。
- 四张图重出：CNB 1416 帧 / 1.4MB，GitHub 3437 帧 / 3.4MB（invader）；
  脏矩形 99.4% → 0.4% 画布、每帧 5,360 B → 992 B，GitHub 图 16.8MB → 3.4MB。
- **默认清场顺序改为 seed 洗牌**（[ADR 0000 第 20 节](docs/adr/0000-rewrite-baseline.md)）：
  用户判定中心扩散效果仍差。`CONTRIB_RULE` 默认从 `spread` 改为 `shuffle`，
  由 `CONTRIB_SEED` 经自研 xorshift + Fisher-Yates 打乱有目标列的顺序 ——
  同一 seed 可复现、换 seed 换顺序；`spread` / `waves` 保留可回退。
  视觉命中（同列先打最下方活目标）不变。
- 四张图重出：CNB 1506 帧 / 1.5MB，GitHub 3491 帧 / 3.5MB（invader）；
  动画中段剩余目标 L/R 从 16/104 改善到 35/75，帧数仍低于 4800 上限。
- **发布冻结**：打 tag 与发布镜像等画面验收通过后再执行；`package.json` 与示例 `uses:`
  的版本号仍未统一（见 `todo.md` P0-1 / P0-2）。

## [0.4.0] - 2026-11-12

### 新增

- **`classic` 渲染器**：还原重写前「贡献绿方块方阵」的观感（深黑底、星点、四档绿、
  `SCORE` / `@h1s97x` HUD、蓝色小飞船）。与 `invader` 并存，
  `CONTRIB_RENDERER=classic|invader` 切换；两者共享同一份 `Calendar` / `Level` / `Action`
  契约，`domain/`、`sources/`、`cli/`、平台契约零改动，零新增依赖。
- **`legacy/pre-rewrite` 分支**：保存重写前最后一个提交 `8d63e8a`
  （含 `src/engine.ts`、`demo.gif`、旧 README 与 32 个回归测试），随时可检出运行。

### 变更

- `CONTRIB_RENDERER` 改为显式枚举，非法值报错不静默回落。
- 新增 3 个 classic 回归测试（共 33 个）；四张效果图（两渲染器 × 两平台）入库。

### 说明

`sync-github.sh` 对 GitHub 分发端点的 `main` / `latest` 使用 `--force`（单向镜像），
CNB 主仓一直是普通 fast-forward push，历史完整；归档分支只在唯一源（CNB 主仓）维护。

## [0.3.0] - 2026-11-12

### ⚠️ 破坏性变更

- 默认画布 `512×128 → 1024×256`，`CONTRIB_SCALE` 默认 `2 → 1`（产物尺寸仍为 1024×256）。

### 变更（按用户选定的「全览大画布 + 深空分层」重做）

- 53 列 × 16px 网格水平居中；8×8 精灵每点正好 2px，去掉 `Math.ceil` 造成的
  16px 画进 9px 格子、相邻怪物互相覆盖的硬缺陷（怪物不再糊）。
- 新增 `src/render/invader/backdrop.ts`：16 级渐变 + 星云光斑 + 固定色扫描线 +
  三层视差星点 + 地平线光带与滚动透视线。
- 飞船轨迹：每帧持续滑行、残影、抖动尾焰、从飞船到目标的完整激光束与命中闪光。
- **调色板预留色**：`buildPalette` / `buildPaletteFromFrames` 增加第三参数，CLI 预留
  13 个主题特效色。深空渐变的数百种色阶原本会把低频暖色挤出 255 色表，
  导致激光/尾焰/爆炸在 GIF 里完全消失；实测量化后暖色像素 `0 → 289`。
- 新增 6 个渲染回归测试（共 30 个）：16px 格子、精灵不溢出、残影/尾焰/激光、分层背景、
  预留色保真。

## [0.2.0] - 2026-11-12

### ⚠️ 破坏性变更

- 默认画布从 `240×80` 改为 `512×128`，产物尺寸从 `480×160` 变为 `1024×256`
  （`CONTRIB_WIDTH` / `CONTRIB_HEIGHT`、`action.yml`、契约文档同步）。

### 变更（画面重做）

- 渲染层 v2：8×8 三型两帧像素外星人、菱形机身 + 半透明机翼、子弹拖尾、粒子爆炸、
  视差星空、HUD（分数 / 连击 / 波次 / 进度条）、已清空列标记；裁掉 `rest` 空转帧。
- 修复首版三个视觉缺陷：一年 53 列被压成 1px 竖线、飞船三角形塌成一个点、中段帧空白。
- GIF 改用脏矩形差分，处置方式从 2（恢复背景）改为 1（保留上一帧）：
  CNB 图 5.8MB → 1.5MB，GitHub 图 17MB → 3.4MB。
- 新增 5 个渲染回归测试（共 27 个），并用 Pillow 解码中段帧确认无残影。

## [0.1.0] - 2026-11-12

### ⚠️ 破坏性变更

- **按 [ADR 0000](docs/adr/0000-rewrite-baseline.md) 整体重写**：从「按平台各做一套」改为
  「一份平台无关镜像 + 可插拔数据源」。旧的 `gh-space-invaders` / `cnb-space-invaders`
  两套实现均不作为代码基线，详见 [05 迁移](docs/05-migration.md)。
- 参数从 CLI Flags 改为 `CONTRIB_*` 环境变量；产物只写一个文件，不再输出平台变量。
- 玩法改为自研「波次 + 热度 + 连击」，不沿用任何参考项目的常量、坐标系或策略。

### 新增

- 零运行时依赖：手写光栅化、调色板量化、GIF89a + LZW 编码。
- 四个数据源：`github`（GraphQL）/ `cnb`（活跃日历 REST）/ `file` / `mock`。
- 三张注册表（source / rule / renderer），加平台或加输出只改一个模块。
- `docs:check` 由 `src/cli/args.ts` 单点声明生成参数表，拒绝文档漂移。
- 黄金帧摘要、22 个单元测试、两侧流水线与镜像契约校验。

### 移除

- `@napi-rs/canvas` / `gifenc` 及全部平台原生二进制；`dist/` 与大体积 GIF 不再入库。
- GitHub ↔ CNB 双向同步（改为单向分发）。
