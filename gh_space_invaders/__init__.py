"""gh-space-invaders: 把 GitHub 贡献图炸成像素 GIF 💥

拆分后的模块分工（`cli.py` 只是参数解析 + 串流程）：

    config.py   常量（调色板 / 几何 / 可调参数）
    models.py   数据结构（Target / Enemy / Bullet / Particle / Star / Strategy）
    data.py     GitHub GraphQL 抓取 + 离线假数据
    engine.py   玩法逻辑（状态机、碰撞、主循环）
    render.py   绘制层（Renderer，只读地消费 Engine 状态）
    gif.py      编码（共享调色板 + 逐帧量化）
    cli.py      命令行入口

对外 API 全部从包根导出 —— `from gh_space_invaders import Engine` 即可，
不必关心内部文件划分。
"""

from .config import (
    BG, BOSS_HI, BULLET, BULLET_PIERCE, CELL, COLS, DEFAULT_COLORS, DEFAULT_FPS,
    GAP, GRID_BG, GRID_BOTTOM, GRID_TOP, HEIGHT, HUD1, HUD2, LEVEL_COLORS,
    PADDING_LR, PARTICLES, ROWS, SHIP_H, SHIP_W, SHIP_Y, STARS, WIDTH,
)
from .data import GRAPHQL, fetch_contributions, generate_dummy
from .engine import Engine
from .gif import build_palette, encode_gif, quantize_frame
from .models import (
    Bullet, Contributions, Enemy, Particle, Star, Strategy, Target,
)

__version__ = "0.2.0"

__all__ = [
    "__version__",
    # 配置
    "BG", "BOSS_HI", "BULLET", "BULLET_PIERCE", "CELL", "COLS",
    "DEFAULT_COLORS", "DEFAULT_FPS", "GAP", "GRID_BG", "GRID_BOTTOM",
    "GRID_TOP", "HEIGHT", "HUD1", "HUD2", "LEVEL_COLORS", "PADDING_LR",
    "PARTICLES", "ROWS", "SHIP_H", "SHIP_W", "SHIP_Y", "STARS", "WIDTH",
    # 数据
    "GRAPHQL", "fetch_contributions", "generate_dummy",
    # 玩法 / 绘制 / 编码
    "Engine", "build_palette", "encode_gif", "quantize_frame",
    # 数据结构
    "Bullet", "Contributions", "Enemy", "Particle", "Star", "Strategy", "Target",
]
