import { readFile } from "node:fs/promises"

export interface OsmNode {
  id: number
  version: number
  lon: number
  lat: number
  tags: Record<string, string>
}

export interface OsmWay {
  id: number
  version: number
  nodeRefs: number[]
  tags: Record<string, string>
}

export type OsmMemberType = "node" | "way" | "relation"

export interface OsmRelationMember {
  type: OsmMemberType
  ref: number
  role: string
}

export interface OsmRelation {
  id: number
  version: number
  tags: Record<string, string>
  members: OsmRelationMember[]
}

export interface OsmDocument {
  nodes: Map<number, OsmNode>
  ways: Map<number, OsmWay>
  relations: Map<number, OsmRelation>
}

/**
 * Parses the small XML fixture used as the semantic oracle. Production input
 * is always PBF; this parser deliberately remains a fixture-only dependency.
 */
export function parseOsmXml(xml: string): OsmDocument {
  const nodes = new Map<number, OsmNode>()
  for (const match of xml.matchAll(
    /<node\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/node>)/g
  )) {
    const attributes = parseAttributes(match[1])
    const id = parseId(attributes.id, "node")
    nodes.set(id, {
      id,
      version: parseVersion(attributes.version),
      lon: parseNumber(attributes.lon, "node lon"),
      lat: parseNumber(attributes.lat, "node lat"),
      tags: parseTags(match[2] ?? ""),
    })
  }

  const ways = new Map<number, OsmWay>()
  for (const match of xml.matchAll(/<way\s+([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const attributes = parseAttributes(match[1])
    const id = parseId(attributes.id, "way")
    const body = match[2]
    ways.set(id, {
      id,
      version: parseVersion(attributes.version),
      nodeRefs: [
        ...body.matchAll(/<nd\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/nd>)/g),
      ].map((nd) => parseId(parseAttributes(nd[1]).ref, "way node")),
      tags: parseTags(body),
    })
  }

  const relations = new Map<number, OsmRelation>()
  for (const match of xml.matchAll(
    /<relation\s+([^>]*?)>([\s\S]*?)<\/relation>/g
  )) {
    const attributes = parseAttributes(match[1])
    const id = parseId(attributes.id, "relation")
    const body = match[2]
    const members: OsmRelationMember[] = []
    for (const member of body.matchAll(
      /<member\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/member>)/g
    )) {
      const values = parseAttributes(member[1])
      if (
        values.type !== "node" &&
        values.type !== "way" &&
        values.type !== "relation"
      ) {
        throw new Error(`unsupported fixture member type: ${values.type ?? ""}`)
      }
      members.push({
        type: values.type,
        ref: parseId(values.ref, "relation member"),
        role: values.role ?? "",
      })
    }
    relations.set(id, {
      id,
      version: parseVersion(attributes.version),
      tags: parseTags(body),
      members,
    })
  }

  return { nodes, ways, relations }
}

export async function readOsmXml(path: string): Promise<OsmDocument> {
  return parseOsmXml(await readFile(path, "utf8"))
}

export function documentEntities(document: OsmDocument): {
  nodes: OsmNode[]
  ways: OsmWay[]
  relations: OsmRelation[]
} {
  return {
    nodes: [...document.nodes.values()].sort((a, b) => a.id - b.id),
    ways: [...document.ways.values()].sort((a, b) => a.id - b.id),
    relations: [...document.relations.values()].sort((a, b) => a.id - b.id),
  }
}

function parseAttributes(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    result[match[1]] = decodeXml(match[2])
  }
  return result
}

function parseTags(source: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const match of source.matchAll(
    /<tag\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/tag>)/g
  )) {
    const values = parseAttributes(match[1])
    if (values.k !== undefined) result[values.k] = values.v ?? ""
  }
  return result
}

function parseId(value: string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`invalid ${label} id: ${value ?? ""}`)
  }
  return parsed
}

function parseVersion(value: string | undefined): number {
  if (value === undefined) return 1
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`invalid OSM version: ${value}`)
  }
  return parsed
}

function parseNumber(value: string | undefined, label: string): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed))
    throw new Error(`invalid ${label}: ${value ?? ""}`)
  return parsed
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
}
