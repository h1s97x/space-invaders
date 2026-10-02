# 02 · 模块职责

逐文件说明：导出什么、为什么这么设计、踩过什么坑。

## 1. 职责总览

| 文件 | 一句话 |
|---|---|
| `config.ts` | 所有"魔法数字"的唯一出处|
| `types.ts` | 实体类与策略枚举 |
| `rng.ts` | 可复现随机数 |
| `data.ts` | 两个数据源：GraphQL / 离线假数据 |
| `engine.ts` | 玩法核心 |
| `render.ts` | Canvas 绘制 |
| `gif.ts` | GIF 编码 |
| `font.ts` | 5×7 点阵字体 |
| `index.ts` | CLI 与流程编排 |

---

## 2. `config.ts` —— 纯常量

依赖图的叶子，不 import 任何本项目模块。

### 2.1 画面几何

```ts
CELL = 12        // 格子边长
GAP  = 3         // 格子间距
PADDING = 40     // 画布边距
PITCH = CELL + GAP = 15
COLS = 52  ROWS = 7
SHIP_ROW = ROWS + 3 = 10      // 飞船停在网格下方第 10 行
```

由此推出画布尺寸：

```
WIDTH  = 52 × 15 + 2 × 40 = 860
HEIGHT = 10 × 15 + 2 × 40 = 230
```

### 2.2 坐标转换：唯一的换算入口

```ts
cellX(cx) = PADDING + cx * PITCH
cellY(cy) = PADDING + cy * PITCH
```

**全项目只有这两个函数做格↔像素换算。** 早期在渲染层散落着
`PADDING + x * 15` 这类字面量，改 `GAP` 时漏改一处就整张图歪。

### 2.3 速度与时长：单位是「格/秒」和「秒」

```ts
SHIP_SPEED = 12.5          // 格/秒
BULLET_SPEED = 7.5         // 格/秒
SHIP_SHOOT_COOLDOWN = 0.2  // 秒
```

与帧率解耦，由 `deltaTime` 换算成每帧位移。

### 2.4 两个反直觉的时间函数

```ts
deltaTimeFor(fps) = 3.0 / fps    // 注意不是 1/fps
frameMsFor(fps)   = 2000 / fps   // 注意不是 1000/fps
```

这两个来自参考项目，**刻意原样保留、不做"修正"**：
`deltaTime` 是真实帧间隔的 3 倍，相当于给所有速度乘 1.5 倍系数。
`config.test.ts` 里有专门的用例锁住这个关系，防止有人"顺手修正"。

### 2.5 调色板

只有 5 个颜色，且全部照抄参考项目的 `RenderContext.darkmode`：

```ts
BACKGROUND = (13, 17, 23)
GRID_COLOR = (22, 27, 34)
SHIP_COLOR = (68, 147, 248)
BULLET_COLOR = (255, 223, 0)   // 参考是黄色，不是我之前用的淡黄白
```

敌人配色在 `types.ts` 的 `ENEMY_COLORS`（因为它按血量索引，不是纯常量）。

**`rgba()` 也在这里**——统一把 RGB 元组转成 canvas 的 `rgba()` 字符串，
避免各处手写 alpha 换算。

---

## 3. `types.ts` —— 实体类

### 3.1 `Enemy` —— 贡献格靶子

```ts
class Enemy {
  x: number       // 列号（整数）
  y: number       // 行号（整数）
  health: number  // = 贡献等级 1~4
}
```

`takeDamage()` 返回 `'hit' | 'dead'`，调用方据此决定放哪种爆炸。
不返回布尔值的原因：两种爆炸的粒子数、半径、时长都不同（4 vs 8 粒、10 vs 20 半径），
返回布尔还得再查一次 `health`。

### 3.2 `Bullet` —— x 是整数列号

```ts
class Bullet {
  x: number   // 整数列号
  y: number   // 浮点格坐标，向上移动
}
```

**这是整个项目最关键的设计。** 因为 x 被量化成整数列：

```ts
enemies.find(e => e.x === b.x && e.y >= b.y)
```

子弹**永远不会横向打偏**。早期版本用像素坐标 + `colUnder()` 换算列号，
结果飞船跨列飞行时机身其实卡在两列之间 2px 的缝里，子弹从缝中穿过、一发都打不到
（实测 88% 的子弹打空）。改成格坐标后这个问题从根上消失了。

### 3.3 `Ship` —— 匀速 + 停稳

```ts
class Ship {
  x: number         // 当前格坐标（浮点）
  targetX: number   // 目标列
  shootCooldown: number

  moveTo(x)          // 设目标
  isMoving()         // x !== targetX
  canShoot()         // shootCooldown <= 0
  animate(dt, speed) // 匀速逼近，min/max 夹住绝不越过
}
```

`animate` 里那句 `Math.min(this.x + dx, this.targetX)` 是"绝不越过"的关键。
参考项目用的也是这个写法——**不用弹簧阻尼、不做过冲回稳**，
因为那样会破坏"停稳才开火"的节奏。

出生位置 `x = 25`，正好是 52 列的正中。

### 3.4 `Action` —— 策略产出的最小单元

```ts
class Action {
  x: number      // 去哪一列
  shoot: boolean // 到位后是否开火
}
```

策略只产出这个，不控制飞船怎么动。**这是"像在打游戏"的关键**：
飞船的移动是匀速的、开火时机由停稳决定，策略只表达意图。

### 3.5 `ENEMY_COLORS` —— 按血量索引

```ts
{ 1: (0,109,50), 2: (38,166,65), 3: (57,211,83), 4: (87,242,135) }
```

键是**剩余血量**，所以掉血就自动变暗一档——受击反馈免费获得。
放在 `types.ts` 而非 `config.ts`，因为它的索引空间是血量（1~4），
和其他常量（画布宽高之类）不是一回事。

---

## 4. `rng.ts` —— 可复现随机数

```ts
class Rng {
  next(): number            // [0, 1)
  uniform(a, b)             // [a, b)
  int(a, b)                 // [a, b] 闭区间
  choice(seq)               // 等概率取一个
  weighted(seq, weights)    // 加权取一个
}
```

用 **mulberry32** 而不是 `Math.random()`。原因只有一个：**GIF 必须逐帧可复现**。
同一个 `--seed` 跑两次必须得到完全一样的动画，否则没法对比调参效果。

`weighted()` 对应 Python 的 `random.choices(population, weights)[0]`
（参考项目的 `RandomStrategy` 用它来做距离加权）。

**注意**：Python 的 `random` 与 JS 的 `Math.random` 是两套独立算法，
所以本项目的 `--seed` 与 Python 版**不会**产生同样的动画。
一致性只保证「同一份 TS 代码 + 同一个 seed → 同一条动画」。

---

## 5. `data.ts` —— 两个数据源

对外只有两个函数。

### 5.1 `fetchContributions(username, token)`

走 GitHub GraphQL。**任何失败都只返回 `null`，绝不抛出**：

| 情况 | 处理 |
|---|---|
| 401 / 403（token 无效、限流） | 警告 + `null` |
| 网络超时（`AbortSignal.timeout(15_000)`） | 警告 + `null` |
| 返回非 JSON | 警告 + `null` |
| GraphQL 返回 `errors`（HTTP 200 + errors 是它的习惯） | 警告 + `null` |
| 用户不存在 | 警告 + `null` |

**任何失败都降级而不是中断**——构建流水线不该因为一次网络抖动挂掉。
调用方（`index.ts`）拿到 `null` 就退到假数据。

token 只在内存中使用，**不写入产物、日志或 GIF**（见 `SECURITY.md`）。

### 5.2 `generateDummy(username)`

离线假数据，看起来像真实贡献图。

**用 `crc32(username)` 播种**，不用字符串 hash。因为必须让同一个用户名
在任何机器上都得到同一份数据，否则 `--seed` 失去复现意义
（JS 的 `Math.random` 没有这个问题，但 Python 的 `hash()` 每个进程带随机盐）。

分布设计：
- 第 0 行和第 6 行（周末）更稀疏：`[0,0,0,1,2]` 权重 `[40,20,10,20,10]`
- 其余行更密集：`[0,1,2,3,4,5,10]` 权重 `[15,15,20,20,15,10,5]`
- 额外随机 8 个高产格（15~40），保证 level 3/4 一定存在

---

## 6. `engine.ts` —— 玩法核心

481 行，项目里最大的文件。**一行 canvas 都不碰。**

### 6.1 公开字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `ship` | `Ship` | 飞船 |
| `enemies` | `Enemy[]` | 存活敌人（打爆即从数组移除） |
| `bullets` | `Bullet[]` | 在飞子弹 |
| `explosions` | `Explosion[]` | 爆炸 |
| `stars` | `Star[]` | 视差星空 |
| `deltaTime` / `frameMs` | `number` | 时间步长与帧时长 |
| `score` / `defeated` / `shots` | `number` | 统计 |

### 6.2 公开方法

| 方法 | 用途 |
|---|---|
| `isComplete()` | 敌人是否清空 |
| `canTakeAction()` | 是否可以开火（不移动 且 冷却好） |
| `shoot()` | 开一炮 |
| `animate()` | 推进一帧 |
| `iterFrames()` | 生成器：逐帧产出画面 |
| `simulate()` | 无渲染跑一遍，返回统计（调参用） |

`simulate()` 不渲染，所以比`iterFrames()` 快两个数量级——参数扫描可以随便跑。

### 6.3 四种策略

全部是生成器函数，产出 `Action` 流：

| 策略 | 逻辑 |
|---|---|
| `column` | 从第 0 列扫到第 51 列。每列持续 shoot 直到"在飞子弹 >= 该列总血量" |
| `row` | 从上到下逐行，行内**之字形**排序（奇偶行列序相反），逐格打 |
| `random` | **默认**。取最近 8 个有敌人的列，按 `同列10 / 1~3列100 / 4列以上1` 加权随机挑一个，打该列最下面那个敌人 |
| `chaos` | 额外功能。优先打等级最高的格子，同级随机 |

**默认必须是 `random`。** `column` 是一排一排推过去，实测清场顺序严格单调递增
（0,1,2,3,4,5…），观感最机械。`strategy.test.ts` 里有专门的回归用例锁住这一点。

`random` 里那个 `4 列以上权重 = 1` 是"意外感"的唯一来源——
它让飞船偶尔放弃近处的目标跑去打远处，从而打破可预测的节奏。

### 6.4 `maxFrames` 自动推算

`maxFrames = enemies.length * 240 + 4000`，是安全上限而非精确预算。
因为策略是反应式的，真实帧数不可预测；这个值只用来兜底防止死循环撑爆内存。

`simulate()` 和 `iterFrames()` 里另有 `guard` 计数器兜底。

---

## 7. `render.ts` —— Canvas 绘制

**只读**：消费 `Engine` 字段，从不修改游戏状态。

### 7.1 静态底预渲染

背景（纯色 + 空格子圆角方块）预渲染成一张离屏 canvas，每帧只 `drawImage` 一次。
比每帧重画几百个圆角方块快得多。

### 7.2 绘制顺序（敏感）

```
星空 → 敌人 → 爆炸 → 子弹 → 飞船 → HUD
```

这个顺序照抄参考项目的 `GameState.draw()`。改顺序会改变遮挡关系——
比如爆炸画在敌人前面会盖住正在被打的格子。

### 7.3 各绘制方法

| 方法 | 对应参考项目 |
|---|---|
| `drawStars()` | `Starfield.draw()`：亮度直接当灰度 |
| `drawEnemies()` | `Enemy.draw()`：圆角方块，颜色按**剩余血量**取 |
| `drawExplosions()` | `Explosion.draw()`：粒子沿固定角度扩散，半径随 progress 涨、整体淡出 |
| `drawBullets()` | `Bullet.draw()`：3 段递减 alpha 拖尾 + 本体 4 层叠加 |
| `drawShip()` | `Ship.draw()`：机身菱形 + 双翼半透明三角 + 2px 实心翼尖 |

### 7.4 飞船造型

**几何一字不改照抄参考项目**：

```
机身：菱形四点多边形  (顶 → 左3@70% → 底 → 右3@70%)，纯亮色实心
双翼：半透明三角    (±2@50% → ±8@80% → ±8@100% → ±2@70%)，同色 alpha 128
翼尖：2px 实心竖条  ±8..±9
```

简单到爆，但剪影干净、颜色够亮，一眼认得出是飞船。
比"自己发明造型"（早期版本是 9点多边形机身 + 中线暗槽 + 深蓝翼 + 座舱玻璃）
好在**边界清晰**——复杂造型在深色背景上会糊成一坨。

---

## 8. `gif.ts` —— GIF 编码

用 `gifenc`（纯 JS，MIT）。

### 8.1 脏矩形差分靠透明索引

GIF 没有"只更新变化区域"的能力，但可以用透明索引模拟：

```ts
out[i] = real[i] === prevReal![i] ? transparentIndex : real[i]
```

把与上一帧**完全相同**的像素写成透明索引，配合 `dispose: 0`，
解码器就会沿用上一帧的内容——于是变化的像素才真正进 LZW 压缩流。

`prevReal` 必须保存**上一帧的真实色号**（不含透明占位），
不能拿写入用的缓冲区比，否则"连续三帧不变的像素"会被误判成变化。

### 8.2 三条不能踩回去的规矩

1. **不要设 `dispose: 2`** —— 那会强制每帧全量编码，体积直接翻倍
2. **调色板只量化一次**（首帧），所有帧共用 —— 每帧各自量化会让色号在帧间漂移，
   播放时整片格子集体变色（"闪烁"）
3. **透明索引要用尾部多留的一项** —— GIF 的透明色是靠"色号 + 标志"表达的，
   这个色号必须占一个真实槽位，所以量化色数上限是 255 而非 256

### 8.3 `asExactU8()`

`applyPalette` 内部是 `new Uint32Array(rgba.buffer)`——**只看整个 ArrayBuffer**，
不看 `byteOffset` / `byteLength`。canvas 给的 view 恰好是精确的，
但一旦底层 buffer 被复用或更大，就会整帧读到错位的像素。

宁可多一次拷贝，也不能让编码器读到不属于这一帧的数据。

---

## 9. `font.ts` —— 5×7 点阵字体

自绘，硬边、无抗锯齿。**不用系统字体**，因为：

- 矢量字体会发虚，和像素画不配
- 位图字体宽度不齐，右对齐只能靠 `len(name)*6` 硬猜（用户名一长就飘）

点阵字体每个字符固定 6px 步进，宽度可精确计算：

```ts
textWidth(text) = (text.length * 6 - 1) * scale
```

**横向游程合并**：一行里的连续亮像素合成一个 `fillRect`。
一帧几十个字符只发几十次调用（逐像素画会发上千次）。

---

## 10. `index.ts` —— CLI 与流程编排

只做参数解析和串流程，逻辑一行都不放这里。

流程：

```
解析参数
  ↓
决定数据源（--offline 或无 token → 假数据，否则抓真数据，失败降级）
  ↓
new Engine(...)
  ↓
encodeGif(engine.iterFrames(), output, frameMs, colors)
  ↓
打印统计；若设了 GITHUB_OUTPUT 则追加输出（供 Action 读取）
```

参数与参考项目对齐，见[05-running.md](05-running.md)。
