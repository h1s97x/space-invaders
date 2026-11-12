# 04 · 重写档案（零代码继承核验）

| 项 | 值 |
|---|---|
| 状态 | 已执行 |
| 日期 | 2026-11-12 |
| 主仓 | `cnb.cool/h1s97x/plugins/space-invaders`（CNB，唯一源） |
| 许可 | MIT，Copyright (c) 2026 h1s97x |
| 参考的旧实现 | `h1s97x/plugins/gh-space-invaders`、`h1s97x/plugins/cnb-space-invaders` |
| 灵感来源 | 开源社区「把贡献日历做成动画」这一类创意（见 NOTICE） |

本档案回答一个问题：**这个仓库里的代码，到底哪些是自己的，哪些来自别处，怎么核验。**

## 1. 结论

玩法规则、网格几何、配色、参数体系、数据模型、编排与测试均为本项目重新实现。
唯一从旧仓搬入的是**自己手写的三个编解码文件**（约 660 行），
它们是通用图形算法，不承载玩法设计；搬入时已清理旧仓语境注释。
除此之外没有复制任何第三方源码，运行时依赖为零。

## 2. 搬入清单（自研资产）

来源：`cnb-space-invaders@5838e41`，MIT，Copyright (c) 2026 h1s97x。

| 旧仓文件 | 新位置 | 行数 | 处理 |
|---|---|---|---|
| `src/game/raster.ts` | `src/render/codec/raster.ts` | ~172 | 注释中性化 |
| `src/game/pixels.ts` | `src/render/codec/pixels.ts` | ~253 | 注释中性化 |
| `src/game/gif.ts` | `src/render/codec/gif.ts` | ~236 | 注释中性化 |

- 类型依赖由本项目新写的 `src/render/codec/types.ts` 提供，只有 `RGB` / `RGBA` / `Point` / `PixelBuffer`
  四个类型，**不含**旧仓 `types.ts` 里的 `Cell` / `Board` / `Enemy` / `Ship` 等玩法类型。
- 编码结构测试迁移到 `test/codec.test.ts`（GIF89a 头、循环扩展、帧延迟、LZW 首码、
  透明索引、最近邻放大）。
- 旧注释里「与上游逐字一致」「Pillow」等表述已改为中性实现说明；`grep -rn '上游\|Pillow' src/render/codec/` 应无输出。

## 3. 未复制清单（旧仓全部丢弃）

**`cnb-space-invaders`**：`src/game/{types,board,strategies,animator,state,entities,explosion,starfield,context,constants}.ts`、
`src/{api,config,index,inputs,mock,shooter}.ts`、`tests/`、`scripts/docs.ts`、`ARCHITECTURE.md`、
`README.md` 的参数与玩法章节。
理由：这些文件承载参考项目的常量、坐标系、三种清场策略与节奏，属于「设计」，不能靠
「代码是自己写的」带过来（ADR 0002）。

**`gh-space-invaders`（本仓旧实现）**：`src/` 10 个 TS 文件、`test/` 32 个回归用例、
`docs/` 9 份旧引擎文档、`demo.gif`、旧 `action.yml`（composite）、旧 `.cnb.yml` 与双向同步工作流。
理由：依赖 `@napi-rs/canvas` + `gifenc`，且设计与旧参考项目对齐。
旧版保留在 git 历史，不另建归档目录。

## 4. 核验命令

```bash
# 当前源码清单（应只含 contract / sources / domain / render / cli）
git ls-files src | sort

# 与旧仓 codec 逐文件比对：只应看到注释差异
git clone --depth 1 https://cnb.cool/h1s97x/plugins/cnb-space-invaders.git /tmp/old-cnb
diff -u /tmp/old-cnb/src/game/raster.ts src/render/codec/raster.ts
diff -u /tmp/old-cnb/src/game/pixels.ts src/render/codec/pixels.ts
diff -u /tmp/old-cnb/src/game/gif.ts    src/render/codec/gif.ts

# 内核无平台痕迹、无上游常量
grep -rnE 'platform ===|INPUT_|PLUGIN_|GITHUB_OUTPUT|gh-space-shooter|3\.0/fps|860' src/ || true

# 零运行时依赖
node -e "const p=require('./package.json'); if(Object.keys(p.dependencies).length) process.exit(1)"

# 玩法层不引用数据源层、不含参考设计
npm test
```

`test/domain.test.ts` 把最后两项做成了静态断言，CI 每次都会跑。

## 5. 归属

`LICENSE` 只有 `h1s97x`；`NOTICE` 只写灵感致谢，不写「移植自 / 对齐上游」。
本档案与上述命令让「零代码继承」可被第三方复核，而不是一句声明。

## 6. v2 渲染层参考的自有资产（2026-11-12）

首版真数据效果图不可用时，从两个**自有**旧仓取回了美术画法作参考：

| 来源 | 取回的美术资产 |
|---|---|
| `gh-space-invaders@8d63e8a`（主仓历史） | `src/font.ts` 的 5×7 点阵字形（A–Z / 0–9 / 符号）；`src/render.ts` 的星空、爆炸、飞船与 HUD 绘制思路 |
| `cnb-space-invaders@5838e41`（归档仓） | `src/game/entities.ts` 的 6×6 外星人点阵与「菱形机身 + 半透明机翼 + 翼尖实色」；`starfield.ts` 的视差星空；`explosion.ts` 的粒子爆炸 |

处理方式：字形表作为纯美术数据沿用；其余全部重画成 8×8 三型两帧，几何、配色、节奏、
HUD、清空标记与脏矩形编码均为本项目新写。**未取** `config.ts` / `engine.ts` /
`constants.ts` / `strategies.ts` 里的常量、坐标系、三种清场策略与节奏——那些带上游设计血缘。

上述文件均为 MIT © 2026 h1s97x 的自有代码，不构成第三方继承；第 1、3 节的结论不变。
