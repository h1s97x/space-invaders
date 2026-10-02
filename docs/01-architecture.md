# 01 · 整体架构

## 1. 架构总览

```
                      ┌──────────────┐
   GitHub GraphQL ──► │   data.ts    │  抓数据 / 离线假数据
   或 离线假数据       └──────┬───────┘
                             │ Contributions (rows[day][week])
                             ▼
                      ┌──────────────┐
                      │  engine.ts   │  玩法核心（零 canvas 依赖）
                      │              │
                      │  strategies  │  Action(x, shoot) 动作流
                      │  Ship        │  匀速滑行 + 停稳判定
                      │  Bullet      │  整数列 x，向上飞
                      │  Enemy       │  血量 = 贡献等级
                      │  Explosion   │
                      └──────┬───────┘
                             │ Frame { data: RGBA }
                             ▼
                      ┌──────────────┐
                      │  render.ts   │  Canvas 2D 绘制（只读 Engine）
                      └──────┬───────┘
                             │ 一帧像素
                             ▼
                      ┌──────────────┐
                      │   gif.ts     │  gifenc + 透明索引差分
                      └──────┬───────┘
                             ▼
                          game.gif
```

### 1.1 为什么拆成这几个文件？

**一条硬边界：`engine.ts` 一行 canvas 都不碰。**

这不是洁癖，是实际收益：调平衡性（开火频率、移动速度）时不会误伤观感，
反之调配色/字号时不会改变玩法节奏。早期把两者混在一个文件里，结果是改一个颜色
都得跑一遍游戏确认手感没变。

`render.ts` 同样是**只读**的：它消费 `Engine` 的公开字段，从不修改游戏状态。
所有"看起来会动"的东西（尾焰抖动、爆炸粒子）都由游戏状态推导，而非渲染层自己维护。

### 1.2 文件职责一览

| 文件 | 行数 | 职责 | 依赖 |
|---|---|---|---|
| `config.ts` | 94 | 纯常量：调色板、几何、速度、时长 | 无 |
| `types.ts` | 155 | 实体类 + 策略枚举 | config（仅类型） |
| `rng.ts` | 57 | mulberry32 可复现随机 | 无 |
| `data.ts` | 122 | GraphQL 抓取 + 离线假数据 | config, rng, types |
| `engine.ts` | 481 | 玩法：策略 + 主循环 + 碰撞 | config, types, rng, render |
| `render.ts` | 217 | Canvas 2D 绘制 | config, font, types |
| `gif.ts` | 118 | GIF 编码 | config, render（仅类型） |
| `font.ts` | 128 | 5×7 点阵字体 | config |
| `index.ts` | 169 | CLI 参数解析 + 串流程 | 全部 |

`engine.ts` 依赖 `render.ts`（为了 `Frame` 类型与默认渲染器实例），
但**方向是单向的**：`render.ts` 从不 import `engine.ts` 的值，
只用 `import type` 拿类型。这避免了循环依赖。

## 2. 分层职责矩阵

| 关注点 | config | types | rng | data | engine | render | gif | font | index |
|---|---|---|---|---|---|---|---|---|---|
| 调色板 / 几何 | 定义 | 读 | | | | 读 | | | |
| 实体定义 | | 定义 | | 读 | 读 | 读 | | | |
| 随机数 | | | 定义 | 用 | 用 | | | | |
| 网络 I/O | | | | 定义 | | | | | |
| **玩法规则** | | | | | **定义** | | | | |
| **像素绘制** | 读 | 读 | | | 读 | **定义** | | | |
| **文件编码** | 读 | | | | | | **定义** | | |
| 文字渲染 | | | | | | 用 | | 定义 | |
| CLI / 流程编排 | | | | | | | | | **定义** |

**没有任何一个模块同时负责玩法和绘制。**

## 3. 数据流细节

### 3.1 输入：Contributions 矩阵

```ts
class Contributions {
  rows: number[][];   // rows[day][week]，原始贡献数 0~40
  username: string;
  total: number;
}
```

**轴向是最容易搞错的地方。** 我们的 `rows` 是**日优先**（`rows[7][52]`，
第一维是星期几），而 GitHub API 返回的是**周优先**（`weeks[].days[]`）。
`engine.initEnemies()` 里按下标取：

```ts
const count = this.rows[day]?.[week] ?? 0;   // 注意顺序：day 在前
```

### 3.2 矩阵 → Enemy：分位数分档

原始贡献数跨度极大（0~40+），直接当血量会出现"一列要打 40 发"的荒谬情况。
所以先按**分位数**分档成 1~4：

```
统计所有 >0 的值，排序得 counts
对每个 count v：frac = (严格小于 v 的个数) / 总数

frac < 0.25 → level 1
frac < 0.50 → level 2
frac < 0.75 → level 3
否则        → level 4
```

用 `lowerBound`（二分找第一个 >= v 的下标）而不是绝对阈值，原因：
真实数据里绝大多数格子都挤在低分位，绝对阈值（如 `count // 5`）会让
整张图一片深绿，且几乎凑不出高贡献格。

**血量 = 等级。** 所以高贡献格子要挨更多枪，贡献分层因此在观感上真实可见。

### 3.3 帧循环

主循环严格照搬参考项目的结构，**不是**固定步长模拟：

```ts
*iterFrames() {
  yield render()                      // 初始帧

  for (const action of actionGen) {
    ship.moveTo(action.x)

    while (!canTakeAction()) {        // 停稳 + 冷却好
      animate()
      yield render()
    }

    if (action.shoot) {
      shoot()
      animate()
      yield render()
    }
  }

  // 收尾（见 §3.5）
}
```

关键点：**开火时机由「停稳」决定，不是定时器。**
`canTakeAction() = !ship.isMoving() && ship.canShoot()`。
这就是"飞过去 → 停 → 打 → 飞向下一列"观感的来源。

### 3.4 animate() 内的更新顺序

顺序**有讲究**，改错会导致命中判定异常：

```ts
animate() {
  animateStars()      // 星空向下飘
  ship.animate(dt)    // 飞船匀速逼近 targetX，含冷却倒数
  animateBullets()    // 子弹上移 + 碰撞判定 + 伤害结算
  animateExplosions() // 爆炸推进
}
```

子弹必须**先移动再判定碰撞**，否则会出现"子弹停在格子边缘反复判定"的问题。

### 3.5 碰撞与收尾

命中判定只有一行：

```ts
const victim = enemies.find(e => e.x === b.x && e.y >= b.y)
```

因为 `Bullet.x` 是**整数列号**、敌人按行号升序排列，`find` 取到的第一个就是
"恰好在子弹所在行下方的那一格"。**子弹永远不会横向打偏**，也不需要"打空"的概念。

打完所有敌人后有两段收尾（都来自参考项目）：

1. `FORCE_KILL_FRAMES = 100` 帧：只 `animate()`，等在飞的子弹落完
2. 若仍有活靶（`RowStrategy` 快照式发弹会少发），压着最低的活靶补枪直到清完

最后再输出 `TAIL_FRAMES = 5` 帧让爆炸散完。

## 4. 依赖图

```
                index.ts
                   │
    ┌──────────┬───┴────┬──────────┐
    ▼          ▼        ▼          ▼
  data.ts   engine.ts  gif.ts   render.ts
    │          │                   │
    │          └──────┬────────────┤
    ▼                 ▼            ▼
  types.ts          config.ts     font.ts
    ▲                 ▲
    └──────┬──────────┘
           │
        rng.ts
```

**没有环。** `render.ts` 与 `engine.ts` 之间的关联只通过 `import type`
（编译期擦除），运行期不存在互相引用。

## 5. 加一个新玩法要动哪些文件

| 想改什么 | 需要动 |
|---|---|
| 移动速度 / 开火节奏 | 只动 `config.ts` |
| 配色 / 格子尺寸 | 只动 `config.ts` |
| 敌人推进策略 | 只动 `engine.ts` 里的 `*Strategy()` |
| 飞船造型 | 只动 `render.ts` 的 `drawShip()` |
| 爆炸 / 子弹观感 | 只动 `render.ts` |
| GIF 体积 | 只动 `gif.ts` |
| 新增 CLI 参数 | `index.ts` + `config.ts` |

这个"改一处只动一个文件"的性质，是拆包的直接收益。

## 6. 为什么不用固定步长模拟

很多游戏引擎会走"固定时间步累积 + 插值渲染"。本项目**故意不用**：

- 参考项目就是「消费动作 → 走到位 → 开火」的循环，天然不是固定步长
- 引入固定步长就得插值，插值就得处理"位置在两格之间"的情况，
  而子弹的整数列判定会因此变复杂
- GIF 是离屏渲染，不需要考虑实时性，固定步长没有收益

代价是**换帧率会改变观感**（`deltaTime = 3.0/fps` 直接参与速度计算）。
但这是刻意保留的参考项目节奏，不是缺陷。
