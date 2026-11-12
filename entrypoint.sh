#!/bin/sh
# 参数前缀归一：CNB 插件规范把 settings 注入为 PLUGIN_*，
# 这里无脑改名成 CONTRIB_* 后交给 Node 入口。
# 不含任何平台判断，也不读平台专属变量；加新平台不需要改这个脚本。
set -eu

for var in $(env | cut -d= -f1 | grep '^PLUGIN_' || true); do
  name=${var#PLUGIN_}
  value=$(printenv "$var")
  export "CONTRIB_$name=$value"
done

exec node /app/dist/src/cli/index.js "$@"
