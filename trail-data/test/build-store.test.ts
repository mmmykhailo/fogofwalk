import { expect, test } from "bun:test"

import { BuildStore } from "../src/build-store"

test("keeps relation joins and rejects same-version source conflicts", async () => {
  const path = `/tmp/fogofwalk-store-${crypto.randomUUID()}.sqlite`
  const store = await BuildStore.open(path)
  try {
    store.addRelation({
      id: 1,
      version: 2,
      tags: { type: "route", route: "hiking" },
      members: [{ type: "way", ref: 10, role: "" }],
    })
    store.addRelation({
      id: 1,
      version: 2,
      tags: { type: "route", route: "hiking" },
      members: [{ type: "way", ref: 10, role: "" }],
    })
    expect(store.counters.duplicateSourceObjects).toBe(1)
    expect([...store.iterateRelations()][0]?.members[0]?.ref).toBe(10)
    expect(() =>
      store.addRelation({
        id: 1,
        version: 2,
        tags: { type: "route", route: "hiking" },
        members: [{ type: "way", ref: 11, role: "" }],
      })
    ).toThrow("conflicting relation")
    expect(store.counters.sourceConflicts).toBe(1)
  } finally {
    store.close()
  }
})
