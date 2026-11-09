#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
# A separate tag preserves every existing builder and deployed runtime image.
image='block-insure/fabric-ccenv:2.5.16-go1.26.10'
docker build --memory 512m --tag "$image" "$root/network/chaincode-builder"
docker run --rm --network none --memory 128m --entrypoint /usr/local/go/bin/go "$image" version
printf 'Set FABRIC_CHAINCODE_BUILDER=%s before starting the isolated peers.\n' "$image"
