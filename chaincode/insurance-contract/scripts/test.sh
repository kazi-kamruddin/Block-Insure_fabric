#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
contract_root="$(cd -- "${script_dir}/.." && pwd -P)"
docker_command=""

if command -v docker >/dev/null && docker info >/dev/null 2>&1; then
  docker_command="docker"
elif command -v docker.exe >/dev/null && docker.exe info >/dev/null 2>&1; then
  docker_command="docker.exe"
else
  echo "Docker Desktop is not reachable from this shell." >&2
  exit 1
fi

mount_path="${contract_root}"
if [ "${docker_command}" = "docker.exe" ]; then
  mount_path="$(wslpath -w "${contract_root}")"
fi

"${docker_command}" volume create block-insure-go-cache >/dev/null
"${docker_command}" run --rm \
  -v block-insure-go-cache:/go/pkg/mod \
  -v "${mount_path}:/workspace" \
  -w /workspace golang:1.25 \
  bash -c '/usr/local/go/bin/gofmt -w . && /usr/local/go/bin/go vet ./... && /usr/local/go/bin/go test ./...'
