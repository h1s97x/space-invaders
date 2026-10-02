# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### ⚠️ 破坏性变更

- **项目从 Python 改写为 TypeScript。** 原Python 实现（`gh_space_invaders/`）已全部移除。
  - CLI 入口由 `python -m gh_space_invaders` 改为 `node dist/index.js`
  - 部分参数更名：`--max-frame` 保留，`--fire-interval` 移除
  - 画面尺寸与格子几何改为对齐参考项目（860×230，cell 12 / gap 3 / padding 40）
  - 依赖从 Pillow 换成 `@napi-rs/canvas` + `gifenc`

### 新增

- 离线模式（`--offline`），无需 GitHub token 即可生成
- 可复现随机种子（`--seed`）
- 32 个单元测试，覆盖坐标系、运动、碰撞、策略、GIF 产物
- GitHub Actions / CNB 流水线，以及作为 Action 使用的能力
- 仓库文档：贡献指南、安全政策、行为准则

### 变更

- 贡献度按**分位数**分档为1~4 档（原Python 版直接用原始贡献数，会出现 hp40）
- 坐标系统改为**格坐标**，子弹 x 量化为整数列
- 渲染改为预渲染静态底 + `drawImage`；GIF 改用**透明索引差分**压缩

### 修复

- 策略活锁：某些数据下帧数暴涨却几乎不开火
- `score` 恒为 0（先扣血再读血量导致读到 0）
- 收尾阶段残留活靶打不完

