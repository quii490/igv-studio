#!/usr/bin/env node
/**
 * Package the single-file studio as a double-clickable app:
 *   dist/IGV Studio.app          (macOS: launches Chrome/Edge in app mode)
 *   dist/IGV-Studio-Windows/     (start.cmd + app.html)
 * The HTML is copied INSIDE the bundle, so the app is self-contained.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'release');
const APP = path.join(DIST, 'IGV Studio.app');
const HTML = path.join(ROOT, 'dist', 'IGV-Single-SVG-Studio.html');
if (!existsSync(HTML)) { console.error('run `npm run standalone` first (dist/IGV-Single-SVG-Studio.html missing)'); process.exit(1); }
mkdirSync(DIST, { recursive: true });

rmSync(APP, { recursive: true, force: true });
mkdirSync(path.join(APP, 'Contents', 'MacOS'), { recursive: true });
mkdirSync(path.join(APP, 'Contents', 'Resources'), { recursive: true });
copyFileSync(HTML, path.join(APP, 'Contents', 'Resources', 'app.html'));
const icns = '/tmp/IGVStudio.icns';
if (existsSync(icns)) copyFileSync(icns, path.join(APP, 'Contents', 'Resources', 'appicon.icns'));

writeFileSync(path.join(APP, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>IGV Studio</string>
  <key>CFBundleDisplayName</key><string>IGV Studio</string>
  <key>CFBundleIdentifier</key><string>org.igvstudio.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>appicon</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>LSApplicationCategoryType</key><string>public.app-category.graphics-design</string>
</dict>
</plist>
`);

const launcher = `#!/bin/bash
# IGV Studio — opens the bundled editor in a Chrome/Edge app window (no browser chrome).
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
HTML="$HERE/../Resources/app.html"
PROFILE="$HOME/Library/Application Support/IGV Studio/profile"
mkdir -p "$PROFILE"

CANDIDATES=(
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"
  "/Applications/Chromium.app/Contents/MacOS/Chromium"
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
)
BROWSER=""
for c in "\${CANDIDATES[@]}"; do [ -x "$c" ] && BROWSER="$c" && break; done

if [ -z "$BROWSER" ]; then
  osascript -e 'display alert "IGV Studio" message "需要 Google Chrome 或 Microsoft Edge。请安装后再试。" as warning' || true
  exit 1
fi

exec "$BROWSER" --app="file://$HTML" --user-data-dir="$PROFILE" \\
  --no-first-run --no-default-browser-check --window-size=1500,950 \\
  --allow-file-access-from-files "$@"
`;
writeFileSync(path.join(APP, 'Contents', 'MacOS', 'launch'), launcher);
chmodSync(path.join(APP, 'Contents', 'MacOS', 'launch'), 0o755);

/* ---------------- Windows ---------------- */
const WIN = path.join(DIST, 'IGV-Studio-Windows');
mkdirSync(WIN, { recursive: true });
copyFileSync(HTML, path.join(WIN, 'app.html'));
writeFileSync(path.join(WIN, 'Start IGV Studio.cmd'), `@echo off
setlocal
set "HERE=%~dp0"
set "PROFILE=%LOCALAPPDATA%\\IGVStudio\\profile"
if not exist "%PROFILE%" mkdir "%PROFILE%"
set "BROWSER="
if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"
if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"
if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "BROWSER=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"
if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" if not defined BROWSER set "BROWSER=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"
if not defined BROWSER (
  echo Chrome/Edge not found - opening in the default browser instead.
  start "" "%HERE%app.html"
  exit /b
)
start "" "%BROWSER%" --app="file:///%HERE:\=/%app.html" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --window-size=1500,950 --allow-file-access-from-files
endlocal
`);
writeFileSync(path.join(WIN, 'README.txt'), `IGV Studio (Windows)\n\n双击 "Start IGV Studio.cmd" 即可。\n需要 Google Chrome 或 Microsoft Edge（已安装其一即可）。\n所有处理都在本机，文件不会上传。\n`);

writeFileSync(path.join(DIST, 'IGV-Studio-README.txt'), `IGV Studio - desktop build

macOS
  1. unzip IGV-Studio-mac.zip and drag "IGV Studio.app" into /Applications
  2. first launch: right-click -> Open (unsigned app)
     if macOS says "damaged":
       xattr -dr com.apple.quarantine "/Applications/IGV Studio.app"
  3. needs Google Chrome or Microsoft Edge installed

Windows
  1. unzip IGV-Studio-Windows.zip anywhere (keep app.html next to the .cmd)
  2. double-click "Start IGV Studio.cmd" (Chrome or Edge required)

Both: own window, no address bar; drop an IGV-exported .svg; everything stays local.
App data: macOS ~/Library/Application Support/IGV Studio ; Windows %LOCALAPPDATA%\\IGVStudio
`);

console.log('built:');
console.log('  ' + APP);
console.log('  ' + WIN);
