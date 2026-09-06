#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network_root="$(cd -- "${script_dir}/.." && pwd -P)"
samples_root="${network_root}/.fabric/fabric-samples"
export PATH="${samples_root}/bin:${PATH}"

org_root="${network_root}/organizations"

require_tool() { command -v "$1" >/dev/null || { echo "Missing required tool: $1" >&2; exit 1; }; }
require_tool fabric-ca-client

write_node_ous() {
  local msp_dir="$1" ca_file="$2"
  cat >"${msp_dir}/config.yaml" <<EOF
NodeOUs:
  Enable: true
  ClientOUIdentifier: { Certificate: ${ca_file}, OrganizationalUnitIdentifier: client }
  PeerOUIdentifier: { Certificate: ${ca_file}, OrganizationalUnitIdentifier: peer }
  AdminOUIdentifier: { Certificate: ${ca_file}, OrganizationalUnitIdentifier: admin }
  OrdererOUIdentifier: { Certificate: ${ca_file}, OrganizationalUnitIdentifier: orderer }
EOF
}

enroll_peer_org() {
  local org="$1" msp="$2" port="$3" role="$4"
  local domain="${org}.blockinsure.test" ca_name="ca-${org}"
  local base="${org_root}/peerOrganizations/${domain}"
  local ca_cert="${org_root}/fabric-ca/${org}/ca-cert.pem"
  export FABRIC_CA_CLIENT_HOME="${base}"
  fabric-ca-client enroll -u "https://admin:adminpw@localhost:${port}" --caname "${ca_name}" --tls.certfiles "${ca_cert}"
  write_node_ous "${base}/msp" "cacerts/localhost-${port}-${ca_name}.pem"
  mkdir -p "${base}/msp/tlscacerts" "${base}/ca" "${base}/tlsca"
  cp "${ca_cert}" "${base}/msp/tlscacerts/ca.crt"
  cp "${ca_cert}" "${base}/ca/ca.${domain}-cert.pem"
  cp "${ca_cert}" "${base}/tlsca/tlsca.${domain}-cert.pem"
  fabric-ca-client register --caname "${ca_name}" --id.name peer0 --id.secret peer0pw --id.type peer --tls.certfiles "${ca_cert}"
  fabric-ca-client register --caname "${ca_name}" --id.name orgadmin --id.secret orgadminpw --id.type admin --tls.certfiles "${ca_cert}"
  fabric-ca-client register --caname "${ca_name}" --id.name "${role}" --id.secret "${role}pw" --id.type client --id.attrs "role=${role}:ecert" --tls.certfiles "${ca_cert}"
  fabric-ca-client enroll -u "https://peer0:peer0pw@localhost:${port}" --caname "${ca_name}" -M "${base}/peers/peer0.${domain}/msp" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${base}/peers/peer0.${domain}/msp/config.yaml"
  fabric-ca-client enroll -u "https://peer0:peer0pw@localhost:${port}" --caname "${ca_name}" -M "${base}/peers/peer0.${domain}/tls" --enrollment.profile tls --csr.hosts "peer0.${domain}" --csr.hosts localhost --tls.certfiles "${ca_cert}"
  cp "${base}/peers/peer0.${domain}/tls/tlscacerts/"* "${base}/peers/peer0.${domain}/tls/ca.crt"
  cp "${base}/peers/peer0.${domain}/tls/signcerts/"* "${base}/peers/peer0.${domain}/tls/server.crt"
  cp "${base}/peers/peer0.${domain}/tls/keystore/"* "${base}/peers/peer0.${domain}/tls/server.key"
  fabric-ca-client enroll -u "https://orgadmin:orgadminpw@localhost:${port}" --caname "${ca_name}" -M "${base}/users/Admin@${domain}/msp" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${base}/users/Admin@${domain}/msp/config.yaml"
  fabric-ca-client enroll -u "https://${role}:${role}pw@localhost:${port}" --caname "${ca_name}" -M "${base}/users/${role}@${domain}/msp" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${base}/users/${role}@${domain}/msp/config.yaml"

  if [ "${org}" = "insurer" ]; then
    fabric-ca-client register --caname "${ca_name}" --id.name policyholder1 --id.secret policyholder1pw --id.type client --id.attrs "role=policyholder:ecert,subjectId=policyholder1:ecert" --tls.certfiles "${ca_cert}"
    fabric-ca-client enroll -u "https://policyholder1:policyholder1pw@localhost:${port}" --caname "${ca_name}" -M "${base}/users/policyholder1@${domain}/msp" --tls.certfiles "${ca_cert}"
    cp "${base}/msp/config.yaml" "${base}/users/policyholder1@${domain}/msp/config.yaml"
  fi
}

enroll_peer_org insurer InsurerMSP 7054 insurerAdmin
enroll_peer_org hospital HospitalMSP 8054 hospitalOfficer
enroll_peer_org auditor AuditorMSP 9054 auditor
enroll_peer_org bank BankMSP 12054 bankOfficer
enroll_peer_org oracle OracleMSP 13054 oracle
bash "${network_root}/scripts/enroll-auditors.sh"
bash "${network_root}/scripts/enroll-oracles.sh"

enroll_orderer() {
  local domain="blockinsure.test"
  local base="${org_root}/ordererOrganizations/${domain}"
  local ca_cert="${org_root}/fabric-ca/orderer/ca-cert.pem"
  export FABRIC_CA_CLIENT_HOME="${base}"
  fabric-ca-client enroll -u https://admin:adminpw@localhost:11054 --caname ca-orderer --tls.certfiles "${ca_cert}"
  write_node_ous "${base}/msp" "cacerts/localhost-11054-ca-orderer.pem"
  mkdir -p "${base}/msp/tlscacerts" "${base}/tlsca"
  cp "${ca_cert}" "${base}/msp/tlscacerts/ca.crt"
  cp "${ca_cert}" "${base}/tlsca/tlsca.${domain}-cert.pem"
  fabric-ca-client register --caname ca-orderer --id.name orderer --id.secret ordererpw --id.type orderer --tls.certfiles "${ca_cert}"
  fabric-ca-client register --caname ca-orderer --id.name ordereradmin --id.secret ordereradminpw --id.type admin --tls.certfiles "${ca_cert}"
  fabric-ca-client enroll -u https://orderer:ordererpw@localhost:11054 --caname ca-orderer -M "${base}/orderers/orderer.${domain}/msp" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${base}/orderers/orderer.${domain}/msp/config.yaml"
  fabric-ca-client enroll -u https://orderer:ordererpw@localhost:11054 --caname ca-orderer -M "${base}/orderers/orderer.${domain}/tls" --enrollment.profile tls --csr.hosts "orderer.${domain}" --csr.hosts localhost --tls.certfiles "${ca_cert}"
  cp "${base}/orderers/orderer.${domain}/tls/tlscacerts/"* "${base}/orderers/orderer.${domain}/tls/ca.crt"
  cp "${base}/orderers/orderer.${domain}/tls/signcerts/"* "${base}/orderers/orderer.${domain}/tls/server.crt"
  cp "${base}/orderers/orderer.${domain}/tls/keystore/"* "${base}/orderers/orderer.${domain}/tls/server.key"
  fabric-ca-client enroll -u https://ordereradmin:ordereradminpw@localhost:11054 --caname ca-orderer -M "${base}/users/Admin@${domain}/msp" --tls.certfiles "${ca_cert}"
  cp "${base}/msp/config.yaml" "${base}/users/Admin@${domain}/msp/config.yaml"
  fabric-ca-client enroll -u https://ordereradmin:ordereradminpw@localhost:11054 --caname ca-orderer -M "${base}/users/Admin@${domain}/tls" --enrollment.profile tls --csr.hosts "admin.${domain}" --csr.hosts localhost --tls.certfiles "${ca_cert}"
  cp "${base}/users/Admin@${domain}/tls/tlscacerts/"* "${base}/users/Admin@${domain}/tls/ca.crt"
  cp "${base}/users/Admin@${domain}/tls/signcerts/"* "${base}/users/Admin@${domain}/tls/client.crt"
  cp "${base}/users/Admin@${domain}/tls/keystore/"* "${base}/users/Admin@${domain}/tls/client.key"
}

enroll_orderer
