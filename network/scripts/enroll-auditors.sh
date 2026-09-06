#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
export PATH="${samples_root}/bin:${PATH}"

domain="auditor.blockinsure.test"
base="${network_root}/organizations/peerOrganizations/${domain}"
ca_cert="${network_root}/organizations/fabric-ca/auditor/ca-cert.pem"
export FABRIC_CA_CLIENT_HOME="${base}"

command -v fabric-ca-client >/dev/null || { echo "Missing required tool: fabric-ca-client" >&2; exit 1; }
test -f "${ca_cert}" || { echo "Auditor CA certificate is missing; start the network CAs first." >&2; exit 1; }
test -f "${base}/msp/config.yaml" || { echo "Auditor organization admin enrollment is missing." >&2; exit 1; }

for index in 1 2 3 4; do
  user="auditor${index}"
  user_msp="${base}/users/${user}@${domain}/msp"
  if compgen -G "${user_msp}/signcerts/*" >/dev/null; then
    echo "${user} is already enrolled."
    continue
  fi
  fabric-ca-client register --caname ca-auditor \
    --id.name "${user}" --id.secret "${user}pw" --id.type client \
    --id.attrs "role=auditor:ecert,subjectId=${user}:ecert" \
    --tls.certfiles "${ca_cert}" >/dev/null 2>&1 || true
  fabric-ca-client enroll -u "https://${user}:${user}pw@localhost:9054" \
    --caname ca-auditor -M "${user_msp}" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${user_msp}/config.yaml"
  echo "Enrolled ${user} with an immutable subjectId certificate attribute."
done
