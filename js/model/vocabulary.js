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
    informant: term('nv', 'informant')
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
 * Canonical participation roles. Following the W3C Property of a Role pattern,
 * a role is asserted alongside the participant on an event.
 */
export const CANONICAL_ROLES = {
    child: NV.child,
    parent: NV.parent,
    mother: NV.mother,
    father: NV.father,
    godParent: NV.godParent,
    informant: NV.informant
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
