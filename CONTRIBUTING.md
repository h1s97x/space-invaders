# 贡献指南

## 先读决策记录

本仓库的架构与边界锁定在 [docs/adr/0000-rewrite-baseline.md](docs/adr/0000-rewrite-baseline.md)。
**凡与该文档冲突的提案，先改文档，再改代码**，不要用「先跑通再说」绕过约束。

## 开发环境

需要 Node.js ≥ 22，不需要 Python、不需要原生编译工具链（运行时依赖为零）。

```bash
git clone https://cnb.cool/h1s97x/plugins/space-invaders.git
cd space-invaders
npm ci
npm run check        # typecheck + 测试 + 参数表一致性
```

## 改动落点

| 想做什么 | 改哪里 | 不要动 |
|---|---|---|
| 加平台 | `src/sources/` 加模块 + `sources/index.ts` 注册 | `domain/` / `render/` / `cli/` |
| 改玩法 | `src/domain/` | `contract/` 之外的层 |
| 加输出 | `src/render/` 加目录 + `render/index.ts` 注册 | 具体玩法模块 |
| 改参数 | `src/cli/args.ts`，然后 `npm run docs` | README 里的参数表（自动生成） |

## 硬约束

- 内核只认 `CONTRIB_*`；`src/` 不得出现平台判断、平台输出变量或另一套参数前缀。
- `domain/` 不 import `sources/`；`render/` 不 import 具体玩法。
- `package.json` 的 `dependencies` 必须保持 `{}`。
- 产物只写一个文件；提交、上传、输出变量交给平台流水线。
- 玩法规则不得引入参考项目的常量、策略名、坐标系或节奏（有测试静态拦截）。

## 提交前

```bash
npm run check     # 必须全绿
npm run golden    # 只有渲染确实变了才更新 test/golden/mock.json，并在 PR 里说明原因
docker build -t space-invaders:local .
```

改了渲染却没更新黄金摘要，`check` 会失败；改了参数表却没跑 `npm run docs`，`docs:check` 会失败。
