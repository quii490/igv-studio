#!/bin/bash
# usage: make-dmg.sh <app path> <out dmg> <volname>
set -euo pipefail
APP="$1"; OUT="$2"; VOL="$3"
STAGE=$(mktemp -d /tmp/igv-dmg.XXXXXX)
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT"
hdiutil create -volname "$VOL" -srcfolder "$STAGE" -ov -format UDZO "$OUT" >/dev/null
echo "$OUT"
