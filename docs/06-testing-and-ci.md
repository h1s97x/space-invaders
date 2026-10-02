# 06 · 测试与 CI

## 1. 测试哲学

**不引入任何测试框架。** 用 Node 22 内置的 `node:test` + `node:assert`，
由 `tsx` 直接跑TypeScript。理由：

- 零依赖 = 零供应链风险 + 零版本冲突
- `npm test` 从安装到出结果 3~5 秒
- 测试框架本身不需要被测试

**测试的重点不是覆盖率，是回归防护。**

这个项目从 Python 时代演进到TypeScript，中间踩过好几个很难查的坑
（策略活锁、残留活靶、score 恒为 0）。这些坑修完之后，
**每一个都配了一条测试锁住**，所以它们不会再回来。

## 2. 运行测试

```bash
npm test                                   # 全部（推荐，CI 用这个）

node --import tsx --test "test/*.test.ts"  # 同上，显式写法

node --import tsx --test test/config.test.ts    # 单个文件

node --import tsx --test --test-name-pattern "清场" # 按用例名过滤
```

⚠️ **`node --test test/` 不行**（会报 `ERR_UNSUPPORTED_DIR_IMPORT`），
必须用 glob。

### 2.1 在提交前跑

```bash
npm run check     # build + test
```

## 3. 测试用例清单（32 例）

### `config.test.ts`（7 例）—— 常量契约

锁住画布尺寸、格子几何、坐标映射、速度单位。

| 用例 | 断言 |
|---|---|
| 画布尺寸 | `WIDTH === 860`、`HEIGHT === 230` |
| 格子几何 | `CELL 12` / `GAP 3` / `PADDING 40` / `PITCH 15` |
| 网格尺寸 | `COLS 52` / `ROWS 7` / `SHIP_ROW 10` |
| 坐标映射 | `cellX(0) === 40`、`cellY(10) === 190` |
| 速度单位 | `12.5` / `7.5` / `0.2` |
| **时间函数** | `deltaTimeFor(40) === 0.075`、`frameMsFor(40) === 50`，且 `!== 1/40` |
| 敌人配色 | 键恰好是 `[1,2,3,4]` |

⚠️ 时间函数那条用例的**意图是锁住"反直觉"**：
有人看到 `3.0/fps` 会以为是bug 想去"修正"，这条用例会让测试失败。

### `ship.test.ts`（6 例）—— 运动与开火闸门

| 用例 | 断言 |
|---|---|
| 出生位置 | `x === 25`（52 列正中），静止 |
| 匀速逼近 | 每帧位移 `=== speed × dt` |
| **绝不越过** | 目标比一帧位移还近时，精确停在目标 |
| `isMoving` | `x !== targetX`，到位后为 false |
| 开火冷却 | 开火后 2 帧仍false、3 帧后 true（0.2s ÷ 0.075） |
| 左右对称 | 向右 / 向左位移量相等 |

### `collision.test.ts`（5 例）—— 碰撞与伤害

| 用例 | 断言 |
|---|---|
| 敌人血量 | 初始 = 等级 |
| `takeDamage` | 未死返回 `hit`、打死返回 `dead` |
| **子弹 x 是整数** | `Number.isInteger(b.x)` |
| 命中判定 | 同列且 `y >= bullet.y` 才命中 |
| **只打最靠上那格** | `find` 取第一个满足的 |
| 血量上限 4 | 各级打对应次数后死亡 |

### `strategy.test.ts`（8 例）—— 策略与回归防护

**这个文件最重要。** 全部是踩坑记录：

| 用例 | 防的是什么 |
|---|---|
| 四种策略都能清空 | `RowStrategy` 残留活靶（曾剩 45 个 / 剩 1 个） |
| 都不会死循环 | 策略活锁（曾 17435 帧只开 33 枪 / Python 版直接超时） |
| 都会真正开火 | 同上（曾只开 20 枪） |
| `column` 顺序单调递增 | 记录它的定义（**不是 bug，是特性**） |
| **`random` 顺序非单调** | 默认策略被误设为 `column`，观感变机械 |
| **默认策略是 random** | 同上（直接读 `index.ts` 源码断言） |
| `random` 不跑整张图 | 为一个远处孤格跑 3000 帧 |
| **血量只能 1~4** | 分档丢失，出现 hp40 |
| **score 与击败数成正比** | 先减血再读血量 → score 恒 0 |

其中"默认策略"那条用例的写法值得一提：

```ts
const src = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const m = src.match(/strategy:\s*Strategy\.(\w+)/);
assert.equal(m[1], 'RANDOM');
```

**不 import `index.ts`**（它有副作用会真的跑起来），
而是读源码文本断言默认值。

### `gif.test.ts`（4 例）—— 产物格式

| 用例 | 断言 |
|---|---|
| GIF 头 | `GIF89a`、尾块 `0x3B`、尺寸 860×230、有全局色表 |
| 颜色数生效 | 16 色体积 ≤ 32 色体积 |
| 颜色数 clamp | `0` / `1` / `300` 都不崩 |
| 帧时长换算 | `fps=40 → 50ms` |

⚠️ **必须用极小的数据集**（4 个格子）。完整动画有 2600+ 帧，
一次性编码进内存会 OOM——实测三次全量编码直接 `SIGKILL`。

## 4. 测试辅助（`test/helpers.ts`）

```ts
makeContrib(cells, username?)      // 造可控数据：cells[列][行]
oneCellPerColumn(level?)     // 每列 1 格，用来看清场顺序
clearOrder(contrib, strategy, seed?) // 记录每列被打空的先后
isStrictlyIncreasing(xs)          // 判断序列严格递增
```

`clearOrder` 从 `iterFrames` 逐帧观察（不是 `simulate`），
因为需要看局面变化。数据集小所以很快。

## 5. 什么该测、什么不该测

|该测 | 不该测 |
|---|---|
| 坐标换算、画布尺寸 | 每个绘制函数的像素输出 |
| 运动学（匀速、不越界） | 具体的动画观感 |
| 碰撞判定的边界 | gifenc 内部行为 |
| 策略能否清场、会不会死循环 | 每一帧的具体内容 |
| 产物格式（头/尾/尺寸） | 体积精确值 |
| **每一个曾经踩过的坑** | — |

**原则：测"会不会出错"，不测"长什么样"。**
观感靠人眼判断，写成断言反而会 brit���（改个配色就红一片）。

## 6. 加新测试的时机

**改了玩法逻辑就必须加回归测试。** 尤其是：

-动了策略选择逻辑
- 改了碰撞判定
- 改了坐标系统
- 改了血量 / 分档
- 修了一个 bug（**尤其是**）

修 bug 不补测试 = 这个 bug 一定会回来。这不是概率问题，是确定性——
你当时为什么会踩它，条件依然存在。

## 7. CI 配置

### 7.1 GitHub Actions

`.github/workflows/ci.yml`：

```
push / PR → Node 22 → npm ci → npm run build → npm test
          → 离线冒烟出图 → 上传产物
```

### 7.2 CNB

`.cnb.yml` 的 `main.push`：

```
build（装依赖 → 类型检查 → 测试 → 冒烟出图）
  ↓ 通过才继续
sync to github
```

**测试不过就不会往 GitHub 推。**

### 7.3 PR 门禁放哪边

**PR 门禁在 GitHub Actions，CNB 侧不重复做。**
用 `pull_request` 事件（而非 `pull_request.target`），
checkout 的是预合并后的代码，含 PR 分支的修改。

## 8. 性能

| 操作 | 耗时 |
|---|---|
| `npm test`（32 例） | 3~5 秒 |
| `npm run build` | ~2 秒 |
| `npm run check` | ~5 秒 |
| 离线出图（2661 帧） | ~18 秒 |

测试跑得快是因为策略用例用 `simulate()`（不渲染）。
若改成 `iterFrames()` 会慢一个数量级。
