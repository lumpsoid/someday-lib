#!/usr/bin/env bash
#
# Symlink this plugin into an Obsidian vault for local development.
#
# The whole repo directory is linked to <vault>/.obsidian/plugins/<id>/, so a
# rebuild (npm run dev / npm run build) is picked up on the next Obsidian reload.
# Only main.js, manifest.json, styles.css and data.json are read by Obsidian;
# data.json (your settings) is gitignored, so it won't touch the repo history.
#
# Usage:
#   scripts/install-vault.sh <vault-path> [--force]
#   VAULT=<vault-path> scripts/install-vault.sh [--force]
#
# --force replaces an existing entry at the destination.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VAULT="${1:-${VAULT:-}}"
FORCE=0
for arg in "$@"; do
	[ "$arg" = "--force" ] && FORCE=1
done
# If the first positional arg was --force, there was no vault path.
[ "${VAULT:-}" = "--force" ] && VAULT=""

if [ -z "${VAULT:-}" ]; then
	echo "Usage: $0 <vault-path> [--force]" >&2
	echo "   or: VAULT=<vault-path> $0 [--force]" >&2
	exit 1
fi

# Resolve the vault to an absolute path.
VAULT="$(cd "$VAULT" 2>/dev/null && pwd || true)"
if [ -z "$VAULT" ]; then
	echo "Error: vault path does not exist." >&2
	exit 1
fi
if [ ! -d "$VAULT/.obsidian" ]; then
	echo "Error: '$VAULT' has no .obsidian folder — is it an Obsidian vault?" >&2
	exit 1
fi

PLUGIN_ID="$(node -p "require('$REPO_ROOT/manifest.json').id")"
PLUGINS_DIR="$VAULT/.obsidian/plugins"
DEST="$PLUGINS_DIR/$PLUGIN_ID"

mkdir -p "$PLUGINS_DIR"

if [ -L "$DEST" ]; then
	rm "$DEST" # existing symlink: safe to refresh
elif [ -e "$DEST" ]; then
	if [ "$FORCE" -eq 1 ]; then
		rm -rf "$DEST"
	else
		echo "Error: '$DEST' already exists and is not a symlink." >&2
		echo "Re-run with --force to replace it." >&2
		exit 1
	fi
fi

ln -s "$REPO_ROOT" "$DEST"
echo "Linked $PLUGIN_ID -> $DEST"

if [ ! -f "$REPO_ROOT/main.js" ]; then
	echo "Note: main.js is not built yet — run 'npm run build' (or 'npm run dev')."
fi
echo "Enable it in Obsidian: Settings -> Community plugins -> $PLUGIN_ID."
