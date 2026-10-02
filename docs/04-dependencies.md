# 04 · 依赖关系

## 1. 一句话总结

**运行时只有 2 个依赖**（`@napi-rs/canvas` + `gifenc`），开发依赖 3 个。
对比参考项目的 5 个运行时依赖（typer/httpx/dotenv/rich/pillow），
我们把CLI、HTTP、终端渲染全部省掉了——用 Node 内置能力和 canvas。

## 2. 运行时依赖

### 2.1 `@napi-rs/canvas` —— 渲染

```json
"@napi-rs/canvas": "^0.1.60"
```

Canvas 2D 实现，API 与浏览器 `CanvasRenderingContext2D` 基本一致。

**为什么不用 `node-canvas`**：

| | `@napi-rs/canvas` | `node-canvas` |
|---|---|---|
| 安装 | 预编译二进制，npm i 即用 | 需要系统装 cairo / pango，编译可能失败 |
| 平台 | mac / linux / win 全预编译 | 依赖系统库 |
| 许可 | MIT | MIT |

对本项目这种"要能在 CI 和各种机器上跑"的场景，预编译是决定性优势。

**用到的 API**（很少，就这几个）：

```ts
createCanvas(w, h)          // 创建画布
ctx.getContext('2d')        // 取 2D 上下文
ctx.fillRect / fillStyle    // 矩形填充
ctx.beginPath / moveTo / lineTo / closePath / fill   // 多边形
ctx.roundRect               // 圆角矩形
ctx.drawImage               // 贴预渲染的静态底
ctx.getImageData            // 取像素
```

⚠️ **Canvas 会抗锯齿**，而参考项目用的 PIL 不会。所以同一段多边形代码，
画出来的边缘有细微渐变。这是已知差异（实测飞船边缘比参考略"虚"一点）。

### 2.2 `gifenc` —— GIF 编码

```json
"gifenc": "^1.0.3"
```

纯 JS 的 GIF 编码器，MIT 许可，作者 Matt DesLauriers。

**为什么自己编码而不用现成方案**：

- 浏览器端的 `gif.js` 依赖 Web Worker，Node 下不好用
- `omggif` 更底层，但没有内置量化器，要自己实现
- `gifenc` 自带 PnnQuant 量化器 + LZW 压缩，够用且体积小（5KB before gzip）

**三个必须知道的坑**（详见 [02-modules.md §8](02-modules.md)）：

1. gifenc 是 CJS，Node ESM 下具名导出探测不到，必须显式引
   `gifenc/dist/gifenc.esm.js`
2. 调色板是 `[r,g,b][]` 子数组数组，不是扁平字节；`applyPalette` 要求长度 ≤ 256
3. `applyPalette` 内部只看整个 `ArrayBuffer`，必须传长度精确的 view

### 2.3 为什么没有其他运行时依赖

| 需求 | 我们的做法 | 替代的库 |
|---|---|---|
| CLI 参数解析 | 手写 40 行 switch | typer / commander |
| HTTP 请求 | Node 22 内置 `fetch` | httpx / axios |
| 环境变量 | `process.env` | python-dotenv |
| 进度条 | `console.log` | rich |

**GitHub GraphQL 只需要发一次 POST**，用不着 axios 那种重方案；
**参数总共 9 个**，手写比引库更省事且没有传递依赖。

## 3. 开发依赖

```json
"@types/node": "^22.9.0"
"tsx": "^4.19.2"
"typescript": "^5.6.3"
```

### 3.1 `typescript` —— 编译 + 类型检查

`tsconfig.json` 开了 `strict`、`noUnusedLocals`、`noImplicitOverride`。

`npm run build` 同时完成类型检查和编译——**没有单独的 typecheck 步骤**，
因为 `tsc` 报错就不会产出。

### 3.2 `tsx` —— 直接跑 TypeScript

```bash
npm run dev -- --offline      # 改完立刻看效果，不用先编译
npm run offline               # 冒烟测试
npm test                      # 跑测试
```

**测试也走 tsx**，所以不需要额外配置。

### 3.3 `@types/node` —— Node 类型

`node:test`、`node:assert`、`fs`、`path`、`zlib` 的类型。

## 4. 测试依赖：零

**测试框架用 Node 22 内置的 `node:test` + `node:assert`，不加任何依赖。**

```bash
npm test    # node --import tsx --test "test/*.test.ts"
```

对比参考项目用 `pytest` + `pytest-asyncio`。我们连这两个都不需要。

## 5. 依赖树

```
gh-space-invaders
├── @napi-rs/canvas@0.1.x        （运行时）
│   └── 无传递依赖（预编译二进制）
├── gifenc@1.0.3                 （运行时）
│   └── 无传递依赖
├── typescript@5.6.x        （开发）
│   └── 无传递依赖
├── tsx@4.19.x                  （开发）
│   └── esbuild（传递）
└── @types/node@22.x            （开发）
    └── undici-types
```

**总传递依赖只有 2 个**（`esbuild` + `undici-types`），
其中 `esbuild` 只在开发时用（tsx 依赖）。

安装体积：

| | 参考项目 | 本项目 |
|---|---|---|
| 运行时依赖数 | 5 | 2 |
| 需要编译 | 否（都是wheel） | 否（预编译二进制） |
| 需要系统库 | Python 3.12+ | 仅 Node 22+ |

## 6. 版本支持矩阵

| 环境 | 版本 | 说明 |
|---|---|---|
| Node.js | **≥ 22** | 硬性要求 |
| npm | ≥ 10 | `npm ci` 需要 |
| 操作系统 | Linux / macOS / Windows | `@napi-rs/canvas` 全平台预编译 |
| Docker | `node:22` | CI 用|

**为什么硬性要求 Node 22**：

- `node:test` 的 `--import` 加载器用法（测试依赖它）
- 全局 `fetch`（`data.ts` 用它抓GitHub 数据）
- `AbortSignal.timeout()`（同上）

低于 22 需要降级处理，收益不大，所以直接抬高门槛。

## 7. 安全考量

### 7.1 供应链

运行时依赖只有 2 个，且都是**单一维护者 + 小体积 + 无传递依赖**——
供应链攻击面极小。

建议 CI 用 `npm ci` 而非 `npm install`，以使用 lockfile 锁定的确切版本。

### 7.2 GitHub token

`fetchContributions` 需要 `GITHUB_TOKEN`（或 `GH_TOKEN`）环境变量。

**token 只在内存中使用**：

- 不写入任何文件
- 不打印到日志
- 不嵌入 GIF（GIF 只含像素）

详见 [SECURITY.md](../SECURITY.md)。

### 7.3 网络访问

程序**只在显式调用 `fetchContributions` 时**访问 `api.github.com/graphql`。
`--offline` 模式完全不联网。

### 7.4 许可证兼容性

| 依赖 | 许可 | 与 MIT 兼容 |
|---|---|---|
| `@napi-rs/canvas` | MIT | ✅ |
| `gifenc` | MIT | ✅ |
| `typescript` | Apache-2.0 | ✅ |
| `tsx` | MIT | ✅ |
| `esbuild`（传递） | MIT | ✅ |

Apache-2.0 与 MIT 兼容（但 Apache-2.0 有专利条款，
若分发 typescript 产物需保留其 NOTICE——**我们不分发**，
typescript 只是构建期工具）。

本项目自身的许可见 [LICENSE](../LICENSE) 与 [NOTICE](../NOTICE)。
