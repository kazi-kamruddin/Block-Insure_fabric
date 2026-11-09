#!/usr/bin/env bash
set -euo pipefail
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
channel="${CHANNEL_NAME:-insurance-workflow-alignment-20261108}"
version="${CHAINCODE_VERSION:-1.6.0-xgb-alignment}"
if [[ ! "$channel" =~ ^insurance-workflow-alignment-[0-9]{8}$ ]]; then
  echo 'Alignment deployment requires a dated alignment-only channel; preserved channels are forbidden.' >&2
  exit 2
fi
if [[ ! "$version" =~ ^1\.6\.[0-9]+-xgb-alignment$ ]]; then
  echo 'Use a distinct 1.6.x-xgb-alignment package version for this candidate.' >&2
  exit 2
fi
cd "$project_root"
node_command="$(command -v node || command -v node.exe || true)"
if [[ -z "$node_command" ]]; then
  echo 'Node is required to verify the evaluator identity before deployment.' >&2
  exit 1
fi
"$node_command" services/oracle-worker/scripts/check-xgboost.mjs
CHANNEL_NAME="$channel" CHAINCODE_VERSION="$version" bash network/scripts/create-workflow-channel.sh
CHANNEL_NAME="$channel" CHAINCODE_VERSION="$version" CHAINCODE_SEQUENCE=1 bash scripts/audit-chaincode-package.sh
