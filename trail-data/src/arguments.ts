export interface ParsedArguments {
  command: string
  options: Map<string, string>
  flags: Set<string>
}

export function parseArguments(argv: string[]): ParsedArguments {
  const [command = ""] = argv
  if (!command || command.startsWith("--")) {
    throw new Error("missing trail-data subcommand")
  }

  const options = new Map<string, string>()
  const flags = new Set<string>()
  for (const argument of argv.slice(1)) {
    if (!argument.startsWith("--")) {
      throw new Error(`arguments must use --name=value: ${argument}`)
    }
    const body = argument.slice(2)
    const separator = body.indexOf("=")
    if (separator < 0) {
      if (flags.has(body) || options.has(body)) {
        throw new Error(`duplicate argument ${body}`)
      }
      flags.add(body)
      continue
    }
    const key = body.slice(0, separator).replaceAll("_", "-")
    const value = body.slice(separator + 1)
    if (!key || !value) throw new Error(`argument ${key} must not be blank`)
    if (flags.has(key) || options.has(key)) {
      throw new Error(`duplicate argument ${key}`)
    }
    options.set(key, value)
  }
  return { command, options, flags }
}

export function requiredOption(parsed: ParsedArguments, name: string): string {
  const value = parsed.options.get(name)
  if (!value) throw new Error(`missing --${name}=...`)
  return value
}

export function optionalInteger(
  parsed: ParsedArguments,
  name: string,
  fallback: number
): number {
  const value = parsed.options.get(name)
  if (value === undefined) return fallback
  if (!/^-?\d+$/.test(value)) throw new Error(`--${name} must be an integer`)
  const parsedValue = Number(value)
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`--${name} must be a safe integer`)
  }
  return parsedValue
}
