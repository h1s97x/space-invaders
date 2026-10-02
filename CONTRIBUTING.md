# 贡献指南

感谢你愿意参与这个项目。无论是提 issue、报 bug 还是提 PR，都欢迎。

## 开发环境

需要 **Node.js ≥ 22**（用到内置的 `node:test`）。不需要装 Python，也不需要装
`node-gyp` 之类的东西 —— `@napi-rs/canvas` 是预编译二进制。

```bash
git clone https://github.com/h1s97x/gh-space-invaders.git
cd gh-space-invaders
npm install
```

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run build` | 类型检查 + 编译到 `dist/` |
| `npm test` | 跑单元测试（32 个，约3~5 秒） |
| `npm run check` | `build` + `test` 一起跑，提交前请务必执行 |
| `npm run offline` | 用假数据生成一份 GIF |
| `npm run dev -- --offline` | tsx 直跑，改完立刻看效果 |

## 提 Issue 之前

跑一遍 `npm run check`，如果失败，把报错贴进 issue —— 这能省掉一轮来回。

## 提交规范

用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <简短描述>

type: feat | fix | docs | test | ci | chore | refactor | perf | style
```

例子：

```
feat(engine): 支持自定义策略权重
fix(gif): 修正 300+ 色时的透明索引冲突
test(strategy): 补 random 策略清场顺序的回归测试
docs(readme): 更新实测数据
```

**一个提交只做一件事。** 不要把「改逻辑 + 改格式 + 加测试」混在一个提交里——
评审和日后回溯都会痛苦得多。

## 代码风格

- **TypeScript 严格模式**，不允许 `any`（必要时用 `unknown` + 类型收窄）。
- 缩进 2 空格，单引号，分号。
- **注释写「为什么」，不写「是什么」。** 代码本身已经说了是什么。
- 注释里如果提到灵感到某个开源项目，请注明出处（见 `NOTICE`），保持风格一致。

## 改动玩法逻辑时，务必补回归测试

这个项目是从一个玩法模型演进出来的，历史上踩过好几个很难查的坑，都已经写成测试钉住了：

| 坑 | 锁它的测试 |
|---|---|
| 默认策略被误设为 `column`，轨迹变成"从左到右一排一排清" | `strategy.test.ts` |
| 策略活锁，帧数暴涨但几乎不开火 | `strategy.test.ts` |
| 贡献分档丢失，出现 hp40 这种值 | `strategy.test.ts` |
| 先减血再读血量，`score` 恒为 0 | `strategy.test.ts` |

改动这些地方时，先看 `test/strategy.test.ts` 里对应的用例。**新增 bug 一定要补一条回归测试**，
否则它一定会再回来。

## 涉及 GIF 体积的改动

先量再改，别凭感觉：

```bash
npm run offline -- --colors 16 -o /tmp/a.gif
npm run offline -- --colors 32 -o /tmp/b.gif
ls -l /tmp/a.gif /tmp/b.gif
```

另外注意 `gif.ts` 里的脏矩形差分靠**透明索引**实现，**不要**改用 `dispose=2`
（那会强制每帧全量编码，体积直接翻倍）。

## Pull Request

1. 从 `main` 开分支：`feat/xxx` / `fix/xxx` / `docs/xxx`
2. `npm run check` 必须通过
3. PR 描述里说清：**改了什么**、**为什么**、**怎么验证的**
4. 涉及画面变化的，附一张前后对比 GIF（把 `--seed` 一起写上，便于复现）

## 行为准则

参与即表示同意 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。
