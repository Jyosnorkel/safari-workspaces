#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
node scripts/verify-extension-package.mjs
xcodebuild -project 'native/Safari Dev Lab/Safari Dev Lab.xcodeproj' \
  -scheme 'Safari Dev Lab' -configuration Debug -derivedDataPath build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
./scripts/bundle-service.sh 'build/Build/Products/Debug/Safari Dev Lab.app'
node scripts/verify-extension-package.mjs 'build/Build/Products/Debug/Safari Dev Lab.app'
print '\nBuilt app: build/Build/Products/Debug/Safari Dev Lab.app'
