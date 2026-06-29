#!/usr/bin/env bash
set -euo pipefail

HOST_NAME="${CODEX_TRANSLATOR_HOST_NAME:-com.codex_context_translator.host}"
DEFAULT_EXTENSION_ID="mildfcoedbkcjlcbfmalbfefchdhjdkk"
EXTENSION_ID="${CODEX_TRANSLATOR_EXTENSION_ID:-${1:-$DEFAULT_EXTENSION_ID}}"
REQUIRED_NODE_MAJOR=18
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_SCRIPT="$REPO_ROOT/native-host/codex-context-translator-host.js"
SERVER_DIR="$REPO_ROOT/server"
INSTALL_ROOT="$HOME/Library/Application Support/CodexContextTranslator"
APP_DIR="$INSTALL_ROOT/app"
APP_HOST_DIR="$APP_DIR/native-host"
APP_SERVER_DIR="$APP_DIR/server"
APP_HOST_SCRIPT="$APP_HOST_DIR/codex-context-translator-host.js"
HOST_DIR="$INSTALL_ROOT/native-host"
LAUNCHER_PATH="$HOST_DIR/run-host"
MANIFEST_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
MANIFEST_PATH="$MANIFEST_DIR/$HOST_NAME.json"
SETUP_URL="${CODEX_TRANSLATOR_SETUP_URL:-chrome-extension://$EXTENSION_ID/setup.html}"
COMMON_PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:$HOME/.bun/bin:/usr/bin:/bin:/usr/sbin:/sbin"
CURRENT_STEP="초기화"

print_step_hint() {
  local step="$1"

  case "$step" in
    "Chrome extension ID 확인")
      echo "해결 방법: Chrome extension ID는 a-p 문자로만 된 32자여야 합니다." >&2
      echo "현재 확장 ID는 extension setup 화면의 '현재 확장 ID'에서 확인할 수 있습니다." >&2
      ;;
    "필수 runtime 파일 확인")
      echo "해결 방법: 배포 폴더 전체를 받은 뒤 installer를 다시 실행하세요." >&2
      echo "native-host와 server 폴더가 installer와 같은 배포 폴더 안에 있어야 합니다." >&2
      ;;
    "Node.js 확인")
      echo "해결 방법: Node.js $REQUIRED_NODE_MAJOR 이상을 설치하거나 NODE_BIN으로 node 경로를 지정하세요." >&2
      ;;
    "설치 경로 생성")
      echo "해결 방법: 사용자 Library/Application Support 경로에 쓸 수 있는지 확인하세요." >&2
      ;;
    "runtime 파일 복사")
      echo "해결 방법: 배포 폴더 파일 권한과 사용자 Library/Application Support 쓰기 권한을 확인하세요." >&2
      ;;
    "native host launcher 생성")
      echo "해결 방법: native-host 설치 경로에 실행 파일을 만들 수 있는지 확인하세요." >&2
      ;;
    "Chrome Native Messaging manifest 생성")
      echo "해결 방법: Chrome NativeMessagingHosts 폴더에 manifest를 만들 수 있는지 확인하세요." >&2
      ;;
  esac
}

on_error() {
  local code=$?
  echo "" >&2
  echo "설치 실패: ${CURRENT_STEP:-알 수 없는 단계}" >&2
  echo "종료 코드: $code" >&2
  print_step_hint "${CURRENT_STEP:-}"
  exit "$code"
}

begin_step() {
  CURRENT_STEP="$1"
  echo "[진행] $CURRENT_STEP"
}

finish_step() {
  echo "[완료] $CURRENT_STEP"
  CURRENT_STEP=""
}

fail_step() {
  echo "$1" >&2
  return 1
}

trap on_error ERR

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

begin_step "Chrome extension ID 확인"
if [[ ! "$EXTENSION_ID" =~ ^[a-p]{32}$ ]]; then
  fail_step "Chrome extension ID must be 32 characters using only a-p: $EXTENSION_ID"
fi
finish_step

begin_step "필수 runtime 파일 확인"
REQUIRED_FILES=(
  "$HOST_SCRIPT"
  "$SERVER_DIR/translator.js"
  "$SERVER_DIR/translation-schema.json"
  "$SERVER_DIR/openai-pricing-snapshot.json"
)

for required_file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    fail_step "Required runtime file not found: $required_file"
  fi
done
finish_step

begin_step "Node.js 확인"
NODE_BIN="${NODE_BIN:-$(find_executable node || true)}"
if [[ -z "$NODE_BIN" ]]; then
  fail_step "Node.js was not found. Install Node.js or set NODE_BIN before installing."
fi

if ! NODE_VERSION="$("$NODE_BIN" --version 2>/dev/null)"; then
  fail_step "Node.js 실행에 실패했습니다: $NODE_BIN"
fi

NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"
if [[ ! "$NODE_MAJOR" =~ ^[0-9]+$ ]] || (( NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
  fail_step "Node.js $REQUIRED_NODE_MAJOR 이상이 필요합니다. 현재 버전: ${NODE_VERSION:-unknown}"
fi

echo "Node.js: $NODE_BIN ($NODE_VERSION)"
finish_step

begin_step "설치 경로 생성"
mkdir -p "$APP_HOST_DIR" "$APP_SERVER_DIR" "$HOST_DIR" "$MANIFEST_DIR"
finish_step

begin_step "runtime 파일 복사"
install -m 755 "$HOST_SCRIPT" "$APP_HOST_SCRIPT"
install -m 644 "$SERVER_DIR/translator.js" "$APP_SERVER_DIR/translator.js"
install -m 644 "$SERVER_DIR/translation-schema.json" "$APP_SERVER_DIR/translation-schema.json"
install -m 644 "$SERVER_DIR/openai-pricing-snapshot.json" "$APP_SERVER_DIR/openai-pricing-snapshot.json"
finish_step

begin_step "native host launcher 생성"
cat > "$LAUNCHER_PATH" <<EOF
#!/bin/sh
APP_HOST_SCRIPT="$APP_HOST_SCRIPT"
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

if [ ! -f "\$APP_HOST_SCRIPT" ]; then
  echo "Installed native host script not found: \$APP_HOST_SCRIPT" >&2
  exit 1
fi

CODEX_BIN="\${CODEX_TRANSLATOR_CODEX_BIN:-\$(find_executable codex || true)}"
if [ -n "\$CODEX_BIN" ]; then
  export CODEX_TRANSLATOR_CODEX_BIN="\$CODEX_BIN"
  export PATH="\$(dirname "\$CODEX_BIN"):\$PATH"
fi

export PATH="\$(dirname "\$NODE_BIN"):\$PATH"
exec "\$NODE_BIN" "\$APP_HOST_SCRIPT"
EOF

chmod +x "$LAUNCHER_PATH"
finish_step

begin_step "Chrome Native Messaging manifest 생성"
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
finish_step

echo "Installed $HOST_NAME"
echo "Extension ID: $EXTENSION_ID"
echo "Runtime: $APP_DIR"
echo "Manifest: $MANIFEST_PATH"
echo "Launcher: $LAUNCHER_PATH"
echo "Setup URL: $SETUP_URL"

if [[ "${CODEX_TRANSLATOR_OPEN_SETUP:-0}" == "1" ]]; then
  begin_step "설정 페이지 열기"
  if open -a "Google Chrome" "$SETUP_URL" || open "$SETUP_URL"; then
    finish_step
  else
    echo "[경고] 설정 페이지 자동 열기에 실패했습니다. 직접 여세요: $SETUP_URL" >&2
    finish_step
  fi
fi
