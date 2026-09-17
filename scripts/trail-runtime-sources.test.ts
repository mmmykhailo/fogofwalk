import { expect, test } from "bun:test"
import { resolve } from "node:path"

import { isPublicPmtilesPath } from "./trail-runtime-sources"

const repositoryRoot = resolve(import.meta.dir, "..")
const publicRoot = resolve(repositoryRoot, "public")

test("allows the E2E fixture but rejects a public PMTiles path", () => {
  expect(
    isPublicPmtilesPath(
      resolve(repositoryRoot, "e2e/fixtures/trails-v1.pmtiles"),
      publicRoot
    )
  ).toBe(false)
  expect(
    isPublicPmtilesPath(
      resolve(repositoryRoot, "public/map-data/trails/example.pmtiles"),
      publicRoot
    )
  ).toBe(true)
})
