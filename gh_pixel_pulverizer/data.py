"""数据来源：GitHub GraphQL 抓取 + 离线假数据兜底。

对外只有两个函数，且 `fetch_contributions()` **任何失败都只返回 None** ——
调用方（`cli.main`）拿到 None 就退到假数据，绝不让一次网络抖动搞挂构建。
"""

from __future__ import annotations

import json
import random
import urllib.error
import urllib.request
import zlib
from typing import List, Optional

from .config import COLS, ROWS
from .models import Contributions

GRAPHQL = """
query($user: String!) {
  user(login: $user) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks {
          contributionDays { contributionCount weekday }
        }
      }
    }
  }
}
"""


def fetch_contributions(username: str, token: Optional[str]) -> Optional[Contributions]:
    url = "https://api.github.com/graphql"
    headers = {"Content-Type": "application/json",
               "User-Agent": "gh-pixel-pulverizer/2.0"}
    if token:
        headers["Authorization"] = f"bearer {token}"
    payload = json.dumps({"query": GRAPHQL, "variables": {"user": username}}).encode()

    req = urllib.request.Request(url, data=payload, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        # 401 / 403 常见于 token 无效或 API 限流
        print(f"  [warn] API 返回 {e.code}: {e.reason}")
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"  [warn] API 请求失败: {e}")
        return None
    except (json.JSONDecodeError, ValueError) as e:
        print(f"  [warn] API 返回不是合法 JSON: {e}")
        return None

    if body.get("errors"):
        # GraphQL 习惯用 HTTP 200 + errors 表达失败（token 无效 / 用户不存在 / 限流）
        msg = (body["errors"][0] or {}).get("message", "unknown")
        print(f"  [warn] GraphQL 错误: {msg}")
        return None

    user = body.get("data", {}).get("user")
    if not user:
        print(f"  [warn] 找不到用户 '{username}'")
        return None

    calendar = user["contributionsCollection"]["contributionCalendar"]
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    for c, week in enumerate(calendar["weeks"][:COLS]):
        for day in week["contributionDays"]:
            r = day["weekday"]
            if 0 <= r < ROWS:
                rows[r][c] = day["contributionCount"]
    return Contributions(rows=rows, username=username,
                         total=calendar.get("totalContributions", 0))


def generate_dummy(username: str = "octocat") -> Contributions:
    """假数据 —— 看起来像真实贡献图。

    用 crc32 而不是内置 hash()：str 的 hash 每个进程都带随机盐，
    会让 --seed 失去可复现性。
    """
    rows: List[List[int]] = [[0] * COLS for _ in range(ROWS)]
    rng = random.Random(zlib.crc32(username.encode("utf-8")))
    for c in range(COLS):
        for r in range(ROWS):
            if r in (0, 6):
                count = rng.choices([0, 0, 0, 1, 2], weights=[40, 20, 10, 20, 10])[0]
            else:
                count = rng.choices([0, 1, 2, 3, 4, 5, 10], weights=[15, 15, 20, 20, 15, 10, 5])[0]
            rows[r][c] = count
    # 种几个高产格，保证 level 4/5 的 BOSS 格一定存在
    for _ in range(8):
        rc = rng.randint(0, ROWS - 1)
        cc = rng.randint(0, COLS - 1)
        rows[rc][cc] = rng.randint(15, 40)
    total = sum(v for row in rows for v in row)
    return Contributions(rows=rows, username=username, total=total)
