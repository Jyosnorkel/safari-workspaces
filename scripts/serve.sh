#!/bin/zsh
set -euo pipefail
cd "${0:A:h:h}"
print 'Demo: http://localhost:8765/'
python3 -m http.server 8765 --bind 127.0.0.1 --directory demo
