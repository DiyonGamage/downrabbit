#!/bin/sh
# downrabbit installer for macOS, Linux and Termux
#   curl -fsSL https://downrabbit.pages.dev/install.sh | sh
# needs node 18+ (yt-dlp and the engine download themselves; ffmpeg is only
# needed for merging 1080p+ video and mp3 conversion).
set -eu

BASE="${DOWNRABBIT_SRC:-https://github.com/DiyonGamage/downrabbit/archive/refs/heads/main.tar.gz}"
DIR="${DOWNRABBIT_DIR:-$HOME/.local/share/downrabbit}"

say() { printf '%s\n' "$*"; }
fail() { say "install failed: $*"; exit 1; }

IS_TERMUX=0
[ -n "${PREFIX:-}" ] && [ -d "$PREFIX" ] && IS_TERMUX=1
if [ "$IS_TERMUX" = 1 ]; then BIN="$PREFIX/bin"; else BIN="$HOME/.local/bin"; fi
mkdir -p "$DIR/bridge/bin" "$BIN"

command -v curl >/dev/null 2>&1 || fail "curl is required"

if [ "$IS_TERMUX" = 1 ]; then
  say "installing packages (nodejs, ffmpeg, yt-dlp) - already-installed ones are skipped..."
  pkg update -y >/dev/null 2>&1 || true
  pkg install -y nodejs ffmpeg yt-dlp || fail "pkg install failed"
  if [ ! -d "$HOME/storage/downloads" ] && command -v termux-setup-storage >/dev/null 2>&1; then
    say "allow the storage prompt so downr can save into your Downloads folder"
    termux-setup-storage || true
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  say "node is required (18 or newer). install it first:"
  say "  macOS:   brew install node"
  say "  Ubuntu:  sudo apt install nodejs npm"
  say "  others:  https://nodejs.org"
  exit 1
fi
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || fail "node $NODE_MAJOR is too old - install node 18 or newer"

say "downrabbit"
say "installing to $DIR"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

say "downloading the engine..."
curl -fsSL "$BASE" -o "$TMP/src.tar.gz" || fail "could not download the engine"
tar -xzf "$TMP/src.tar.gz" -C "$TMP" || fail "could not unpack the engine"
SRC=$(find "$TMP" -maxdepth 1 -type d -name 'downrabbit-*' | head -n 1)
[ -n "$SRC" ] || fail "the download did not contain the engine files"

cp "$SRC/bridge/server.js" "$DIR/bridge/server.js"
cp "$SRC/bridge/downr.js" "$DIR/bridge/downr.js"
cp "$SRC/bridge/package.json" "$DIR/bridge/package.json"

if [ -x "$DIR/bridge/bin/yt-dlp" ]; then
  say "yt-dlp already present"
elif [ "$IS_TERMUX" = 1 ]; then
  command -v yt-dlp >/dev/null 2>&1 || fail "run: pkg install -y yt-dlp"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-*) YTDLP=yt-dlp_macos ;;
    Linux-x86_64|Linux-amd64) YTDLP=yt-dlp_linux ;;
    Linux-aarch64|Linux-arm64) YTDLP=yt-dlp_linux_aarch64 ;;
    Linux-armv7l) YTDLP=yt-dlp_linux_armv7l ;;
    *) fail "no yt-dlp build for $(uname -s) $(uname -m) - install yt-dlp yourself" ;;
  esac
  say "downloading yt-dlp ($YTDLP)..."
  curl -fsSL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/$YTDLP" -o "$DIR/bridge/bin/yt-dlp" || fail "could not download yt-dlp"
  chmod +x "$DIR/bridge/bin/yt-dlp"
fi

if ! command -v ffmpeg >/dev/null 2>&1 && [ ! -x "$DIR/bridge/bin/ffmpeg" ]; then
  say ""
  say "note: ffmpeg is not installed. direct links and single-file videos still work,"
  say "but 1080p+ video (separate audio+video streams) and mp3 need it:"
  say "  macOS:   brew install ffmpeg"
  say "  Ubuntu:  sudo apt install ffmpeg"
  say "  Termux:  pkg install -y ffmpeg"
  say ""
fi

cat > "$BIN/downr" <<EOF
#!/bin/sh
exec node "$DIR/bridge/downr.js" "\$@"
EOF
chmod +x "$BIN/downr"

case ":$PATH:" in
  *":$BIN:"*) ;;
  *)
    say ""
    say "$BIN is not on your PATH. add this line to ~/.bashrc or ~/.zshrc:"
    say "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

say ""
say "installed. open a new terminal, then type:"
say ""
say "    downr https://youtu.be/jNQXAC9IVRw"
say ""
say "or just type \"downr\" and paste a link when it asks."
say "files go to your Downloads folder. -q 1080 / -m / -o \"\$HOME/Videos\" change that."
