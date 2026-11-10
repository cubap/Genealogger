/**
 * @module model/person
 * @description The assembled Person view. Given an id, returns the bare
 * entity plus every assertion grouped by property, the derived parents
 * (stored nv:hasParent assertions) and the COMPUTED children (inverse,
 * never stored). This read is the model layer's highest test seam: no UI or
 * network is reachable past it.
 */

import { NV, TYPES } from './vocabulary.js'
import { resolve as resolveAssertions } from './assertions.js'
import { readEntity } from './entities.js'
import { parentsOf, childrenOf, valuesOf } from './search.js'
import { getDefaultStore } from './default-store.js'

/**
 * Assemble the full Person view: bare entity + assertions grouped by type +
 * derived parent/child links + lacunae.
 * @param {Object} [options]
 * @param {Object} [options.store] Store implementation (defaults to memory)
 * @param {string} options.id Person entity id
 * @returns {Promise<Object|null>} assembled view:
 * `{ entity, label, assertions, parents, children, lacunae }` or null when
 * the id does not name a Person.
 */
export async function getPerson(options = {}) {
    const { store = getDefaultStore(), id } = options
    if (!id) throw new TypeError('getPerson() requires an id')
    const entity = await readEntity({ store, id })
    if (!entity) return null
    const type = entity['@type']
    const isPerson = Array.isArray(type) ? type.includes(TYPES.Person) : type === TYPES.Person
    if (!isPerson) return null
    const [assertions, parents, children, lacunae] = await Promise.all([
        resolveAssertions({ store, target: id }),
        parentsOf({ store, personId: id }),
        childrenOf({ store, personId: id }),
        valuesOf({ store, targetId: id, type: NV.Lacuna })
    ])
    const labelValues = assertions.label
    const label = entity.label
        || (Array.isArray(labelValues) ? labelValues[0]?.value : labelValues?.value)
    return { entity, label, assertions, parents, children, lacunae }
}
