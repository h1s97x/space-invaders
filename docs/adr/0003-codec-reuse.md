# ADR 0003 · 复用自己手写的编解码器，但不复用玩法

- 状态：已认可（ADR 0000 第 6 节的展开）
- 日期：2026-11-12

## 背景

要求「尽量不引入重度依赖，自研」。`@napi-rs/canvas` 带 11 个平台原生二进制，`gifenc` 有
ESM/CJS 与调色板槽位的历史坑；两者都不适合多架构镜像。
但 `cnb-space-invaders` 里已有约 660 行自己写的 `raster.ts` / `pixels.ts` / `gif.ts`
（光栅化、调色板量化、GIF89a + LZW），MIT、作者是自己、零依赖，且有 LZW 与调色板测试覆盖。

## 决策

1. 只搬这三个**纯编解码文件**到 `src/render/codec/`，连同对应的编码测试。
   它们只依赖四个类型（`RGB` / `RGBA` / `Point` / `PixelBuffer`），由本项目自己写的
   `src/render/codec/types.ts` 提供 —— 不带 `Cell` / `Board` / `Enemy` 等任何玩法类型。
2. 旧仓 `types.ts` / `context.ts` / `constants.ts` / `entities.ts` / `animator.ts` /
   `strategies.ts` **一律不搬**：它们承载上游玩法设计与几何配色。
3. 搬入时清理注释里「动画逻辑与上游逐字一致」这类旧仓语境表述，改成中性的实现说明，
   避免新仓读起来仍像某个项目的移植版。
4. 运行时依赖恒为 `{}`；devDeps 只有 TypeScript 与 `@types/node`。

## 后果

- 正面：省掉重写编解码器的最大一块成本，且零运行时依赖从第一天成立。
- 负面：约 660 行编解码器以后自己维护 —— 用黄金帧与 LZW 结构测试兜住，
  并把「调色板 256 色 / 透明索引 / 处置方式」的约定写进 `docs/01-architecture.md`。
- 风险：`pixels.ts` 的调色板策略与画面色彩数量相关，换主题后若出现色带，改在 `theme.ts` 收敛颜色数，
  不改编解码器。
