# 05 · 迁移与归档

两个旧仓库即将归档。本文档是用户迁移的唯一依据，也是归档前的检查表。

| 旧仓 | 状态 | 去向 |
|---|---|---|
| `h1s97x/plugins/cnb-space-invaders` | 公告已发布、issue 已关闭；归档待权限 | 能力并入本仓，插件镜像换坐标 |
| `h1s97x/plugins/gh-space-invaders` | 本仓旧实现，已被重写覆盖 | 历史留在 git |
| `h1s97x/plugins/cnb-profile-3d-contrib` | 空仓，归档待权限 | 上一次收尾的历史欠账 |

## 执行记录（2026-11-12）

- 迁移公告已贴在 `cnb-space-invaders` 的 README 顶部并推送（commit `c4f2a82`），远端内容已核验。
- `#13` / `#18` 已带结论评论并关闭，该仓 open issue 数为 0。
- 归档前置条件已核验：旧 `:latest` 镜像 manifest 可拉取，归档操作后再次确认仍可拉取。
- **归档仍待执行**：内置 `CNB_TOKEN` 缺 scope（403）；随后提供的 CNB 令牌为 26 字符、
  调用日历接口返回 401 `user is not logged in`，判定无效。两个仓库仍 `freeze: false`。
  需要完整且带 `repo-code:rw,repo-manage:rw` 的令牌，或在仓库设置页手动归档；完成后把上表状态改为「已归档」。
- 旧 `:latest` 镜像 manifest 在归档尝试后复查仍可拉取。
- 主仓重写结果已提交推送（`e8579c4`），`sync-github.sh` 已同步分发端点 `main` / `latest`；
  两侧 CI（CNB `cnb-0h8-1k778v47n`、GitHub Actions `43172256193`）均 success。

## 参数映射

### 旧 `gh-space-invaders` CLI

| 旧 | 新 | 说明 |
|---|---|---|
| `-o, --output` | `CONTRIB_OUTPUT` | 默认 `game.gif` |
| `-s, --strategy` | `CONTRIB_RULE` | 策略概念取消，改为规则注册表（默认 `waves`），无一一对应 |
| `--fps` | `CONTRIB_FPS` | 默认 20（旧默认 40，节奏是自研的，不沿用） |
| `--colors` | — | 调色板由自研 codec 全片共用 256 色 |
| `--seed` | `CONTRIB_SEED` | 默认 1 |
| `--offline` | `CONTRIB_SOURCE=mock` | 或 `file` + `CONTRIB_CALENDAR` |
| `--user` | `CONTRIB_USER` | |
| `--max-frame` | `CONTRIB_MAX_FRAMES` | 默认 4800 |
| `--quiet` | — | stdout 固定只有一行摘要 |
| `GITHUB_TOKEN` | `CONTRIB_TOKEN` | 由 `action.yml` 的 `runs.env` 映射 |

### 旧 `cnb-space-invaders` 插件 settings

| 旧 | 新 | 说明 |
|---|---|---|
| `output` / `seed` / `fps` / `scale` / `username` / `token` | 同名 → `CONTRIB_*` | `entrypoint.sh` 把 `PLUGIN_*` 改名 |
| `mock` | `CONTRIB_SOURCE=mock` | |
| `strategy` | `CONTRIB_RULE` | 三种清场策略取消，改为自研波次规则 |
| `days` | — | 窗口由 `rollingWindow(now)` 固定为滚动一年 |
| `metric` | — | 活跃值统一用 `heatOf()` 全口径求和 |
| `theme` | — | 默认自研主题；扩展见 [03](03-extending.md) |
| `timeout` | — | 固定 15s 请求超时 |

**观感说明**：新实现不宣称与任何参考项目一致，规则、几何、配色、节奏都不同；
上面的映射是「参数能落到哪」，不是「输出相同的 GIF」。

## 分发坐标迁移

| 场景 | 旧 | 新 |
|---|---|---|
| CNB 插件镜像 | `docker.cnb.cool/h1s97x/plugins/cnb-space-invaders:latest` | `docker.cnb.cool/h1s97x/plugins/space-invaders:latest` |
| GitHub Action | `h1s97x/gh-space-invaders@...`（composite） | `h1s97x/space-invaders@v0.1.0`（container action） |

- **旧 `:latest` 在归档后会冻结**：归档前必须留迁移窗口，并确认归档不影响制品库旧镜像可拉取。
- GitHub 侧改名后的 301 是否对 `uses:` 生效，需在阶段 4 端到端实测，不照搬其它项目的结论。

## 旧仓 Issue 处置

| Issue | 结论 |
|---|---|
| `cnb-space-invaders#13` 帧数上界断言硬编码、峰值内存无覆盖 | 新实现有 `CONTRIB_MAX_FRAMES` 硬上界 + 两遍流式编码（帧不驻留内存）+ 有界测试，带结论关闭 |
| `cnb-space-invaders#18` 静态网格每帧重绘、dist 不清理导致本地验证失真 | 新实现每帧完整重画低分辨率画布，不存在「静态底」命题；`dist/` 不入库、镜像构建层独立产出，带结论关闭 |

## 公告草案（贴到旧仓 README 顶部）

> **本项目已归档。** 能力已并入 [`space-invaders`](https://cnb.cool/h1s97x/plugins/space-invaders)，
> 一个平台无关的仓库同时支持 GitHub 与 CNB。参数映射与镜像坐标见
> [`docs/05-migration.md`](https://cnb.cool/h1s97x/plugins/space-invaders/-/git/raw/main/docs/05-migration.md)。
> 旧镜像 `:latest` 不再更新，请迁移到新坐标。

## 归档顺序（阶段 5）

1. 三条路径双跑：GitHub 真数据 / CNB 真数据 / `mock` 离线。
2. 两侧端到端各跑一次（GitHub Actions workflow + CNB 流水线）。
3. 旧仓 README 置顶公告；本文件发布到新主仓。
4. 处理并关闭 #13 / #18。
5. 留 `:latest` 迁移窗口，确认制品库旧镜像仍可拉取。
6. 归档 `cnb-space-invaders` 与空仓 `cnb-profile-3d-contrib`。
7. [ADR 0000 第 9 节](adr/0000-rewrite-baseline.md) 的 10 条验收清单全部打勾。
