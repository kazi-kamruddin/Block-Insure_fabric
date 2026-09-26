#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
project_root="$(cd -- "${script_dir}/.." && pwd -P)"
network_root="${project_root}/network"
channel_name="${CHANNEL_NAME:-insurance-channel}"
chaincode_version="${CHAINCODE_VERSION:-1.4.0}"
chaincode_sequence="${CHAINCODE_SEQUENCE:-11}"
package_file="${network_root}/channel-artifacts/insurance-contract_${chaincode_version}.tar.gz"
organizations="${network_root}/organizations"
export PATH="${network_root}/.fabric/fabric-samples/bin:${PATH}"
export FABRIC_CFG_PATH="${network_root}/.fabric/fabric-samples/config"

if [[ ! -f "${package_file}" ]]; then
  echo "Missing local package: ${package_file}" >&2
  exit 1
fi

expected_id="$(peer lifecycle chaincode calculatepackageid "${package_file}")"
echo "Local package ID: ${expected_id}"

python3 - "${package_file}" "${project_root}/chaincode/insurance-contract" <<'PY'
import io
import pathlib
import sys
import tarfile

package_path, source_root = sys.argv[1], pathlib.Path(sys.argv[2])
with tarfile.open(package_path) as package:
    with tarfile.open(fileobj=io.BytesIO(package.extractfile("code.tar.gz").read())) as code:
        runtime_files = [entry for entry in code if entry.isfile() and
                         (entry.name.endswith(".go") and not entry.name.endswith("_test.go") or
                          entry.name in {"src/go.mod", "src/go.sum"})]
        mismatches = []
        for entry in runtime_files:
            source = source_root / entry.name.removeprefix("src/")
            if not source.is_file() or source.read_bytes() != code.extractfile(entry).read():
                mismatches.append(entry.name)
        if mismatches:
            raise SystemExit("Packaged runtime differs from source: " + ", ".join(mismatches))
        print(f"Packaged runtime matches {len(runtime_files)} source files byte-for-byte")
PY

for entry in "insurer InsurerMSP 7051" "hospital HospitalMSP 8051" "auditor AuditorMSP 9051" "bank BankMSP 12051" "oracle OracleMSP 13051"; do
  read -r org msp port <<<"${entry}"
  domain="${org}.blockinsure.test"
  export CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_LOCALMSPID="${msp}"
  export CORE_PEER_TLS_ROOTCERT_FILE="${organizations}/peerOrganizations/${domain}/peers/peer0.${domain}/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="${organizations}/peerOrganizations/${domain}/users/Admin@${domain}/msp"
  export CORE_PEER_ADDRESS="localhost:${port}"

  definition="$(peer lifecycle chaincode querycommitted --channelID "${channel_name}" --name insurance-contract)"
  approval="$(peer lifecycle chaincode queryapproved --channelID "${channel_name}" --name insurance-contract --sequence "${chaincode_sequence}")"
  installed="$(peer lifecycle chaincode queryinstalled)"
  [[ "${definition}" == *"Version: ${chaincode_version}, Sequence: ${chaincode_sequence}"* ]] || { echo "${org}: unexpected committed definition: ${definition}" >&2; exit 1; }
  [[ "${approval}" == *"${expected_id}"* ]] || { echo "${org}: approved package differs from local package" >&2; exit 1; }
  [[ "${installed}" == *"${expected_id}"* ]] || { echo "${org}: local package ID not installed" >&2; exit 1; }
  echo "${org}: ${channel_name} committed ${chaincode_version}/${chaincode_sequence}, approved and installed local package ID"
done
