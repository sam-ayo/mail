#!/usr/bin/env bash
# Installs the AI sorting script as a launchd agent on this Mac.
# It copies sort.mjs to ~/.config/relay-ai-sorting, because launchd jobs
# cannot read files in ~/Desktop or ~/Documents.
#
# Usage: RELAY_URL=https://mail.samayo.me RELAY_TOKEN=relay_... scripts/ai-sorting/install.sh
# Optional: AI_SORTING_ENGINE=codex, AI_SORTING_MODEL=..., INTERVAL=300 (seconds)
set -euo pipefail

: "${RELAY_URL:?Set RELAY_URL to the mail app, for example https://mail.samayo.me}"
: "${RELAY_TOKEN:?Set RELAY_TOKEN to a token from Settings › AI sorting}"
engine="${AI_SORTING_ENGINE:-claude}"
interval="${INTERVAL:-300}"
label="me.samayo.relay-ai-sorting"
dir="$HOME/.config/relay-ai-sorting"
plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/relay-ai-sorting.log"

node="$(command -v node)" || { echo "Install Node.js first" >&2; exit 1; }
engine_bin="$(command -v "$engine")" || { echo "Install the $engine CLI and sign in first" >&2; exit 1; }

mkdir -p "$dir" "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cp "$(dirname "$0")/sort.mjs" "$dir/sort.mjs"
umask 077
cat >"$dir/config.env" <<EOF
RELAY_URL=$RELAY_URL
RELAY_TOKEN=$RELAY_TOKEN
AI_SORTING_ENGINE=$engine
AI_SORTING_MODEL=${AI_SORTING_MODEL:-}
EOF
chmod 600 "$dir/config.env"
[[ -f "$dir/instructions.md" ]] || cat >"$dir/instructions.md" <<'EOF'
<!-- Your own sorting rules. The AI reads this file on each run. Examples:
- Mail from my bank is important, also its marketing.
- GitHub notifications are promotions.
-->
EOF

# launchd gives a short PATH. Add the folders of node and the engine. Codex needs node.
path="$(dirname "$node"):$(dirname "$engine_bin"):/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
umask 022
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$node</string><string>$dir/sort.mjs</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$path</string></dict>
  <key>StartInterval</key><integer>$interval</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$log</string>
  <key>StandardErrorPath</key><string>$log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Installed. AI sorting runs with $engine every $interval seconds."
echo "Log: $log"
echo "Your rules: $dir/instructions.md"
echo "Remove it with: scripts/ai-sorting/uninstall.sh"
