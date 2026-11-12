# 03 · 扩展指南

三张注册表是唯一扩展点。下面的每一步都**不改核心文件**。

## 加一个平台

1. 在 `src/sources/` 新建 `foo.ts`，实现 `Source`：
   `read(ctx: SourceContext): Promise<Calendar>`。
   平台 API 的字段名、错误格式、按年/分页逻辑全部留在这个文件里。
2. 用 `heatOf()` 算 `total`，用 `rollingWindow(ctx.now ?? new Date())` 定 `from` / `to`，
   稀疏 `days` 按日期升序、只含有活动的日期。
3. 在 `src/sources/index.ts` 注册：`sources.register(fooSource)`。
4. 在 `src/cli/args.ts` 的 `source` 枚举里加上 `foo`，跑 `npm run docs`。
5. 在 `test/sources.test.ts` 加一条归一测试：与 `file` 源的等价 fixture 产出同一份 `Calendar`。

不改：`contract/`、`domain/`、`render/`、`cli/index.ts`、Dockerfile、两侧 YAML。

## 加一种输出

1. 在 `src/render/` 下新建目录，实现 `Renderer`：
   `frames(level, actions, ctx): Iterable<Frame>`。只认 `Level` / `Action`，
   不 import 任何玩法模块。
2. 在 `src/render/index.ts` 注册。
3. 在 `src/cli/args.ts` 的 `renderer` 默认值/说明里更新，跑 `npm run docs`。
4. 加一条测试证明「注册后 `renderers.get(id)` 可用」（`test/e2e.test.ts` 有范例）。

`Frame` 是完整 RGBA 画面；放大、调色板与 GIF 编码由 `render/codec/` 统一处理，
新渲染器不必重复实现。

## 改玩法

1. 只改 `src/domain/`：`model.ts`（日历 → 关卡）、`rules.ts`（装配）、`simulate.ts`（动作序列）。
2. 保持纯函数、零 IO、同一 seed 可复现；动作只用 `move` / `fire` / `rest` / `finish`。
3. 若确实需要新字段，先改 `src/contract/action.ts` 和 `docs/02-contract.md`，再改实现。
4. 不要引入参考项目的常量、策略名、坐标系或节奏 —— `test/domain.test.ts` 会静态拦截。

## 改参数

`src/cli/args.ts` 是唯一声明处。改完必须 `npm run docs`，否则 `docs:check` 会失败。
新增参数不要顺手在 `cli/env.ts` 加第二套前缀：平台映射只在 `action.yml` 的 `runs.env`
与 `entrypoint.sh` 里发生。
