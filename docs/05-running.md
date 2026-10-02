# 05 · 运行方式

## 1. 环境要求

| 项| 要求 | 检查 |
|---|---|---|
| Node.js | **≥ 22** | `node -v` |
| npm | ≥ 10 | `npm -v` |
| 内存 | ≥ 512 MB | 渲染 2600+ 帧需要 |
| 网络 | 仅真数据模式需要 | — |

**不需要**：Python、cairo、node-gyp、编译工具链。

## 2. 安装

### 2.1 最轻量（尝鲜与 CI）

```bash
git clone https://github.com/h1s97x/gh-space-invaders.git
cd gh-space-invaders
npm ci
npm run build
```

用 `npm ci` 而非 `npm install`——前者严格按 lockfile 装版本，可复现。

### 2.2 免克隆（直接从 GitHub 跑）

```bash
npx github:h1s97x/gh-space-invaders --offline
```

需要先发 npm 包（当前 `private: true`，暂不可用）。

### 2.3 免编译（用 tsx 直跑）

```bash
git clone https://github.com/h1s97x/gh-space-invaders.git
cd gh-space-invaders
npm install          # 只装依赖，不编译
npm run offline      # tsx 直接跑 .ts
```

开发时推荐这样，改完立刻看效果。

### 2.4 Docker

```bash
docker run --rm -v "$PWD:/out" node:22-slim \
  sh -c "npm ci && npm run build && \
         node dist/index.js --offline --quiet -o /out/game.gif"
```

## 3. 命令行用法

### 3.1 基本形式

```bash
node dist/index.js [用户名] [选项]
```

用户名可省略，解析优先级：

```
--user 参数
  → GITHUB_USER 环境变量
  → GITHUB_REPOSITORY_OWNER 环境变量
  → "octocat"
```

### 3.2 完整参数表

| 参数 | 别名 | 默认 | 说明 |
|---|---|---|---|
| `username` | `--user` | 见上 | GitHub 用户名 |
| `--output` | `-o` | `game.gif` | 输出文件名 |
| `--strategy` | `-s` | **`random`** | 清除策略，见下|
| `--fps` | | `40` | 播放帧率 |
| `--max-frame` | | `0` | 帧数上限，0 = 自动推算 |
| `--colors` | | `32` | 调色板颜色数（2~255） |
| `--seed` | | 无 | 随机种子 |
| `--fire-interval` | | `2` | 两炮最小帧间隔 |
| `--offline` | | `false` | 用假数据 |
| `--quiet` | | `false` | 不打印逐帧进度 |
| `--help` | `-h` | | 帮助 |

### 3.3 四种策略

| 值 | 行为 | 实测帧数 | 观感 |
|---|---|---|---|
| **`random`** | 取最近 8 个有目标的列，按`同列10 / 1~3列100 / 4列以上1` 加权随机，打该列最下面的敌人 | 2661 | **默认**。会来回跳，有意外感 |
| `column` | 从第 0 列扫到第 51 列 | 1983 | 一排一排推过去，**最机械** |
| `row` | 逐行，行内之字形推进 | 2184 | 横向往复 |
| `chaos` | 优先打等级最高的格子 | 5600 | 慢，无规律 |

⚠️ **`column` 的清场顺序严格单调递增**（0,1,2,3,4,5…），这就是"机械"的来源。
`test/strategy.test.ts` 有回归用例锁住"`random` 必须非单调"。

### 3.4 典型用法

```bash
# 离线冒烟（最快，3 秒出结果）
node dist/index.js --offline --quiet -o /tmp/smoke.gif

# 可复现：同一个 seed 两次结果完全一致
node dist/index.js --offline --seed 42 -o a.gif
node dist/index.js --offline --seed 42 -o b.gif
cmp a.gif b.gif    # 应完全相同

# 高帧率（播放更流畅，但体积和帧数不变）
node dist/index.js --offline --fps 50 -o smooth.gif

# 小体积
node dist/index.js --offline --colors 16 -o small.gif

# 真实数据（需要 token）
export GITHUB_TOKEN=ghp_xxx
node dist/index.js h1s97x -o mine.gif

# 试不同策略，选最喜欢的
for s in random row chaos column; do
  node dist/index.js --offline --seed 7 -s $s -q -o demo-$s.gif
done
```

## 4. npm 脚本

| 脚本 | 等价命令 |
|---|---|
| `npm run build` | `tsc -p tsconfig.json` |
| `npm start` | `node dist/index.js` |
| `npm run offline` | `tsx src/index.ts --offline` |
| `npm run dev` | `tsx src/index.ts` |
| `npm test` | `node --import tsx --test "test/*.test.ts"` |
| `npm run check` | `build` + `test` |

⚠️ `offline` 和 `dev` 走 tsx（免编译），`start` 走 dist（需先 build）。

## 5. 作为 GitHub Action 使用

```yaml
- uses: h1s97x/gh-space-invaders@v1
  with:
    username: ${{ github.repository_owner }}
    output: contrib.gif
    seed: '42'

- uses: actions/upload-artifact@v4
  with:
    name: contrib-gif
    path: contrib.gif
```

### 5.1 输入项

| 输入 | 默认 | 说明 |
|---|---|---|
| `username` | 仓库 owner | GitHub 用户名 |
| `strategy` | `random` | 清除策略 |
| `fps` | `40` | 播放帧率 |
| `colors` | `32` | 调色板颜色数 |
| `seed` | 空 | 随机种子 |
| `output` | `space-invaders.gif` | 输出文件名 |
| `token` | 空 | 可选 PAT，默认用 `github.token` |

### 5.2 输出项

| 输出 | 说明 |
|---|---|
| `path` | GIF 的相对路径 |
| `bytes` | 字节数 |

### 5.3 注意事项

- Action 内部会在**它自己的目录**装依赖编译，产物再搬回工作目录，
  **不污染使用方仓库**
- 需要 `contents: read` 权限（读贡献图）
- 私有仓库或读不到公开数据时才需要传 `token`

## 6. 在 CNB / CI 里跑

```yaml
- name: 安装依赖
  command: npm ci
- name: 类型检查
  command: npm run build
- name: 单元测试
  command: npm test
- name: 出图
  command: node dist/index.js --offline --seed 1 --quiet -o dist/smoke.gif
```

完整流水线见 [`.cnb.yml`](../.cnb.yml) 与
[`.github/workflows/ci.yml`](../.github/workflows/ci.yml)。

## 7. 输出规格

| 项 | 值 |
|---|---|
| 格式 | GIF89a |
| 尺寸 | 860 × 230（固定） |
| 调色板 | 2~255 色，默认 32 |
| 帧时长 | `2000 / fps` 毫秒（fps=40 → 50ms） |
| 循环 | 无限（`loop=0`） |
| 透明 | 用作差分占位，不含真实透明区域 |

### 7.1 体积预期

离线假数据（269 个非空格）实测：

| 策略 | 帧数 | 时长 | 体积 |
|---|---|---|---|
| column | 1983 | 99s | ~3.0 MB |
| random | 2661 | 133s | ~4.0 MB |
| chaos | 5600 | 280s | ~8.5 MB |

**减色数省不了多少**（16 色 vs 32 色只省约 6%，画质明显变糙），
真正决定体积的是**帧数**。想压体积应该减帧（降 fps 或缩短时长），不是减颜色。

## 8. 故障排查

| 现象 | 原因 | 解法 |
|---|---|---|
| `ERANGE out of range`（canvas） | Node 版本过低 | 升级到 Node 22 |
| `The requested module does not provide an export named 'GIFEncoder'` | 引用了裸包名 | 引 `gifenc/dist/gifenc.esm.js` |
| GIF 打不开 / 只有第一帧 | 差分逻辑坏了 | 检查 `prevReal` 基准是否正确 |
| 画面全黑 | 编译产物缺失 | `npm run build` |
| 一直转圈不出图 | 策略死循环 | 跑 `npm test`，多半是回归了 |
| GIF 巨大（>10MB） | 用了 `chaos` 或 `--colors` 太大 | 换 `random` |

如果测试挂了，先看是不是碰了 `test/strategy.test.ts` 里那几个回归用例——
它们锁的都是曾经真实踩过的坑。
