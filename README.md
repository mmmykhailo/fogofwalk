# Fog of Walk

Import your GPS activity files and geotagged photos, and watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.

**Local-first.** All parsing, geometry and rendering happen in your browser, and the app is fully usable with no account and no server — that is how the public build is deployed. An **optional** sync server (`server/`) can be added to sync activities between your own devices; photos never leave the device that imported them.

---

## Features

- Import `.gpx` and `.fit` activity files
- Import `.jpg` / `.heic` photos taken during your activities — automatically placed on the map by matching the photo's timestamp to your activities (no GPS in the photo required)
- Two fog modes:
  - **Corridor** — clears everything within 100 m of your route (a ~200 m-wide band)
  - **Fill** — also clears the interior of closed loops
- Real-time fog rendering as files are processed
- Activity stats with elevation profile — single activity or a multi-select of several
- **FIT laps** — the splits your watch recorded, with per-lap stats and per-lap sharing
- Lifetime statistics page: totals, unique distance, weekly chart, streaks, personal records
- Shareable 3:4 stat cards rendered from a map snapshot or one of your photos
- **Persistent** — activities, photos, and fog survive page reloads (IndexedDB + localStorage)
- Map position and zoom remembered between sessions
- Satellite / terrain map mode
- Installable PWA — share a GPX or FIT straight from another app into Fog of Walk, and keep working offline after the first load
- Optional GitHub sign-in and cross-device activity sync when a server is configured

## Getting started

```bash
bun install
bun run dev
```

Open `http://localhost:5173`, import some activity files, watch the fog clear. There is a **Try a sample run** button in the first-run dialog if you don't have a file to hand.

## Commands

```bash
bun run dev        # dev server
bun run build      # production build
bun run typecheck  # type-check (react-router typegen + tsc)
bun run format     # prettier over ts/tsx
bun run test:e2e   # Playwright end-to-end suite (see e2e/README.md)
bun run release    # prepare the next patch release and changelog entry
```

## Deploy

`bun run build` produces a fully static SPA in `build/` (the script flattens `build/client/*` up a
level and writes a `404.html` so client-side routing works on static hosts). Drop that directory on
GitHub Pages, Cloudflare Pages, Vercel, S3 — anything that serves files. No server is required.

`.github/workflows/deploy-client.yml` does exactly this on every push to `master` that touches the client,
deploying to GitHub Pages with `VITE_API_URL` taken from the repository variable of the same name.
Leave that variable unset and the build is server-less again: every account and sync surface is
compiled out.

To prepare a release, run `bun run release` (or `bun run release minor` / `major`), review the
generated `CHANGELOG.md`, and commit it with both `package.json` files. Client and server use the
same version, enforced by the release script and deployment workflows. After the client deployment
succeeds, GitHub Actions creates the corresponding `v…` tag. The in-app [changelog](CHANGELOG.md)
is built from that same file.

The API deploys separately — `.github/workflows/deploy-server.yml` ships `server/` to a Debian VPS
(Bun + systemd behind Caddy) whenever `server/**` or `shared/**` changes. Setup, secrets and the
rollback path are in [`server/README.md`](server/README.md).

## Architecture

Parsing runs on the main thread (it needs browser APIs — `DOMParser` for GPX); all geometry runs
in a Web Worker. The fog is a single GeoJSON polygon covering the world with your explored areas
cut out of it, re-emitted at most every 300 ms as activities are processed. Activities, photos and the fog
cache live in IndexedDB; map position is written to localStorage on every move, synchronously, so
it survives a reload mid-transaction.

An optional sync server lives in `server/` and is compiled out entirely when `VITE_API_URL` is
unset.

For the full module map, the fog algorithm in detail, and the gotchas that matter before changing
any of it, see [`CLAUDE.md`](CLAUDE.md) — and [`server/README.md`](server/README.md) for the sync
API.

## Stack

- [React Router 7](https://reactrouter.com/) (SPA mode)
- [MapLibre GL JS](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) tiles via [PMTiles](https://protomaps.com/docs/pmtiles)
- [Turf.js](https://turfjs.org/) for geometry
- [exifr](https://github.com/MikeKovarik/exifr) for EXIF parsing
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) + [Base UI](https://base-ui.com/)
- [Recharts](https://recharts.org/) for the elevation and weekly charts
- [Vite](https://vitejs.dev/) + [Bun](https://bun.sh/)
- Optional server: [Hono](https://hono.dev/), [Arctic](https://arcticjs.dev/), [Zod](https://zod.dev/) on Bun
