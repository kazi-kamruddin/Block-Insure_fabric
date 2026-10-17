#!/usr/bin/env bash
set -euo pipefail

# Stage dependencies outside the source tree. Fabric's isolated builders have
# no shared module cache and otherwise download the same modules on every peer.
source_root="$1"
package_file="$2"
package_label="$3"
peer_command="${4:-peer}"
staging_root="$(mktemp -d)"
trap 'rm -rf -- "${staging_root}"' EXIT
cp -a "${source_root}/." "${staging_root}/"
(
  cd "${staging_root}"
  go mod verify
  go mod vendor
)
"${peer_command}" lifecycle chaincode package "${package_file}" \
  --path "${staging_root}" --lang golang --label "${package_label}"
