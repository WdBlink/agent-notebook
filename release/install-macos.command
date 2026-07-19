#!/bin/zsh
set -euo pipefail

EXPECTED_ARCH="__ARCH__"
VERSION="__VERSION__"
MACHINE="$(/usr/bin/uname -m)"
ACTUAL_ARCH="$MACHINE"
if [[ "$MACHINE" == "x86_64" ]]; then ACTUAL_ARCH="x64"; fi

show_error() {
  /usr/bin/osascript -e "display alert \"Agent Whiteboard 安装失败\" message \"$1\" as critical" >/dev/null 2>&1 || true
  print -u2 -- "$1"
}

if [[ "$ACTUAL_ARCH" != "$EXPECTED_ARCH" ]]; then
  show_error "这个安装包适用于 $EXPECTED_ARCH，但当前 Mac 是 $ACTUAL_ARCH。请下载正确的版本。"
  exit 1
fi

ROOT_DIR="${0:A:h}"
SOURCE_DIR="$ROOT_DIR/daily-cockpit"
if [[ ! -f "$SOURCE_DIR/manifest.json" || ! -f "$SOURCE_DIR/runtime/active.json" ]]; then
  show_error "安装包内容不完整，请重新下载 GitHub Release。"
  exit 1
fi

VAULT_PATH="$(/usr/bin/osascript <<'APPLESCRIPT'
try
  return POSIX path of (choose folder with prompt "请选择你的 Obsidian Vault 文件夹")
on error number -128
  return ""
end try
APPLESCRIPT
)"

if [[ -z "$VAULT_PATH" ]]; then
  print -- "安装已取消。"
  exit 0
fi
VAULT_PATH="${VAULT_PATH%/}"

if [[ ! -d "$VAULT_PATH/.obsidian" ]]; then
  show_error "所选文件夹不是 Obsidian Vault：未找到 .obsidian。"
  exit 1
fi

PLUGIN_DIR="$VAULT_PATH/.obsidian/plugins/daily-cockpit"
if [[ -L "$PLUGIN_DIR" ]]; then
  show_error "目标插件目录是符号链接；为避免覆盖外部文件，安装已停止。"
  exit 1
fi

/bin/mkdir -p "$PLUGIN_DIR"
/usr/bin/ditto --noqtn "$SOURCE_DIR" "$PLUGIN_DIR"

if [[ ! -f "$PLUGIN_DIR/main.js" || ! -f "$PLUGIN_DIR/styles.css" || ! -f "$PLUGIN_DIR/manifest.json" ]]; then
  show_error "插件文件复制后校验失败。"
  exit 1
fi

/usr/bin/osascript -e "display dialog \"Agent Whiteboard $VERSION 已安装。请在 Obsidian → 设置 → 第三方插件中启用 Agent Whiteboard；若 Obsidian 已打开，请重新加载应用。\" buttons {\"完成\"} default button \"完成\"" >/dev/null 2>&1 || true
print -- "Agent Whiteboard $VERSION installed to: $PLUGIN_DIR"
