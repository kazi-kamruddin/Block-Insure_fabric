#!/usr/bin/env bash
# Offline regression: invoke the real dispatcher with shell-function doubles.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(cd "$here/../.." && pwd -P)"
test_log="$(mktemp)"
trap 'rm -f -- "$test_log"' EXIT
export test_log
docker() {
  if [[ "$1" == info ]]; then return 0; fi
  echo "docker $*" >>"$test_log"
  case "$1 $2" in
    'volume ls') printf '%s\n' block-insure-dev-lite_orderer block-insure_orderer ;;
    'volume inspect') echo "${mock_owner:-block-insure-dev-lite/orderer}" ;;
    'ps --filter') printf '%s' "${mock_orderer:-}" ;;
  esac
}
osnadmin() {
  [[ " $* " == *" localhost:31053 "* && " $* " == *"/data/$DEV_LITE_DATA_DIR/organizations/"* ]] || return 2
  echo '{"name":"insurance-dev-lite-190"}'
}
peer() {
  [[ "$*" == 'channel getinfo -c insurance-dev-lite-190' && "$CORE_PEER_MSPCONFIGPATH" == *"/data/$DEV_LITE_DATA_DIR/organizations/"* ]] || return 2
  echo "$CORE_PEER_ADDRESS" >>"$test_log"
}
powershell.exe() { echo "powershell $*" >>"$test_log"; }
wslpath() { echo "$2"; }
export -f docker peer osnadmin powershell.exe wslpath
run() { bash "$here/network.sh" --dev-lite "$@"; }
run verify
for port in 31051 31151 31251 31351 31451; do grep -Fxq "localhost:$port" "$test_log"; done
run ca-start
run stop
grep -Fq ' up -d --no-recreate ca-insurer ca-hospital ca-auditor ca-bank ca-oracle ca-orderer' "$test_log"
grep -Fq 'Drain -Profile DevLite -ChaincodeVersion 1.9.0 -CoreOnly' "$test_log"
: > "$test_log"
if run teardown; then exit 1; fi
[[ ! -s "$test_log" ]]
if mock_owner=other/orderer run teardown --confirm-dev-lite; then exit 1; fi
if grep -Eq '^docker (compose|volume rm)' "$test_log"; then exit 1; fi
run teardown --confirm-dev-lite
grep -Fxq 'docker volume rm block-insure-dev-lite_orderer' "$test_log"
: > "$test_log"
bash "$here/network.sh" --dev-lite-couchdb verify
mock_orderer=block-insure-dev-lite bash "$here/network.sh" --dev-lite-couchdb up && exit 1
bash "$here/network.sh" --dev-lite-couchdb teardown --confirm-dev-lite && exit 1
bash "$here/network.sh" --dev-lite-couchdb ca-start
bash "$here/network.sh" --dev-lite-couchdb stop
grep -Fq 'docker compose --project-name block-insure-dev-lite-couchdb' "$test_log"
grep -Fq 'compose-dev-lite-couchdb.yaml' "$test_log"
grep -Fq ' up -d ca-insurer ca-hospital ca-auditor ca-bank ca-oracle ca-orderer' "$test_log"
if grep -Eq '^docker volume rm|^powershell' "$test_log"; then exit 1; fi
# Source-level contract: only evaluate the known exact-equality guard.
# Fail closed if its implementation changes; never infer success from a missing match.
python_bin=python3
command -v python3 >/dev/null || python_bin=python
"$python_bin" - "$root" "${1:-}" <<'PY'
from pathlib import Path
import json, re, subprocess, sys, tempfile
root = Path(sys.argv[1])
source = (root / "chaincode/insurance-contract/src/medical_episode.go").read_text()
approval = (root / "chaincode/insurance-contract/src/medical_approval.go").read_text()
channel = re.search(r"^channel=([a-z0-9-]+)$", (root / "network/scripts/dev-lite.sh").read_text(), re.M)[1]
allowed = re.search(r'const medicalCandidateChannel = "([^"]+)"', source)[1]
assert "return channel == medicalCandidateChannel || channel == medicalDevLiteChannel" in source
assert allowed == "insurance-medical-reimbursement"
assert re.search(r'const medicalDevLiteChannel = "([^"]+)"', approval)[1] == channel
print(f"Current medical channel predicate allows {channel} alongside the accepted channel.")
if sys.argv[2] == "--go":
    # Compile the actual predicate with two stub channel IDs. The overlay
    # augments the existing test file in the compiler's view only.
    module = root / "chaincode/insurance-contract"
    original = module / "src/medical_test.go"
    with tempfile.TemporaryDirectory() as scratch:
        test = Path(scratch) / "medical_test.go"
        test.write_text(original.read_text() + '''
func TestDevLiteChannelBoundary(t *testing.T) {
    _, ctx := medicalTestContext()
    for channel, expected := range map[string]bool{
        "insurance-medical-reimbursement": true,
        "''' + channel + '''": true,
        "insurance-channel": false,
    } {
        ctx.stub.channelID = channel
        if isMedicalCandidate(ctx) != expected { t.Fatalf("wrong medical eligibility for %s", channel) }
    }
}
''')
        overlay = Path(scratch) / "overlay.json"
        overlay.write_text(json.dumps({"Replace": {str(original): str(test)}}))
        subprocess.run(["go", "test", "-mod=readonly", "-overlay", str(overlay),
                        "./src", "-run", "^TestDevLiteChannelBoundary$", "-count=1"],
                       cwd=module, check=True)
PY
echo 'Offline dev-lite checks passed.'
