# Defence memory plan

The host has 8 GB physical RAM. Use the LevelDB dev-lite network alone.
Before an install, organization approval or lifecycle readback, check at
least 500 MB available. Before committing a definition, registering actors
or writing any business transaction, check at least 700 MB. The defence
profile target is at least 1,000 MB available after startup and warm-up.

The 25 November sequence-3 install and approvals succeeded with at least
848 MB at the pre-approval samples. The three-peer majority commit
attempt measured 648, 369, 463 and 733 MB. The final immediate pre-submit
check was 618 MB, so it sent no commit. The bounded revisit started with
1,971 MB free and stopped before submission at 668 MB. These are lifecycle measurements.
The full defence-profile measurement requires the live R2 service and
remaining journeys and is separately tracked.

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
