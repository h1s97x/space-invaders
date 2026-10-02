# 09 · 设计思路与实现方案

> 本文说明**玩法模型是怎么跑起来的**，以及为什么这样设计。
> 想快速上手读代码，先看 [01-architecture.md](01-architecture.md)。

## 0. 背景与目标

**目标**：把 GitHub 贡献图变成一段"太空射击"GIF。

约束：

1. 画面必须**逐帧播放**（GIF），所以一切都要在离线渲染里算好
2. 尺寸要小（README 里能塞下），所以要压体积
3. 要能复现（否则调参没法对比）

## 1. 整体流程

```
① 拿数据    data.ts
   GraphQL / 离线假数据 → Contributions(rows[7][52])
        ↓
② 分档      engine.initEnemies()
   按分位数把贡献数分档 1~4 → Enemy[]（血量 = 档位）
        ↓
③ 出动作    engine.generateActions()
   策略生成器 → Action(x, shoot) 序列
        ↓
④ 消费动作  engine.iterFrames()
   moveTo → 等停稳 → shoot → animate → render
        ↓
⑤ 渲染      render.ts      Canvas 2D → Frame{RGBA}
        ↓
⑥ 编码      gif.ts         gifenc + 透明索引差分 → game.gif
```

## 2. 核心机制一：动作流（`Action`）

### 2.1 为什么用动作流而不是"每帧重新决策"

最直觉的做法是每帧问一次"现在该去哪"，然后直接走过去。
但那样会得到**没有段落感**的动作——因为每帧的最优解是连续的，
飞船就会一直平滑滑行，观感像"扫描仪"。

动作流的做法是：**策略只产出意图，不控制运动。**

```ts
class Action {
  x: number      // 去哪一列
  shoot: boolean // 到位后是否开火
}
```

主循环逐个消费：

```ts
for (const action of actions) {
  ship.moveTo(action.x)

  while (!canTakeAction()) {   // 停稳 + 冷却好
    animate(); render()
  }

  if (action.shoot) { shoot(); animate(); render() }
}
```

**关键在于"到位才开火"这个约束。** 它天然制造了段落：
飞过去 → 停 → 打 → 飞向下一列。真人玩射击游戏就是这么打的。

### 2.2 三种策略

#### `ColumnStrategy` —— 逐列扫

```ts
for (let week = 0; week < 52; week++) {
  while (true) {
    const totalHealth = enemies.filter(e => e.x === week).reduce(sum)
    const flying = bullets.filter(b => b.x === week).length
    if (flying >= totalHealth) break
    yield new Action(week, true)
  }
}
```

"在飞子弹够了就换列"这个判断很优雅：它不需要知道子弹什么时候落地，
只要数量够就行。所以玩家会看到**边打边往旁边挪**。

⚠️ 但它是**一排一排推过去**的（实测清场顺序严格单调递增），
所以**不能作为默认**。

#### `RowStrategy` —— 逐行推进

从上到下逐行，行内**之字形**排序：

```ts
inRow.sort((a, b) =>
  a.x * (day % 2 === 0 ? -1 : 1) - b.x * (day % 2 === 0 ? -1 : 1))
```

奇偶行的列序相反，避免每行都从最左边开始。

⚠️ 这个策略有**快照式发弹**的缺陷（`for _ in range(enemy.health)`
用的是当时的血量），子弹串格就会少发 → 打不完。
我们在收尾处补了补枪逻辑（见坑 2）。

#### `RandomStrategy` —— 加权最近邻（**默认**）

```ts
const candidates = 最近 8 个有敌人的列
weights = d === 0 ? 10 : d <= 3 ? 100 : 1
const target = weightedPick(candidates, weights)
const lowest = 该列 y 最大的敌人
for (i in lowest.health) yield new Action(target, true)
```

**这套权重是"手感"的主要来源：**

| 权重 | 含义 | 效果 |
|---|---|---|
| `d=0 → 10` | 已经在这列，快走 | 避免死守一列 |
| `d≤3 → 100` | 隔壁就是最优解 | 主要行为：就近 |
| `d≥4 → 1` | 远，但偶尔值得 | **意外感的唯一来源** |

那个 `1` 极其重要。没有它，飞船永远是"最近邻 → 最近邻"，
轨迹可预测得很机械。有了它，飞船会突然放弃眼前的跑去打远处——
**这正是真人会做的事**（"咦那边一整片都亮了"）。

实测清场顺序（每列 1 格的数据）：

```
column:  0,1,2,3,4,5,6,7,8,9,...      ← 严格单调，一排一排推
random:  17,23,25,42,49,48,47,46,...  ← 来回跳，有意外感
```

## 3. 核心机制二：匀速 + 停稳

### 3.1 运动模型

```ts
animate(dt, speed) {
  const dx = speed * dt
  if (this.x < this.targetX) this.x = Math.min(this.x + dx, this.targetX)
  else if (this.x > this.targetX) this.x = Math.max(this.x - dx, this.targetX)
  if (this.shootCooldown > 0) this.shootCooldown -= dt
}
```

**没有加速度、没有过冲、没有转向停顿。** 是匀速 + 急停。

### 3.2 为什么不做加减速

这条来之不易。早期版本试过完整的物理曲线：

- 梯形速度曲线（加速 → 巡航 → 减速停住）
- 轻微过冲后回稳
- 转向时的减速斜坡
- 开火节拍抖动

结果**观感更差**。原因：

1. 减速曲线让飞船在相邻列之间磨蹭，**移动变得黏滞**
2. 破坏了"停稳才开火"的节奏——飞船还没停稳就开始减速
3. 过冲 + 回稳产生了高频的小幅抖动，像在抽搐

真人玩弹幕射击的操作感**恰恰是匀速 + 急停**。
你按左键，它就以固定速度向左；松手就停。没有滑行惯性。

所以这些全砍掉了（ADR-4 记录了这个决策）。

### 3.3 速度单位：格/秒

```ts
SHIP_SPEED = 12.5         // 格/秒
deltaTime = 3.0 / fps     // 注意不是 1/fps
```

每帧位移 = `12.5 × 0.075 = 0.9375` 格 ≈ 14px。

⚠️ `deltaTime = 3.0/fps` 是真实帧间隔的 **3 倍**，
相当于给所有速度乘了 1.5 倍系数。这是参考项目的设定，
**刻意保留、不"修正"**，`test/config.test.ts` 有用例锁住。

## 4. 核心机制四：格坐标与整数列子弹

### 4.1 换算只有一个入口

```ts
cellX(cx) = PADDING + cx * PITCH   // PADDING=40, PITCH=15
```

### 4.2 为什么子弹 x 必须是整数

```ts
class Bullet {
  x: number   // 整数列号！
  y: number   // 浮点
}
```

于是命中判定退化成一行：

```ts
const victim = enemies.find(e => e.x === b.x && e.y >= b.y)
```

**一行的代价，零 bug。** 子弹永远不会横向打偏。

### 4.3 一个真实的代价（像素坐标时代）

早期版本用像素坐标 + `colUnder()` 换算列号：

```ts
colUnder(cx) = floor((cx - PADDING_LR) / (CELL + GAP))
```

问题来了：机身宽 32px，跨列飞行时 `shipCx` 会在两列之间**扫过**，
某一瞬间算出的"当前列"其实机身大部分卡在列缝里。
子弹从缝中穿过，**一发都打不到**。

实测后果：**88% 的子弹打空**（`dmg/shot` 掉到 0.08）。

改成格坐标后这个问题从根上消失。

## 5. 核心机制五：分档

```ts
统计所有 >0 的贡献数，排序得 counts
frac = lowerBound(counts, v) / counts.length

frac < 0.25 → 1
frac < 0.50 → 2
frac < 0.75 → 3
否则       → 4
```

**血量 = 档位。** level 4 的格子要挨 4 枪，level 1 的挨 1 枪——
**贡献分层在观感上真实可见**。

为什么不用绝对阈值：真实数据里绝大多数格子挤在低分位，
`count // 5` 会让整张图一片深绿，且几乎凑不出高贡献格。

## 6. 核心机制六：GIF 压缩

### 6.1 共享调色板

只量化**首帧**一次，所有帧共用。

每帧各自量化会让色号在帧间漂移 → 播放时整片格子集体变色（"闪烁"）。

### 6.2 透明索引差分

GIF 没有"只更新变化区域"的能力，但可以模拟：

```ts
out[i] = real[i] === prevReal[i] ? TRANSPARENT : real[i]
```

配合 `transparent: true` + `dispose: 0`，解码器会沿用上一帧未变区域。

⚠️ 基准必须是 `prevReal`（真实色号），不能用写入缓冲区
（那里未变的像素已经是透明索引了）。

### 6.3 体积取决于帧数，不是颜色数

实测：

| 颜色数 | 体积 | 画质 |
|---|---|---|
| 16 | −6% | 明显变糙 |
| 32 | 基准 | 好 |

因为大色块的 GIF 每帧差分后本来就只有几十种颜色。
**想压体积要减帧**（降 fps 或缩短时长），不是减颜色。

## 7. 数据流的一个坑：轴向

```ts
rows: number[][]   // rows[day][week]  ← 日优先！
```

而 GitHub API 是 `weeks[].days[]`（**周优先**）。

`data.ts` 做了一次转置，`engine.initEnemies()` 按 `rows[day][week]` 取。
这个轴向问题在移植时踩过一次（导致血量直接用了原始贡献数，出现 hp40）。

## 8. 测试策略

**测"会不会出错"，不测"长什么样"。**

理由：观感靠人眼判断。把"飞船第 100 帧应该在 x=345"写成断言，
改个配色就红一片，而且它对真正的 bug 毫无检测力。

所以测试只覆盖：

- 坐标换算、画布尺寸（契约）
- 运动学（匀速、不越界）
- 碰撞判定边界
- 策略能否清场 / 会不会死循环
- GIF 产物格式
- **每一个曾经踩过的坑**

详见 [06-testing-and-ci.md](06-testing-and-ci.md)。

## 9. 如果要重做一遍

按这个顺序改动，风险最低：

1. **改配色/尺寸** → 只动 `config.ts`
2. **改速度/节奏** → 只动 `config.ts` 的速度常量
3. **加一种策略** → 只动 `engine.ts`，实现一个 `Generator<Action>`
4. **改飞船造型** → 只动 `render.ts` 的 `drawShip()`
5. **改碰撞规则** → `engine.ts` 的 `animateBullets()`

⚠️ 第 5 步是唯一有技术风险的一步——整数列子弹带来的"绝不打偏"
是整个观感的基石，改之前想清楚。

## 10. 相关文档

| 想了解 | 看 |
|---|---|
| 分层与数据流 | [01-architecture.md](01-architecture.md) |
| 每个文件的细节 | [02-modules.md](02-modules.md) |
| 所有导出符号 | [03-api-reference.md](03-api-reference.md) |
| 为什么这样设计 | [07-design-decisions.md](07-design-decisions.md) |
| 怎么跑起来 | [05-running.md](05-running.md) |
