#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
# An alternate output must be deliberate; never modify a registered app in place.
derived_data=${1:-build}
[[ "$derived_data" = /* ]] || derived_data="$PWD/$derived_data"
app_output="$derived_data/Build/Products/Debug/Safari Dev Lab.app"
node scripts/check-build-target.mjs "$app_output"
node scripts/verify-extension-package.mjs
xcodebuild -project 'native/Safari Dev Lab/Safari Dev Lab.xcodeproj' \
  -scheme 'Safari Dev Lab' -configuration Debug -derivedDataPath "$derived_data" \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
./scripts/bundle-service.sh "$app_output"
node scripts/verify-extension-package.mjs "$app_output"
print "\nBuilt app: $app_output"
print 'Build completion does not verify Safari has loaded this version. Do not overwrite a registered copy.'
