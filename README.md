# Fog of Walk

Import your GPS activity files and timestamped photos, and watch the fog of war lift over every trail you've run, every road you've cycled, every path you've ever walked.

**Local-first.** All parsing, geometry and rendering happen in your browser, and the app is fully usable with no account and no server. An **optional** sync server (`server/`) can sync activities and saved points between your devices; photos never leave the device that imported them.

---

## Features

- Import `.gpx` and `.fit` activity files
- Import timestamped photos (commonly JPEG or HEIC) taken during your activities — automatically placed on the map by matching the photo's timestamp to your activities (no GPS in the photo required)
- Two fog modes:
  - **Corridor** — clears everything within 100 m of your route (a ~200 m-wide band)
  - **Fill** — also clears the interior of closed loops
- Real-time fog rendering as files are processed
- Activity stats with elevation profile — single activity or a multi-select of several
- **FIT laps** — the splits your watch recorded, with per-lap stats and per-lap sharing
- A paginated activity library with sorting, activity types, and bulk editing
- Lifetime statistics page: totals, unique distance, weekly chart, streaks, personal records
- Shareable 3:4 stat cards rendered from a map snapshot or one of your photos
- Saved map points with names, descriptions, colours, optional public visibility, and cross-device sync
- Optional public profiles with public activities, saved points, and achievements
- **Persistent** — activities, photos, saved points, and fog survive page reloads (IndexedDB + localStorage)
- Map position and zoom remembered between sessions
- Standard and satellite map styles, 3D terrain relief, and an optional current-location marker
- Installable PWA — share a GPX or FIT straight from another app into Fog of Walk, and keep working offline after the first load
- Optional GitHub sign-in and cross-device activity and saved-point sync when a server is configured

## Getting started

```bash
bun install
bun run dev
```

Open `http://localhost:5173`, import some activity files, and watch the fog clear. There is a **Try sample** button in the first-run dialog if you don't have a file to hand.

## Commands

```bash
bun run dev        # dev server
bun run build      # production build
bun run typecheck  # type-check (react-router typegen + tsc)
bun run format     # prettier over ts/tsx
bun run test:e2e   # Playwright end-to-end suite (see e2e/README.md)
bun run release:patch  # prepare a patch release and changelog entry
bun run release        # prepare a minor release and changelog entry
bun run release:major  # prepare a major release and changelog entry
```

## Deploy

`bun run build` produces a fully static SPA in `build/` (the script flattens `build/client/*` up a
level and writes a `404.html` so client-side routing works on static hosts). Drop that directory on
GitHub Pages, Cloudflare Pages, Vercel, S3 — anything that serves files. No server is required.

Two independent workflows deploy the app from `master`. They run only for release commits:

- [`deploy-client.yml`](.github/workflows/deploy-client.yml) runs only when the root
  `package.json` changes. It verifies that the client and server versions match, builds the static
  client, and deploys it to GitHub Pages with `VITE_API_URL` taken from the repository variable of
  the same name. Leave that variable unset and the account and sync surfaces disappear; the client
  makes no API requests.
- [`deploy-server.yml`](.github/workflows/deploy-server.yml) runs only when
  `server/package.json` changes. It verifies the matching version, type-checks and tests the
  server, then uploads it to the VPS (Bun + systemd behind Caddy). Setup, secrets, and rollback
  details are in [`server/README.md`](server/README.md).

To prepare a release, run `bun run release:patch`, `bun run release`, or
`bun run release:major`, review the generated `CHANGELOG.md`, and commit it with both
`package.json` files. The scripts update both versions together, which starts both workflows; they
then run independently. Once the client deployment succeeds and its version differs from the
latest tag, the client workflow creates the corresponding `v…` tag. The in-app
[changelog](CHANGELOG.md) is built from that same file.

## Architecture

Parsing runs on the main thread (it needs browser APIs such as `DOMParser` for GPX); fog and
library-wide unique-distance geometry run in Web Workers. The fog renderer consumes positive
explored-mask polygons and draws the surrounding world stencil in a custom MapLibre layer.
Revisioned snapshots are emitted at most every 300 ms while activities are processed. Activities,
activity summaries, photos, saved points, sync state, and derived caches live in IndexedDB; map
position is written synchronously to localStorage on `moveend`.

An optional sync server lives in `server/`. When `VITE_API_URL` is unset, account and sync surfaces
are disabled and the client remains network-independent apart from map resources.

For the module map and project invariants, start with [`AGENTS.md`](AGENTS.md), then read the
focused references in [`docs/`](docs). The optional sync API and deployment guide are in
[`server/README.md`](server/README.md).

## Stack

- [React Router 7](https://reactrouter.com/) (SPA mode)
- [MapLibre GL JS](https://maplibre.org/) + [OpenFreeMap](https://openfreemap.org/) tiles via [PMTiles](https://protomaps.com/docs/pmtiles)
- [Turf.js](https://turfjs.org/) for geometry
- [exifr](https://github.com/MikeKovarik/exifr) for EXIF parsing
- [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) + [Base UI](https://base-ui.com/)
- [Recharts](https://recharts.org/) for the elevation and weekly charts
- [Vite](https://vitejs.dev/) + [Bun](https://bun.sh/)
- Optional server: [Hono](https://hono.dev/) and [Zod](https://zod.dev/) on Bun
