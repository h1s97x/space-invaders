/**
 * GIF89a 编码器。
 *
 * Node 侧只有 sharp 之类带原生依赖的库能写 GIF，
 * 而 CNB 插件的镜像越瘦越好（也避免多架构构建时的原生编译问题），
 * 因此这里手写一份最小实现，只覆盖本场景需要的部分：
 *
 * - 调色板（最多 256 色，索引 0 留作透明色）
 * - 逐帧写入，帧间不做差分：画布只有几百像素宽，索引数据量本身就不大
 * - 每帧**按自己的局部调色板**写 —— 全片共用一张表时调用方只需传同一个数组
 *
 * 调色板与索引由调用方算好（见 pixels.ts 的按频次建表），
 * 本模块只负责字节流拼装。
 */

export interface GifFrame {
  indices: Uint8Array
  palette: Uint8Array
  transparentIndex: number
  /** 毫秒，写入时转为 1/100 秒 */
  delay: number
}

export function encodeGif({
  width,
  height,
  frames,
  loop = 0,
}: {
  width: number
  height: number
  /** 支持迭代器：调用方可逐帧产出（边放大边编码），不必整段驻留内存 */
  frames: Iterable<GifFrame>
  loop?: number
}): Buffer {
  if (width > 65535 || height > 65535) throw new Error("GIF 尺寸超出上限")

  const iterator = frames[Symbol.iterator]()
  const first = iterator.next()
  if (first.done) throw new Error("至少需要一帧")

  // 循环扩展必须在第一帧之前写入，否则播放器按「播一遍就停」处理
  const chunks = [header(), screenDescriptor(width, height), loopExtension(loop)]

  let frame = first.value
  while (true) {
    const { indices, palette, transparentIndex } = frame
    // 图形控制扩展：帧延迟 + 透明色 + 不做处置（每帧都是完整图像）
    chunks.push(graphicControl(frame.delay, transparentIndex))
    chunks.push(imageDescriptor(width, height, 0, 0))
    chunks.push(localColorTable(palette))
    chunks.push(...imageData(indices))

    const next = iterator.next()
    if (next.done) break
    frame = next.value
  }

  chunks.push(Buffer.from([0x3b]))   // Trailer
  return Buffer.concat(chunks)
}

function header(): Buffer {
  return Buffer.from("GIF89a", "ascii")
}

/** 逻辑屏幕描述符。全局调色板留空，颜色全走每帧的局部调色板 */
function screenDescriptor(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(7)
  buffer.writeUInt16LE(width, 0)
  buffer.writeUInt16LE(height, 2)
  // 无全局色表（0x00）、颜色分辨率 8 位、不排序
  buffer[4] = 0x70
  buffer[5] = 0x00
  buffer[6] = 0x00
  return buffer
}

/**
 * Netscape 循环扩展（共 19 字节）。
 *
 * GIF89a 只规定了「播一遍」；动图要反复播放，得靠这段应用扩展声明
 * 循环次数，且必须出现在第一帧之前。0 表示无限循环 ——
 * GIF 的 Netscape 循环扩展就是这一段。
 *
 * 缺了它，动图播完最后一帧就静止在画面上，只能刷新页面重看。
 */
function loopExtension(loop: number): Buffer {
  const buffer = Buffer.alloc(19)
  buffer[0] = 0x21                            // 扩展引入符
  buffer[1] = 0xff                            // 应用扩展标签
  buffer[2] = 0x0b                            // 随后的块长度：11
  buffer.write("NETSCAPE2.0", 3, "ascii")    // 应用标识，11 字节
  buffer[14] = 0x03                           // 子块长度：3
  buffer[15] = 0x01                           // 子块 ID
  buffer.writeUInt16LE(Math.max(0, Math.trunc(loop)), 16)  // 循环次数
  buffer[18] = 0x00                           // 块终止符
  return buffer
}

/** 图形控制扩展：延迟单位为 1/100 秒 */
function graphicControl(delayMs: number, transparentIndex: number): Buffer {
  const buffer = Buffer.alloc(8)
  buffer[0] = 0x21
  buffer[1] = 0xf9
  buffer[2] = 0x04
  // 处置方式 2（恢复背景），并启用透明色
  buffer[3] = 0x09
  buffer.writeUInt16LE(Math.max(2, Math.round(delayMs / 10)), 4)
  buffer[6] = transparentIndex
  buffer[7] = 0x00
  return buffer
}

/**
 * 图像描述符：0x2C + 左/上/宽/高（各 2 字节，小端）+ 打包字段。
 * 共 10 字节 —— 偏移量从第 1 字节开始，写错会整体错位。
 */
function imageDescriptor(width: number, height: number, left: number, top: number): Buffer {
  const buffer = Buffer.alloc(10)
  buffer[0] = 0x2c
  buffer.writeUInt16LE(left, 1)
  buffer.writeUInt16LE(top, 3)
  buffer.writeUInt16LE(width, 5)
  buffer.writeUInt16LE(height, 7)
  // 局部色表 + 256 色（2^(7+1)）
  buffer[9] = 0x87
  return buffer
}

/** 局部调色板固定 256 色 × 3 字节 */
function localColorTable(palette: Uint8Array): Buffer {
  const table = Buffer.alloc(768)
  table.set(palette.subarray(0, Math.min(palette.length, 768)))
  return table
}

/**
 * 图像数据：LZW 压缩后按 255 字节分包。
 *
 * GIF 用的是可变宽度 LZW：初始码宽等于颜色位深 + 1，
 * 每满 2^码宽 个表项就加宽一位，直到 12 位后清表重来。
 */
function imageData(indices: Uint8Array): Buffer[] {
  // GIF 的 LZW 数据块以「最小码宽」开头（1 字节），随后才是子块。
  // 漏掉这一字节，解码器会把第一个子块的长度当成码宽，整段数据不可读。
  const minCodeSize = 8
  const compressed = lzwCompress(indices, minCodeSize)
  const blocks = [Buffer.from([minCodeSize])]

  let offset = 0
  while (offset < compressed.length) {
    const size = Math.min(255, compressed.length - offset)
    const block = Buffer.alloc(1 + size)
    block[0] = size
    compressed.copy(block, 1, offset, offset + size)
    blocks.push(block)
    offset += size
  }

  blocks.push(Buffer.from([0x00]))   // 块终止符
  return blocks
}

/**
 * LZW 压缩（GIF 变体）。
 *
 * 用哈希表存「前缀码 + 下一个字节」，不逐段重建字符串，
 * 因此不会因为长串拼接退化成 O(n²)。
 */
export function lzwCompress(indices: Uint8Array, minCodeSize = 8): Buffer {
  const clearCode = 1 << minCodeSize
  const endCode = clearCode + 1

  const out: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  let codeSize = minCodeSize + 1

  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      out.push(bitBuffer & 0xff)
      bitBuffer >>>= 8
      bitCount -= 8
    }
  }

  // 码表：key 为「前缀码 * 256 + 字节」
  let table = new Map<number, number>()
  let next = endCode + 1

  const reset = () => {
    table = new Map()
    next = endCode + 1
    codeSize = minCodeSize + 1
  }

  emit(clearCode)
  reset()

  let prefix = indices[0]
  for (let index = 1; index < indices.length; index++) {
    const byte = indices[index]
    const key = prefix * 256 + byte

    const found = table.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }

    emit(prefix)
    table.set(key, next)
    next++

    if (next > (1 << codeSize)) {
      if (codeSize < 12) codeSize++
      else {
        emit(clearCode)
        reset()
      }
    }

    prefix = byte
  }

  emit(prefix)
  emit(endCode)

  // 收尾补齐最后一个字节
  if (bitCount > 0) out.push(bitBuffer & 0xff)

  return Buffer.from(out)
}
