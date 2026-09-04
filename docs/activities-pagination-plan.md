# Activities pagination and page selection plan

## Goal

Replace the progressive **Load more activities** behavior on `/activities` with
numbered pagination and add a **Select all** button that selects the activities
shown on the current page.

The completed behavior should be:

- show at most 48 activity cards per page;
- sort the complete activity library before taking the current 48-item slice;
- expose the current page in the URL so reload, back/forward navigation, and
  shared links restore the same view;
- retain selections while moving between pages, while **Select all** adds only
  the current page to the selection;
- preserve all existing per-card editing, bulk editing, offline, and optional
  sync behavior.

This is client-side pagination over the `ActivitySummary[]` already returned by
the route loader. It must not introduce server requests or load full activity
geometry.

## User-facing behavior

### Pagination

Use a `page` search parameter alongside the existing `sort` parameter. Page 1
is the default and should omit `page` from the URL; later pages use
`?page=2`, `?page=3`, and so on while preserving `sort` and any unrelated
parameters.

The pagination control appears below the grid when there is more than one page.
It provides:

- **Previous page** and **Next page** controls;
- numbered page controls such as 1, 2, 3;
- a compact window with ellipses for large libraries, always retaining the
  first page, last page, current page, and nearby pages;
- `aria-current="page"` on the active page and accessible labels on navigation
  controls.

Changing page scrolls or focuses users back to the activities section rather
than leaving them below the newly rendered grid. Disabled previous/next states
must not be interactive.

Parse `page` as a positive integer. Missing, malformed, zero, negative, or
out-of-range values resolve to the nearest valid page and are normalized with a
replace navigation so the URL and rendered page agree. If the activity count
shrinks while the user is on the final page, clamp to the new final page.

Changing the sort resets pagination to page 1 because page positions have new
meaning after reordering. Pagination and sort-only query changes must continue
to avoid loader revalidation and IndexedDB reads.

Replace the current footer copy with a range summary, for example **Showing
49–96 of 100 activities**. Remove the **Load more activities** button and
`visibleCount` state entirely so only one page is mounted at a time.

### Selection

Add a **Select all** button to `ActivitiesGridWithSortingHeader`. It selects the
IDs in the current page slice, including fewer than 48 activities on the final
page. It unions those IDs with `selectedActivityIds`; selections made on earlier
pages remain selected and continue to participate in bulk updates.

Keep the button available in both header modes: beside sorting when nothing is
selected and beside the bulk controls when a selection exists. Disable it when
every activity on the current page is already selected (and while a bulk update
is submitting). The existing **Clear selection** action remains global and
clears selections from every page. Individual checkboxes continue to allow a
user to remove any selected activity.

The selection count remains a global count, not a page count. The button label
and accessible name stay **Select all**; supporting text or a tooltip may say
**Select all activities on this page** if the page-local scope needs
clarification.

## Implementation steps

### 1. Extract pagination rules

Add small pure helpers in `app/lib/activitiesRoute.ts` (or a focused adjacent
module) for:

- the shared page size of 48;
- parsing and clamping the `page` search parameter;
- calculating total pages and the `[start, end)` slice;
- producing the compact list of page numbers and ellipsis gaps used by the UI.

Keep these calculations independent of React so boundary behavior can be unit
tested. For a non-empty library there is always at least page 1; the existing
empty state remains owned by `app/routes/activities.tsx` and renders no pager.

Expand the current `isActivitiesSortOnlyNavigation` rule into an activities
view-only navigation check that accepts supported `sort` changes, `page`
changes (including a raw value that the component will normalize), or both,
while rejecting pathname changes, action submissions, and changes to unrelated
parameters. Update `shouldRevalidate` in `app/routes/activities.tsx` to use it.

### 2. Make the sorting component own the current page

In `ActivitiesGridWithSorting`:

1. Read and validate `page` from `useSearchParams`.
2. Continue sorting the entire `activities` collection with
   `sortActivitiesBy`.
3. Derive `totalPages`, the clamped current page, and `pageActivities` from the
   sorted result.
4. Pass only `pageActivities` to `ActivitiesGrid`.
5. Add handlers that update only the relevant search parameters, preserve
   unrelated parameters, use replace navigation for normalization, and remove
   `page` whenever page 1 is selected.
6. Remove `page` inside `handleSortChange` so every sort starts from page 1.
7. Keep `selectedActivityIds` at this parent level so selection survives page
   changes and remains resolvable against the complete `activityById` map.

Use memoized page ID derivation and stable callbacks so pagination does not
regress the bounded rendering work. Do not move pagination into the loader:
bulk selection and editing need the complete summary collection, and IndexedDB
does not currently provide the globally sorted page for every sort option.

### 3. Replace progressive rendering with a page grid

Make `ActivitiesGrid` a presentational bounded grid again:

- remove `visibleCount`, its reset effect, slicing, and the load-more footer;
- render exactly the page slice passed by its parent;
- either render the range summary and pagination as sibling components in
  `ActivitiesGridWithSorting`, or extract a dedicated
  `ActivitiesPagination` presentational component if that keeps route
  components focused;
- use the existing `Button` styles and responsive wrapping conventions; do not
  add a dependency solely for pagination.

The grid keeps stable activity IDs as React keys. Moving to another page should
unmount the old 48 cards and mount at most the next 48, maintaining the current
DOM and memory bound.

### 4. Wire page-local select all into the header

Add these inputs to `ActivitiesGridWithSortingHeader`:

- whether all activities on the current page are selected;
- whether selection is temporarily disabled;
- an `onSelectAll` callback.

In `ActivitiesGridWithSorting`, implement `onSelectAll` as a functional state
update that clones the prior `Set` and adds every current-page ID. Compute the
disabled state with `pageActivities.every(...)`; do not compare the global
selection count with 48, because it may contain IDs from other pages and the
last page may be shorter.

Do not change the action payload or bulk-update dialog. They should continue to
use `selectedActivities`, which resolves every selected ID from the full
library, so a multi-page selection is submitted as one existing bulk operation.

### 5. Accessibility and navigation polish

- Render pagination within a `nav` landmark labelled **Activities pages**.
- Mark the current numbered control with `aria-current="page"`.
- Give icon-only controls explicit names, or use visible Previous/Next text.
- Keep the result summary in an `aria-live="polite"` region without announcing
  every checkbox update.
- After a page change, move focus to a stable heading or grid anchor and scroll
  it into view; do not focus a card whose identity changes with sorting.
- Ensure the sticky header and pagination wrap cleanly at mobile widths.

## Test plan

### Unit tests

Extend route/helper tests to cover:

- page counts and slices for 0, 1, 48, 49, 96, and 97 activities;
- parsing and normalization of missing, fractional, malformed, negative, zero,
  and too-large page values;
- compact page-number output near the beginning, middle, and end of a large
  page range;
- view-only revalidation decisions for page-only, sort-only, combined, action,
  pathname, and unrelated-query changes.

### Playwright coverage

Update `e2e/specs/activities-performance.spec.ts` to replace load-more
expectations and prove that:

- 100 activities render as pages of 48, 48, and 4 cards;
- page controls update the URL, range summary, rendered IDs, and current-page
  semantics;
- next/previous and browser back/forward navigation restore the correct page;
- global sort order remains correct across page boundaries and changing sort
  returns to page 1;
- malformed and out-of-range page URLs normalize without reloading activity
  storage;
- no navigation mounts more than 48 cards.

Extend the activities bulk-settings coverage, or add a focused spec, to prove
that:

- **Select all** on page 1 selects exactly 48 activities;
- moving to page 2 leaves those 48 selected and its checkboxes initially
  unselected;
- **Select all** on page 2 produces a global selection of 96;
- the last page selects only its remaining activities;
- an individually cleared checkbox makes **Select all** available again;
- **Clear selection** clears selected checkboxes on every page;
- a bulk activity-type update includes selections from multiple pages and
  persists after reload.

Retain the existing sort-only no-storage-read assertion and add the equivalent
for page-only navigation.

## Verification

Format only touched files, then run:

```bash
bunx prettier --write app/routes/activities.tsx \
  app/components/activities/ActivitiesGridWithSorting.tsx \
  app/components/activities/ActivitiesGridWithSortingHeader.tsx \
  app/components/activities/ActivitiesGrid.tsx \
  app/lib/activitiesRoute.ts docs/activities-pagination-plan.md
bun run typecheck
bun test
cd e2e && bun run typecheck && bun run test -- activities-performance activities-bulk-settings
```

Adjust the focused Playwright invocation to the repository's supported filename
syntax if necessary. A final production-build smoke run should confirm the
first render and every page remain capped at 48 mounted activity cards.

## Definition of done

- `/activities` provides numbered, URL-restorable pages of at most 48 globally
  sorted activities.
- Page 1 has a clean canonical URL, and invalid or stale page values are safely
  normalized.
- Pagination and sorting do not re-run the loader or read IndexedDB.
- **Select all** affects only the current page while preserving selections from
  other pages; **Clear selection** remains global.
- Multi-page selections work with the existing confirmation, persistence, and
  optional-sync paths.
- Pagination is keyboard accessible, responsive, and bounded to a compact
  number of controls for large libraries.
- The old progressive load-more state and control are removed, and no page
  mounts more than 48 cards.
