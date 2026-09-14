# Development guide

This document expands on the contributor rules in [AGENTS.md](../AGENTS.md).

## Commands

```bash
bun run dev
bun run typecheck
bun run build
bun run test
```

### Interaction performance verification

The interaction benchmark runs against the production build and is the source
of timing comparisons. It covers dense and compact activity libraries, fog and
activity overlay combinations, map dialogs, desktop pointer gestures, and
mobile touch pan/rotate:

```bash
cd e2e && bun run test:performance
```

The performance configuration covers six activity-library datasets (metadata
and geometry fixtures at 100, 500, and 2,000 activities), 22 sampled map
interaction scenarios, and desktop dialog pointer-move coalescing.
Deterministic work-count, DOM-bound, and long-task assertions are the gates;
raw frame gaps are diagnostic because the Chromium renderer and SwiftShader
performance vary between hosts. Regression runs retain their JSON metrics and
Playwright traces in the E2E test-results directory rather than committing
machine-specific baselines.

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
