# Examples：效果图与可复制的流水线示例

目录位于仓库根目录 `examples/`，与 `docs/` 下的决策、契约与规格文档分开。
这里的资产不参与构建与镜像分发（`.dockerignore` 已排除 `examples/`）。

## 效果图

4 张 GIF 是两种渲染器 × 两份真数据、默认参数生成的 **1024×256 完整动画**；
4 张同名 PNG 是其中的静态预览帧。根目录 `README.md` 通过相对路径引用它们，
**这些文件必须提交进仓库、路径不要随意改**。

| 文件 | 渲染器 | 数据源 |
|---|---|---|
| `contrib-cnb.gif` / `.png` | `invader`（默认） | CNB 活跃日历 |
| `contrib-github.gif` / `.png` | `invader`（默认） | GitHub 贡献日历 |
| `classic-cnb.gif` / `.png` | `classic` | CNB 活跃日历 |
| `classic-github.gif` / `.png` | `classic` | GitHub 贡献日历 |

重新生成命令、数据抓取方式与 Pillow 校验步骤见 `todo.md` 第 5 节。
注意 `.gitignore` 全局忽略 `*.gif`，这 4 张图靠白名单例外入库；
PNG 不受该规则影响。

## 流水线示例

- `pipelines/`：可以直接复制进 profile 仓库的 CNB 与 GitHub Actions 配置片段。
- `calendar.json`：`CONTRIB_SOURCE=file` 用的示例归一化日历。

完整参数表见根目录 `README.md` 的「参数」章节；平台差异与环境变量前缀归一
见 `docs/02-contract.md`。
