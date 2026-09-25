"""离线冒烟测试 —— 不联网也能跑，覆盖抓数据之外的整条链路。

直接运行:
    python tests/test_smoke.py
或用 unittest 发现:
    python -m unittest discover -s tests
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from PIL import Image  # noqa: E402

from gh_pixel_pulverizer import (  # noqa: E402
    COLS,
    HEIGHT,
    ROWS,
    WIDTH,
    Contributions,
    Engine,
    Strategy,
    build_palette,
    encode_gif,
    fetch_contributions,
    generate_dummy,
    quantize_frame,
)


def _engine(seed: int = 7, **kwargs) -> Engine:
    return Engine(generate_dummy("octocat"), seed=seed, **kwargs)


class TestDummyData(unittest.TestCase):
    def test_shape(self):
        c = generate_dummy("octocat")
        self.assertEqual(len(c.rows), ROWS)
        self.assertTrue(all(len(row) == COLS for row in c.rows))
        self.assertEqual(c.total, sum(v for row in c.rows for v in row))

    def test_reproducible(self):
        """同名用户的假数据必须完全一致。

        这里曾经用内置 hash()，而 str 的 hash 每个进程都带随机盐，
        导致 --seed 完全失去复现能力。
        """
        self.assertEqual(generate_dummy("octocat").rows,
                         generate_dummy("octocat").rows)

    def test_different_users_differ(self):
        self.assertNotEqual(generate_dummy("alice").rows,
                            generate_dummy("bob").rows)


class TestTargets(unittest.TestCase):
    def test_levels_and_hp_are_valid(self):
        e = _engine()
        self.assertGreater(e.total_targets, 0)
        self.assertTrue(all(1 <= t.level <= 5 for t in e.targets))
        self.assertTrue(all(t.hp >= 1 for t in e.targets))

    def test_levels_are_spread_out(self):
        """分档必须铺开，否则整张贡献图会是一片深绿、也凑不出 BOSS 格。"""
        levels = {t.level for t in _engine().targets}
        self.assertGreaterEqual(len(levels), 3)

    def test_targets_stay_inside_the_canvas(self):
        for t in _engine().targets:
            self.assertGreaterEqual(t.x, 0)
            self.assertGreaterEqual(t.y, 0)
            self.assertLessEqual(t.x + t.size, WIDTH)
            self.assertLessEqual(t.y + t.size, HEIGHT)


class TestEngine(unittest.TestCase):
    def test_auto_max_frame_actually_clears_the_board(self):
        """默认参数必须能打完 —— 旧的固定 300 帧上限下通关动画永远触发不了。"""
        e = _engine(seed=7, max_frame=0)
        for _ in e.iter_frames(verbose=False):
            pass
        self.assertEqual(sum(1 for t in e.targets if t.alive), 0)
        self.assertEqual(e.defeated, e.total_targets)

    def test_explicit_max_frame_is_respected(self):
        e = _engine(max_frame=40)
        self.assertEqual(e.max_frame, 40)
        # 打不完时正好 40 帧；万一提前清场会多出 15 帧庆祝动画
        self.assertLessEqual(sum(1 for _ in e.iter_frames(verbose=False)), 55)

    def test_dead_objects_are_pruned(self):
        """已经死亡的粒子/子弹/敌人必须被回收，否则列表随帧数无界增长。"""
        e = _engine()
        for _ in e.iter_frames(verbose=False):
            pass
        self.assertFalse([p for p in e.particles if p.life <= 0])
        self.assertFalse([b for b in e.bullets if not b.alive])
        self.assertFalse([x for x in e.enemies if not x.alive])

    def test_frame_size(self):
        frames = list(_engine(max_frame=5).iter_frames(verbose=False))
        self.assertEqual(len(frames), 5)
        self.assertTrue(all(isinstance(f, Image.Image) for f in frames))
        self.assertEqual(frames[0].size, (WIDTH, HEIGHT))

    def test_seed_is_deterministic(self):
        a = [f.tobytes() for f in _engine(seed=99, max_frame=30).iter_frames(False)]
        b = [f.tobytes() for f in _engine(seed=99, max_frame=30).iter_frames(False)]
        self.assertEqual(a, b)

    def test_every_strategy_runs(self):
        for strategy in Strategy:
            with self.subTest(strategy=strategy):
                e = _engine(strategy=strategy, max_frame=30)
                self.assertEqual(
                    sum(1 for _ in e.iter_frames(verbose=False)), 30)

    def test_empty_contributions_do_not_crash(self):
        empty = Contributions(
            rows=[[0] * COLS for _ in range(ROWS)], username="ghost", total=0)
        e = Engine(empty, seed=1)
        self.assertEqual(e.total_targets, 0)
        self.assertGreater(sum(1 for _ in e.iter_frames(verbose=False)), 0)


class TestGifEncoding(unittest.TestCase):
    def test_roundtrip_matches_source_frames(self):
        """靠脏矩形差分压缩（不指定 disposal），解码出来必须逐帧一致、无残影。

        注意要和「量化后」的帧比，而不是原始 RGB 帧 —— 减色本身是有损的。
        """
        src = list(_engine(max_frame=25).iter_frames(verbose=False))
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.gif")
            self.assertEqual(encode_gif(iter(src), path, 25, 32), len(src))
            self.assertGreater(os.path.getsize(path), 0)

            pal = build_palette(src[0], 32)
            expected = [quantize_frame(src[0], pal, 32)]
            expected += [quantize_frame(f, pal, 32) for f in src[1:]]

            with Image.open(path) as got:
                for i, exp in enumerate(expected):
                    got.seek(i)
                    self.assertEqual(got.convert("RGB").tobytes(),
                                     exp.convert("RGB").tobytes(),
                                     msg=f"第 {i} 帧与源帧不一致（残影/差分错误）")

    def test_accepts_a_generator(self):
        """必须支持流式消费，否则会一次性驻留所有 RGB 帧（300 帧约 170MB）。"""
        e = _engine(max_frame=4)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.gif")
            self.assertEqual(
                encode_gif(e.iter_frames(verbose=False), path, 25, 32), 4)

    def test_colors_are_clamped(self):
        e = _engine(max_frame=3)
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "t.gif")
            self.assertEqual(
                encode_gif(e.iter_frames(verbose=False), path, 25, 999), 3)

    def test_empty_input_raises(self):
        with self.assertRaises(RuntimeError):
            encode_gif(iter([]), os.devnull, 25)


class TestNetworkFailurePaths(unittest.TestCase):
    """API 必须优雅降级：任何失败都只返回 None，绝不上抛异常。"""

    def test_bad_credentials_return_none(self):
        # 无 token → 401；网络不可达 → URLError。两种都应该返回 None。
        self.assertIsNone(
            fetch_contributions("gh-pixel-pulverizer-no-such-user", None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
