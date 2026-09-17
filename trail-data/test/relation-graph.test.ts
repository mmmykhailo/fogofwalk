import { expect, test } from "bun:test"

import { resolveRelationGraph } from "../src/relation-graph"

test("resolves direct and nested memberships while terminating cycles", () => {
  const result = resolveRelationGraph([
    {
      id: 1,
      tags: { type: "route", route: "hiking", network: "lwn", colour: "red" },
      members: [{ type: "relation", ref: 2, role: "" }],
    },
    {
      id: 2,
      tags: {
        type: "superroute",
        route: "hiking",
        network: "iwn",
        colour: "brown",
      },
      members: [
        { type: "relation", ref: 1, role: "" },
        { type: "way", ref: 10, role: "" },
      ],
    },
    {
      id: 3,
      tags: { type: "route", route: "bicycle", network: "ncn" },
      members: [{ type: "way", ref: 10, role: "" }],
    },
    {
      id: 4,
      tags: { type: "collection", route: "hiking" },
      members: [{ type: "way", ref: 11, role: "" }],
    },
  ])

  expect(result.stats).toMatchObject({
    acceptedRelations: 3,
    hikingRelations: 2,
    cyclingRelations: 1,
    superRelations: 1,
    relationMembers: 5,
    uniqueMemberWays: 1,
  })
  expect(result.stats.relationCycles).toBeGreaterThan(0)
  expect(result.membershipsByWay.get(10)).toHaveLength(3)
  expect(result.membershipsByWay.has(11)).toBe(false)
})
