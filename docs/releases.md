# Releases

Fog of Walk releases the client and optional server as one version. The root
`package.json` and `server/package.json` must always have the same semantic
version.

## Preparing a release

Finish and commit the changes intended for the release first. Then, on the
release branch, run one of these commands:

```bash
bun run release:patch  # patch
bun run release        # minor
bun run release:major  # major
```

The command updates both package versions and prepends the commit subjects
since the preceding release to `CHANGELOG.md`. If the first release tag has
not yet been created, it uses the latest committed changelog as its baseline.
Review and edit the generated notes before committing.

The version bump is always its own commit, named exactly:

```text
release vX.X.X
```

It should contain only `package.json`, `server/package.json`, and
`CHANGELOG.md` (unless a lockfile changes as a direct consequence). Do not
make unrelated changes in that commit.

## Deployment and tags

Pushing the release commit to `master` starts both workflows: the root
`package.json` triggers the client deploy and `server/package.json` triggers
the server deploy. They run independently, but both check that their versions
match. After a successful client deployment, the client workflow creates the
matching `vX.X.X` Git tag if it does not already exist.

Regular code, documentation, and workflow commits do not deploy on their own.

## Trail archive compatibility and rollback

Trail data is a separately built but client-versioned public artifact. Before
referencing a new archive from a client release:

1. Run the fixture/unit build and archive decoder checks, then run the full
   dated PBF build on the dedicated trail-builder runner.
2. Confirm the report records schema version 1, z12-only bounds, the dated OSM
   source and published checksum, the generated SHA-256, attribution/licence,
   tile-size metrics, and the overlap-cap release gate.
3. Upload under an immutable content-addressed filename. Never overwrite an
   existing archive or publish a mutable `latest` alias.
4. Compare the remote size and checksum with the local artifact, then perform
   an external `HEAD` and several `Range` probes. A missing `206` response or
   incorrect `Content-Range` leaves the active client unchanged.
5. Set `VITE_TRAIL_ARCHIVE_URL` to the exact archive URL and deploy the client.
   The deployment workflow repeats the URL, `HEAD`, and first-127-byte range
   preflight before building.

Retain the current archive and at least the previous two archives. Delete an
old archive only when no retained client release references it and it is at
least 90 days old. Rollback is a client redeploy using the prior immutable URL;
the corresponding archive must remain available for the lifetime of that
release. A missing archive disables only the trail overlay and does not block
local imports, fog rendering, saved points, photos, or optional sync.
