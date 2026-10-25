#!/usr/bin/env bash
# Stops the AI sorting launchd agent and removes its files. Your instructions.md stays.
set -euo pipefail

label="me.samayo.relay-ai-sorting"
dir="$HOME/.config/relay-ai-sorting"
launchctl bootout "gui/$(id -u)/$label" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$label.plist" "$dir/sort.mjs" "$dir/config.env"
echo "Removed. Delete the token in Settings › AI sorting."
