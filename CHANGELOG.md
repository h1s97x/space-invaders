# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
