/**
 * 光栅化：把绘制指令渲染成 RGBA 像素缓冲。
 *
 * 为保持零运行时依赖，这里自己实现一份最小绘图器，
 * 只提供画面真正用到的图元：矩形、圆角矩形、多边形、点。
 *
 * 画布刻意保持低分辨率（一格 5-10 像素），最后统一放大，
 * 像素成本因此低两三个数量级。
 */

import type { Point, RGB, RGBA } from "./types.js"

export function createSurface(width: number, height: number) {
  // 每像素 4 通道（RGBA）
  const data = new Uint8ClampedArray(width * height * 4)

  /** 覆盖一个像素：alpha 为覆盖强度 0-1 */
  function blend(x: number, y: number, [r, g, b]: RGB, alpha: number) {
    if (alpha <= 0 || x < 0 || y < 0 || x >= width || y >= height) return

    const index = (y * width + x) * 4
    if (alpha >= 1) {
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = 255
      return
    }

    const dstA = data[index + 3] / 255
    const outA = alpha + dstA * (1 - alpha)
    if (outA <= 0) return

    const channels = [r, g, b]
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = (channels[channel] * alpha + data[index + channel] * dstA * (1 - alpha)) / outA
    }
    data[index + 3] = outA * 255
  }

  /** 擦除一个像素（置为完全透明） */
  function erase(x: number, y: number) {
    if (x < 0 || y < 0 || x >= width || y >= height) return
    data[(y * width + x) * 4 + 3] = 0
  }

  return {
    width,
    height,
    data,

    /** 不透明底色 */
    fill([r, g, b]: RGB) {
      for (let index = 0; index < data.length; index += 4) {
        data[index] = r
        data[index + 1] = g
        data[index + 2] = b
        data[index + 3] = 255
      }
    },

    /**
     * 矩形。坐标与尺寸以像素为单位，可为小数。
     * 按与实际像素的重叠面积计算覆盖率，边缘自然得到抗锯齿。
     */
    rect(x0: number, y0: number, x1: number, y1: number, color: RGB, alpha = 1) {
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const coverY = Math.min(y + 1, y1) - Math.max(y, y0)
        if (coverY <= 0) continue

        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const coverX = Math.min(x + 1, x1) - Math.max(x, x0)
          if (coverX <= 0) continue
          blend(x, y, color, coverX * coverY * alpha)
        }
      }
    },

    /**
     * 圆角矩形，用于敌人格子。
     *
     * 与其先铺满矩形再擦角（两次写入，且擦除范围容易盖到中心），
     * 不如按行直接算「这一行该画多宽」：四角是半径 r 的 1/4 圆，
     * 行内起止位置由圆心到该行的距离决定。一次写入，无覆盖顺序问题。
     *
     * 覆盖率按到圆心的距离算，边缘自然抗锯齿。
     */
    roundedRect(
      x0: number,
      y0: number,
      x1: number,
      y1: number,
      radius: number,
      color: RGB,
      alpha = 1,
    ) {
      const halfWidth = (x1 - x0) / 2
      const halfHeight = (y1 - y0) / 2
      const r = Math.max(0, Math.min(radius, halfWidth, halfHeight))

      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const coverY = Math.min(y + 1, y1) - Math.max(y, y0)
        if (coverY <= 0) continue

        // 该行中心距上 / 下边缘的较小距离；小于半径时落在圆角区，需要收窄。
        // 注意不能把 y 夹到 [y0, y1] 之内 —— 那会让每行都算成贴着边缘。
        const fromTop = y + 0.5 - y0
        const distanceFromEdge = Math.min(fromTop, y1 - (y + 0.5))

        let inset = 0
        if (r > 0 && distanceFromEdge < r) {
          // 圆角区：圆在该行还差多少才到直边
          inset = r - Math.sqrt(Math.max(0, r * r - (r - distanceFromEdge) ** 2))
        }

        const rowStart = x0 + inset
        const rowEnd = x1 - inset
        if (rowEnd <= rowStart) continue

        for (let x = Math.floor(rowStart); x < Math.ceil(rowEnd); x++) {
          const coverX = Math.min(x + 1, rowEnd) - Math.max(x, rowStart)
          if (coverX <= 0) continue
          blend(x, y, color, coverX * coverY * alpha)
        }
      }
    },

    /** 多边形（扫描线 + 奇偶填充），用于飞船 */
    polygon(points: Point[], color: RGB, alpha = 1) {
      if (points.length < 3) return

      const ys = points.map(point => point[1])
      for (let y = Math.floor(Math.min(...ys)); y < Math.ceil(Math.max(...ys)); y++) {
        const scanY = y + 0.5
        const crossings: number[] = []

        for (let index = 0; index < points.length; index++) {
          const [ax, ay] = points[index]
          const [bx, by] = points[(index + 1) % points.length]
          if (ay === by) continue
          if (scanY < Math.min(ay, by) || scanY >= Math.max(ay, by)) continue
          crossings.push(ax + ((scanY - ay) / (by - ay)) * (bx - ax))
        }

        crossings.sort((a, b) => a - b)
        for (let index = 0; index + 1 < crossings.length; index += 2) {
          const from = crossings[index]
          const to = crossings[index + 1]
          for (let x = Math.floor(from); x < Math.ceil(to); x++) {
            const coverX = Math.min(x + 1, to) - Math.max(x, from)
            if (coverX <= 0) continue
            blend(x, y, color, coverX * alpha)
          }
        }
      }
    },

    /** 单像素点，用于星空 */
    point(x: number, y: number, color: RGB, alpha = 1) {
      blend(Math.floor(x), Math.floor(y), color, alpha)
    },

    erase,

    /** 取某像素的 RGBA（测试用） */
    at(x: number, y: number): RGBA {
      const index = (y * width + x) * 4
      return [data[index], data[index + 1], data[index + 2], data[index + 3]]
    },
  }
}
