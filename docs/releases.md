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

Trail data is a separately built but client-versioned public artifact. It is
generated locally by the Bun/TypeScript release tool; neither deploy workflow
downloads OSM data nor rebuilds an archive. Before referencing a new archive
from a client release:

1. Run `bun run build:trail-fixture`, `bun run verify:trail-fixture`, and the
   trail TypeScript tests.
2. Build from a reviewed manifest of local, dated, checksummed PBF inputs:

   ```sh
   bun trail-data/build.ts build \
     --manifest=/data/manifests/trails.json \
     --output=/data/trails/trails-build.pmtiles \
     --report=/data/trails/trails-build.report.json \
     --scratch-dir=/data/scratch/fogofwalk-trails
   ```

3. Review the report for schema version 1, explicit coverage, source
   checksums, generated SHA-256, attribution/licence, tile-size metrics,
   duplicate/conflict counts, geometry loss, and the overlap-cap gate. Run
   `bun trail-data/build.ts manifest` to produce the checksum, source manifest,
   and ODbL `DATA-LICENSE.txt` sidecars.
4. Name the archive with its snapshot date and first 12 SHA-256 characters.
   Upload the archive and sidecars under a temporary static name, compare
   remote size/checksums, atomically move them to immutable names, and perform
   external `HEAD` plus several `Range` probes. A missing `206` response or
   incorrect `Content-Range` leaves the active client unchanged.
5. Set `VITE_TRAIL_ARCHIVE_URL` to the exact immutable archive URL and deploy
   the client. The deployment workflow repeats the URL, `HEAD`, and first-127-
   byte range preflight before building.

Retain the current archive and at least the previous two archives. Delete an
old archive only when no retained client release references it and it is at
least 90 days old. Rollback is a client redeploy using the prior immutable URL;
the corresponding archive must remain available for the lifetime of that
release. A missing archive disables only the trail overlay and does not block
local imports, fog rendering, saved points, photos, or optional sync.
