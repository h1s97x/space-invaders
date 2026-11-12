/**
 * 像素管线：把低分辨率 RGBA 帧放大成点阵，并量化到 GIF 调色板。
 *
 * 两步各解决一个问题：
 *
 * 1. **放大**：画布只有 400×80 左右，直接输出会糊成一片。
 *    整数倍最近邻放大后每个逻辑像素变成 gifscale × gifscale 的方块，
 *    得到「像素艺术」观感（等价于最近邻缩放）。
 *
 * 2. **量化**：GIF 每帧最多 256 色。画面主体的纯色只有十几种
 *    （背景、网格、4 级敌人绿、飞船蓝、子弹黄、星空灰），
 *    因此按颜色频次直接建表即可，不做中位切分这类通用量化。
 *
 *    但"颜色不多"只对**纯色**成立：光栅化是自己实现的覆盖率混合，
 *    圆角矩形、飞船多边形与爆炸粒子的边缘会产出数千种中间色
 *    （实测 90 天单张动图约 4100 种溢出色）。这些颜色数量少但位置关键 ——
 *    它们正好构成所有形状的轮廓，因此不能简单丢弃，见 buildPalette。
 */

import type { PixelBuffer, RGB } from "./types.js"

/**
 * 透明像素的固定键。
 *
 * 真实颜色用 24 位 RGB 打包（0x000000..0xFFFFFF，恒为非负），
 * 因此 -1 这个负数不可能与任何颜色相撞，可以安全地当作透明哨兵。
 */
const TRANSPARENT = -1

/**
 * 兜底索引。
 *
 * GIF 局部色表固定 256 项，精确色只占用 1..limit-1，最后一项留给
 * 「未入表」的颜色，这样量化时永远有地方可落，不会越界。
 */
export const FALLBACK_INDEX = 255

/**
 * 放大一帧。
 *
 * @param frame RGBA 缓冲（Uint8Array 或 Buffer）
 * @param width 源宽
 * @param height 源高
 * @param scale 放大倍数（1-8）
 */
export function upscale(
  frame: PixelBuffer,
  width: number,
  height: number,
  scale: number,
): { data: PixelBuffer; width: number; height: number } {
  if (scale <= 1) return { data: frame, width, height }

  const targetWidth = width * scale
  const targetHeight = height * scale
  const data = new Uint8ClampedArray(targetWidth * targetHeight * 4)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4
      const r = frame[source]
      const g = frame[source + 1]
      const b = frame[source + 2]
      const a = frame[source + 3]

      for (let dy = 0; dy < scale; dy++) {
        const rowStart = ((y * scale + dy) * targetWidth + x * scale) * 4
        for (let dx = 0; dx < scale; dx++) {
          const target = rowStart + dx * 4
          data[target] = r
          data[target + 1] = g
          data[target + 2] = b
          data[target + 3] = a
        }
      }
    }
  }

  return { data, width: targetWidth, height: targetHeight }
}

export interface Palette {
  /** 256 色 × 3 字节。**每个槽位都是真实颜色**，见下方关于兜底索引的说明 */
  palette: Uint8Array
  /** 精确色（24 位 RGB 打包）→ 索引；透明像素为 -1 → 0。size ≤ limit */
  map: Map<number, number>
  /**
   * 溢出色 → 最近的已入表索引。
   *
   * 在建表时就对「输入里真实出现过的溢出色」逐个解析完，
   * 因此逐像素量化仍然只是一次 O(1) 查表，不必边量化边算距离。
   */
  nearest: Map<number, number>
  /** 被合并的颜色种数 */
  overflow: number
}

/**
 * 按频次建调色板：出现最多的颜色占索引 1..n，其余按最近色合并。
 *
 * key 为 24 位 RGB 打包后的整数（透明像素用 -1 表示），见 pixelKey。
 *
 * 超出 limit 的颜色不直接丢弃：它们绝大多数是抗锯齿产生的中间色，
 * 一路塌到同一个索引会让边缘出现整圈异色描边，因此逐个匹配到最近的实色。
 */
export function buildPalette(
  frame: PixelBuffer,
  limit = 255,
  reserve: readonly RGB[] = [],
): Palette {
  // 单帧版只是多帧版的特例：包一层迭代器即可
  return buildPaletteFromFrames([frame], limit, reserve)
}

/**
 * 跨多帧统计颜色并按频次建表。
 *
 * 与单帧版的关键差别：**边迭代边统计，不保留任何帧缓冲** ——
 * 调用方可以传一个生成器（见 shooter.ts 的两趟流水），
 * 内存里只留颜色直方图，不随帧数线性增长。
 */
export function buildPaletteFromFrames(
  frames: Iterable<PixelBuffer>,
  limit = 255,
  reserve: readonly RGB[] = [],
): Palette {
  const counts = new Map<number, number>()
  // 每 4 字节一个像素，直接遍历
  for (const frame of frames) {
    for (let index = 0; index < frame.length; index += 4) {
      const key = pixelKey(frame, index)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])
  const palette = new Uint8Array(768)
  const map = new Map<number, number>()
  const nearest = new Map<number, number>()

  // 索引 0 固定留给透明色
  map.set(TRANSPARENT, 0)

  let next = 1
  let overflow = 0

  // 预留色优先占坑：背景渐变、星云与抗锯齿边缘的色阶动辄数百种，
  // 纯按频次排序会把激光、尾焰、爆炸这类「像素少但不能变色」的特效挤出
  // 255 色表，量化成灰蓝后在动画里彻底消失。调用方把主题里的关键色传进来。
  for (const color of reserve) {
    if (next >= limit) break
    const key = (color[0] << 16) | (color[1] << 8) | color[2]
    if (key === TRANSPARENT || map.has(key)) continue
    writeRGB(palette, next, color)
    map.set(key, next)
    next++
  }

  for (const [key] of sorted) {
    if (key === TRANSPARENT || map.has(key)) continue
    if (next >= limit) {
      overflow++
      continue
    }
    writeColor(palette, next, key)
    map.set(key, next)
    next++
  }

  // 尾部空槽（含兜底索引 255）统一写成最高频的实色。
  //
  // 之前这些槽位保持 Uint8Array 零初始化留下的纯黑：调色板本身没坏，
  // 但只要有任何像素落到兜底索引，就会画出一笔纯黑。
  // 抗锯齿边缘正是这样一批像素 —— 深色主题下背景本就接近黑，
  // 不易察觉；浅色主题下就是一圈明显的黑边。
  const primary: RGB = next > 1 ? readColor(palette, 1) : [0, 0, 0]
  for (let index = next; index < palette.length / 3; index++) writeRGB(palette, index, primary)

  // 溢出色逐个解析到最近色，只算一次
  for (const [key] of sorted) {
    if (key === TRANSPARENT || map.has(key)) continue
    nearest.set(key, nearestIndex(palette, key, 1, Math.max(1, next)))
  }

  return { palette, map, nearest, overflow }
}

/**
 * 把 RGBA 帧映射为调色板索引。
 *
 * 查表顺序：精确色 → 预解析好的最近色 → 兜底索引。
 * 传了 buildPalette 返回的 nearest 就一定能命中前两级，
 * 兜底只为「不在建表帧里出现过的颜色」这种情况留一条不出错的路。
 */
export function toIndices(
  frame: PixelBuffer,
  map: Map<number, number>,
  nearest?: Map<number, number>,
): Uint8Array {
  const indices = new Uint8Array(frame.length / 4)

  for (let pixel = 0; pixel < indices.length; pixel++) {
    const key = pixelKey(frame, pixel * 4)
    indices[pixel] = map.get(key) ?? nearest?.get(key) ?? FALLBACK_INDEX
  }

  return indices
}

/**
 * 像素的调色板键。
 *
 * **只用 24 位 RGB，不把 alpha 编进去。** GIF 没有逐像素透明，
 * 一个像素要么走透明索引、要么是一个纯 RGB 色，因此 alpha 本就不该参与建表 ——
 * 顺带还能把「同 RGB 不同 alpha」合并成一个索引（它们在 GIF 里本来就画成一样的）。
 *
 * 这条规则也修掉了一个会撞键的坑：若按 0xRRGGBBAA 打包，
 * 纯白不透明像素恰好是 0xFFFFFFFF，按位运算即 -1，
 * 与下面的透明哨兵重合 —— 浅色主题的整片白色背景会被当成透明色。
 */
function pixelKey(frame: PixelBuffer, offset: number): number {
  if (frame[offset + 3] === 0) return TRANSPARENT
  return (frame[offset] << 16) | (frame[offset + 1] << 8) | frame[offset + 2]
}

/** 把 24 位 RGB 打包键写进指定槽位 */
function writeColor(palette: Uint8Array, index: number, key: number): void {
  palette[index * 3] = (key >>> 16) & 0xff
  palette[index * 3 + 1] = (key >>> 8) & 0xff
  palette[index * 3 + 2] = key & 0xff
}

function writeRGB(palette: Uint8Array, index: number, [r, g, b]: RGB): void {
  palette[index * 3] = r
  palette[index * 3 + 1] = g
  palette[index * 3 + 2] = b
}

function readColor(palette: Uint8Array, index: number): RGB {
  return [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]]
}

/**
 * 在 [from, to) 里找与 key 的 RGB 距离最近的槽位。
 *
 * from 传 1 是为了把索引 0 排除在外 —— 那是透明色，不是可以拿来匹配的实色。
 */
function nearestIndex(palette: Uint8Array, key: number, from: number, to: number): number {
  const r = (key >>> 16) & 0xff
  const g = (key >>> 8) & 0xff
  const b = key & 0xff
  let best = from
  let bestDistance = Infinity

  for (let index = from; index < to; index++) {
    const dr = palette[index * 3] - r
    const dg = palette[index * 3 + 1] - g
    const db = palette[index * 3 + 2] - b
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  }

  return best
}
