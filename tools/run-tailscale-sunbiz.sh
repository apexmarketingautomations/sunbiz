#!/bin/zsh
set -eu

cd /Users/apexmarketingautomations/Documents/Codex/2026-07-17/files-mentioned-by-the-user-apex-2
mkdir -p .local
exec /opt/homebrew/Cellar/node@22/22.22.2_2/bin/node tools/tailscale-sunbiz-server.mjs
