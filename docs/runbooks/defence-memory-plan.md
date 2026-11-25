# Defence memory plan

The host has 8 GB physical RAM. Use the LevelDB dev-lite network alone.
Before chaincode installation, organization approval, lifecycle commit or
readback, check at least 500 MB available. Check 700 MB before actor
registration and business writes, and 900 MB immediately before the
single-worker Chromium screenshot pass. The defence profile target is
at least 1,000 MB available after startup and warm-up.

The 25 November sequence-3 install and approvals succeeded with at least
848 MB at the pre-approval samples. The three-peer majority commit
attempt measured 648, 369, 463 and 733 MB. The final immediate pre-submit
check was 618 MB against the previous 700 MB floor, so it sent no commit.
The bounded revisit started with 1,971 MB free and stopped before
submission at 668 MB. These are historical lifecycle measurements.
The full defence-profile measurement requires the live R2 service and
remaining journeys and is separately tracked.

## Session A measurement, 26 November 2026

Chaincode 1.9.0 at sequence 3, LevelDB, shared ccaas and DEMO. The one-command launch reported HEALTHY with all five peers, three Oracle workers and six adapter listeners. Windows available memory was 698 MB at first status and 967 MB at the warmed sample. The WSL working set at the warmed sample was 1,230 MiB. The warmed sample stayed below the 1,000 MB operating target and was above the 700 MB business-write and 900 MB screenshot floors at that instant.

| Process or container | Warmed memory MiB |
| --- | ---: |
| Orderer | 23.77 |
| Insurer peer | 83.35 |
| Hospital peer | 80.02 |
| Auditor peer | 72.22 |
| Bank peer | 82.88 |
| Oracle peer | 84.04 |
| ccaas | 471.30 |
| Production web | 111.1 |
| Oracle 1, 2, 3 | 67.9, 67.8, 67.2 |
| Direct adapters and publisher | 47.7 |
| Mirror adapters | 53.3 |
| Event projection worker | 53.0 |

Containers use Docker's memory reading. Windows processes use working set. The WSL reading already contains the Linux processes, so these values cannot be summed as host usage. The full-profile result is a spot sample on one 8 GB host. Check fresh memory before writes or Chromium.

| Segment | Services to run |
| --- | --- |
| Package, Go, TLC, production Next build, offline Chromium | No Fabric containers |
| Install, approve or check one organization's definition | Orderer and one selected peer |
| Commit the chaincode definition | Orderer and exactly three lifecycle endorsers |
| Claim, episode or OCR private write | Orderer, Insurer, Hospital and Oracle, plus the selected runtime |
| Private panel preparation and votes | Orderer, Insurer and Auditor, plus the selected runtime |
| Premium or payout | Orderer, Insurer and Bank, plus the selected runtime |
| Read-only defence walkthrough | Production web app and required peers only. Add workers and signed-feed adapters for the live Oracle segment. |

Stop only task-started services between segments. Give gossip time to
converge after changing peer sets. Check the live peer clock and confirm
the profile's committed sequence. Stop the selected step if its floor is
not available. The `pre-r2` archive preserves the six ledgers and scoped
app state. Existing credentials stay in their original stores.
