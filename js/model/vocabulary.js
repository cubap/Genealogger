/**
 * @module model/vocabulary
 * @description Controlled vocabulary for the Eventities model layer. Standard
 * ontologies (schema.org, dcterms, OA, W3C-PRO/PROV, geo, time) are preferred
 * wherever a term exists there. Only Eventities-specific terms are minted in
 * the `nv:` namespace. HisGen vocabulary is internal guidance only and is
 * deliberately absent from this public surface.
 */

export const NAMESPACES = {
    nv: 'https://cubap.github.io/Genealogger/nv#',
    schema: 'https://schema.org/',
    dcterms: 'http://purl.org/dc/terms/',
    oa: 'http://www.w3.org/ns/oa#',
    prov: 'http://www.w3.org/ns/prov#',
    geo: 'http://www.w3.org/2003/01/geo/wgs84_pos#',
    time: 'http://www.w3.org/2006/time#'
}

/**
 * Expand a namespace prefix and local name into a full term URI.
 * @param {string} prefix one of the NAMESPACES keys
 * @param {string} local the local term name
 * @returns {string}
 */
export function term(prefix, local) {
    if (!Object.prototype.hasOwnProperty.call(NAMESPACES, prefix)) {
        throw new Error(`Unknown vocabulary prefix '${prefix}'`)
    }
    return NAMESPACES[prefix] + local
}

/** Bare entity/annotation types, kept plain for devstore shape compatibility. */
export const TYPES = {
    Person: 'Person',
    Event: 'Event',
    Record: 'Record',
    Place: 'Place',
    Annotation: 'Annotation'
}

/** Eventities-specific terms. Everything here lives in `nv:`. */
export const NV = {
    hasParent: term('nv', 'hasParent'),
    hasChild: term('nv', 'hasChild'),
    Lacuna: term('nv', 'Lacuna'),
    confidence: term('nv', 'confidence'),
    participant: term('nv', 'participant'),
    role: term('nv', 'role'),
    child: term('nv', 'child'),
    parent: term('nv', 'parent'),
    mother: term('nv', 'mother'),
    father: term('nv', 'father'),
    godParent: term('nv', 'godParent'),
    informant: term('nv', 'informant'),
    witness: term('nv', 'witness'),
    attendant: term('nv', 'attendant')
}

/**
 * Event subtypes. schema.org carries no generic vital-record event classes,
 * so genealogical event subtypes live in `nv:`.
 */
export const EVENT_SUBTYPES = {
    Birth: term('nv', 'Birth'),
    Christening: term('nv', 'Christening'),
    Baptism: term('nv', 'Baptism'),
    Death: term('nv', 'Death'),
    Burial: term('nv', 'Burial'),
    Marriage: term('nv', 'Marriage'),
    Census: term('nv', 'Census')
}

/**
 * Every '@type' token under which the given subtypes can be found in a store.
 * New-shape documents carry the full URI; migrated DEER v1 documents carry the
 * bare local name ('Birth'), and devstore matches '@type' exactly -- so a search
 * that must see both generations has to ask for both spellings.
 * @param {...(string|Array<string>)} subtypes type URIs, or arrays of them
 * @returns {Array<string>} each URI followed by its bare fragment, de-duplicated
 */
export function typeTokens(...subtypes) {
    const tokens = []
    for (const value of subtypes.flat()) {
        if (!value || tokens.includes(value)) continue
        tokens.push(value)
        const bare = String(value).split(/[#/]/).pop()
        if (bare && !tokens.includes(bare)) tokens.push(bare)
    }
    return tokens
}

/**
 * Canonical participation roles. Following the W3C Property of a Role pattern,
 * a role is asserted alongside the participant on an event.
 */
export const CANONICAL_ROLES = {
    child: NV.child,
    parent: NV.parent,
    mother: NV.mother,
    father: NV.father,
    godParent: NV.godParent,
    informant: NV.informant,
    witness: NV.witness,
    attendant: NV.attendant
}

/** schema.org terms used for facts asserted about people. */
export const SCHEMA = {
    name: term('schema', 'name'),
    givenName: term('schema', 'givenName'),
    familyName: term('schema', 'familyName'),
    additionalName: term('schema', 'additionalName'),
    alternateName: term('schema', 'alternateName'),
    birthDate: term('schema', 'birthDate'),
    birthPlace: term('schema', 'birthPlace'),
    deathDate: term('schema', 'deathDate'),
    deathPlace: term('schema', 'deathPlace'),
    sex: term('schema', 'sex'),
    gender: term('schema', 'gender'),
    homeLocation: term('schema', 'homeLocation')
}

/**
 * Name qualifiers. Issue #12 story 12 requires that every name has a type and may
 * be bounded in time, and the qualifiers ride INSIDE the ValueObject so two
 * disagreeing name claims keep their own type/range instead of being merged.
 * (Minted page-locally by the person slice while the M3 page slices ran in
 * parallel; hoisted now that the naming rule has a second writer.)
 */
export const NV_NAME_TYPE = term('nv', 'nameType')
export const NV_ACTIVE_FROM = term('nv', 'activeFrom')
export const NV_ACTIVE_TO = term('nv', 'activeTo')

/** Display labels for the ValueObject qualifiers a name assertion can carry. */
export const QUALIFIER_LABELS = {
    [NV_NAME_TYPE]: 'type',
    [NV_ACTIVE_FROM]: 'from',
    [NV_ACTIVE_TO]: 'to'
}

/** The name properties a person can be asserted to have, keyed by form token. */
export const NAME_PROPERTY_TOKENS = {
    full: SCHEMA.name,
    given: SCHEMA.givenName,
    family: SCHEMA.familyName,
    additional: SCHEMA.additionalName,
    alternate: SCHEMA.alternateName
}

/** Bare name-type values (issue #12 story 12: every name has a type). */
export const NAME_TYPE_TOKENS = [
    'birth name', 'married name', 'nickname', 'adopted name', 'religious name',
    'professional name', 'alias', 'customary name', 'other name'
]

/** dcterms terms used for provenance on ValueObjects and annotations. */
export const DCTERMS = {
    source: term('dcterms', 'source'),
    created: term('dcterms', 'created'),
    modified: term('dcterms', 'modified'),
    title: term('dcterms', 'title'),
    type: term('dcterms', 'type')
}

/** PROV terms for derivation/attribution where dcterms is too coarse. */
export const PROV = {
    wasDerivedFrom: term('prov', 'wasDerivedFrom'),
    wasAttributedTo: term('prov', 'wasAttributedTo')
}

/** WGS84 geo terms for Place coordinates. */
export const GEO = {
    lat: term('geo', 'lat'),
    long: term('geo', 'long')
}

/** OWL Time terms for event instants. */
export const TIME = {
    inXSDDate: term('time', 'inXSDDate')
}

/**
 * Keys that stay raw on resolved entities instead of resolving to
 * ValueObjects (mirrors DEER v2 identity handling).
 */
export const IDENTITY_KEYS = ['@id', '@type', '@context', '__rerum']
