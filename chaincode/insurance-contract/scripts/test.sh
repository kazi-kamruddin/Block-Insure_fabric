#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
contract_root="$(cd -- "${script_dir}/.." && pwd -P)"
source "${contract_root}/../../network/scripts/chaincode-toolchain.sh"
docker_command=""

for attempt in {1..10}; do
  if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    docker_command="docker"
    break
  elif command -v docker.exe >/dev/null && docker.exe info >/dev/null 2>&1; then
    docker_command="docker.exe"
    break
  fi
  if [ "${attempt}" -lt 10 ]; then
    echo "Docker is not ready (attempt ${attempt}/10); retrying in 2 seconds..." >&2
    sleep 2
  fi
done
if [ -z "${docker_command}" ]; then
  echo "Docker Desktop is not reachable after 10 attempts." >&2
  exit 1
fi

mount_path="${contract_root}"
if [ "${docker_command}" = "docker.exe" ]; then
  mount_path="$(wslpath -w "${contract_root}")"
fi

"${docker_command}" volume create block-insure-go-cache >/dev/null
"${docker_command}" run --rm \
  --memory 512m --cpus 1 -e GOTOOLCHAIN=local -e GOMEMLIMIT=384MiB -e GOMAXPROCS=1 -e GOFLAGS=-p=1 \
  -v block-insure-go-cache:/go/pkg/mod \
  -v "${mount_path}:/workspace:ro" \
  -w /workspace "$chaincode_go_image" \
  bash -c 'test -z "$(/usr/local/go/bin/gofmt -l .)" && /usr/local/go/bin/go vet ./... && /usr/local/go/bin/go test ./...'
