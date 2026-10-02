# gh-space-invaders · Code Wiki

> 项目已从 Python 改写为 TypeScript（见 [CHANGELOG](../CHANGELOG.md)）。
> 本文档库已同步重写完毕，以 **TypeScript 版**为准。

## 0. 一分钟速览

把 GitHub 贡献图渲染成一段「太空射击」GIF：飞船在网格下方横向移动，
逐列消灭贡献格子，格子越亮（贡献越高）血越厚。

- **技术栈**：Node 22 + TypeScript（ESM）
- **渲染**：`@napi-rs/canvas`（预编译二进制，无需 cairo）
- **编码**：`gifenc`（纯 JS）
- **画面**：860 × 230，52 列 × 7 行
- **许可**：MIT（见 [LICENSE](../LICENSE)、[NOTICE](../NOTICE)）

```bash
npm install
npm run check      # 类型检查 + 32 个单元测试
npm run offline    # 离线生成一份 GIF
```

## 1. 文档索引

| # | 文档 | 内容 | 行数 |
|---|---|---|---|
| 01 | [整体架构](01-architecture.md) | 分层职责、数据流、依赖图| 229 |
| 02 | [模块职责](02-modules.md) | 逐文件职责、导出、设计理由 | 403 |
| 03 | [API 参考](03-api-reference.md) | 全部导出符号与常量表 | 490 |
| 04 | [依赖关系](04-dependencies.md) | npm 依赖树、版本矩阵、安全 | 200 |
| 05 | [运行方式](05-running.md) | 安装、CLI 参数、Action 用法 | 232 |
| 06 | [测试与 CI](06-testing-and-ci.md) | 32 个用例、回归防护清单 | 197 |
| 07 | [设计决策 · 坑](07-design-decisions.md) | 14 条 ADR、13 个坑、修改禁忌 | 380 |
| 09 | [设计思路](09-our-design.md) | 六大核心机制与实现方案 | 325 |

> 原 `08-competitive-analysis.md`（竞品对比）已删除。
> 灵感来源与许可归属的说明见根目录 [NOTICE](../NOTICE)，
> 差异对比见 [README 的「灵感来源与致谢」](../README.md#灵感来源与致谢)。

仓库级文档在根目录：[README](../README.md)、
[CONTRIBUTING](../CONTRIBUTING.md)、[SECURITY](../SECURITY.md)、
[CODE_OF_CONDUCT](../CODE_OF_CONDUCT.md)、[CHANGELOG](../CHANGELOG.md)。

## 2. 核心概念（读代码前必知）

### 2.1 格坐标，不是像素坐标

这是最容易搞错的一点。**逻辑坐标的单位是「格」**，不是像素。

```
格坐标 (x, y)  →  像素 = PADDING + 坐标 × (CELL + GAP)
                PADDING = 40, CELL = 12, GAP = 3, PITCH = 15
```

画布 860×230 = `52 × 15 + 2×40` × `10 × 15 + 2×40`。

**子弹的 `x` 是整数列号**，只有 `y` 是浮点。所以命中判定就是：

```ts
enemy.x === bullet.x && enemy.y >= bullet.y
```

永远不会横向打偏 —— 这是「子弹不会浪费」的根本原因。

### 2.2 时间单位是「格/秒」和「秒」

所有速度与时长都与帧率解耦，由 `deltaTime` 换算：

```ts
deltaTime = 3.0 / fps     // 注意不是 1/fps
frameMs   = 2000 / fps    // 注意不是 1000/fps
```

`deltaTime = 3.0/fps` 相当于给所有速度乘了 1.5 倍系数 —— 这来自灵感来源项目
的设定，**照原样保留，不做"修正"**。

### 2.3 动作流模型

策略生成一串离散动作 `Action(x, shoot)`，主循环逐个消费：

```
for action of actions:
    ship.moveTo(action.x)
    while (!canTakeAction()) { animate(); render() }   // 走到位且冷却好
    if action.shoot) { shoot(); animate(); render() }
```

`canTakeAction() = !ship.isMoving() && ship.canShoot()`

**开火时机由「停稳」决定，不是定时器** —— 这是观感的关键。

## 3. 端到端链路

```
GitHub GraphQL / 离线假数据
        ↓  data.ts
   Contributions (rows[day][week])
        ↓  engine.initEnemies()  按分位数分档为 1~4
   Enemy[]（血量 = 等级）
        ↓  strategies → Action[]
   Action(x, shoot) 逐个消费
        ↓
   Ship 匀速滑到 x → 停稳 → shoot() → Bullet(x=整数列)
        ↓  animate()
   Bullet 向上 7.5 格/秒 → 命中判定 → Enemy.takeDamage()
        ↓  死 → LargeExplosion / 未死 → SmallExplosion
   Frame (RGBA 像素)  ← render.ts
        ↓  gif.ts（gifenc，透明索引差分）
   game.gif
```

## 4. 设计信条

1. **玩法逻辑与渲染彻底分离。** `engine.ts` 一行 canvas 都不碰，
   调平衡性不会误伤观感。
2. **Renderer 只读。** 它消费 engine 字段，从不修改游戏状态。
3. **坐标用格，不用像素。** 见 §2.1。
4. **速度用「格/秒」，不用「像素/帧」。** 见 §2.2。
5. **GIF 体积靠脏矩形差分，不靠减色数。** 减色数只省约 6%，减帧才有效。
6. **默认策略是 `random`。** `column` 是一排一排推过去，最机械。
7. **允许打空是特性不是 bug。** 完美效率是生成动画最明显的机器特征。

## 5. 变更历史

```bash
git log --oneline              # 提交历史
git log -- src/                # 只看 TypeScript 实现
git show c0f0aa6 -- docs/     # Python 时代的文档（在历史里）
```

Python 版已移除，需要时从 git 历史取回。
