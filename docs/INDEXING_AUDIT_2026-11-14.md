# Report indexing investigation — 2026-11-14

The owner requested investigation and fixes for the 56 reports in Search
Console's **Discovered – currently not indexed** examples. This is a subset of
148 examples in that group, not a list of all excluded reports. The coverage
report was last updated November 9; its examples do not establish each URL's
current indexing status.

## Observed production state

Read-only HTTP checks covered all 56 exact clean URLs on November 14:

- 56/56 return HTTP 200 directly, with no redirect chain.
- 56/56 have a single self-referencing production canonical.
- 56/56 have no meta/X-Robots noindex or nofollow directive.
- 56/56 are present in the current sitemap and linked in their locale/category's
  initial HTML. No orphaned report was found in this sample.
- Every response contains substantial report text, a title and description.
  One old weekly lacks an H1; this alone does not establish an indexing block.
- Search Console says the sitemap succeeded, was last read November 14, and
  discovered 429 pages. The later live sitemap contains 430 URLs.
- Individual inspections of Market Basics episode 4 and the October 30 SK hynix
  investment note say **URL is unknown to Google**, with no previous crawl.
  Both pass Google's live test: **URL is available to Google / page can be
  indexed**. A live-test pass is not proof of indexing.
- Additional individual inspections of Research No.05 (stablecoins/Treasuries),
  English Market Basics episode 2, and the October 15 earnings-cut investment
  note also show no recorded crawl. The first two are known through the sitemap
  (Research No.05 also lists a referring report); the earnings-cut note is unknown.
  Only these five URLs were individually inspected; the 56-URL HTTP audit is separate.

The audit snapshot, 56 URLs, per-response metadata and saved Google UI evidence
are in the owner's local `outputs/indexing-audit-2026-11-14` directory. This
repository document deliberately does not store private Search Console UI data.

## Change

Previously, report-to-report previous/next links appeared only after
report-shell.js executed and fetched posts.json. Middleware now includes visible,
clean, same-category/same-language previous/next anchors in the initial HTML.
The existing styled Shadow DOM discovery component removes the fallback only
after successful rendering. A failed fetch leaves reading links intact.

Across the full published corpus this supplies 109 initial-HTML links into the
56 sampled reports; every sampled report has at least one neighboring report
linking to it through this navigation.

This provides another crawlable reading path from neighboring articles without
altering article content or requesting mass recrawls. The 56-page audit found no
confirmed robots/canonical/HTTP/sitemap blocker, so this is a discovery
improvement, not a proven explanation for Google's decision not to crawl.

Validation includes corpus-wide parity with the existing browser navigation,
failed-fetch fallback preservation, successful replacement without duplicates,
escaped titles and clean hrefs, middleware output checks, and the full repository
verification gate (1,505 tests passed). Preview smoke passed 20/20. Desktop and
mobile checks cover the unchanged rich discovery UI and the visible fallback
with an intentionally failed browser posts.json fetch. Production deployment
and final HTTP checks are recorded in PR #215.

## Follow-up

Use a small set of important evergreen research, basics and insight URLs for
subsequent URL inspections. Record first-crawl date and actual index status
separately from live-test eligibility. Recheck after Google revisits; do not
interpret an unchanged older coverage report as a failed deployment.

Google explicitly says repeated requests for the same URL do not make crawling
faster, and neither requests nor sitemap submission guarantee inclusion:
https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl
