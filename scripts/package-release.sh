#!/bin/zsh
# Package an existing app; never sign, notarize, upload, or change Safari.
set -euo pipefail
cd "${0:A:h:h}"

if [[ $# -ne 2 || ( "$1" != --development && "$1" != --release ) ]]; then
  print -u2 'Usage: scripts/package-release.sh --development|--release /absolute/path/to/App.app'
  exit 2
fi
mode="$1"
app_path="$2"
if [[ "$app_path" != /* || ! -d "$app_path/Contents" || "$app_path" != *.app ]]; then
  print -u2 'Choose an existing app using its absolute path.'
  exit 2
fi
/usr/bin/codesign --verify --deep --strict "$app_path"
for component in runtime/node runtime/LICENSE server/start-desktop.mjs; do
  if [[ ! -f "$app_path/Contents/Resources/AIService/$component" ]]; then
    print -u2 'The app is missing its bundled AI service, runtime or license. Build the complete app first.'
    exit 1
  fi
done
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app_path/Contents/Info.plist")
if [[ ! "$version" =~ '^[0-9]+\.[0-9]+\.[0-9]+$' ]]; then
  print -u2 'The app needs a numeric release version.'
  exit 2
fi
label=developer-preview
if [[ "$mode" == --release ]]; then
  signature=$(/usr/bin/codesign -dvv "$app_path" 2>&1)
  if [[ "$signature" != *'Authority=Developer ID Application:'* ]]; then
    print -u2 'Public release requires a Developer ID Application signature.'
    exit 1
  fi
  /usr/bin/xcrun stapler validate "$app_path"
  /usr/sbin/spctl --assess --type execute --verbose=2 "$app_path"
  label=macOS
fi
mkdir -p build/releases
archive_path="$PWD/build/releases/Safari-Workspaces-${version}-${label}.zip"
if [[ -e "$archive_path" ]]; then
  print -u2 "Package already exists: $archive_path. Preserve it or choose a new build/version."
  exit 1
fi
/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive_path"
/usr/bin/shasum -a 256 "$archive_path" > "$archive_path.sha256"
print "Packaged: $archive_path"
if [[ "$mode" == --development ]]; then
  print 'Developer preview only. This does not establish normal Gatekeeper installation or release readiness.'
fi
