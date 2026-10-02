"""绘制层：把 Engine 的状态画成一帧 RGB 图。

`Renderer` 是**只读**的：它消费 `game`（Engine）的字段，从不修改游戏状态。
所以「调观感」只碰这个文件，「调玩法」只碰 `engine.py`，互不干扰。

美术方向是**硬核像素风**：自绘 5×7 点阵字（`font.py`）、飞船是像素 sprite、
爆炸带白闪与点阵冲击环、背景预渲染成静态棋盘底。全部硬边、无抗锯齿。

所有实体先画在一张 RGBA 透明图层上，最后 alpha 合成到背景 —— 这样粒子淡出、
子弹拖尾、尾焰才能用**真正的 alpha**；直接把 RGB 乘向黑色只是「伪透明」，
会在背景上留下一块块脏斑。
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, List, Optional, Tuple

from PIL import Image, ImageDraw

from .config import (
    BG, BG_BOTTOM, BG_TOP, BOSS_HI, BULLET, BULLET_TRAIL_ALPHA,
    BULLET_TRAIL_SEGMENTS, BULLET_TRAIL_SPACING, CELL, COLS, ENEMY_BULLET, GAP,
    GRID_BG, GRID_LINE, GRID_TOP, HEIGHT, HUD1, HUD2, LEVEL_COLORS, PADDING_LR,
    ROWS, SHIP_BODY, SHIP_DARK, SHIP_FL, SHIP_FL2, SHIP_H, SHIP_HI, SHIP_W,
    SHIP_Y, STARS, WIDTH, _rgba,
)
from .font import draw_text, text_width

if TYPE_CHECKING:  # 只在类型检查时导入，避免与 engine 形成运行时循环
    from .engine import Engine


# ──────────────────────────── 飞船 sprite ───────────────────────────────────
# 15×11 的点阵，放大 2 倍 → 30×22，正好落在 SHIP_W×SHIP_H 的框里。
# B=机身  D=暗部（机翼/引擎舱）  H=座舱玻璃  W=引擎喷口高光  .=透明
# 造型要点（旧版被否在「像个蓝色蘑菇/UFO」）：
#   * 机头收成 **1px 的尖**（旧版顶部是 3×3 的亮色圆顶，看着就是蘑菇伞盖）；
#   * 座舱玻璃嵌进机身里（旧版 H 浮在顶端独立三行，和机身是「两层」）；
#   * 引擎改成**左右双喷口**（旧版一行 WWW 像一个洞）；
#   * 机翼底部斜切收边，不再是两块悬空的「脚」。
SHIP_SPRITE: Tuple[str, ...] = (
    "......B......",
    ".....BBB.....",
    ".....BHB.....",
    ".....BHB.....",
    "....BBHBB....",
    "....BHHHB....",
    "...BBBBBBB...",
    "...BBBBBBB...",
    ".DBBBBBBBBBD.",
    "DDBBWWWWWBBDD",
    "DD..WW.WW..DD",
)
SPRITE_H = len(SHIP_SPRITE)
SPRITE_W = len(SHIP_SPRITE[0])
SPRITE_SCALE = 2
_SPRITE_COLORS = {"B": SHIP_BODY, "D": SHIP_DARK, "H": SHIP_HI, "W": (255, 255, 255)}

HUD_SEP_Y = 19      # HUD 与战场之间的 1px 分隔线


# ──────────────────────────── 静态棋盘底 ─────────────────────────────────────

_BOARD: Optional[Image.Image] = None


def _build_board() -> Image.Image:
    """预渲染「背景分带 + 空格子」，每帧只需 copy 一次。

    之前每帧都要画 54+8 条网格线；现在空格子本身就是网格（对齐 GitHub 的
    #161b22），既更像贡献图，也省掉了每帧几百次画线。
    """
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(img)
    # 纵向分带：上暗下亮，给原本纯色的背景一点纵深（硬边分带，不做平滑渐变）
    bands = 6
    for i in range(bands):
        y0 = i * HEIGHT // bands
        y1 = (i + 1) * HEIGHT // bands
        t = i / (bands - 1)
        col = tuple(int(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOTTOM))
        d.rectangle([0, y0, WIDTH, y1], fill=col)
    # 空格子
    for r in range(ROWS):
        for c in range(COLS):
            x = PADDING_LR + c * (CELL + GAP)
            y = GRID_TOP + r * (CELL + GAP)
            d.rounded_rectangle([x, y, x + CELL - 1, y + CELL - 1],
                                radius=2, fill=GRID_BG)
    return img


def get_board() -> Image.Image:
    global _BOARD
    if _BOARD is None:
        _BOARD = _build_board()
    return _BOARD


class Renderer:
    """一局游戏对应一个 Renderer，持有 Engine 引用并按帧取状态绘制。"""

    def __init__(self, game: "Engine"):
        self.game = game

    # ── 对外唯一入口 ────────────────────────────────────────────────

    def render(self, celebration: bool = False) -> Image.Image:
        """合成一帧。celebration=True 时跳过靶子/敌人/子弹（留给烟花）。"""
        base = get_board().copy()
        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        d = ImageDraw.Draw(overlay, "RGBA")
        self._draw_stars(d)
        if not celebration:
            self._draw_targets(d)
            self._draw_enemies(d)
            self._draw_bullets(d)
        self._draw_flashes(d)
        self._draw_ship(d)
        self._draw_particles(d)
        self._draw_hud(d)
        # 合成后回到 RGB：编码层（quantize / 共享调色板）保持不变
        return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")

    # ── 各图层 ──────────────────────────────────────────────────────

    def _draw_stars(self, d: ImageDraw.ImageDraw):
        # 3 层视差：z=0 最近 → 最快最亮；z=2 最远 → 最慢最暗
        # 不做逐帧闪烁 —— 整屏星点一起呼吸太吵，也白白增大每帧差分区域。
        for s in self.game.stars:
            d.point((s.x, s.y), fill=_rgba(STARS[3 - s.z], 200))

    def _draw_targets(self, d: ImageDraw.ImageDraw):
        for t in self.game.targets:
            if not t.alive: continue
            # 剩余 HP 参与配色：每掉一点血就降一档亮度，受击有可见反馈。
            dim = t.max_hp - t.hp
            col = LEVEL_COLORS[max(0, min(4, t.level - 1 - dim))]
            x0, y0, x1, y1 = t.rect()
            # 圆角格子，比直角方块精致得多
            d.rounded_rectangle([x0, y0, x1, y1], radius=2, fill=_rgba(col))
            # 这里原本给每个 level5 格子顶边画一条黄色「皇冠条」，
            # 结果满屏绿块上横着一道道黄杠，又吵又没信息量 —— 已删。
            # BOSS 是靠「打爆后飞出的红色带刺外星人」表达的，不需要提前预告。

    def _draw_bullets(self, d: ImageDraw.ImageDraw):
        for b in self.game.bullets:
            if not b.alive: continue
            bx = int(b.x); by = int(b.y)
            if b.friendly:
                # 拖尾沿运动反方向（己方子弹向上飞 → 尾巴在下方）
                self._draw_bullet_trail(d, bx, by, BULLET, downward=True)
                d.rectangle([bx - 1, by - 3, bx + 1, by + 2], fill=_rgba(BULLET))
                d.point((bx, by - 4), fill=_rgba((200, 255, 200)))
            else:
                self._draw_bullet_trail(d, bx, by, ENEMY_BULLET, downward=False)
                d.rectangle([bx - 1, by - 1, bx + 1, by + 3],
                            fill=_rgba(ENEMY_BULLET))

    def _draw_bullet_trail(self, d: ImageDraw.ImageDraw, bx: int, by: int,
                           color, downward: bool):
        """子弹拖尾：几段递减 alpha 的短条，越远离弹头越淡越细。"""
        for i in range(BULLET_TRAIL_SEGMENTS):
            fade = 1.0 - (i + 1) / (BULLET_TRAIL_SEGMENTS + 1)  # 0.75 / 0.5 / 0.25
            offset = (i + 1) * BULLET_TRAIL_SPACING
            ty = by + offset if downward else by - offset
            half = 1 if i == 0 else 0        # 越远越细
            d.rectangle([bx - half, ty - 2, bx + half, ty + 1],
                        fill=_rgba(color, int(BULLET_TRAIL_ALPHA * fade)))

    def _draw_enemies(self, d: ImageDraw.ImageDraw):
        """BOSS 外星人：红色带刺。"""
        for e in self.game.enemies:
            if not e.alive: continue
            col = (230, 60, 60) if e.hp == e.max_hp else (200, 40, 40)
            ex, ey = int(e.x), int(e.y)
            # 身体
            d.rectangle([ex, ey, ex + e.size - 1, ey + e.size - 1], fill=_rgba(col))
            # 刺（四个角）
            d.polygon([(ex - 2, ey), (ex, ey - 2), (ex, ey)], fill=_rgba(col))
            d.polygon([(ex + e.size, ey), (ex + e.size + 2, ey - 2),
                       (ex + e.size, ey)], fill=_rgba(col))
            # 眼睛（瞄准飞船）
            sx = self.game.ship_x + SHIP_W / 2
            dx = 1 if sx > ex + e.size / 2 else -1
            d.point((ex + e.size // 2 + dx, ey + 4), fill=_rgba((255, 255, 255)))
            d.point((ex + e.size // 2 + dx, ey + e.size - 5),
                    fill=_rgba((255, 255, 255)))
            # HP 条
            if e.hp < e.max_hp:
                w = e.size * e.hp // e.max_hp
                d.rectangle([ex, ey - 3, ex + w - 1, ey - 2], fill=_rgba(BOSS_HI))

    def _draw_ship(self, d: ImageDraw.ImageDraw):
        g = self.game
        sx = int(g.ship_x) + (SHIP_W - SPRITE_W * SPRITE_SCALE) // 2
        sy = SHIP_Y - 12
        # sprite：同一行里连续的同类像素合并成一个 rectangle，10 行约 15 次调用
        for ry, row in enumerate(SHIP_SPRITE):
            y0 = sy + ry * SPRITE_SCALE
            run_ch = ""
            run_start = 0
            for rx, ch in enumerate(row + "."):     # 末尾补 '.' 强制收尾
                if ch != run_ch:
                    if run_ch and run_ch != ".":    # run_ch 为空是首字符的初始化态
                        d.rectangle([sx + run_start * SPRITE_SCALE, y0,
                                     sx + rx * SPRITE_SCALE - 1,
                                     y0 + SPRITE_SCALE - 1],
                                    fill=_rgba(_SPRITE_COLORS[run_ch]))
                    run_ch, run_start = ch, rx
        # 阶梯尾焰：一节节收窄的方块，比三角多边形更像素。
        # 修正两处旧毛病：① 内外层的**颜色和 alpha 原来是接反的**（注释里
        #   FL=外焰 / FL2=内焰，代码却给贴身那节用了外焰色 + 更低的 alpha，
        #   渲染出来就是一坨贴着机身的土黄污渍）；② 半宽 5/3 比机身还宽。
        # 现在贴身那节用内焰色（亮黄、实），外节用外焰色（橙、淡），且比喷口窄。
        alive_pct = sum(1 for t in g.targets if t.alive) / max(1, g.total_targets)
        flame_boost = 1.5 - alive_pct              # 1.5 (全灭) → 0.5 (全活)
        flame_h = int(4 * flame_boost + math.sin(g.frame * 0.7) * 2 + 2)
        mid = sx + SPRITE_W * SPRITE_SCALE // 2
        tail = sy + SPRITE_H * SPRITE_SCALE - 3
        steps = 2
        for i in range(steps):
            hh = max(2, flame_h // steps)
            y0 = tail + i * hh
            half = 3 - i                           # 3 / 2 —— 焰要比机身窄
            col, alpha = (SHIP_FL2, SHIP_FL)[i], (220, 180)[i]
            d.rectangle([mid - half, y0, mid + half, y0 + hh - 1],
                        fill=_rgba(col, alpha))

    def _draw_flashes(self, d: ImageDraw.ImageDraw):
        """爆炸白闪：中心亮点 + 向外扩张的点环。"""
        for f in self.game.flashes:
            if f.life <= 0: continue
            t = f.life / f.max_life                 # 1 → 0
            cx, cy = int(f.x), int(f.y)
            # 白核：只有一个 3×3，且很快淡掉（不再是 5×5 起手）
            core = 1 if t > 0.45 else 0
            d.rectangle([cx - core, cy - core, cx + core, cy + core],
                        fill=_rgba((255, 255, 255), int(190 * t)))
            # 冲击环：12 个点，淡得比白核更快（t²）
            pts: List[Tuple[int, int]] = []
            for i in range(12):
                a = 2 * math.pi * i / 12
                pts.append((int(cx + math.cos(a) * f.r), int(cy + math.sin(a) * f.r)))
            d.point(pts, fill=_rgba((255, 255, 255), int(150 * t * t)))

    def _draw_particles(self, d: ImageDraw.ImageDraw):
        for p in self.game.particles:
            if p.life <= 0: continue
            # 真·淡出：靠 alpha 让粒子融进背景，而不是把 RGB 乘向黑色。
            fade = p.life / p.max_life
            # 尾段加速衰减，避免大量半透明粒子长时间糊在画面上（也利于压缩）
            alpha = int(255 * fade * fade)
            col = p.color      # 不再做「白热核心」：那一层高光让爆炸看起来很吵
            d.rectangle([int(p.x) - 1, int(p.y) - 1,
                         int(p.x) + p.size, int(p.y) + p.size],
                        fill=_rgba(col, alpha))

    def _draw_hud(self, d: ImageDraw.ImageDraw):
        """HUD 只有一行：左「SCORE n」、右「@username」。

        删掉的：`BEAT d/total`、`xx%`、`F###` —— 它们和底部进度条表达的是同一件事，
        三处重复反而让人不知道该看哪儿。进度就是底部那条。
        """
        g = self.game
        alive = sum(1 for t in g.targets if t.alive)
        done = 1 - alive / max(1, g.total_targets)

        d.line([(0, HUD_SEP_Y), (WIDTH, HUD_SEP_Y)], fill=_rgba(GRID_LINE))
        draw_text(d, (8, 6), f"SCORE {g.score}", HUD1)
        # 右对齐用 text_width() 精确算，不再用 len(name)*6 硬猜
        name = f"@{g.contrib.username}"
        draw_text(d, (WIDTH - 8 - text_width(name), 6), name, HUD2)

        # 底部进度条：唯一表达「打掉多少」的地方
        blocks, bw, bgap = 18, 5, 1
        step = bw + bgap
        bx = WIDTH - 8 - (blocks * step - bgap)
        by = HEIGHT - 9
        filled = int(blocks * done)
        col = LEVEL_COLORS[3] if done > 0.3 else (255, 120, 80)
        for i in range(blocks):
            x0 = bx + i * step
            d.rectangle([x0, by, x0 + bw - 1, by + 2],
                        fill=_rgba(col if i < filled else (45, 50, 60)))
