import { spawnSync } from "node:child_process"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

type GateLayer = "U" | "R" | "W" | "B" | "E" | "V"
type GateStatus = "pass" | "fail" | "unimplemented"

interface GateCommand {
  label: string
  executable: string
  args: string[]
  cwd: string
}

interface GateCheck {
  id: string
  priority: "P0" | "P1"
  layers: GateLayer[]
  description: string
  commands: GateCommand[]
}

interface CommandResult {
  status: Exclude<GateStatus, "unimplemented">
  detail?: string
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const e2eRoot = join(repoRoot, "e2e")
const bun = process.execPath

function unit(label: string, ...files: string[]): GateCommand {
  return { label, executable: bun, args: ["test", ...files], cwd: repoRoot }
}

function browser(label: string, ...args: string[]): GateCommand {
  return {
    label,
    executable: "bunx",
    args: ["playwright", "test", ...args],
    cwd: e2eRoot,
  }
}

const checks: GateCheck[] = [
  {
    id: "F-038",
    priority: "P0",
    layers: ["B", "V"],
    description: "positive explored masks have no internal compositing seams",
    commands: [
      browser(
        "MapLibre visual regression at zoom/DPR matrix",
        "specs/fog-visual.spec.ts",
        "--project=fog-visual"
      ),
    ],
  },
  {
    id: "F-039",
    priority: "P0",
    layers: ["U", "R", "W"],
    description: "one current identity stamps and invalidates fog caches",
    commands: [
      unit(
        "protocol/cache identity units",
        "app/lib/fog/protocol.test.ts",
        "app/lib/fogState.test.ts",
        "app/lib/storage.test.ts"
      ),
      browser(
        "worker and IndexedDB identity",
        "specs/fog-worker.spec.ts",
        "--project=fog-worker",
        "--grep",
        "\\[F-039\\]"
      ),
    ],
  },
  {
    id: "F-040",
    priority: "P0",
    layers: ["U", "W", "E"],
    description: "partial rebuilds cannot become appendable complete bases",
    commands: [
      unit(
        "engine/coordinator partial-state units",
        "app/lib/fog/engine/index.test.ts",
        "app/lib/fog/coordinator.test.ts"
      ),
      browser(
        "real-worker partial-state protocol",
        "specs/fog-worker.spec.ts",
        "--project=fog-worker",
        "--grep",
        "\\[F-040\\]"
      ),
    ],
  },
  {
    id: "F-041",
    priority: "P1",
    layers: ["U", "W"],
    description: "valid progress refreshes worker inactivity accounting",
    commands: [
      unit("watchdog progress unit", "app/lib/fog/watchdog.test.ts"),
      browser(
        "browser watchdog module",
        "specs/fog-worker.spec.ts",
        "--project=fog-worker",
        "--grep",
        "\\[F-041\\]"
      ),
    ],
  },
  {
    id: "F-042",
    priority: "P0",
    layers: ["U", "W"],
    description: "valid overlapping fill masks merge without degrading fog",
    commands: [
      unit(
        "fill union coordinate-space regression",
        "app/lib/fog/engine/aggregate.test.ts",
        "app/lib/fog/engine/index.test.ts"
      ),
    ],
  },
  {
    id: "I-037",
    priority: "P0",
    layers: ["U", "B", "V"],
    description:
      "canonical path boundaries stay disconnected in every renderer",
    commands: [
      unit(
        "path consumer units",
        "app/lib/uniqueDistance.test.ts",
        "app/lib/photos.test.ts",
        "app/lib/map/geojson.test.ts"
      ),
      browser(
        "main map/share canvas path regression",
        "specs/paths.spec.ts",
        "--project=paths"
      ),
    ],
  },
  {
    id: "I-038",
    priority: "P1",
    layers: ["U", "B"],
    description:
      "concurrent import stages remain simultaneously visible in stable order",
    commands: [
      unit(
        "concurrent import stage units",
        "app/lib/activities/import/status.test.ts",
        "app/lib/activities/import/service.test.ts"
      ),
      browser(
        "concurrent import stage browser regression",
        "specs/activity-progress.spec.ts",
        "--project=synced",
        "--grep",
        "\\[I-038\\]"
      ),
    ],
  },
  {
    id: "L-014",
    priority: "P1",
    layers: ["R"],
    description:
      "no-op commands create no outbox effect and revisions are authoritative",
    commands: [
      unit(
        "library repository outbox units",
        "app/lib/activities/repository.test.ts"
      ),
    ],
  },
]

const commandResults = new Map<string, CommandResult>()

function run(command: GateCommand): CommandResult {
  const key = JSON.stringify(command)
  const cached = commandResults.get(key)
  if (cached) return cached

  const result = spawnSync(command.executable, command.args, {
    cwd: command.cwd,
    env: process.env,
    encoding: "utf8",
  })
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim()
  const commandResult: CommandResult =
    result.error || result.status !== 0
      ? {
          status: "fail",
          detail: (result.error?.message ?? output).slice(-2_000),
        }
      : { status: "pass" }
  commandResults.set(key, commandResult)
  return commandResult
}

function statusFor(check: GateCheck): {
  status: GateStatus
  results: { command: GateCommand; result: CommandResult }[]
} {
  if (check.commands.length === 0)
    return { status: "unimplemented", results: [] }
  const results = check.commands.map((command) => ({
    command,
    result: run(command),
  }))
  return {
    status: results.every(({ result }) => result.status === "pass")
      ? "pass"
      : "fail",
    results,
  }
}

const reportRows = checks.map((check) => ({ check, ...statusFor(check) }))
const lines = [
  "# Activity pipeline regression gate",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "| ID | Pri | Layers | Status | Regression |",
  "| --- | --- | --- | --- | --- |",
  ...reportRows.map(
    ({ check, status }) =>
      `| ${check.id} | ${check.priority} | ${check.layers.join(", ")} | ${status} | ${check.description} |`
  ),
]

const failures = reportRows.flatMap(({ check, results }) =>
  results
    .filter(({ result }) => result.status === "fail")
    .map(
      ({ command, result }) =>
        `\n${check.id} · ${command.label}\n${result.detail ?? "command failed"}`
    )
)
if (failures.length > 0) lines.push("", "## Failed checks", ...failures)

console.log(lines.join("\n"))

if (reportRows.some(({ status }) => status !== "pass")) process.exitCode = 1
