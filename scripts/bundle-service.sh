#!/bin/zsh
# Developer packaging only. Public releases must use a verified official runtime.
set -euo pipefail
cd "${0:A:h:h}"
app=${1:?Pass the built app path}
runtime=${WORKSPACES_NODE_PATH:-$(command -v node)}
runtime=${runtime:A}
license=${WORKSPACES_NODE_LICENSE:-${runtime:h:h}/LICENSE}
[[ -x "$runtime" && -f "$license" ]] || { print -u2 'Node runtime and its LICENSE are required. Set WORKSPACES_NODE_PATH and WORKSPACES_NODE_LICENSE.'; exit 1; }
[[ "$($runtime -p 'process.platform')" == darwin ]] || { print -u2 'Use a macOS Node runtime.'; exit 1; }
destination="$app/Contents/Resources/AIService"
mkdir -p "$destination/runtime" "$destination/server"
cp "$runtime" "$destination/runtime/node"
cp "$license" "$destination/runtime/LICENSE"
cp server/*.mjs "$destination/server/"
chmod 755 "$destination/runtime/node"
codesign --force --sign - --options runtime --entitlements scripts/node-runtime.entitlements "$destination/runtime/node"
# Copying resources changes the containing app seal; do not re-sign the extension.
codesign --force --sign - --options runtime "$app"
codesign --verify --deep --strict "$app"
print 'Bundled local AI service and Node runtime (development signature). No service was started.'
