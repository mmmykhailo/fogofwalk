import {
  classifyRelation,
  type RelationClassification,
  type TrailMembership,
  type TrailTags,
} from "./classifier"
import type { OsmMemberType } from "./osm-xml-fixture"

export interface RelationGraphMember {
  type: OsmMemberType
  ref: number
  role: string
}

export interface RelationGraphRelation {
  id: number
  version?: number
  tags: TrailTags
  members: RelationGraphMember[]
}

export interface RelationGraphStats {
  acceptedRelations: number
  hikingRelations: number
  cyclingRelations: number
  superRelations: number
  relationMembers: number
  relationCycles: number
  missingRelations: number
  uniqueMemberWays: number
}

export interface RelationGraphResult {
  accepted: Map<number, RelationClassification>
  membershipsByWay: Map<number, TrailMembership[]>
  stats: RelationGraphStats
}

/**
 * Resolves direct and nested relation memberships without recursion. A fresh
 * visited set is used for each root/path so cyclic superroutes terminate while
 * independent roots retain their visual memberships.
 */
export function resolveRelationGraph(
  relations: Iterable<RelationGraphRelation>
): RelationGraphResult {
  const relationMap = new Map<number, RelationGraphRelation>()
  for (const relation of relations) {
    if (relationMap.has(relation.id)) {
      throw new Error(`duplicate relation ${relation.id} in relation graph`)
    }
    relationMap.set(relation.id, relation)
  }

  const accepted = new Map<number, RelationClassification>()
  const stats: RelationGraphStats = {
    acceptedRelations: 0,
    hikingRelations: 0,
    cyclingRelations: 0,
    superRelations: 0,
    relationMembers: 0,
    relationCycles: 0,
    missingRelations: 0,
    uniqueMemberWays: 0,
  }

  for (const relation of [...relationMap.values()].sort(
    (a, b) => a.id - b.id
  )) {
    stats.relationMembers += relation.members.length
    const classification = classifyRelation(relation.id, relation.tags)
    if (!classification) continue
    accepted.set(relation.id, classification)
    stats.acceptedRelations++
    if (classification.kind === "hiking") stats.hikingRelations++
    else stats.cyclingRelations++
    if (classification.superRoute) stats.superRelations++
  }

  const membershipsByWay = new Map<number, TrailMembership[]>()
  const roots = [...accepted.keys()].sort((a, b) => a - b)
  for (const rootId of roots) {
    const root = accepted.get(rootId)
    if (!root) continue
    const pending: Array<{
      relationId: number
      membership: TrailMembership
      visited: Set<number>
      depth: number
    }> = [
      {
        relationId: rootId,
        membership: {
          relationId: root.id,
          kind: root.kind,
          networkRank: root.networkRank,
          color: root.color,
          inherited: false,
        },
        visited: new Set(),
        depth: 0,
      },
    ]

    while (pending.length > 0) {
      const current = pending.pop()
      if (!current) continue
      if (current.visited.has(current.relationId)) {
        stats.relationCycles++
        continue
      }

      const relation = relationMap.get(current.relationId)
      if (!relation) {
        stats.missingRelations++
        continue
      }

      const visited = new Set(current.visited)
      visited.add(current.relationId)
      for (const member of relation.members) {
        if (member.type === "way") {
          const list = membershipsByWay.get(member.ref) ?? []
          list.push({ ...current.membership, inherited: current.depth > 0 })
          membershipsByWay.set(member.ref, list)
        } else if (member.type === "relation") {
          if (visited.has(member.ref)) {
            stats.relationCycles++
            continue
          }
          pending.push({
            relationId: member.ref,
            membership: current.membership,
            visited: new Set(visited),
            depth: current.depth + 1,
          })
        }
      }
    }
  }

  stats.uniqueMemberWays = membershipsByWay.size
  return { accepted, membershipsByWay, stats }
}
