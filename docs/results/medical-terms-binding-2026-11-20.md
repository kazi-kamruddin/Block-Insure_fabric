# Medical approval terms binding

On 20 November 2026 the full offline Go suite passed 53 tests and 18 subtests, up from 52 tests and 18 subtests. The scope was synthetic, one host, and unit-level.

Previously, the certificate bound the accepted statement digest and payable amount. The statement indirectly committed to policy terms, episode revision and remaining coverage. The certificate carried no explicit product or rules version and no separate commitment to the calculated breakdown.

New dev-lite claim versions record the package ID, issued rule version, terms hash and a digest of the breakdown. The breakdown covers the billed and eligible amounts, service sublimit, applied deductible and its cap, insurer share rate and amount, policy ceiling, remaining coverage, and payable amount. The full statement remains in private data. Historical certificates retain the original encoding.

The test filed a claim under the original product, approved it, checked that in-place reconfiguration of the published rules was refused, and published a different product. Authorization and confirmation still used the original 4,000 minor units and certificate digest. No live deployment or CouchDB acceptance ran. Raw results are under `.local-reference/maintenance-1.9/item-04/`.
