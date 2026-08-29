# Releases

Fog of Walk releases the client and optional server as one version. The root
`package.json` and `server/package.json` must always have the same semantic
version.

## Preparing a release

Finish and commit the changes intended for the release first. Then, on the
release branch, run one of these commands:

```bash
bun run release        # patch
bun run release minor
bun run release major
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
