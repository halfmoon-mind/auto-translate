#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="com.codex_context_translator.host"
EXTENSION_ID="mildfcoedbkcjlcbfmalbfefchdhjdkk"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_SCRIPT="$REPO_ROOT/native-host/codex-context-translator-host.js"
INSTALL_ROOT="$HOME/Library/Application Support/CodexContextTranslator"
HOST_DIR="$INSTALL_ROOT/native-host"
LAUNCHER_PATH="$HOST_DIR/run-host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
COMMON_PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"

find_executable() {
  local name="$1"

  if command -v "$name" >/dev/null 2>&1; then
    command -v "$name"
    return 0
  fi

  local path_entry
  local -a path_entries
  IFS=":" read -r -a path_entries <<< "$COMMON_PATH"
  for path_entry in "${path_entries[@]}"; do
    if [[ -x "$path_entry/$name" ]]; then
      printf "%s\n" "$path_entry/$name"
      return 0
    fi
  done

  local candidate
  for candidate in "$HOME"/.nvm/versions/node/*/bin/"$name"; do
    if [[ -x "$candidate" ]]; then
      printf "%s\n" "$candidate"
      return 0
    fi
  done

  return 1
}

if [[ ! -f "$HOST_SCRIPT" ]]; then
  echo "Native host script not found: $HOST_SCRIPT" >&2
  exit 1
fi

NODE_BIN="${NODE_BIN:-$(find_executable node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js was not found. Install Node.js or set NODE_BIN before installing." >&2
  exit 1
fi

mkdir -p "$HOST_DIR" "$MANIFEST_DIR"

cat > "$LAUNCHER_PATH" <<EOF
#!/bin/sh
COMMON_PATH="$COMMON_PATH"
export PATH="\$COMMON_PATH:\$PATH"

find_executable() {
  name="\$1"

  if command -v "\$name" >/dev/null 2>&1; then
    command -v "\$name"
    return 0
  fi

  old_ifs="\$IFS"
  IFS=":"
  for path_entry in \$COMMON_PATH; do
    if [ -x "\$path_entry/\$name" ]; then
      IFS="\$old_ifs"
      printf "%s\n" "\$path_entry/\$name"
      return 0
    fi
  done
  IFS="\$old_ifs"

  for candidate in "\$HOME"/.nvm/versions/node/*/bin/"\$name"; do
    if [ -x "\$candidate" ]; then
      printf "%s\n" "\$candidate"
      return 0
    fi
  done

  return 1
}

NODE_BIN="\${NODE_BIN:-\$(find_executable node || true)}"
if [ -z "\$NODE_BIN" ]; then
  echo "Node.js was not found. Install Node.js or set NODE_BIN." >&2
  exit 1
fi

CODEX_BIN="\${CODEX_TRANSLATOR_CODEX_BIN:-\$(find_executable codex || true)}"
if [ -n "\$CODEX_BIN" ]; then
  export CODEX_TRANSLATOR_CODEX_BIN="\$CODEX_BIN"
  export PATH="\$(dirname "\$CODEX_BIN"):\$PATH"
fi

export PATH="\$(dirname "\$NODE_BIN"):\$PATH"
exec "\$NODE_BIN" "$HOST_SCRIPT"
EOF

chmod +x "$LAUNCHER_PATH"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "$HOST_NAME",
  "description": "Codex Context Translator native host",
  "path": "$LAUNCHER_PATH",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$EXTENSION_ID/"
  ]
}
EOF

echo "Installed $HOST_NAME"
echo "Manifest: $MANIFEST_PATH"
echo "Launcher: $LAUNCHER_PATH"
