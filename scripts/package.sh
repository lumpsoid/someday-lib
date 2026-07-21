#!/usr/bin/env bash
#
# Build the plugin and bundle the release files into a distributable archive.
#
# Obsidian only reads main.js, manifest.json and styles.css, so those are the
# only files placed in the archive. The zip is written to dist/ and its entries
# are nested under <id>/ so it extracts straight into a vault's
# .obsidian/plugins/ folder.
#
# Usage:
#   scripts/package.sh [--skip-build]
#   npm run package
#
# --skip-build packages the existing main.js instead of rebuilding.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SKIP_BUILD=0
for arg in "$@"; do
	[ "$arg" = "--skip-build" ] && SKIP_BUILD=1
done

PLUGIN_ID="$(node -p "require('./manifest.json').id")"
VERSION="$(node -p "require('./manifest.json').version")"

if [ "$SKIP_BUILD" -eq 0 ]; then
	echo "Building $PLUGIN_ID $VERSION..."
	npm run build
elif [ ! -f "main.js" ]; then
	echo "Error: --skip-build was given but main.js does not exist." >&2
	echo "Run 'npm run build' first, or drop --skip-build." >&2
	exit 1
fi

# Verify the release files exist before archiving.
FILES=(main.js manifest.json styles.css)
for f in "${FILES[@]}"; do
	if [ ! -f "$f" ]; then
		echo "Error: expected release file '$f' is missing." >&2
		exit 1
	fi
done

DIST_DIR="$REPO_ROOT/dist"
STAGE_DIR="$DIST_DIR/$PLUGIN_ID"
ARCHIVE="$DIST_DIR/$PLUGIN_ID-$VERSION.zip"

mkdir -p "$DIST_DIR"
rm -rf "$STAGE_DIR" "$ARCHIVE"
mkdir -p "$STAGE_DIR"

cp "${FILES[@]}" "$STAGE_DIR/"

# Zip from dist/ so archive entries are prefixed with <id>/.
( cd "$DIST_DIR" && zip -r -q "$ARCHIVE" "$PLUGIN_ID" )
rm -rf "$STAGE_DIR"

echo "Packaged: ${ARCHIVE#$REPO_ROOT/}"
( cd "$DIST_DIR" && unzip -l "$ARCHIVE" )
