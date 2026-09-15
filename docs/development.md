# Development guide

This document expands on the contributor rules in [AGENTS.md](../AGENTS.md).

## Commands

```bash
bun run dev
bun run typecheck
bun run build
bun run test
```

### Storybook

Storybook is the isolated component catalogue. It uses the same Tailwind
styles and application providers where needed, but does not run route
generation, the PWA plugin, service-worker registration, live API calls, map
tiles, workers, or IndexedDB persistence.

```bash
bun run storybook
bun run storybook:build
bun run test:storybook
bunx playwright install chromium
```

`bun run test:storybook` uses Vitest Browser Mode with headless Chromium and
checks every story for render failures, interaction assertions, and configured
accessibility violations. Install the browser once on a new machine; CI uses
`bunx playwright install --with-deps chromium` for Linux system dependencies.
If the browser is installed but a test fails to launch, rerun the install and
then run `bun run test:storybook` again. Portal-based controls (dialogs,
drawers, selects, menus, popovers, and tooltips) render under
`document.body`, so tests should query that container rather than only the
story canvas. When a dependency change causes an unexpected Vite reload,
add the imported package to `.storybook/vite.config.ts` under
`optimizeDeps.include`.

### Interaction performance verification

The interaction benchmark runs against the production build and is the source
of timing comparisons. It covers dense and compact activity libraries, fog and
activity overlay combinations, map dialogs, desktop pointer gestures, and
mobile touch pan/rotate:

```bash
cd e2e && bun run test:performance
```

The performance configuration covers six activity-library datasets (metadata
and geometry fixtures at 100, 500, and 2,000 activities), sampled map
interaction scenarios, and desktop dialog pointer-move coalescing, for 22
benchmark tests in total. It is intentionally isolated from the functional
suite, runs with one worker and non-parallel execution, and should not be split
across workers merely to reduce wall-clock time. Deterministic work-count,
DOM-bound, long-task, and pointer-coalescing assertions are the gates; raw
Chromium/SwiftShader frame gaps are diagnostic because renderer performance
varies between hosts.

The default E2E command is the functional suite only:

```bash
cd e2e && bun run test
```

It lists 70 tests and excludes `activities-performance.spec.ts` and
`map-interaction-performance.spec.ts`, which are owned by
`bun run test:performance` (22 tests). Run both responsibilities in sequence
with the explicit aggregate command:

```bash
cd e2e && bun run test:all
```

Regression runs retain their JSON metrics and Playwright traces in the E2E
test-results directory rather than committing machine-specific baselines.

Run `bun run typecheck` after every application change. The repository has Prettier drift, so format only the files you changed with `bunx prettier --write <paths>` rather than `bun run format`.

The sync server and E2E suite are independent packages:

```bash
cd server && bun install && bun run typecheck && bun test
cd e2e && bun run typecheck && bun run test
```

## Local environment and worktrees

When creating a worktree, symlink the primary worktree's ignored `.env` and `server/.env` if they exist. Never copy or commit either file. They are required for commands that use the local API URL or server credentials.

## UI conventions

- Avoid nested ternary operators.
- Outside `components/ui/`, every presentational component has its own file, with the file name matching the component name. Route modules export only route concerns; extract rendered subcomponents.
- Use `Grid` from `app/components/Grid.tsx` for responsive page-section grids. Its `columns` prop declares breakpoint-specific counts; its spacing is always `gap-3`. Use raw CSS Grid only for component-internal layouts or specialised visualisations.
- Name boolean React state `isFoo` / `setIsFoo`.
- Build conditional class names with `cn` from `~/lib/utils`; do not import `clsx` directly.
- Use Phosphor's `*Icon` exports, never deprecated suffix-free names.

## Routing and client data

Routes are explicitly registered in `app/routes.ts`; adding a route file alone produces a 404. React Router owns UI requests and mutations: page data belongs in `clientLoader`, mutations in `clientAction`, and in-place flows use `useFetcher`. Do not call API client methods from a component effect or event handler.

## Commits

Use short, lowercase, imperative, single-line subjects such as `add loader`. Never add trailers, including `Co-Authored-By`.
