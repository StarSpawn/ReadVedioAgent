#!/bin/bash
# Finder may not inherit the PATH configured in an interactive shell.
export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"
cd -- "$(dirname -- "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。请先安装 Node.js 20 或以上版本，再双击本文件。"
  read -r -p "按回车关闭…"
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Node.js 版本过低，请升级到 20 或以上版本。"
  read -r -p "按回车关闭…"
  exit 1
fi

node launch.mjs
result=$?
if [ "$result" -ne 0 ]; then
  read -r -p "启动遇到问题，请查看上方提示。按回车关闭…"
fi
exit "$result"
