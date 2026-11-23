#!/bin/sh
# SPDX-License-Identifier: MIT
# mgu-deploy runs this once a new version runs: the control socket must be there (else the tool is rolled back).
i=0
while [ $i -lt 20 ]; do
    [ -S /run/dex-drive-d/ctl.sock ] && exit 0
    i=$((i + 1))
    sleep 0.5
done
echo "dex-drive-d: no /run/dex-drive-d/ctl.sock after 10 s"
exit 1
