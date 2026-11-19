#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$root/network/scripts/chaincode-toolchain.sh"
# A separate tag preserves every existing builder and deployed runtime image.
docker build --memory 512m --tag "$chaincode_builder_image" "$root/network/chaincode-builder"
built_version="$(docker run --rm --network none --memory 128m --entrypoint /usr/local/go/bin/go "$chaincode_builder_image" env GOVERSION)"
if [[ "$built_version" != "go$chaincode_go_version" ]]; then
  printf 'Expected builder compiler go%s, got %s.\n' "$chaincode_go_version" "$built_version" >&2
  exit 1
fi
printf 'Set FABRIC_CHAINCODE_BUILDER=%s before starting the isolated peers.\n' "$chaincode_builder_image"
