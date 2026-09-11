# Fog validation and warning fix plan

Status: implementation complete; verification complete

Date: 2026-09-11

Scope: the post-refactor notice
“Some fog regions remain covered because their geometry could not be validated”
and the accompanying
“A consecutive duplicate or near-duplicate point was coalesced” messages.

Companions:

- [activity pipeline refactor plan](activity-pipeline-refactor-plan.md)
- [activity pipeline review and fix plan](activity-pipeline-refactor-review-and-fix-plan.md)
- [activity pipeline test matrix](activity-pipeline-test-matrix.md)

## Decision summary

The duplicate-point messages and the missing fog are separate effects that are
currently combined into one degraded status.

The checked-in `public/sample-run.gpx` reproduces both:

- 82,364 input points are safely sanitized and simplified to 298 fog input
  points;
- 3,061 source points no more than 0.5 m from the last retained point are
  coalesced;
- Turf successfully builds one explored mask;
- the mask's two large rings contain 800 and 777 vertices;
- the validator stops before deciding whether either ring is simple because its
  fixed 250,000 segment-pair budget is exhausted;
- budget exhaustion is reported as invalid geometry, and aggregation replaces
  the entire positive explored projection with the empty/full-fog fallback.

Applying the existing emitted-fog tolerance (`SIMPLIFY_TOLERANCE`, 0.0001°) to
that mask reduces the two rings to 377 and 376 vertices. The existing validator
then accepts the result. The new positive-mask aggregation path never applies
that tolerance, despite the documented invariant that activity simplification
and emitted-fog simplification are separate stages.

The reported 212 warnings are also explainable from the implementation. The
engine creates one warning for every coalesced point, prefixes it only with the
activity ID, and later deduplicates identical strings. The UI therefore shows
roughly one warning per affected activity rather than the number of repair
events. It also marks any repaired activity as degraded, although a sub-0.5 m
coalesce is an expected, coverage-neutral sanitizer operation under a 100 m fog
buffer.

Do not fix this by merely raising `maxIntersectionChecks`, suppressing all
diagnostics, or accepting geometry whose validation was not completed. Restore
the missing output stage, make validation outcomes precise, and separate
informational sanitizer metrics from coverage-affecting failures.

## Root causes

### 1. Emitted geometry is no longer simplified

`app/lib/fog/engine/input.ts` correctly uses
`ACTIVITY_SIMPLIFY_TOLERANCE` before buffering. After the positive-mask/stencil
refactor, `app/lib/fog/engine/aggregate.ts` projects, accumulates, unprojects,
and validates the masks without applying `SIMPLIFY_TOLERANCE` to the emitted
geometry.

This is both a regression and an invariant violation. Buffering expands one
simplified line into substantially more ring vertices, so input simplification
does not replace output simplification.

### 2. “Not validated within budget” is treated as “invalid”

`ringIsSimple()` has three internal results: simple, self-intersecting, and
budget-exceeded. `validateFogRenderData()` flattens the latter two into
`ok: false`. Aggregation then publishes an empty positive mask for every kind of
validation error.

The safety budget is useful for bounding the current quadratic algorithm, but
exhausting it proves neither invalidity nor corruption. The status text
currently implies a geometry defect where the observed defect is validator
scale.

### 3. One difficult feature erases all explored geometry

`aggregationResult()` validates the complete collection. A failure in one ring
returns `featureCollection([])`, discarding every otherwise valid explored
component in that snapshot. This is conservative with respect to fog removal,
but unnecessarily loses coverage far outside the failing feature.

### 4. Diagnostic severity and cardinality are conflated

`coalesced_duplicate_point` is necessary input hygiene and normally has no
meaningful coverage impact. The engine nevertheless:

- appends one full string per point to cumulative diagnostics;
- increments `repairedActivityCount` for any sanitizer warning;
- makes `recordFogSnapshot()` choose the degraded UI phase whenever that count
  is non-zero;
- uses the deduplicated string-array length as the displayed warning count.

Consequently normal high-frequency GPS data can create large worker payloads,
make every activity look faulty, and obscure the one diagnostic that actually
caused the fallback.

## Required behavior

1. A lossless or coverage-neutral sanitizer operation may be counted in local
   support diagnostics, but must not make a complete fog snapshot degraded or
   show a warning banner.
2. A validation algorithm hitting its work budget must have a distinct outcome
   from proven invalid geometry.
3. Emitted positive masks must use `SIMPLIFY_TOLERANCE`; this must remain
   independent from `ACTIVITY_SIMPLIFY_TOLERANCE`.
4. One rejected output feature must not erase unrelated validated explored
   features.
5. Only a complete, validated projection may be cached or used as an append
   base. A partial feature-local fallback remains partial.
6. Diagnostic memory and worker-message size must be bounded independently of
   duplicate-point count.
7. The UI count must come from stable coded counters, not the number of example
   strings retained for debugging.

## Repair plan

### Phase 0 — lock in the reproduction

1. Add a regression fixture/test based on `public/sample-run.gpx` or a minimized
   deterministic path with the same ring sizes. Record only aggregate counts in
   assertions; do not add private route data.
2. Exercise the real `FogEngine.process()` path in corridor and fill modes and
   assert the current failure before changing it: sanitizer acceptance, mask
   creation, validator budget exhaustion, partial snapshot, and empty fallback.
3. Add focused status tests showing that 3,061 identical coalesce events from
   one activity can currently become one displayed warning, and that 212
   affected activities can become “212 warnings.”
4. Add benchmark measurements for sanitize, buffer, emitted simplification,
   validation, serialized snapshot bytes, and total worker time. Use the public
   sample as the first scale case and retain the existing 100/1,000/10,000
   library cases.

Exit: CI reproduces the false fallback and misleading count without relying on
the reporter's IndexedDB library.

### Phase 1 — restore emitted-fog simplification

1. Add an explicit output-normalization stage between positive-mask
   accumulation and final validation. Apply Turf simplification with
   `SIMPLIFY_TOLERANCE` to each emitted Polygon/MultiPolygon without mutating the
   accumulator.
2. Keep the tolerance import out of the input sanitizer. Add a contract test
   that changing `ACTIVITY_SIMPLIFY_TOLERANCE` cannot silently change the output
   tolerance, and vice versa.
3. Revalidate every simplified feature for finite bounded coordinates, closed
   non-zero-area rings, topology, feature/vertex budgets, and serialized size.
   Simplification is not permission to skip validation.
4. Measure visual equivalence at the supported zoom range and verify that the
   simplified positive mask does not shrink the cleared corridor materially,
   damage closed-loop fill, or introduce antimeridian seams.
5. Bump `FOG_ALGORITHM_VERSION` because cached geometry changes. If the wire
   diagnostic contract changes in the same release, bump the protocol version
   too; do not misuse the partition/representation version for this change.

Exit: the public sample completes in corridor and fill modes, its large rings
validate after output simplification, and stale pre-fix caches are rejected.

### Phase 2 — make validation scalable and outcomes explicit

1. Replace the all-pairs self-intersection scan with a measured spatial-index or
   sweep-line implementation that checks only plausible segment pairs and still
   detects touching/overlapping non-adjacent segments. Keep cancellation/yield
   checkpoints for large rings.
2. Change the validation result from one boolean to coded outcomes such as
   `valid`, `invalid`, `budget_exceeded`, and `cancelled`, while retaining
   structural and size error codes.
3. Treat `budget_exceeded` as an operational inability to validate, not proof of
   invalid geometry. Retry it only through a specifically more capable path
   (additional partitioning or the scalable validator), never by repeating the
   same deterministic work unchanged.
4. Keep absolute feature, vertex, and serialized-byte limits as independent
   safety gates. A faster topology check must not remove output-size bounds.
5. Add adversarial tests for genuine bow-ties, collinear overlaps, repeated ring
   vertices, holes touching shells, large valid rings, and near-epsilon
   intersections.

Exit: valid rings above the old ~708-segment quadratic ceiling can be decided
within the worker budget, while known-invalid rings still fail closed.

### Phase 3 — isolate geometry fallback

1. Validate emitted features/components individually before assembling the
   snapshot. Retain validated explored features and omit only the feature that
   cannot be made safe.
2. Carry stable feature/component failure counts into cumulative engine state.
   The snapshot remains `partial`, cannot seed append, and cannot be cached as
   complete while any accepted activity's explored mask is omitted.
3. Preserve the last complete compatible projection until a replacement is
   ready. If no complete projection exists, publish the validated subset with
   explicit conservative-coverage status rather than erasing all unrelated
   explored geometry.
4. Add multi-activity tests in which one oversized or invalid component cannot
   remove a distant valid component, plus append-after-partial and rebuild
   recovery tests.

Exit: failures are spatially contained and completeness/cache semantics remain
honest.

### Phase 4 — separate sanitizer metrics from user-visible degradation

1. Define a coded diagnostic taxonomy with at least:
   `info` (coverage-neutral normalization), `coverage_reduced`, and `error`.
   Classify `coalesced_duplicate_point` as `info`. Review every other current
   sanitizer and aggregation code explicitly rather than inferring severity
   from whether it is called a warning today.
2. Replace per-point diagnostic strings with aggregate counters keyed by code.
   Retain at most a small bounded number of redacted examples for debugging;
   activity IDs/names and coordinates must not enter exported diagnostics.
3. Split `repairedActivityCount` into semantically named counts, for example
   normalized activities versus coverage-reduced activities. Only the latter,
   rejected activities, geometry fallback, or engine degradation may select the
   degraded UI phase.
4. Make `FogStatusNotice` choose its message from the highest-severity coded
   outcome and display that outcome's event/affected-region count. Never use
   `status.warnings.length` as the count.
5. Remove temporary console logging of full warning arrays. Verify that a normal
   complete run with coalesces has no alert and remains available in the
   privacy-safe support diagnostics as a count.
6. Make retry visibility code-specific. Deterministic coalescing, invalid
   geometry, and same-algorithm budget exhaustion are not user-retryable; worker
   crashes and other transient failures remain retryable.

Exit: normal GPS cleanup is quiet, actionable coverage loss remains visible,
and diagnostic size is bounded for arbitrarily many duplicate points.

### Phase 5 — release gates and documentation

1. Add matrix cases for the public large-track regression, large valid rings,
   feature-local fallback, lossless sanitizer silence, bounded diagnostics, and
   correct coded UI counts.
2. Run the focused fog suite, full client tests, typecheck, production build,
   activity-pipeline gate, real-browser fog visual suite, and real engine
   benchmark.
3. Verify cache upgrade behavior with warm complete, warm partial, stale
   algorithm-version, missing, and corrupt caches.
4. Update `docs/fog-and-data.md` to describe the positive-mask output
   simplification stage, validation taxonomy, fallback granularity, and status
   semantics after the implementation lands.

Exit: the original library rebuilds without the false validation notice; a
deliberately invalid route still produces a precise conservative warning; and
all correctness, visual, cache, and performance gates pass.

## Acceptance checks

- The public sample produces a complete non-empty fog snapshot in both modes.
- Its coalesced-point count is retained as informational telemetry but produces
  no `role="alert"` notice.
- A genuine self-intersection or unrepairable output remains rejected.
- A large valid ring is not rejected solely because the old quadratic budget
  was reached.
- With one bad and one good activity, the good activity's explored mask remains
  published and the snapshot remains partial/non-cacheable.
- Warning/event counts are exact by code and do not depend on string
  deduplication.
- Worker diagnostic payload size stays bounded when a fixture contains tens of
  thousands of near-duplicate points.
- Activity data, hashes, statistics, persistence, sync, and the 100 m clearing
  radius are unchanged.

## Verification record

- `bun test`: 232 tests passed.
- `bun run typecheck`: passed.
- `bun run build`: passed; the existing large-chunk warning remains non-fatal.
- `bun run bench:fog`: passed with the public sample and 100/1,000/10,000
  activity scale tiers. The public sample completed in corridor and fill mode
  with valid non-empty geometry and no fallback.
- `bun run test:activity-pipeline-gate`: all six project regression checks
  passed, including browser fog rendering at DPR 1 and DPR 2.

## Files expected to change during implementation

- `app/lib/fog/engine/input.ts`
- `app/lib/fog/engine/aggregate.ts`
- `app/lib/fog/engine/validate.ts`
- `app/lib/fog/engine/index.ts`
- `app/lib/fog/protocol.ts`
- `app/lib/mapStore.ts`
- `app/components/FogProgress.tsx`
- focused fog/status/cache tests and the activity-pipeline gate
- `docs/fog-and-data.md` and the progress tracker

Parser, canonical activity, persistence, sync, and server contracts should not
need behavior changes for this fix.
