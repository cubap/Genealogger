/**
 * The normative JSON-LD context is a promise about the bytes the model writes.
 * These tests keep that promise from drifting: every prefix and every `nv:` or
 * schema.org URI that js/model/vocabulary.js hands to a store must resolve in
 * the context, and every term must carry the rdfs:label / rdfs:comment that
 * make the file self-documenting. A failure here means code and spec disagree,
 * which is exactly the failure this milestone exists to prevent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
    NAMESPACES,
    TYPES,
    NV,
    EVENT_SUBTYPES,
    CANONICAL_ROLES,
    SCHEMA,
    NV_NAME_TYPE,
    NV_ACTIVE_FROM,
    NV_ACTIVE_TO
} from '../../js/model/vocabulary.js'

// Vitest serves modules over http, so import.meta.url is not a filesystem path;
// the test runner's cwd is the repo root.
const FILE = join(process.cwd(), 'schemas', 'genealogger-context.jsonld')
const raw = readFileSync(FILE, 'utf8')
const doc = JSON.parse(raw)
const ctx = doc['@context']

const terms = Object.entries(ctx).filter(([, v]) => v && typeof v === 'object')
const prefixes = Object.entries(ctx).filter(([, v]) => typeof v === 'string')
const local = (uri) => String(uri).split(/[#/]/).pop()
// The context states @ids in compact form ("nv:child"); compare on expanded IRIs.
const expand = (id) => {
    if (!id.includes(':') || id.startsWith('http')) return id
    const [prefix, ...rest] = id.split(':')
    expect(ctx[prefix], `undeclared prefix '${prefix}'`).toBeTruthy()
    return ctx[prefix] + rest.join(':')
}

describe('genealogger JSON-LD context', () => {
    it('is a single context document', () => {
        expect(Object.keys(doc)).toEqual(['@context'])
    })

    it('declares the prefixes the model uses plus the RDF ones it cites', () => {
        for (const [prefix, iri] of Object.entries(NAMESPACES)) {
            expect(ctx[prefix]).toBe(iri)
        }
        for (const cited of ['rdfs', 'rdf', 'xsd']) {
            expect(typeof ctx[cited]).toBe('string')
        }
        expect(prefixes).toHaveLength(Object.keys(NAMESPACES).length + 3)
    })

    it('documents every term with a label and a comment', () => {
        expect(terms.length).toBeGreaterThan(40)
        for (const [key, def] of terms) {
            expect(def['rdfs:label'], `${key} needs rdfs:label`).toBeTruthy()
            expect(def['rdfs:comment'], `${key} needs rdfs:comment`).toBeTruthy()
        }
    })

    it('only compacts against declared prefixes', () => {
        for (const [key, def] of terms) {
            const id = def['@id']
            expect(typeof id, `${key} needs an @id`).toBe('string')
            const [prefix] = id.split(':')
            if (id.includes(':') && !id.startsWith('http')) {
                expect(ctx[prefix], `${key} uses undeclared prefix '${prefix}'`).toBeTruthy()
            }
        }
    })

    it('covers every nv: term the model writes', () => {
        const written = [
            ...Object.values(NV),
            ...Object.values(EVENT_SUBTYPES),
            NV_NAME_TYPE,
            NV_ACTIVE_FROM,
            NV_ACTIVE_TO
        ]
        for (const uri of written) {
            expect(ctx[local(uri)], `${local(uri)} missing from context`).toBeDefined()
            expect(expand(ctx[local(uri)]['@id']), `${local(uri)} maps to the wrong IRI`).toBe(uri)
        }
    })

    it('covers every schema.org fact property', () => {
        for (const uri of Object.values(SCHEMA)) {
            expect(ctx[local(uri)], `${local(uri)} missing from context`).toBeDefined()
            expect(expand(ctx[local(uri)]['@id'])).toBe(uri)
        }
    })

    it('compacts each bare entity type the code writes into @type', () => {
        for (const bare of Object.values(TYPES)) {
            expect(ctx[bare], `${bare} missing from context`).toBeDefined()
        }
    })

    it('maps each canonical role token to its nv: URI', () => {
        for (const [token, uri] of Object.entries(CANONICAL_ROLES)) {
            expect(ctx[token], `role '${token}' missing`).toBeDefined()
            expect(expand(ctx[token]['@id'])).toBe(uri)
        }
        expect(ctx.role['@type']).toBe('@vocab')
    })

    it('types reference-valued terms so bare ids stay URIs', () => {
        for (const key of ['evidence', 'participant', 'target', 'creator', 'hasParent', 'hasChild', 'rel', 'about']) {
            expect(ctx[key]['@type'], `${key} should be @type @id`).toBe('@id')
        }
        expect(ctx.confidence['@type']).toBe('xsd:decimal')
    })

    it('says in prose which terms are derived rather than authoritative', () => {
        // These three are the ones a reader is most likely to start writing to.
        expect(ctx.hasParent['rdfs:comment']).toMatch(/never written/i)
        expect(ctx.hasChild['rdfs:comment']).toMatch(/never written/i)
        expect(ctx.rel['rdfs:comment']).toMatch(/never read as fact/i)
        expect(ctx.label['rdfs:comment']).toMatch(/cache/i)
    })
})
