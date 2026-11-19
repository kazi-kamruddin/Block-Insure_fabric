# Source from the chaincode build, test and deployment scripts.
toolchain_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
chaincode_go_version="$(awk '$1 == "go" {print $2; exit}' "$toolchain_dir/../../chaincode/insurance-contract/go.mod" | tr -d '\r')"
chaincode_go_image="$(sed -n 's/^ARG GO_IMAGE=//p' "$toolchain_dir/../chaincode-builder/Dockerfile" | tr -d '\r')"
if [[ ! "$chaincode_go_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ||
      ! "$chaincode_go_image" =~ ^golang:[0-9]+\.[0-9]+\.[0-9]+@sha256:[a-f0-9]{64}$ ||
      "$chaincode_go_image" != "golang:${chaincode_go_version}@"* ]]; then
  echo "Chaincode go.mod and the digest-pinned builder GO_IMAGE must select the same Go patch version." >&2
  return 1
fi
chaincode_builder_image="block-insure/fabric-ccenv:2.5.16-go${chaincode_go_version}"
