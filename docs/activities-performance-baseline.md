# Activities performance baseline

Measured on 2026-09-04 with the production SPA build, Chromium Desktop, one
Playwright worker, and five serial repeats per fixture. The fixture seeds
IndexedDB directly; it does not include GPX parsing. The table reports the
median and observed p95 of the instrumented values.

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
implementation mounts the complete collection, so card, DOM, and heap values
scale directly with library size. Sort and selection timings, and warm-map
navigation, remain follow-up scenarios for the optimization commits.
