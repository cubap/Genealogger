/**
 * @module adapters/store
 * @description The single store contract every adapter must satisfy. The model
 * layer in js/model/ talks to persistence ONLY through this interface, so unit
 * tests can run against the in-memory adapter with no network access and the
 * RERUM adapter (M2) can drop in behind the same surface.
 *
 * Every method may return a value or a Promise of that value; the model layer
 * awaits all results. Implementations MUST return deep copies (or frozen
 * documents) so callers never mutate store-held state.
 *
 * @typedef {Object} ValueObject
 * @property {*} value the asserted value (string, number, entity id, etc.)
 * @property {Object} [source] citation metadata for where the claim was read
 * @property {string} [source.citationSource] human-readable source string
 * @property {string} [source.citationNote] note about the citation
 * @property {string} [source.comment] free-text comment (e.g. why the claim is
 * recorded despite being believed false)
 * @property {string} [evidence] id of the Record/Event entity supporting the claim
 * @property {number} [confidence] nv:confidence, 0-1, optional
 *
 * @typedef {Object} BareEntity
 * @property {string} '@id'
 * @property {string|Array<string>} '@type' e.g. 'Person' or ['Event', nv:Birth]
 * @property {string} [label] cheap display string; itself a ValueObject-tracked
 * property via a `label` annotation (bare copy lives here for lists)
 *
 * @typedef {Object} Annotation
 * @property {string} '@id'
 * @property {'Annotation'} type Web Annotation type
 * @property {string} target id of the entity the annotation is about
 * @property {Object<string, ValueObject|ValueObject[]>} body map of property
 * URI to one or more ValueObjects. Conflicting values of the same property on
 * the same target live in SEPARATE annotations and are never merged.
 * @property {string} [motivation] OA motivation, e.g. 'describing'
 * @property {string} [creator] attributing agent
 * @property {string} [dctermsSource] provenance: id of the evidence document
 *
 * @typedef {Object} QueryFilter
 * @property {string} [target] annotation target id
 * @property {string} [type] property URI that must key some annotation body
 * @property {*} [value] ValueObject value to match (compared with ===)
 *
 * @typedef {Object} Store
 * @property {function((BareEntity|Annotation)): (BareEntity|Annotation|Promise<BareEntity|Annotation>)} create
 * Persist a new document. An '@id' is minted via config.mintId() when absent.
 * @property {function(string): (?Object|Promise<?Object>)} read Fetch one
 * document by id; resolve null/undefined when not found.
 * @property {function((BareEntity|Annotation)): (Object|Promise<Object>)} update
 * Replace the stored document having the same '@id'; reject when unknown.
 * @property {function(string): (boolean|Promise<boolean>)} remove Delete by id.
 * @property {function(string): (Array<BareEntity>|Promise<Array<BareEntity>>)} listByType
 * All entities whose '@type' equals or includes the given type.
 * @property {function(QueryFilter): (Array<Annotation>|Promise<Array<Annotation>>)} query
 * Annotations matching target/type/value filters (all provided filters must match).
 * @property {function(): (Array<Object>|Promise<Array<Object>>)} [all]
 * Optional: every stored document (fixtures/debug helpers may use it).
 */

/**
 * Method names every Store implementation must provide.
 * @type {Array<string>}
 */
export const STORE_METHODS = ['create', 'read', 'update', 'remove', 'listByType', 'query']

/**
 * Validate that a candidate object satisfies the Store contract.
 * @param {Object} candidate something claiming to be a Store
 * @returns {Object} the candidate, when valid
 * @throws {TypeError} when any required method is missing
 */
export function assertStore(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        throw new TypeError('store must be an object implementing the Store contract')
    }
    const missing = STORE_METHODS.filter(method => typeof candidate[method] !== 'function')
    if (missing.length) {
        throw new TypeError(`store is missing required method(s): ${missing.join(', ')}`)
    }
    return candidate
}
