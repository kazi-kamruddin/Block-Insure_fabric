#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
export PATH="${samples_root}/bin:${PATH}"

domain="oracle.blockinsure.test"
base="${network_root}/organizations/peerOrganizations/${domain}"
ca_cert="${network_root}/organizations/fabric-ca/oracle/ca-cert.pem"
export FABRIC_CA_CLIENT_HOME="${base}"

command -v fabric-ca-client >/dev/null || { echo "Missing required tool: fabric-ca-client" >&2; exit 1; }
test -f "${ca_cert}" || { echo "Oracle CA certificate is missing; start the network CAs first." >&2; exit 1; }
test -f "${base}/msp/config.yaml" || { echo "Oracle organization admin enrollment is missing." >&2; exit 1; }

for index in 1 2; do
  user="oracle${index}"
  user_msp="${base}/users/${user}@${domain}/msp"
  if compgen -G "${user_msp}/signcerts/*" >/dev/null; then
    echo "${user} is already enrolled."
    continue
  fi
  fabric-ca-client register --caname ca-oracle \
    --id.name "${user}" --id.secret "${user}pw" --id.type client \
    --id.attrs "role=oracle:ecert,subjectId=${user}:ecert" \
    --tls.certfiles "${ca_cert}" >/dev/null 2>&1 || true
  fabric-ca-client enroll -u "https://${user}:${user}pw@localhost:13054" \
    --caname ca-oracle -M "${user_msp}" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${user_msp}/config.yaml"
  echo "Enrolled ${user} with an immutable Oracle subjectId certificate attribute."
done
