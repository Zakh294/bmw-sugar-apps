#!/bin/sh
# Rebuilds DeX Drive's native programs into native/dex_drive/prebuilt (committed: the Store installs the tool from
# there as it is, with no build step on the car), and runs their tests.
#   sh tools/dex_drive/build_native.sh
# Needs Go 1.22+, a C++ compiler (the fake decoder for the tests), zig (`pip install ziglang`) and binutils' readelf.
set -e
cd "$(dirname "$0")/../.."
( cd native/dex_drive/dexd && go vet ./... && go test -count=1 ./... )
( cd native/dex_drive/dexd && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o ../prebuilt/dex-drive-d . )
python3 native/dex_drive/dexdec/tools/build.py
sha256sum native/dex_drive/prebuilt/dex-drive-d native/dex_drive/prebuilt/dexdec native/dex_drive/prebuilt/scrcpy-server
