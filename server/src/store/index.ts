/**
 * Driver factory — the only module that imports a concrete store.
 *
 * To add a driver (the Storage drivers table in `server/README.md` lists
 * `sqlite-blob`, `postgres-bytea` and `postgres-s3` as the intended next
 * ones):
 *   1. implement `ServerStore` in `src/store/<driver>.ts` — Bun ships
 *      `bun:sqlite`, `Bun.sql` and `Bun.s3`, so none of them needs a
 *      dependency;
 *   2. add one `case` below;
 *   3. document its env vars in `README.md` and `.env.example`.
 * Nothing else in the server may import a driver module directly.
 */

import { env } from "../env"
import { createMemoryStore } from "./memory"
import { createSqliteFsStore } from "./sqlite-fs"
import type { ServerStore } from "./types"

const IMPLEMENTED = ["sqlite-fs", "memory"] as const

export async function createStore(
  driver: string = env.STORE_DRIVER,
  dataDir: string = env.DATA_DIR
): Promise<ServerStore> {
  switch (driver) {
    case "sqlite-fs":
      return createSqliteFsStore(dataDir)
    case "memory":
      return createMemoryStore()
    default:
      throw new Error(
        `Unknown STORE_DRIVER "${driver}". Implemented drivers: ` +
          `${IMPLEMENTED.join(", ")}. ` +
          `sqlite-blob, postgres-bytea and postgres-s3 are documented ` +
          `extension points — see the Storage drivers table in ` +
          `server/README.md and add a case in server/src/store/index.ts.`
      )
  }
}
