#!/usr/bin/env bash
# 单向同步：CNB 主仓 → GitHub 分发端点。
# GitHub 侧只为存量 uses: 引用存在，绝不反向推送（ADR 0000 第 4 节）。
set -euo pipefail

REPO="${GITHUB_REPO:-h1s97x/space-invaders}"
BRANCHES="${GITHUB_BRANCHES:-main latest}"
SRC_REF="${SRC_REF:-HEAD}"

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ERROR: GITHUB_TOKEN is required (contents:write on ${REPO})" >&2
  exit 1
fi

REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"

for branch in ${BRANCHES}; do
  echo "-> ${REPO}:${branch} <- ${SRC_REF}"
  git push --force --quiet "${REMOTE}" "${SRC_REF}:refs/heads/${branch}"
done

TAGS="${GITHUB_TAGS:-$(git describe --tags --abbrev=0 "${SRC_REF}" 2>/dev/null || true)}"
for tag in ${TAGS}; do
  echo "-> ${REPO}:refs/tags/${tag}"
  git push --force --quiet "${REMOTE}" "refs/tags/${tag}:refs/tags/${tag}"
done

echo "GitHub 分发端点已更新：branches [${BRANCHES}] tags [${TAGS:-none}]"
