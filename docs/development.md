# Development guide

This document expands on the contributor rules in [AGENTS.md](../AGENTS.md).

## Commands

```bash
bun run dev
bun run typecheck
bun run build
bun run test
```

Run `bun run typecheck` after every application change. The repository has Prettier drift, so format only the files you changed with `bunx prettier --write <paths>` rather than `bun run format`.

The sync server and E2E suite are independent packages:

```bash
cd server && bun install && bun run typecheck && bun test
cd e2e && bun run typecheck && bun run test
```

## Local environment and worktrees

When creating a worktree, symlink the primary worktree's ignored `.env` and `server/.env` if they exist. Never copy or commit either file. They are required for commands that use the local API URL or server credentials.

## UI conventions

- Outside `components/ui/`, every presentational component has its own file. Route modules export only route concerns; extract rendered subcomponents.
- Use `Grid` from `app/components/Grid.tsx` for responsive page-section grids. Its `columns` prop declares breakpoint-specific counts and `gap` declares the shared spacing scale. Use raw CSS Grid only for component-internal layouts or specialised visualisations.
- Name boolean React state `isFoo` / `setIsFoo`.
- Build conditional class names with `cn` from `~/lib/utils`; do not import `clsx` directly.
- Use Phosphor's `*Icon` exports, never deprecated suffix-free names.

## Routing and client data

Routes are explicitly registered in `app/routes.ts`; adding a route file alone produces a 404. React Router owns UI requests and mutations: page data belongs in `clientLoader`, mutations in `clientAction`, and in-place flows use `useFetcher`. Do not call API client methods from a component effect or event handler.

## Commits

Use short, lowercase, imperative, single-line subjects such as `add loader`. Never add trailers, including `Co-Authored-By`.
