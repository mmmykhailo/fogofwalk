---
name: release
description: Prepare and commit a Fog of Walk semver release when a patch, minor, or major release is requested.
---

# Fog of Walk release

Use this skill for a requested Fog of Walk release. Read `docs/releases.md`
before changing version files.

The root `package.json` and `server/package.json` are one release version.
Always use `bun run release [patch|minor|major]`; do not edit either version by
hand. The command updates both package files and generates the changelog entry.

Before running it, inspect `git status --short`. Preserve unrelated changes
and do not include them in a release commit. Review the generated changelog and
the exact diff, then run `bun run typecheck` and the server's typecheck and
tests when their dependencies are available.

Create the version bump as a separate commit named exactly `release vX.X.X`.
It contains only the generated version and changelog files, except for a
lockfile changed directly by the release command. Do not push or create a tag
locally unless explicitly requested: deployment creates the tag after the
client deploy succeeds.

This portable `SKILL.md` is linked from both `.codex/skills/release` and
`.claude/skills/release` so Codex and Claude Code can use the same workflow.
