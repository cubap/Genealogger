/**
 * @module model/label
 * @description The label page's use-case layer: what a Person is called, and
 * keeping the denormalized bare `label` cache honest when the user records a
 * new name. This is the FIRST write path of the naming rule in
 * docs/page-model-adapter.md § "Naming a person": a list read cannot see
 * annotations, so anything that asserts a new name must refresh the bare
 * `label` too, or the same person is called two different things.
 *
 * Invariants this module is responsible for upholding (mirrored by the tests):
 *   - the DISPLAY string always comes from `search.personLabel()`. Nothing here
 *     re-implements (or ranks) label preference; `deriveLabel()` is reported
 *     alongside it only so a page can show what a list would say.
 *   - a label is display-only and carries no evidence of its own: the name is
 *     asserted as an evidenced fact under `schema:name`, and the bare `label` is
 *     a cache of it. The two are written together, never instead of each other.
 *   - CONFLICTS ARE A FEATURE: like `saveDeath`, `saveLabel` never dedupes or
 *     overwrites assertions. Two sources that disagree about a name produce two
 *     assertions, each with its own provenance and confidence.
 *   - AGREEING WITH AN OLDER ASSERTION still refreshes the cache. If the user
 *     re-records a name a different source already claimed while the cache holds
 *     something else, the cache is set to the name just recorded. Rationale: the
 *     cache is what lists read and `personLabel` prefers on the detail page, so
 *     "last recorded name wins" is the only rule that keeps both surfaces on one
 *     string; ranking the most-evidenced name inside a write path would be
 *     exactly the merging `personLabel` forbids. Re-asserting therefore REPAIRS a
 *     drifted cache instead of being ignored. The one exception is a no-op: when
 *     the cache already holds that string nothing is written (see the versioning
 *     caveat below).
 *   - no `query()` is issued without `target`/`rel`, and no list result is
 *     treated as a total (docs/devstore-query-contract.md).
 *
 * DEER v1 lineage: the old page posted `deer-key="name"` onto the Person with
 * `deer-type="Person"`, so a migrated person's bare `name` is already copied
 * into `label` by adapters/legacy.js and shows up here as a plain name claim —
 * reading such a record needs no special path.
 *
 * DEVSTORE CAVEAT (verified only against memory/local stores, never the shared
 * sandbox): `RerumStore.update()` PUTs `/update`, and the real service answers
 * with a NEW document under a NEW `@id` while the previous version links
 * forward. Because of that the cache write happens BEFORE the assertion and the
 * id the store returns is adopted as the person's id, so the surviving document
 * carries both the fresh cache value and the fresh fact. `read()` also hands
 * back a reduced model-shape document, so for a person still carrying DEER v1
 * facts inline (`#legacy-` annotations) the cache write is skipped rather than
 * PUTting a document that would drop those facts; such a person still gets the
 * new-shape name assertion. An id-preserving/merging update in js/adapters/ is
 * the follow-up that removes both workarounds.
 */

import { TYPES } from './vocabulary.js'
import { LABEL_PROPERTY, FULL_NAME_PROPERTY, createEntity, readEntity } from './entities.js'
import { assert as assertAnnotation, list as listAssertions } from './assertions.js'
import { getPerson } from './person.js'
import { personLabel, deriveLabel } from './search.js'
import { getDefaultStore } from './default-store.js'

/** Human labels for the name claims this page audits. */
export const PROPERTY_LABELS = {
    [FULL_NAME_PROPERTY]: 'Full name',
    [LABEL_PROPERTY]: 'Label'
}

/**
 * Properties that are claims about what to call a person: the formal
 * schema.org full name (what this page writes) and the bare-`label` property
 * `createPerson()` records with its creating evidence. Both are audited so the
 * user can see where the current display name came from.
 */
const NAME_PROPERTIES = [FULL_NAME_PROPERTY, LABEL_PROPERTY]

const LEGACY_ID_MARKER = '#legacy-'

function isLegacyAnnotation(anno) {
    return typeof anno['@id'] === 'string' && anno['@id'].includes(LEGACY_ID_MARKER)
}

function asArray(value) {
    return Array.isArray(value) ? value : [value]
}

async function resolveLabels(store, ids) {
    const labels = {}
    for (const id of new Set(ids.filter(Boolean))) {
        if (labels[id]) continue
        const entity = await readEntity({ store, id })
        labels[id] = (entity && entity.label) || id
    }
    return labels
}

/**
 * Load the label view of an existing person: the string `personLabel()` renders
 * now, the string a list would render, the name claims behind both with their
 * provenance, and whether the two agree.
 *
 * `names` is the name-property slice of the resolved assertion map, in the shape
 * `assertions.resolve()` returns, so a page can hand it straight to
 * `gl-assertion`'s `toAssertionRows()` and get one row per ValueObject — every
 * coexisting claim, none merged.
 * @param {Object} [options]
 * @param {Object} [options.store]
 * @param {string} options.personId
 * @returns {Promise<Object|null>} `{ personId, entity, label, listLabel,
 * cacheStale, legacy, names, evidenceLabels, view }`, or null when the id is not
 * a Person. `label` is what the detail page shows (always `personLabel()`);
 * `listLabel` is what `deriveLabel()` gives a list row; `cacheStale` is true when
 * they differ, i.e. when the bare cache holds nothing displayable and only the
 * assertions can name this person — recording the display name again repairs it.
 */
export async function loadLabel(options = {}) {
    const { store = getDefaultStore(), personId } = options
    if (!personId) throw new TypeError('loadLabel() requires a personId')
    const view = await getPerson({ store, id: personId })
    if (!view) return null

    const grouped = view.assertions
    const names = {}
    const evidenceIds = []
    for (const property of NAME_PROPERTIES) {
        const raw = grouped[property]
        if (!raw) continue
        names[property] = raw
        for (const vo of asArray(raw)) {
            if (vo && vo.evidence) evidenceIds.push(vo.evidence)
        }
    }

    // Legacy persons are shown as the migrated view they are, exactly as the
    // death/birth pages do it: by the `#legacy-` ids the legacy reader mints.
    const annotations = await listAssertions({ store, target: personId })
    const legacy = annotations.some(isLegacyAnnotation)

    // Each name claim is evidenced by a Record; alias the id to the document's
    // title so every audit row names its source instead of a URI.
    const evidenceLabels = await resolveLabels(store, evidenceIds)

    const label = personLabel({ entity: view.entity, assertions: grouped })
    const listLabel = deriveLabel(view.entity)

    return {
        personId,
        entity: view.entity,
        label,
        listLabel,
        cacheStale: label !== listLabel,
        legacy,
        names,
        evidenceLabels,
        view
    }
}

/**
 * Record a new display name for an existing person: assert it as an evidenced
 * `schema:name` fact AND refresh the Person's bare `label` cache, which is what
 * every list read shows. Assert-only — a disagreeing source produces a second
 * assertion, never an overwrite.
 * @param {Object} [options]
 * @param {Object} [options.store] Store (defaults to the model's configured one)
 * @param {string} options.personId the person being named; this page never
 * creates a Person, so it is required
 * @param {string} options.name the display name to record
 * @param {Object} options.evidence `{ title }` for a new Record, or `{ id }` to
 * reuse an existing one — the source is named separately from the claim
 * @param {number} [options.confidence] nv:confidence for the name assertion
 * @returns {Promise<{ personId: string, recordId: string, annotationId: string,
 * label: string, cacheUpdated: boolean, cacheSkipped: string|null }>}
 * `personId` is the id the store now
 * serves for this person — the same one it came in as on memory/local stores, and
 * the superseding document's id on a versioning store (see the module caveat).
 * `cacheUpdated` is false when the cache was not written, and `cacheSkipped` says
 * why: "unchanged" when the cache already held this name (a no-op PUT is not worth
 * a new document version) or "legacy" when the person is still served as a DEER v1
 * document whose inline facts a PUT of the read-back shape would replace. In the
 * legacy case the page must say out loud that lists keep showing the old name —
 * silently leaving the cache stale is the failure this module exists to prevent.
 */
export async function saveLabel(options = {}) {
    const { store = getDefaultStore(), personId, name, evidence = {}, confidence } = options
    if (!personId) {
        throw new TypeError('saveLabel() requires a personId — the label page names an existing person')
    }
    const display = typeof name === 'string' ? name.trim() : ''
    if (!display) {
        throw new TypeError('saveLabel() requires the display name to record')
    }
    if (!evidence || (!evidence.id && !evidence.title)) {
        throw new TypeError('saveLabel() requires evidence: name the evidence document (Record) separately from the name it supports')
    }

    const view = await getPerson({ store, id: personId })
    if (!view) {
        throw new Error(`saveLabel() found no Person at ${personId}`)
    }
    const annotations = await listAssertions({ store, target: personId })
    const legacy = annotations.some(isLegacyAnnotation)

    // 1. The evidence document, named separately from the claim it supports.
    const recordId = evidence.id
        || (await createEntity({ store, '@type': TYPES.Record, label: evidence.title }))['@id']

    // 2. The denormalized cache, written first so that on a store which answers
    //    an update with a new version, the surviving document is the one the
    //    fresh fact below targets.
    let target = personId
    let cacheUpdated = false
    let cacheSkipped = null
    if (legacy) {
        cacheSkipped = 'legacy'
    } else if (view.entity[LABEL_PROPERTY] === display) {
        cacheSkipped = 'unchanged'
    } else {
        const updated = await store.update({ ...view.entity, [LABEL_PROPERTY]: display })
        target = (updated && updated['@id']) || personId
        cacheUpdated = true
    }

    // 3. The name claim itself: one evidenced assertion, never merged with the
    //    claims other sources already made.
    const annotation = await assertAnnotation({
        store,
        target,
        property: FULL_NAME_PROPERTY,
        value: display,
        evidence: recordId,
        confidence
    })

    return {
        personId: target,
        recordId,
        annotationId: annotation['@id'],
        label: display,
        cacheUpdated,
        cacheSkipped
    }
}

export default { saveLabel, loadLabel, PROPERTY_LABELS }
