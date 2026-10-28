#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
xcodebuild -project 'native/Safari Dev Lab/Safari Dev Lab.xcodeproj' \
  -scheme 'Safari Dev Lab' -configuration Debug -derivedDataPath build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES build
print '\nBuilt app: build/Build/Products/Debug/Safari Dev Lab.app'
