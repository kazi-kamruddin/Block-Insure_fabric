#!/usr/bin/env bash
# Build with the pinned cached toolchain. Run with all Fabric services stopped.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd -- "$here/../.." && pwd -P)"
source "$here/chaincode-toolchain.sh"
out="$root/data/dev-lite/channel-artifacts/r2"
label=insurance-contract_1.9.0-r2
docker_cli=docker
checkout="$root"
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  docker_cli=docker.exe
  checkout="$(wslpath -w "$root")"
fi
if [[ -n "$("$docker_cli" ps -q --filter label=com.docker.compose.service=orderer)" ]]; then
  echo 'Stop Fabric before compiling the chaincode service.' >&2
  exit 1
fi
"$docker_cli" image inspect "$chaincode_builder_image" >/dev/null
"$docker_cli" volume inspect block-insure-go-cache >/dev/null
mkdir -p "$out"
"$docker_cli" run --rm --pull never --network none --memory 512m --cpus 1 --entrypoint /bin/sh \
  -e GOPROXY=off -e GOSUMDB=off -e GOMODCACHE=/go/pkg/mod -e GOTOOLCHAIN=local -e GOMAXPROCS=1 -e GOMEMLIMIT=384MiB \
  -e CGO_ENABLED=0 -e GOFLAGS=-p=1 -v block-insure-go-cache:/go/pkg/mod:ro \
  -v "$checkout:/workspace:ro" -w /workspace/chaincode/insurance-contract \
  "$chaincode_builder_image" -c 'go build -trimpath -buildvcs=false -o /tmp/insurance-contract . && cat /tmp/insurance-contract' \
  > "$out/insurance-contract.building"
chmod 755 "$out/insurance-contract.building"
mv "$out/insurance-contract.building" "$out/insurance-contract"

package_dir="$(mktemp -d)"
trap 'rm -f -- "$package_dir/connection.json" "$package_dir/metadata.json" "$package_dir/code.tar.gz"; rmdir -- "$package_dir"' EXIT
printf '%s\n' '{"address":"insurance-chaincode:9999","dial_timeout":"10s","tls_required":false}' > "$package_dir/connection.json"
binary_hash="$(sha256sum "$out/insurance-contract" | cut -d' ' -f1)"
printf '{"type":"ccaas","label":"%s","binarySha256":"%s"}\n' "$label" "$binary_hash" > "$package_dir/metadata.json"
archive() {
  tar -C "$package_dir" --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=0644 -cf - "$@" | gzip -n
}
archive connection.json > "$package_dir/code.tar.gz"
archive metadata.json code.tar.gz > "$out/$label.tar.gz"
(
  cd "$out"
  sha256sum "$label.tar.gz" insurance-contract > SHA256SUMS
  package_hash="$(sha256sum "$label.tar.gz" | cut -d' ' -f1)"
  printf '%s:%s\n' "$label" "$package_hash" > package-id.txt
  sha256sum --check SHA256SUMS
  cat package-id.txt
)
