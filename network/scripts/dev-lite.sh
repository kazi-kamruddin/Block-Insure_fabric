#!/usr/bin/env bash
# WSL, via network.sh. All host endpoints and writable paths are scoped to the selected development profile.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
network="$(cd "$here/.." && pwd -P)"
root="$(cd "$network/.." && pwd -P)"
profile="${1:-}"
case "$profile" in
  --dev-lite|--dev-lite-couchdb) shift ;;
  *) echo "Select --dev-lite or --dev-lite-couchdb" >&2; exit 2 ;;
esac
state="$root/data/${profile#--}"
samples="$network/.fabric/fabric-samples"
export PATH="$samples/bin:$PATH"
project="block-insure-${profile#--}"
channel=insurance-dev-lite-190
orgs=(insurer hospital auditor bank oracle)
cas=(ca-insurer ca-hospital ca-auditor ca-bank ca-oracle ca-orderer)
block="$state/channel-artifacts/$channel.block"
organizations="$state/organizations"
compose_files=(-f "$network/compose/compose-dev-lite.yaml")
export DEV_LITE_COMPOSE_PROJECT="$project"
export DEV_LITE_DATA_DIR="${profile#--}"
if [[ "$profile" == --dev-lite-couchdb ]]; then
  compose_files+=(-f "$network/compose/compose-dev-lite-couchdb.yaml")
  export DEV_LITE_RUNTIME_NAMESPACE=devlitecouch
else
  export DEV_LITE_RUNTIME_NAMESPACE=devlite
fi

die() { echo "$*" >&2; exit 1; }
# No daemon startup, context switching or fallback to the ordinary network.
docker_cli=docker
if ! command -v docker >/dev/null || ! docker info >/dev/null 2>&1; then
  command -v docker.exe >/dev/null || die "Docker Desktop is unreachable."
  docker_cli=docker.exe
  for ((index=1; index < ${#compose_files[@]}; index+=2)); do
    compose_files[index]="$(wslpath -w "${compose_files[index]}")"
  done
fi
compose() { "$docker_cli" compose --project-name "$project" "${compose_files[@]}" "$@"; }
retry() {
  local i
  for i in {1..30}; do
    if "$@"; then return 0; fi
    sleep 2
  done
  die "Timed out waiting for $1 on $channel."
}
drain() {
  if [[ "$profile" == --dev-lite-couchdb ]]; then
    if [[ "${1:-}" == -CoreOnly ]]; then
      local runtime names
      names="$("$docker_cli" ps --filter "network=$project" --format '{{.Names}}')"
      while IFS= read -r runtime; do
        if [[ "$runtime" =~ ^devlitecouch-peer0\.(insurer|hospital|auditor|bank|oracle)\.dev-lite-couchdb\.blockinsure\.test-insurance-contract_1\.9\.0-[a-f0-9]{64}$ ]]; then
          "$docker_cli" stop --timeout 10 "$runtime"
        fi
      done <<<"$names"
    fi
    return
  fi
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(wslpath -w "$root/scripts/low-memory-network.ps1")" Drain -Profile DevLite -ChaincodeVersion 1.9.0 "$@"
}
peer_context() {
  local i=$1 org=${orgs[$1]} domain="${orgs[$1]}.blockinsure.test"
  export FABRIC_CFG_PATH="$samples/config" CORE_PEER_TLS_ENABLED=true
  export CORE_PEER_ADDRESS="localhost:$((31051 + i*100))" CORE_PEER_LOCALMSPID="${org^}MSP"
  export CORE_PEER_TLS_ROOTCERT_FILE="$organizations/peerOrganizations/$domain/peers/peer0.$domain/tls/ca.crt"
  export CORE_PEER_MSPCONFIGPATH="$organizations/peerOrganizations/$domain/users/Admin@$domain/msp"
  export CORE_PEER_BCCSP_SW_FILEKEYSTORE_KEYSTORE="$CORE_PEER_MSPCONFIGPATH/keystore"
}
orderer_admin() {
  local org="$organizations/ordererOrganizations/blockinsure.test"
  osnadmin channel "$@" -o localhost:31053 --ca-file "$org/orderers/orderer.blockinsure.test/tls/ca.crt" \
    --client-cert "$org/users/Admin@blockinsure.test/tls/client.crt" --client-key "$org/users/Admin@blockinsure.test/tls/client.key"
}
orderer_joined() { orderer_admin list --channelID "$channel" | grep -Fq "\"$channel\""; }
ca_ready() {
  local org=$1 port=$2 cert="$organizations/fabric-ca/$1/ca-cert.pem"
  [[ -s "$cert" ]] && FABRIC_CA_CLIENT_HOME="$state/ca-probe/$org" fabric-ca-client getcainfo \
    --caname "ca-$org" -u "https://localhost:$port" --tls.certfiles "$cert" >/dev/null
}
bootstrap() {
  mkdir -p "$state"/{config,channel-artifacts}
  if [[ ! -f "$state/enrollment-complete" ]]; then
    compose up -d "${cas[@]}"
    trap 'compose stop "${cas[@]}"' EXIT
    for i in "${!cas[@]}"; do retry ca_ready "${cas[i]#ca-}" "$((31054+i*100))"; done
    bash "$here/enroll-identities.sh" "$profile"
    touch "$state/enrollment-complete"
  fi
  compose stop "${cas[@]}"
  trap - EXIT
  if [[ ! -s "$block" ]]; then
    cp "$network/config/configtx.yaml" "$state/config/configtx.yaml"
    FABRIC_CFG_PATH="$state/config" configtxgen -profile InsuranceChannel -channelID "$channel" -outputBlock "$block.tmp"
    mv "$block.tmp" "$block"
  fi
}
verify() {
  orderer_joined || die "Dev-lite orderer has not joined $channel."
  for i in "${!orgs[@]}"; do
    peer_context "$i"
    peer channel getinfo -c "$channel" >/dev/null
  done
  echo "$channel ready on five ${profile#--} peers (1.9.0 target; deployment is separate)."
}
deploy() {
  local package="${DEV_LITE_PACKAGE:-$state/channel-artifacts/insurance-contract_1.9.0-schema.tar.gz}"
  local staged="$state/build/insurance-contract"
  local collection="$network/config/collections_config.json"
  local policy="OutOf(2, 'InsurerMSP.peer','HospitalMSP.peer','AuditorMSP.peer','BankMSP.peer','OracleMSP.peer')"
  local orderer_ca="$organizations/ordererOrganizations/blockinsure.test/orderers/orderer.blockinsure.test/tls/ca.crt"
  local ordering=(-o localhost:31050 --ordererTLSHostnameOverride orderer.blockinsure.test --tls --cafile "$orderer_ca")
  local sequence="${DEV_LITE_SEQUENCE:-1}"
  [[ "$sequence" =~ ^[1-9][0-9]{0,6}$ ]] || die 'DEV_LITE_SEQUENCE must be a positive integer.'
  local definition=(--channelID "$channel" --name insurance-contract --version 1.9.0 --sequence "$sequence" --collections-config "$collection" --signature-policy "$policy")
  local targets=() i existing installed
  verify
  peer_context 0
  existing="$(peer lifecycle chaincode querycommitted --channelID "$channel" --output json)" || die "Unable to read the dev-lite lifecycle"
  if grep -Eq '"name"[[:space:]]*:[[:space:]]*"insurance-contract"' <<<"$existing"; then
    local current
    current="$(peer lifecycle chaincode querycommitted --channelID "$channel" --name insurance-contract)"
    current="$(sed -n 's/.*Sequence: \([0-9][0-9]*\),.*/\1/p' <<<"$current")"
    [[ "$current" =~ ^[1-9][0-9]*$ ]] && (( sequence == current + 1 )) && [[ -n "${DEV_LITE_PACKAGE:-}" ]] ||
      die 'Dev-lite upgrade requires the next DEV_LITE_SEQUENCE and an explicit DEV_LITE_PACKAGE.'
  elif (( sequence != 1 )); then
    die 'The first dev-lite deployment must use sequence 1.'
  fi
  if [[ ! -f "$package" ]]; then
    [[ -f "$staged/vendor/modules.txt" ]] || die 'Stage the verified 1.9.0 source with matching vendored dependencies under data/dev-lite/build/insurance-contract.'
    command -v go >/dev/null || die 'Package 1.9.0 with the matching Go toolchain and pass its archive as DEV_LITE_PACKAGE.'
    peer lifecycle chaincode package "$package" --path "$staged" --lang golang --label insurance-contract_1.9.0
  fi
  local package_id
  package_id="$(peer lifecycle chaincode calculatepackageid "$package")"
  [[ "$package_id" == insurance-contract_1.9.0:* ]] || die 'Unexpected development package label.'
  for i in "${!orgs[@]}"; do
    peer_context "$i"
    installed="$(peer lifecycle chaincode queryinstalled --output json)"
    if ! grep -Fq "$package_id" <<<"$installed"; then peer lifecycle chaincode install "$package"; fi
    peer lifecycle chaincode approveformyorg "${ordering[@]}" "${definition[@]}" --package-id "$package_id"
    targets+=(--peerAddresses "$CORE_PEER_ADDRESS" --tlsRootCertFiles "$CORE_PEER_TLS_ROOTCERT_FILE")
  done
  peer_context 0
  peer lifecycle chaincode commit "${ordering[@]}" "${definition[@]}" "${targets[@]}"
  for i in "${!orgs[@]}"; do
    peer_context "$i"
    peer lifecycle chaincode querycommitted --channelID "$channel" --name insurance-contract
  done
}
up() {
  local orderers active
  orderers="$("$docker_cli" ps --filter label=com.docker.compose.service=orderer --format '{{.Label "com.docker.compose.project"}}')"
  while IFS= read -r active; do
    [[ -z "$active" || "$active" == "$project" ]] || die "Another Fabric orderer is running. Stop that development project separately."
  done <<<"$orderers"
  for tool in fabric-ca-client configtxgen osnadmin peer powershell.exe wslpath; do
    command -v "$tool" >/dev/null || die "Missing prerequisite: $tool"
  done
  bootstrap
  compose up -d orderer
  retry orderer_admin list
  if ! orderer_joined; then orderer_admin join --channelID "$channel" --config-block "$block"; fi
  for i in "${!orgs[@]}"; do
    compose up -d "peer-${orgs[i]}"
    peer_context "$i"
    retry peer channel list
    if ! peer channel getinfo -c "$channel" >/dev/null 2>&1; then peer channel join -b "$block"; fi
  done
  drain
  verify
}
case "${1:-}" in
  up) up ;;
  deploy) deploy ;;
  verify) verify ;;
  ca-start) compose up -d "${cas[@]}" ;;
  ca-stop) compose stop "${cas[@]}" ;;
  stop) compose stop; drain -CoreOnly ;;
  teardown)
    if [[ "$profile" == --dev-lite-couchdb ]]; then
      [[ "${2:-}" == --confirm-dev-lite-couchdb ]] || die "Explicit --confirm-dev-lite-couchdb required for the isolated CouchDB volumes."
    else
      [[ "${2:-}" == --confirm-dev-lite ]] || die "Explicit --confirm-dev-lite required: deletes six dev-lite ledger volumes."
    fi
    # Validate every existing volume before removing any container or volume.
    volumes=()
    volume_keys=(orderer "${orgs[@]/#/peer-}")
    if [[ "$profile" == --dev-lite-couchdb ]]; then
      volume_keys+=("${orgs[@]/#/couchdb-}")
    fi
    inventory="$("$docker_cli" volume ls --format '{{.Name}}')"
    for key in "${volume_keys[@]}"; do
      name="${project}_${key}"
      if grep -Fxq "$name" <<<"$inventory"; then
        owner="$("$docker_cli" volume inspect -f '{{index .Labels "com.docker.compose.project"}}/{{index .Labels "com.docker.compose.volume"}}' "$name")"
        [[ "$owner" == "$project/$key" ]] || die "Unexpected owner for $name"
        volumes+=("$name")
      fi
    done
    compose stop
    drain -CoreOnly
    compose rm -f "${volume_keys[@]}" "${cas[@]}"
    if (( ${#volumes[@]} )); then "$docker_cli" volume rm "${volumes[@]}"; fi
    ;;
  *) die "Use $profile {up|deploy|verify|ca-start|ca-stop|stop|teardown}";;
esac
