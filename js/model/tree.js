/**
 * @module model/tree
 * @description Read use-case for the family tree page (issue #14 story 10):
 * assemble the nodes and edges around one person from DERIVED reads only.
 * Edges upward come from `search.parentsOf()` (the nv:hasParent assertions
 * targeting the person); edges downward come from `search.childrenOf()`, the
 * COMPUTED inverse recovered through the assertion's `rel` reverse index.
 * Nothing in this module reads or writes a stored nv:hasChild — the parent→child
 * edge exists exactly once on the wire, in the child's hasParent assertion.
 *
 * Fan-out is bounded: the walk covers `maxGenerations` in BOTH directions from
 * the root (default 2, i.e. grandparents and grandchildren; a page may pass
 * `?generations=N`). Each visited person costs a parentsOf query, a childrenOf
 * query, and one entity read per newly-seen person; each distinct evidence
 * document costs one read plus two target queries (provenance, participations),
 * all cached per load, so shared ancestors and repeated records are read once.
 *
 * Contested parentage is PRESERVED, not reconciled (this app's thesis): a
 * person whose parent claims span two evidence sources, exceed two parents, or
 * name two different people for the same role keeps every claim as its own
 * edge and is flagged `contested`, so the disagreement shows in the tree's
 * shape, not just a tooltip.
 *
 * DEER v1: `hasFather`/`hasMother` stored on a person (directly or in v1
 * annotations) arrive through the adapter's lazy reader as ordinary
 * nv:hasParent assertions targeting the child, so the derived path already
 * covers them. When a person has no parent assertions at all, a second read
 * asks `eventsForPerson(..., { legacyTypes: typeTokens(Birth...) })` for v1
 * event documents (they predate the rel index) and takes the parentage those
 * events claim. v1 documents carry no `rel`, so a legacy PARENT cannot see its
 * children from its own side (docs/devstore-query-contract.md); v1 downward
 * edges only exist when the tree is rooted through the child.
 *
 * HOISTING FLAGS for the final migration slice: `roleToken()` and the
 * PARENT_ROLES set duplicate the private equivalents in model/events.js, and
 * the event-vs-record `isEventEntity()` sniff repeats what model/death.js
 * does inline. All three are candidates to move into search.js/events.js once
 * a second page needs them.
 */

import { NV, TYPES, EVENT_SUBTYPES, typeTokens } from './vocabulary.js'
import { parentsOf, childrenOf, valuesOf, deriveLabel, eventsForPerson } from './search.js'
import { readEntity } from './entities.js'
import { eventProvenance, participations } from './events.js'
import { getDefaultStore } from './default-store.js'

/** Generations shown above AND below the root unless the caller overrides. */
export const DEFAULT_MAX_GENERATIONS = 2

const BIRTH_SUBTYPES = [EVENT_SUBTYPES.Birth, EVENT_SUBTYPES.Christening, EVENT_SUBTYPES.Baptism]
const BIRTH_TYPE_TOKENS = typeTokens(...BIRTH_SUBTYPES)
const PARENT_ROLES = new Set([NV.parent, NV.mother, NV.father])
const EVENT_URI_TYPES = new Set(Object.values(EVENT_SUBTYPES))
const EVENT_BARE_TYPES = new Set(Object.keys(EVENT_SUBTYPES))

function asArray(value) {
    if (value === undefined || value === null) return []
    return Array.isArray(value) ? value : [value]
}

/** The bare word off a role/confidence URI ('.../father' -> 'father'). */
function roleToken(role) {
    return String(role || '').split(/[#/]/).pop() || ''
}

function isEventEntity(entity) {
    return asArray(entity && entity['@type'])
        .some(t => t === TYPES.Event || EVENT_URI_TYPES.has(t) || EVENT_BARE_TYPES.has(t))
}

function isBirthEvent(entity) {
    return asArray(entity && entity['@type'])
        .some(t => BIRTH_SUBTYPES.includes(t) || ['Birth', 'Christening', 'Baptism'].includes(t))
}

/**
 * Resolve what an assertion's `evidence` id points at: the Birth Event (or the
 * Record itself, when v1 evidence skipped the event). For an event, the visible
 * evidence name is the Record BEHIND the event, and the event's participations
 * supply each agent's role. Cached per evidence id: siblings share one birth
 * record, so one resolution serves the whole family.
 */
async function describeEvidence(state, evidenceId) {
    if (!evidenceId) return {}
    if (state.evidenceCache.has(evidenceId)) return state.evidenceCache.get(evidenceId)
    const entity = await readEntity({ store: state.store, id: evidenceId })
    const described = {}
    if (entity && isEventEntity(entity)) {
        const provenance = await eventProvenance({ store: state.store, event: entity })
        described.recordLabel = provenance.evidence
            ? await labelFor(state, provenance.evidence)
            : (deriveLabel(entity) || undefined)
        described.roles = {}
        for (const row of await participations({ store: state.store, event: entity })) {
            if (row.agent && PARENT_ROLES.has(row.role)) described.roles[row.agent] = roleToken(row.role)
        }
    } else if (entity) {
        // The evidence doc reads as the Record itself (v1 evidence fields, or a
        // caller that pointed an assertion straight at a source document).
        described.recordLabel = deriveLabel(entity) || undefined
    } else {
        // Unreadable evidence id (v1 pointing at a Record outside the store):
        // name the edge with the raw id rather than nothing.
        described.recordLabel = evidenceId
    }
    state.evidenceCache.set(evidenceId, described)
    return described
}

async function labelFor(state, id) {
    if (state.labels.has(id)) return state.labels.get(id)
    const entity = await readEntity({ store: state.store, id })
    const label = entity ? deriveLabel(entity) : id
    state.labels.set(id, label)
    return label
}

/**
 * The parent claims for one person, as { parent, evidence, role } rows.
 * Primary: the derived nv:hasParent reads. Fallback (only when empty): v1
 * Birth-type event documents, whose hasFather/hasMother targeted the event
 * rather than the child and which carry no rel index.
 */
async function parentClaims(state, personId) {
    const { store } = state
    const vos = await parentsOf({ store, personId })
    if (vos.length) {
        return vos.filter(vo => vo.value)
            .map(vo => ({ parent: vo.value, evidence: vo.evidence }))
    }
    const events = await eventsForPerson({ store, personId, role: NV.child, legacyTypes: BIRTH_TYPE_TOKENS })
    const rows = []
    for (const event of events.filter(isBirthEvent)) {
        const eventId = event['@id']
        for (const row of await participations({ store, event })) {
            if (row.agent && PARENT_ROLES.has(row.role)) {
                rows.push({ parent: row.agent, evidence: eventId, role: roleToken(row.role) })
            }
        }
        for (const vo of await valuesOf({ store, targetId: eventId, type: NV.hasParent })) {
            if (vo.value) rows.push({ parent: vo.value, evidence: vo.evidence || eventId })
        }
    }
    return rows
}

/**
 * Contested = the sources disagree, not merely that a person has two parents.
 * Three shapes count: two different evidence documents claim parentage, more
 * distinct parents than mother+father slots, or two DIFFERENT people claimed
 * for the same role (two fathers).
 */
function isContested(claims) {
    if (claims.length < 2) return false
    const parents = new Set(claims.map(claim => claim.parent))
    const sources = new Set(claims.map(claim => claim.evidence || ''))
    if (sources.size > 1 || parents.size > 2) return true
    const byRole = new Map()
    for (const claim of claims) {
        if (!claim.role) continue
        if (!byRole.has(claim.role)) byRole.set(claim.role, new Set())
        byRole.get(claim.role).add(claim.parent)
    }
    return [...byRole.values()].some(set => set.size > 1)
}

async function addEdge(state, { from, to, evidence, role, evidenceLabel }) {
    if (!from || !to || from === to) return
    const key = `${from}>${to}`
    if (state.edges.has(key)) return
    state.edges.set(key, { from, to, role: role || undefined, evidence, evidenceLabel })
}

/**
 * Load the family tree around a person.
 * @param {Object} [options]
 * @param {Object} [options.store] store (defaults to the configured one)
 * @param {string} options.rootId person the tree is drawn around
 * @param {number} [options.maxGenerations] generations above AND below the
 *   root; DEFAULT_MAX_GENERATIONS (2) by default
 * @returns {Promise<{ rootId: string, rootLabel: string, maxGenerations: number,
 *   nodes: Array<{ id: string, label: string, gen: number, contested: boolean }>,
 *   edges: Array<{ from: string, to: string, role?: string, evidence?: string,
 *   evidenceLabel?: string, contested: boolean }> } | null>} null when the root
 *   id resolves to nothing
 */
export async function loadTree(options = {}) {
    const { store = getDefaultStore(), rootId, maxGenerations = DEFAULT_MAX_GENERATIONS } = options
    if (!rootId) throw new TypeError('loadTree() requires a rootId')
    const root = await readEntity({ store, id: rootId })
    if (!root) return null
    const max = Number.isFinite(maxGenerations) ? Math.max(0, Math.trunc(maxGenerations)) : DEFAULT_MAX_GENERATIONS

    const state = {
        store,
        labels: new Map(),
        evidenceCache: new Map(),
        contested: new Set(),
        edges: new Map()
    }
    const gens = new Map([[rootId, 0]])
    const queue = [rootId]

    while (queue.length) {
        const id = queue.shift()
        const gen = gens.get(id)
        await labelFor(state, id)
        // Upward: parentsOf is authoritative — it carries evidence and, through
        // the evidence event's participations, the mother/father role.
        if (gen > -max) {
            const claims = await parentClaims(state, id)
            for (const claim of claims) {
                const parentGen = gen - 1
                // Out-of-range parents are dropped whole: every edge must
                // reference two nodes the renderer actually has.
                if (!gens.has(claim.parent) && parentGen < -max) continue
                const described = await describeEvidence(state, claim.evidence)
                claim.role = claim.role || described.roles?.[claim.parent]
                await addEdge(state, {
                    from: claim.parent,
                    to: id,
                    evidence: claim.evidence,
                    role: claim.role,
                    evidenceLabel: described.recordLabel
                })
                if (!gens.has(claim.parent)) {
                    gens.set(claim.parent, parentGen)
                    queue.push(claim.parent)
                }
            }
            if (isContested(claims)) state.contested.add(id)
        }
        // Downward: childrenOf is the computed inverse; rows are the very same
        // hasParent assertions, so the edge (with its evidence) is complete here.
        if (gen < max) {
            for (const row of await childrenOf({ store, personId: id })) {
                const childGen = gen + 1
                if (!gens.has(row.target) && childGen > max) continue
                const described = await describeEvidence(state, row.evidence)
                await addEdge(state, {
                    from: id,
                    to: row.target,
                    evidence: row.evidence,
                    role: described.roles?.[id],
                    evidenceLabel: described.recordLabel
                })
                if (!gens.has(row.target)) {
                    gens.set(row.target, childGen)
                    queue.push(row.target)
                }
            }
        }
    }

    const nodes = [...gens.entries()].map(([id, gen]) => ({
        id,
        gen,
        label: state.labels.get(id) || deriveLabel(null),
        contested: state.contested.has(id)
    })).sort((a, b) => a.gen - b.gen || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    // Sort by displayed labels so sibling order is stable and human-sane,
    // not by minted ids.
    const labelOf = id => state.labels.get(id) || id
    const edges = [...state.edges.values()]
        .map(edge => ({ ...edge, contested: state.contested.has(edge.to) }))
        .sort((a, b) => labelOf(a.to).localeCompare(labelOf(b.to)) || labelOf(a.from).localeCompare(labelOf(b.from)))
    return {
        rootId,
        rootLabel: state.labels.get(rootId) || deriveLabel(root),
        maxGenerations: max,
        nodes,
        edges
    }
}

export default { loadTree, DEFAULT_MAX_GENERATIONS }
