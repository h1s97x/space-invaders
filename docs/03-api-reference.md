# 03 · API 参考

全部导出符号清单。**按模块分组，每个都标注用途与注意点。**

## 1. `config.ts` —— 常量

### 1.1 类型

```ts
type Rgb = readonly [number, number, number]
function rgba(color: Rgb, alpha?: number): string
```

`rgba()` 把 RGB 元组转成 canvas 的 `rgba()` 字符串，`alpha` 取 0~255（会自动 clamp）。
全项目统一走它，避免各处手写 alpha 换算出错。

### 1.2 画面几何

| 常量 | 值 | 说明 |
|---|---|---|
| `CELL` | 12 | 格子边长（px） |
| `GAP` | 3 | 格子间距 |
| `PADDING` | 40 | 画布边距 |
| `PITCH` | 15 | `CELL + GAP`，相邻格子中心距 |
| `COLS` | 52 | 列数（周） |
| `ROWS` | 7 | 行数（日） |
| `SHIP_ROW` | 10 | 飞船所在行，`ROWS + 3` |
| `GRID_W` | 780 | `COLS × PITCH` |
| `WIDTH` | 860 | `GRID_W + 2 × PADDING` |
| `HEIGHT` | 230 | `SHIP_ROW × PITCH + 2 × PADDING` |

### 1.3 坐标转换

```ts
function cellX(cx: number): number   // PADDING + cx * PITCH
function cellY(cy: number): number   // PADDING + cy * PITCH
```

**全项目唯一的格↔像素换算入口。** 注意 `cx` 是格坐标不是像素。

### 1.4 调色板

| 常量 | RGB | 用途 |
|---|---|---|
| `BACKGROUND` | (13, 17, 23) | 画布底色 |
| `GRID_COLOR` | (22, 27, 34) | 空格子 |
| `SHIP_COLOR` | (68, 147, 248) | 飞船（唯一亮色） |
| `BULLET_COLOR` | (255, 223, 0) | 子弹 + 爆炸粒子 |

以上四个全部照抄参考项目 `RenderContext.darkmode()`。

### 1.5 速度与时长

**单位是「格/秒」和「秒」，与帧率解耦。**

| 常量 | 值 | 说明 |
|---|---|---|
| `SHIP_SPEED` | 12.5 | 飞船横移（格/秒） |
| `BULLET_SPEED` | 7.5 | 子弹上移（格/秒） |
| `SHIP_SHOOT_COOLDOWN` | 0.2 | 两炮最小间隔（秒） |
| `BULLET_TRAILING_LENGTH` | 3 | 拖尾段数 |
| `BULLET_TRAIL_SPACING` | 0.15 | 拖尾段间距（格） |

### 1.6 爆炸

| 常量 | 小爆炸 | 大爆炸 | 说明 |
|---|---|---|---|
| `EXPLOSION_PARTICLE_COUNT_*` | 4 | 8 | 粒子数 |
| `EXPLOSION_MAX_RADIUS_*` | 10 | 20 | 最大半径（格） |
| `EXPLOSION_DURATION_*` | 0.12 | 0.4 | 时长（秒） |

**小爆炸 = 子弹命中但没打死；大爆炸 = 打爆。**

### 1.7 星空

| 常量 | 值 |
|---|---|
| `STAR_COUNT` | 100 |
| `STAR_SPEED_MIN` | 1.0 |
| `STAR_SPEED_MAX` | 2.5 |

速度公式：`MIN + brightness × (MAX - MIN)`——**越亮越快 = 越近**。

### 1.8 时间换算（反直觉）

```ts
function deltaTimeFor(fps: number): number   // 3.0 / fps
function frameMsFor(fps: number): number     // 2000 / fps
```

⚠️ **都不是直觉里的 `1/fps` 和 `1000/fps`。**

`deltaTime = 3.0/fps` 是真实帧间隔的 3 倍，相当于给所有速度乘 1.5 倍系数；
`frameMs = 2000/fps` 让播放帧率只有 `fps/2`。

这两个来自参考项目，**刻意原样保留**。`test/config.test.ts` 有用例锁住。

### 1.9 其他

| 常量 | 值 | 说明 |
|---|---|---|
| `DEFAULT_FPS` | 40 | 参考项目默认值 |
| `DEFAULT_COLORS` | 32 | GIF 调色板颜色数 |
| `FORCE_KILL_FRAMES` | 100 | 收尾等在飞子弹的帧数上限 |
| `TAIL_FRAMES` | 5 | 收尾后额外输出帧数 |

---

## 2. `types.ts` —— 实体

### 2.1 `Enemy`

```ts
class Enemy {
  constructor(x: number, y: number, health: number)
  x: number          // 列号（整数 0..51）
  y: number          // 行号（整数 0..6）
  health: number     // 剩余血量，= 贡献等级 1..4
  get alive(): boolean
  get cx(): number
  get cy(): number
  takeDamage(): 'hit' | 'dead'
}
```

- `alive` 等价于 `health > 0`
- `takeDamage()` 血量减 1，返回是否打死——调用方据此选爆炸类型
- 血量上限 4（`ENEMY_COLORS` 只有 4 档）

### 2.2 `Bullet`

```ts
class Bullet {
  constructor(x: number, y: number)
  x: number   // 整数列号
  y: number   // 浮点格坐标
}
```

⚠️ `x` **必须是整数**。命中判定依赖这一点：

```ts
enemies.find(e => e.x === b.x && e.y >= b.y)
```

若 `x` 变成浮点，`.find` 的严格相等会失效，子弹会打不到任何东西。

### 2.3 `Ship`

```ts
class Ship {
  constructor(startX: number)
  x: number
  targetX: number
  shootCooldown: number
  moveTo(x: number): void
  isMoving(): boolean
  canShoot(): boolean
  animate(deltaTime: number, speed: number): void
}
```

- `animate` 用 `min`/`max` 夹住，**绝不越过目标**
- `shootCooldown` 在 `animate` 里倒数

### 2.4 `Explosion`

```ts
class Explosion {
  constructor(x, y, size: 'small'|'large', duration, maxRadius, particleCount, angles)
  elapsed: number
}
```

`angles` 是构造时一次性算好的粒子方向（每颗一个弧度值），
避免每帧重算三角函数。

### 2.5 `Star`

```ts
class Star { constructor(x, y, brightness, size, speed) }
```

坐标也是格坐标，`brightness` 直接当灰度用。

### 2.6 `Action` / `Contributions` / `Strategy`

```ts
class Action { constructor(x: number, shoot?: boolean) }
class Contributions { constructor(rows: number[][], username: string, total?: number) }

const Strategy = { COLUMN:'column', ROW:'row', RANDOM:'random', CHAOS:'chaos' }
type Strategy = 'column' | 'row' | 'random' | 'chaos'
function isStrategy(v: string): v is Strategy
```

⚠️ `Contributions.rows` 是 **`rows[day][week]`（日优先）**，
不是 GitHub API 的 `weeks[].days[]`（周优先）。

### 2.7 `ENEMY_COLORS`

```ts
{ 1: (0,109,50), 2: (38,166,65), 3: (57,211,83), 4: (87,242,135) }
```

键是**剩余血量**，所以掉血自动变暗一档。

---

## 3. `rng.ts` —— 随机数

```ts
class Rng {
  constructor(seed?: number)      // 省略则用时间+熵混合
  next(): number                  // [0, 1)
  uniform(a, b): number           // [a, b)
  int(a, b): number               // [a, b] 闭区间
  choice<T>(seq: readonly T[]): T
  weighted<T>(seq: readonly T[], weights: readonly number[]): T
}
```

| 方法 | 对应 Python |
|---|---|
| `uniform(a,b)` | `rng.uniform(a,b)` |
| `int(a,b)` | `rng.randint(a,b)`（闭区间） |
| `choice(seq)` | `rng.choice(seq)` |
| `weighted(seq,w)` | `rng.choices(seq, weights=w)[0]` |

⚠️ **`weighted` 要求 `weights` 长度为 0 时不调用**（会返回 `seq[seq.length-1]`，
但那是兜底路径，正常不该走到）。

---

## 4. `data.ts` —— 数据源

```ts
async function fetchContributions(
  username: string,
  token: string | undefined
): Promise<Contributions | null>

function generateDummy(username?: string): Contributions
```

### 4.1 `fetchContributions`

**任何失败都返回 `null`，绝不抛出。** 覆盖的失败模式：

| 情况 | 返回 |
|---|---|
| HTTP 非 2xx（401/403 限流等） | `null` + 警告 |
| 网络超时（15秒） | `null` + 警告 |
| 响应非 JSON | `null` + 警告 |
| GraphQL `errors` 字段非空（HTTP 200 + errors 是它的习惯） | `null` + 警告 |
| 用户不存在 | `null` + 警告 |

成功时 `rows` 是 `rows[day][week]`，`total` 是 `totalContributions`。

⚠️ **token 只在内存中使用**，不写入产物、日志或 GIF。

### 4.2 `generateDummy`

用 `crc32(username)` 播种（不是 `hash()`），保证跨机器可复现。
产出 7×52 的矩阵，周末行更稀疏，额外随机 8 个 15~40 的高产格。

---

## 5. `engine.ts` —— 引擎

### 5.1 构造

```ts
new Engine(
  contrib: Contributions,
  strategy?: Strategy,    // 默认 COLUMN
  fps?: number,      // 默认 DEFAULT_FPS = 40
  maxFrames?: number,     // 默认 0 = 自动推算
  fireInterval?: number,
  seed?: number
)
```

⚠️ `strategy` 传 `COLUMN` 会得到"一排一排推过去"的机械观感。
**默认应该用 `RANDOM`**（CLI 层已这样设置）。

### 5.2 只读字段

```ts
readonly ship: Ship
readonly bullets: Bullet[]
readonly explosions: Explosion[]
readonly stars: Star[]
readonly deltaTime: number
readonly frameMs: number
readonly totalTargets: number
```

### 5.3 可变字段

```ts
enemies: Enemy[]      // 敌人（打爆即移除）
frame: number         // 当前帧号
shots: number         // 累计发弹
score: number         // 得分
defeated: number      // 已击败数
maxFrames: number
rand(): number        // 暴露给测试用
```

### 5.4 方法

| 方法 | 返回 | 说明 |
|---|---|---|
| `isComplete()` | `boolean` | 敌人是否清空 |
| `canTakeAction()` | `boolean` | `!ship.isMoving() && ship.canShoot()` |
| `shoot()` | `void` | 发射一炮，置冷却 |
| `animate()` | `void` | 推进一帧 |
| `iterFrames(verbose?)` | `Generator<Frame>` | 逐帧产出画面 |
| `simulate()` | `{cleared, frames, shots, enemies}` | 无渲染跑一遍 |
| `px(x)` / `py(y)` | `number` | 格坐标 → 像素 |

⚠️ `iterFrames()` 是**生成器**，只能消费一次。第二次调用会得到空序列。

### 5.5 `maxFrames` 自动推算

```ts
maxFrames = enemies.length * 240 + 4000
```

**安全上限，不是精确预算。** 策略是反应式的，真实帧数不可预测（实测 column 1983帧、
random 2661 帧、chaos 5600 帧，差距很大）。这个值只用来兜底防死循环撑爆内存。

---

## 6. `render.ts` —— 渲染

```ts
interface Frame {
  data: Uint8ClampedArray   // RGBA，长度 = WIDTH × HEIGHT × 4
  width: number
  height: number
}

class Renderer {
  constructor(game: Engine)
  render(celebration?: boolean): Frame
}
```

**Renderer 是只读的**——消费 `Engine` 字段，从不修改游戏状态。

---

## 7. `gif.ts` —— 编码

```ts
function buildPalette(first: Frame, colors?: number): number[][]

function encodeGif(
  frames: Iterable<Frame>,
  path: string,
  frameMs: number,
  colors?: number
): number    // 返回写入帧数
```

⚠️ **`frames` 只能消费一次**（内部用 `Symbol.iterator`）。传生成器没问题，传数组也只认一次。

### 7.1 `buildPalette`

用首帧量化出一张 `[r,g,b][]` 数组，所有帧共用。
**末尾会多留一项**当透明索引（所以量化色数上限是 255，不是 256）。

### 7.2 透明索引差分

```ts
out[i] = real[i] === prevReal![i] ? transparentIndex : real[i]
```

配合 `transparent: true` + `dispose: 0` 实现脏矩形差分。

⚠️ 三条不能踩回去的规矩：
1. **不要设 `dispose: 2`** —— 体积直接翻倍
2. **调色板只量化一次** —— 否则帧间色号漂移会"闪烁"
3. **透明索引必须占真实槽位** —— GIF 没有"第 256 个特殊色"

---

## 8. `font.ts` —— 点阵字体

```ts
const GLYPH_W = 5
const GLYPH_H = 7
const GLYPH_GAP = 1
const ADVANCE = 6                    // 每字符占宽
const GLYPHS: Record<string, string[]>

function textWidth(text: string, scale?: number): number
function drawText(ctx, x, y, text, color, scale?, alpha?): void
```

### 8.1 `textWidth`

```ts
textWidth(text, scale) = (text.length * 6 - 1) * scale
```

右对齐/居中都靠它，不用再猜 `len(name) * 6`。

### 8.2 `drawText`

- 字形是 5×7 的字符串数组，`#` = 亮、`.` = 空
- **只实现大写字母**，`drawText` 内部自动 `toUpperCase()`
- 没做某个字形就留空（不画方框）
- 内部做了**横向游程合并**：一行里的连续亮像素合成一个 `fillRect`

### 8.3 支持的字符

```
A-Z  0-9  @ - _ . / % : + ! (空格)
```

**不支持小写字母**（点阵字体惯例）、不支持中文。
若要显示中文用户名需要另找方案。

---

## 9. `index.ts` —— CLI

### 9.1 参数

| 参数 | 别名 | 默认 | 说明 |
|---|---|---|---|
| `username` | 位置参数 / `--user` | 环境变量或 `octocat` | GitHub 用户名 |
| `--output` | `-o` | `game.gif` | 输出文件名 |
| `--strategy` | `-s` | **`random`** | `column`/`row`/`random`/`chaos` |
| `--fps` | | `40` | 帧率 |
| `--max-frame` | | `0` | 帧数上限，0 = 自动 |
| `--colors` | | `32` | 调色板颜色数 |
| `--seed` | | 无 | 随机种子 |
| `--fire-interval` | | `2` | 两炮最小帧间隔 |
| `--offline` | | `false` | 用假数据 |
| `--quiet` | | `false` | 不打印逐帧进度 |

⚠️ **默认策略是 `random` 而非 `column`。** 这是刻意设置的：
`column` 会得到"从左到右一排一排清理"的机械观感。

### 9.2 用户名解析优先级

```
--user 参数
  → GITHUB_USER 环境变量
  → GITHUB_REPOSITORY_OWNER 环境变量
  → "octocat"
```

### 9.3 数据源选择

```
--offline 或 无 token  →  generateDummy()
否则                   →  fetchContributions()，失败降级到 generateDummy()
```

### 9.4 `GITHUB_OUTPUT`

若设了 `GITHUB_OUTPUT` 环境变量，结束时追加：

```
output=<路径>
frames=<帧数>
score=<得分>
username=<用户名>
```

供 GitHub Action 的后续步骤读取。

---

## 10. 全局约定速查

| 约定 | 说明 |
|---|---|
| 坐标 | 逻辑用**格坐标**，像素只在渲染层出现 |
| `x` = 列，`y` = 行 | 与参考项目一致，别搞反 |
| 时间 | 速度用「格/秒」，时长用「秒」 |
| 颜色 | `Rgb` 三元组，转 canvas 用 `rgba()` |
| 命名 | 私有成员加 `private`，不用 `#` |
| 异步 | 只有 `fetchContributions` 是 async，其余全同步 |
| 随机 | 一切随机走 `Rng` 实例，禁止裸用 `Math.random()` |
