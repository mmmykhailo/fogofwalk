# Activities performance baseline and result

The fixture seeds IndexedDB directly; it does not include GPX parsing. Both
tables use the production SPA build, Chromium Desktop, and one Playwright
worker.

## Before optimization

Measured on 2026-09-04 with five serial repeats per fixture. The table reports
the median and observed p95 of the instrumented values. This was the
all-activities loader and render path.

| Library | State | Loader (ms) | Unique repair (ms) | First grid commit (ms) | Cards | DOM elements | Heap |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 metadata | current | 1.2 / 1.5 | — | 265 / 268 | 100 | 3,256 | 35 MB |
| 100 metadata | stale | 11.2 / 12.5 | 8.1 / 10.6 | 174 / 187 | 100 | 3,256 | 35 MB |
| 500 metadata | current | 4.5 / 4.6 | — | 343 / 344 | 500 | 16,053 | 139 MB |
| 500 metadata | stale | 66.6 / 70.1 | 62.8 / 66.5 | 336 / 346 | 500 | 16,053 | 139 MB |
| 2,000 metadata | current | 12.6 / 13.2 | — | 1,357 / 1,513 | 2,000 | 64,053 | 386 MB |
| 2,000 metadata | stale | 136.2 / 172.7 | 126.2 / 160.4 | 1,435 / 1,716 | 2,000 | 64,053 | 410 MB |
| 100 geometry | current | 2.3 / 7.9 | — | 169 / 172 | 100 | 3,556 | 40 MB |
| 100 geometry | stale | 61.3 / 66.7 | 59.4 / 64.6 | 171 / 181 | 100 | 3,556 | 42 MB |
| 500 geometry | current | 9.0 / 10.7 | — | 323 / 334 | 500 | 17,553 | 123 MB |
| 500 geometry | stale | 111.8 / 163.5 | 104.9 / 153.2 | 386 / 513 | 500 | 17,553 | 131 MB |
| 2,000 geometry | current | 75.4 / 80.1 | — | 1,407 / 1,540 | 2,000 | 70,053 | 435 MB |
| 2,000 geometry | stale | 889.9 / 1,079.0 | 824.6 / 1,026.5 | 2,946 / 3,302 | 2,000 | 70,053 | 521 MB |

Values are `median / p95` across the five observed samples. The current
implementation at this point mounted the complete collection, so card, DOM,
and heap values scaled directly with library size.

## After optimization

The final production matrix ran all 17 deterministic performance and storage
tests. These are representative single-run values, not a CI timing gate. The
parent loader and parent IDB columns are the important cold-path measurements:
`/activities` now reads summaries and does not start unique-distance repair.

| Library | State | Parent loader (ms) | Parent IDB (ms) | First grid commit (ms) | Cards | DOM elements | Heap |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 metadata | current | 0.8 | 0.5 | 225.3 | 48 | 1,595 | 25 MB |
| 100 metadata | stale | 1.2 | 1.0 | 141.5 | 48 | 1,595 | 22 MB |
| 500 metadata | current | 2.6 | 2.4 | 144.9 | 48 | 1,595 | 26 MB |
| 500 metadata | stale | 2.0 | 1.8 | 141.2 | 48 | 1,595 | 26 MB |
| 2,000 metadata | current | 11.8 | 11.6 | 154.8 | 48 | 1,595 | 37 MB |
| 2,000 metadata | stale | 7.7 | 7.6 | 158.5 | 48 | 1,595 | 37 MB |
| 100 geometry | current | 1.2 | 1.1 | 136.3 | 48 | 1,739 | 29 MB |
| 100 geometry | stale | 0.9 | 0.7 | 133.0 | 48 | 1,739 | 29 MB |
| 500 geometry | current | 2.4 | 2.3 | 138.8 | 48 | 1,739 | 45 MB |
| 500 geometry | stale | 2.5 | 2.4 | 140.5 | 48 | 1,739 | 45 MB |
| 2,000 geometry | current | 2.5 | 2.3 | 139.1 | 48 | 1,739 | 92 MB |
| 2,000 geometry | stale | 9.9 | 9.7 | 155.2 | 48 | 1,739 | 97 MB |

At 2,000 geometry-heavy activities, the first-grid p95 from the original
baseline was 3,302 ms; the final smoke run was 155.2 ms. Mounted cards fell
from 2,000 to 48, DOM elements from 70,053 to 1,739, and heap from 521 MB to
97 MB. The stale unique-distance repair is no longer on this route's critical
path; it remains available to map and statistics consumers.

The matrix also asserts progressive paging, global sort order across page
boundaries, selection/focus persistence, sort-only navigation without storage
work, v3/empty/corrupt summary migration recovery, offline metadata queueing,
cross-device metadata sync, and server-disabled no-network behavior.
