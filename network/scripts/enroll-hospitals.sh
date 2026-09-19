#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
export PATH="${samples_root}/bin:${PATH}"

domain="hospital.blockinsure.test"
base="${network_root}/organizations/peerOrganizations/${domain}"
ca_cert="${network_root}/organizations/fabric-ca/hospital/ca-cert.pem"
export FABRIC_CA_CLIENT_HOME="${base}"

command -v fabric-ca-client >/dev/null || { echo "Missing required tool: fabric-ca-client" >&2; exit 1; }
test -f "${ca_cert}" || { echo "Hospital CA certificate is missing; start the network CAs first." >&2; exit 1; }
test -f "${base}/msp/config.yaml" || { echo "Hospital organization admin enrollment is missing." >&2; exit 1; }

subjects=(hospital-demo hospital-2 hospital-3 hospital-4 hospital-5)
for index in 1 2 3 4 5; do
  user="hospital${index}"
  subject="${subjects[$((index - 1))]}"
  user_msp="${base}/users/${user}@${domain}/msp"
  if compgen -G "${user_msp}/signcerts/*" >/dev/null; then
    echo "${user} (${subject}) is already enrolled."
    continue
  fi
  if [ -d "${user_msp}" ]; then
    quarantine="${user_msp}.failed-$(date -u +%Y%m%dT%H%M%SZ)"
    mv "${user_msp}" "${quarantine}"
    echo "Preserved incomplete ${user} enrollment at ${quarantine}."
  fi
  fabric-ca-client register --caname ca-hospital \
    --id.name "${user}" --id.secret "${user}pw" --id.type client \
    --id.attrs "role=hospitalOfficer:ecert,subjectId=${subject}:ecert" \
    --tls.certfiles "${ca_cert}" >/dev/null 2>&1 || true
  fabric-ca-client enroll -u "https://${user}:${user}pw@localhost:8054" \
    --caname ca-hospital -M "${user_msp}" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${user_msp}/config.yaml"
  echo "Enrolled ${user} with certificate subjectId ${subject}."
done
