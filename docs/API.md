# Model and adapter API (`js/model/`, `js/adapters/`)

This is the reference for the public JavaScript surface of the model layer.
Pages import from `js/model/*` only; they never talk to a Store directly, never
build a request body, and never encode a JSON-LD shape (see
[page-model-adapter.md](page-model-adapter.md) for the wiring recipe). Every
`async` model function takes **a single options object** — the signatures below
print the destructured keys, but a call is always `fn({ personId, store })`,
never positional. Every model function accepts an injected `store` and falls back
to `getDefaultStore()` when it is omitted, so a page that called `resolveStore()`
once needs no per-call store argument.

Two notes on how signatures are printed:

- They are copied verbatim from the source, `export` / `async` keywords and
  defaults included. The pure helpers that really do take positional arguments
  (`valueObject`, `valueObjectsFor`, `term`, `typeTokens`, `resolveSubtype`,
  `classifyDate`, `deriveLabel`, `normalizeQuery`, `matchesQuery`, `assertStore`,
  `relOf`, `setDefaultStore`, `resetDefaultStore`, the four `legacy.js`
  converters, and the store constructors and
  methods) are marked "positional" at their definition; everything else is
  `fn(options = {})`.
- Vocabulary values are the strings the code produces. `nv:` expands to
  `https://cubap.github.io/Genealogger/nv#` and `schema:` to
  `https://schema.org/`, so `NV.hasParent` is
  `'https://cubap.github.io/Genealogger/nv#hasParent'` and `SCHEMA.name` is
  `'https://schema.org/name'`.

Glossary words (Person, Event, Record, Annotation, Assertion, Body, ValueObject,
Evidence, Confidence, Contested, Participation, Role, Lacuna, bare label,
derived/assembled view, Store kinds) carry the meanings in
[GLOSSARY.md](../GLOSSARY.md).

## Stores

The contract lives in `js/adapters/store.js`. The model layer reaches
persistence through it and nothing else, so a unit test runs against the
in-memory adapter with no network.

```js
export const STORE_METHODS = ['create', 'read', 'update', 'remove', 'listByType', 'query']

export function assertStore(candidate)

export function relOf(doc)
```

- `assertStore(candidate)` — positional. Throws `TypeError` when `candidate` is
  not an object or is missing any of the six methods, and returns the candidate
  otherwise. Every store factory runs its product through it.
- `relOf(doc)` — positional. The `rel` reverse-index ids an annotation carries,
  normalised to an array of strings: `[]` for a missing or `null` `rel`, a
  one-element array for a scalar, the mapped array for an array. An absent index
  means "no reverse hits", never "match all".

Every method may return a value or a Promise of one; the model layer awaits all
results. Implementations must hand back deep copies so a caller cannot mutate
store-held state.

### The six methods

Signatures from `js/adapters/memory-store.js`, the reference implementation. They
are `class MemoryStore` methods, so none is declared `async` and none takes an
options object.

```js
create(doc)
```
Persists a new bare entity or Annotation, minting `'@id'` with `config.mintId()`
when the document has none. Throws `TypeError` for a non-object and `Error`
(`document already exists: <id>`) when the id is taken. Returns a stored copy.

```js
read(id)
```
Returns a copy of the document, or `null` when the id is unknown.

```js
update(doc)
```
Replaces the stored copy of the document with the same `'@id'`. Throws `Error`
when the `@id` is missing or unknown. Returns a stored copy.

```js
remove(id)
```
Returns the boolean from the underlying `Map.delete(id)`.

```js
listByType(type)
```
Returns copies of every non-annotation whose `'@type'` (string or array) equals
or includes `type`, expanding members of any `@graph`. Annotations are documents
with `type === 'Annotation'` or any `target`; everything else is an entity.

```js
query(filter = {})
```
Annotations matching **all** provided clauses (AND): `target`, `rel`, `type` (a
property URI that must key at least one Body ValueObject) and `value` (compared
with `===` against `vo.value`, scoped to `type` when one is given). Returns
copies.

```js
all()
```
Optional extra, outside `STORE_METHODS`: every stored document.

```js
export class MemoryStore

export function createMemoryStore()
```

`new MemoryStore()` keeps its documents in `this.documents`, a
`Map<string, Object>`. `createMemoryStore()` takes no arguments and returns
`assertStore(new MemoryStore())`.

### Store kinds

```js
export const STORE_KINDS = ['local', 'memory', 'rerum', 'fixture']
```

| Kind | Adapter | Factory | For |
|------|---------|---------|-----|
| `local` | `js/adapters/local-store.js` | `createLocalStore(options)` | localStorage; a save survives a reload with no network. E2E and demos. |
| `memory` | `js/adapters/memory-store.js` | `createMemoryStore()` | No persistence, no DOM. Unit tests and the model layer's zero-setup default. |
| `rerum` | `js/adapters/rerum-store.js` | `createRerumStore(options)` | devstore over HTTP; lazily migrates DEER v1 documents on read. |
| `fixture` | `js/adapters/fixture-store.js` | `createFixtureStore(documents)` | The sample-family fixture seeded into a `MemoryStore`, fixture ids preserved. Loaded by dynamic `import()`. |

```js
export async function createStore(kind, options = {})
```

Maps a kind name to its factory and awaits the result. `options` is forwarded
(`RerumStore` reads `fetchImpl`, `writeBase`, `readBases`, `queryBase`;
`LocalStore` reads `storage`, `key`). `memory` and `fixture` ignore it. `devstore`
is accepted as a third spelling of `rerum` although it is not listed in
`STORE_KINDS`. An unknown kind throws `TypeError`.

```js
export async function resolveStore(options = {})
```

The one place a page decides which Store the model talks to; it installs the
result with `setDefaultStore()` and returns it.

| Option | Type | Meaning |
|--------|------|---------|
| `search` | `string` | The `location.search` string to read `?store=` from. Defaults to `globalThis.location.search` where a `location` exists, else `''`. |
| `fallback` | `string` | Kind to use when there is no `?store=` parameter. |
| `storeOptions` | `Object` | Forwarded to the chosen factory. |

The precedence the code implements is exactly:

```js
const kind = param || options.fallback || (browser ? 'rerum' : 'memory')
```

That is: `?store=` from `search`, then `options.fallback`, then a browser sniff —
`typeof globalThis.localStorage !== 'undefined'` selects `rerum`, otherwise
`memory`. `localStorage` is consulted only as that presence test; no kind is read
out of `localStorage`, and the `local` store's own document key
(`genealogger.localstore.v1`) has nothing to do with selection. `resolveStore` is
also the module's default export.

## Legacy DEER v1 adapter (`js/adapters/legacy.js`)

Read-only conversion from the DEER v1 shapes to the model shapes, so a v1
document can be *read* by every assembled view without being rewritten. The
v1 sources (`js/deer.js`, `js/deer-record.js`, `js/utils/data-utils.js`) were
deleted at the end of M3; the header comment of this module is the record of the
shapes it mirrors. It is marked **TRIMMABLE** — when nothing depends on v1
devstore data, the module is deleted, not extended.

Every conversion is a pure function of the document(s) it is handed, so no unit
test needs a store or a network.

```js
export function convertLegacyEntity(entity)   // positional
```

Splits one v1 entity document into `[bareEntity, ...Annotations]` — the v1
"expanded"/DOM-as-database shape writes facts directly onto the document, and
this fans them back out into Assertions. Returns `[]` for a document with no
`'@id'`. A `@graph` wrapper is unwrapped first: the primary member is the one
whose `'@id'` matches the document, else the first member.

The bare entity keeps `'@id'`, `'@type'` (defaulting to `TYPES.Person`) and a
`label` from `primary.label || primary.name`. A doc-level `additionalType`
(`'Birth'`, `'Death'`, …) is **type metadata, not a fact**: it is appended to
`'@type'` as the Event subtype URI (falling back to substituting the token into
`EVENT_SUBTYPES.Birth`), and the same fold is done for the new shape's
`dcterms:type` mirror — see `isSubtypeMirror()`.

Everything else on the document becomes an Annotation targeting it, keyed by the
mapped property URI:

| v1 key | becomes |
|--------|---------|
| `givenName`, `additionalName`, `alternateName`, `name`, `birthDate`, `birthPlace`, `deathDate`, `deathPlace`, `sex`, `gender`, `homeLocation` | the matching `SCHEMA.*` URI |
| `nickname` | `SCHEMA.alternateName` |
| `hasFather`, `hasMother` | one `NV.hasParent` Assertion each (the v1 distinction survives only in the value, not the property) |
| `hasAgent` | `NV.participant` **plus** `NV.role` from that agent's `additionalType`, matched case-insensitively against `CANONICAL_ROLES`; no role ⇒ `NV.child`, the subject slot both the birth and death reads use |
| `hasGodparent` | `NV.participant` plus `NV.role: NV.godParent` |
| an unrecognised bare key | kept verbatim as its own bare name, so no data is dropped |

Reference values arrive either as a bare id string or embedded as
`{ '@id': …, additionalType: 'mother' }` — both are unwrapped to the id so
downstream id comparisons match, and the qualifiers on the object are read for
the Role. `{ name, source, comment }` on a fact become
`vo.source.citationNote / citationSource / comment`. `@id`, `@type`, `@context`,
`__rerum`, `@graph`, `label`, `name` and `evidence` are not converted into
Assertions.

A converted Annotation's id is minted as
`<entityId>#legacy-<property-slug>-<n>` (or `#legacy-agent-<n>` for
participations). That `#legacy-` in the id is what every assembled view reports
as `legacy: true`. A document-level `evidence` becomes each ValueObject's
`evidence` *and* the Annotation's `dcterms:source` — so an unsourced v1 fact
stays unsourced rather than inventing a Record. **Nothing here mints `rel`**,
which is why reads of v1 data take the `legacyTypes` scan (see
`search.eventsForPerson()`).

```js
export function convertLegacyAnnotation(anno)   // positional
```

Converts one v1 Web Annotation, or returns `null` when the document is not one
(no `type: 'Annotation'`, no `target`, no `body`) or when nothing in the `body`
survives conversion. Keys are mapped exactly as above, `anno.evidence` fills any
ValueObject that lacks evidence and is copied to `dcterms:source`, and
`motivation` / `creator` pass through unchanged.

```js
export function isSubtypeMirror(doc, key)   // positional
```

True when `key` is `dcterms:type` and its value is a string already listed in
`doc['@type']` — i.e. the subtype mirror `rerum-store.js` writes for v1 tooling,
which must not become a pseudo-Assertion. Exported because the read path that
detects legacy documents needs the same exemption.

```js
export function readDevstoreJson(jsonArray)   // positional
```

Dispatches a whole dump: `type: 'Annotation'` documents go to
`convertLegacyAnnotation()`, anything with an `'@id'` goes to
`convertLegacyEntity()`, and the results are flattened into one array of
new-shape documents. Throws `TypeError` when the argument is not an array. This
is the function to call on a hand-converted fixture; it never fetches.

```js
export async function loadLegacy(ids, { fetchImpl = globalThis.fetch, baseUrl } = {})
```

Fetches each id (`http`-prefixed ids are used as given, otherwise appended to
`baseUrl`, which defaults to `config.URLS.BASE_URI`) and runs the whole haul
through `readDevstoreJson()`. Throws `TypeError` when no fetch implementation is
available, so a Node test injects one. It is a read helper only: nothing it
returns is written back.


`js/model/assertions.js` — create, resolve and list Annotations (assertions) on a
target. Conflicting assertions of the same property on the same target always
coexist as separate annotations; nothing here overwrites or dedupes. No default
export.

```js
export function valueObject(value, { source, evidence, confidence } = {})
```

Positional: a value plus a metadata object.

| Argument | Type | Meaning |
|----------|------|---------|
| `value` | `*` | The asserted value (string, number, entity id, …). |
| `source` | `Object` | Citation metadata. Kept only when at least one of `citationSource`, `citationNote`, `comment` is truthy, and only those truthy keys are copied. |
| `evidence` | `string` | id of the Record or Event supporting the claim. Copied when truthy. |
| `confidence` | `number` | Written under the `NV.confidence` key. Validated whenever it is not `undefined`. |

Returns a ValueObject: `{ value, source?, evidence?, [NV.confidence] }`. Throws
`RangeError('nv:confidence must be a number between 0 and 1')` for a defined
`confidence` that is not a number in `[0, 1]`.

```js
export async function assert(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `target` | `string` | Required. id of the annotated entity. |
| `property` | `string` | Required. Property key being asserted. |
| `value` | `*` | Asserted value. |
| `source` | `Object` | ValueObject citation metadata. |
| `evidence` | `string` | Evidence document id. Also mirrored onto the annotation's `http://purl.org/dc/terms/source`. |
| `confidence` | `number` | Confidence for the ValueObject. |
| `motivation` | `string` | OA motivation; omitted when falsy. |
| `creator` | `string` | Attributing agent; omitted when falsy. |
| `rel` | `string \| Array<string>` | Reverse-index ids, stored as an array. Written whenever defined (`!== undefined`), including an empty array. |

Returns the Annotation from `store.create`:
`{ '@id', type: 'Annotation', target, body: { [property]: ValueObject }, motivation?,
creator?, rel?, 'http://purl.org/dc/terms/source'? }`. Throws `TypeError` when
`target` or `property` is missing.

```js
export async function list(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `target` | `string` | Required. |
| `property` | `string` | Keep only annotations whose Body has this key. |

Returns `store.query({ target })` filtered by `property` when one is given, in
stored order.

```js
export function valueObjectsFor(annotation, property)
```

Positional. The ValueObject(s) one annotation asserts for one property, cloned.
Returns `[]` when the Body has no such key; a lone ValueObject comes back as a
one-element array.

```js
export async function resolve(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `target` | `string` | Required. |

Returns a property → ValueObject(s) map: every Body key across every annotation
targeting `target`, each mapped to the ValueObjects asserted for it. A property
with exactly one ValueObject is returned as that object; more than one is returned
as an array. Values are never merged.

## birth.js

`js/model/birth.js` — the birth slice's use-case layer: the two operations the
birth page performs, composed from the primitives. No fetching, no DOM.

```js
export const PROPERTY_LABELS = {
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.alternateName]: 'Alternate name(s)',
    [SCHEMA.birthDate]: 'Date of birth',
    [SCHEMA.birthPlace]: 'Place of birth',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.sex]: 'Sex',
    [NV.hasParent]: 'Parent',
    label: 'Label'
}
```

Human labels for the properties the birth read view surfaces, keyed by property.

```js
export const ROLE_TOKENS = {
    child: NV.child,
    parent: NV.parent,
    mother: NV.mother,
    father: NV.father,
    godparent: NV.godParent,
    informant: NV.informant
}
```

Form token → canonical Role URI, for `saveBirth({ participants })`. An
unrecognised token is passed through verbatim, so it becomes a Role that
`deriveParentAssertions()` will not recognise.

```js
export async function saveBirth(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Existing child Person; omit to create one labelled from `name`, or `'Unnamed person'`. |
| `name` | `Object` | `{ given, family, additional, alternate, full }`. |
| `gender` | `string` | Asserted under `SCHEMA.gender`. |
| `birthDate` | `string` | Asserted under `SCHEMA.birthDate`. |
| `birthPlace` | `string` | Asserted under `SCHEMA.birthPlace`. |
| `evidence` | `Object` | Required: `{ title, id?, confidence? }`. `id` reuses a Record; otherwise one is created under `TYPES.Record`. |
| `confidences` | `Object` | Per-field Confidence overrides keyed by field name (`'name.given'`, `'birthDate'`, …). |
| `confidence` | `number` | Default Confidence for facts without an override. |
| `participants` | `Array<Object>` | `{ role, agentId?, name?, label?, confidence? }`. `role` is a `ROLE_TOKENS` key or a URI, and falls back to `NV.parent`. Without `agentId` a Person is created from `name`/`label`. |
| `subtype` | `string` | Event subtype token or URI; `'Birth'` by default. |

Writes, in order: the Record, the child Person, the Birth Event labelled
`Birth of <child>` and evidenced by the Record, the child's Participation as
`NV.child`, one Participation per participant entry, one `assertOutcome`
Assertion per populated fact, then `deriveParentAssertions()`. Returns
`{ personId, eventId: event['@id'], recordId }`. Throws `TypeError` when
`evidence` names no document.

```js
export async function loadBirth(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. |

Returns the assembled view, or `null` when the id is not a Person:
`{ personId, label, legacy, view, events, assertions, evidenceLabels, personLabels }`
— `view` is `getPerson()`'s result; `events` has one entry per birth-family Event
this person was the `NV.child` of, each
`{ event, subtype, record, participants }` with `record` being
`{ id, confidence }` or `null` and `participants` the `participations()` rows;
`assertions` the resolved assertion map; `evidenceLabels` and `personLabels`
id → display-string maps (an id with no label maps to the id); `legacy` true when
any annotation id carries `#legacy-`. An Event's own id is aliased to the label of
the Record behind it in `evidenceLabels`.

```js
export default { saveBirth, loadBirth, PROPERTY_LABELS, ROLE_TOKENS }
```

Default-export convention only; nothing imports it. Callers use the named
bindings.

## config.js

`js/model/config.js` — the model layer's configuration. Performs no I/O. This is
the only `js/model/*` module that is actually default-imported anywhere in the
repository (`js/adapters/memory-store.js`, `js/adapters/rerum-store.js` and two
test files; `js/adapters/legacy.js` reaches the same default through a dynamic
`import('../model/config.js')`).

```js
export const config = {
    URLS: {
        BASE_URI: 'https://devstore.rerum.io/v1',
        READ_BASE_URIS: ['https://devstore.rerum.io/v1'],
        API_BASE: 'https://tinydev.rerum.io'
    },
    ID_BASE: 'https://devstore.rerum.io/v1/id/',
    ID_BASES: ['https://devstore.rerum.io/v1/id/'],
    READ_ID_BASES: ['https://devstore.rerum.io/v1/id/'],
    mintId() {
        return `${this.ID_BASE}${uuid()}`
    }
}
```

| Key | Meaning |
|-----|---------|
| `URLS.BASE_URI` | Document host served by GET (`<BASE_URI>/id/<hex>`). |
| `URLS.READ_BASE_URIS` | Bases `RerumStore` tries on reads, in order. |
| `URLS.API_BASE` | The write/query service (POST `/create`, POST `/query`, PUT `/update`). Not the same host as `BASE_URI`. |
| `ID_BASE` | Prefix minted ids are built under. |
| `ID_BASES` | id bases this model recognises as its own. |
| `READ_ID_BASES` | id bases consulted on reads. |
| `mintId()` | Returns `ID_BASE` plus an RFC4122 v4-style uuid (`crypto.randomUUID` when available). |

```js
export default config
```

## death.js

`js/model/death.js` — the death slice's use-case layer, the mirror of `birth.js`:
create/find the deceased, name the Record, create a Death (or Burial) Event
evidenced by it, record the participants with their Roles, assert each fact with
its own Confidence, and derive parentage when the record names parents. No
fetching, no DOM.

```js
export const PROPERTY_LABELS = {
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.alternateName]: 'Alternate name(s)',
    [SCHEMA.deathDate]: 'Date of death',
    [SCHEMA.deathPlace]: 'Place of death',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.sex]: 'Sex',
    [NV.hasParent]: 'Parent',
    label: 'Label'
}

export const ROLE_TOKENS = {
    child: CANONICAL_ROLES.child,
    parent: CANONICAL_ROLES.parent,
    witness: CANONICAL_ROLES.witness,
    attendant: CANONICAL_ROLES.attendant,
    informant: CANONICAL_ROLES.informant
}
```

`ROLE_TOKENS` is the participant-role map for `saveDeath({ participants })`;
recognised tokens become canonical Role URIs and an unrecognised one passes
through verbatim. An entry with no role at all becomes `ROLE_TOKENS.witness`.

```js
export async function saveDeath(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Existing deceased; omit to create a Person labelled from `name`, or `'Unnamed person'`. |
| `name` | `Object` | `{ given, family, additional, alternate, full }`. |
| `gender` | `string` | Asserted under `SCHEMA.gender`. |
| `deathDate` | `string` | Asserted under `SCHEMA.deathDate`. |
| `deathPlace` | `string` | Asserted under `SCHEMA.deathPlace`. |
| `evidence` | `Object` | Required: `{ title, id?, confidence? }`. `id` reuses a Record; otherwise one is created under `TYPES.Record`. |
| `confidences` | `Object` | Per-field Confidence overrides keyed by field name (`'name.given'`, `'deathDate'`, …). |
| `confidence` | `number` | Default Confidence when `evidence.confidence` and a per-field override are absent. |
| `participants` | `Array<Object>` | `{ role, agentId?, name?, label?, confidence? }`; falsy entries and entries with no label are skipped. |
| `subtype` | `string` | Event subtype token or URI; `'Death'` by default. |

Writes the Record, the deceased Person, the Event labelled `Death of <deceased>`,
the deceased's own Participation as `NV.child`, one Participation per participant
entry, one `assertOutcome` Assertion per populated fact, then
`deriveParentAssertions()`. Returns `{ personId, eventId, recordId }`. Throws
`TypeError` when `evidence` names no document.

```js
export async function loadDeath(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. |

Returns `{ personId, label, legacy, view, events, assertions, evidenceLabels,
personLabels }`, or `null` when the id is not a Person. `events` has one entry per
death-family Event this person was the subject of —
`{ event, subtype, record, participants }`, `subtype` defaulting to
`EVENT_SUBTYPES.Death`, `record` being `{ id, confidence }` or `null` — and the
read reaches DEER v1 deaths by enumerating Death- and Burial-typed events when the
`rel` index yields nothing. Death-family subtypes recognised here are `Death` and
`Burial`.

`SCHEMA.deathDate` and `SCHEMA.deathPlace` are back-filled into `assertions` from
the Event's own Annotations when the person carries neither, because DEER v1 posted
those facts onto the Event document; their `evidence` stays the event id, which
`evidenceLabels` aliases to the label of the Record evidencing that event.

```js
export default { saveDeath, loadDeath, PROPERTY_LABELS, ROLE_TOKENS }
```

Default-export convention only; nothing imports it.

## default-store.js

`js/model/default-store.js` — the shared lazy store singleton behind every
`store` fallback in this API.

```js
export function getDefaultStore()
```

Returns the process-wide Store, building a `createMemoryStore()` on first use.

```js
export function setDefaultStore(store)
```

Positional. Runs `store` through `assertStore()` and installs it as the default.
Returns the installed store.

```js
export function resetDefaultStore(store = null)
```

Positional. Installs `store`, or a fresh memory store when it is falsy. Returns
the new default. Used by tests to clear state.

## entities.js

`js/model/entities.js` — create and read bare entities. A bare Person carries
identity only (`@id`, `@type`, the `label` cache); every fact about it lives in
Annotations. No default export.

```js
export async function createEntity(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `'@type'` | `string \| Array<string>` | Required. Entity type(s), e.g. `'Person'`. |
| `label` | `string` | Cheap display string; omitted when falsy. |
| `extra` | `Object` | Merged onto the bare entity (identity-adjacent properties only). |

Every other key lands in `rest` and is read only as an alternate spelling of
`'@type'`. Returns the stored entity from `store.create()`. Throws `TypeError`
without a type.

```js
export async function createPerson(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `label` | `string` | Required. The bare label, and the value of the label Assertion. |
| `evidence` | `string` | id of the Record or Event that created the person. |
| `confidence` | `number` | Confidence for the label claim. |
| `source` | `Object` | Citation metadata for the label. |

Creates `{ '@type': 'Person', label }` and then asserts `property: 'label'` on it,
so the bare label keeps its provenance. Returns the stored bare Person. Throws
`TypeError` unless `label` is a string.

```js
export async function readEntity(options = {})
```

`{ store, id }`; `id` required. Returns `store.read(id)` — the entity, or `null`
when unknown.

```js
export async function listEntities(options = {})
```

`{ store, type }`; `type` required. Returns `store.listByType(type)`.

```js
export const LABEL_PROPERTY = 'label'

export const FULL_NAME_PROPERTY = SCHEMA.name
```

`LABEL_PROPERTY` is the bare (non-URI) Body key used for the cheap display name;
`FULL_NAME_PROPERTY` is the schema.org full-name URI. See "Cross-cutting
invariants".

## events.js

`js/model/events.js` — first-class Event entities, their own evidence
Assertions, Participation, and derivation of person-side assertions from event
outcomes. An Event's `'@type'` is `['Event', <subtype URI>]`. No default export.

```js
export function resolveSubtype(subtype)
```

Positional. Normalises `'Birth'`, `'nv:Birth'` or a full URI to the subtype URI. A
token containing `#` or `/` is returned unchanged; an unknown bare word is built by
substituting into the `nv:Birth` URI. Throws `TypeError` for a non-string or empty
input.

```js
export async function createEvent(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `subtype` | `string` | Required by `resolveSubtype()`. `'Birth'`, `'Christening'`, a URI, … |
| `label` | `string` | Event display label; omitted when falsy. |
| `evidence` | `string` | Record id evidencing the event; when given, one provenance Assertion is written. |
| `confidence` | `number` | Confidence carried by that provenance Assertion. |

Returns the stored Event:
`{ '@id', '@type': ['Event', <uri>], 'http://purl.org/dc/terms/type': <uri>, label? }`.

```js
export async function eventProvenance(options = {})
```

`{ store, event }` where `event` is an Event entity or an id. Returns the first
`{ evidence: vo.value, confidence: vo[NV.confidence] }` from the event's
`DCTERMS.source` Annotations, or `{}` when it has none. Throws `TypeError` without
an event id.

```js
export async function participate(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `event` | `string \| Object` | Required. Event entity or id. |
| `agent` | `string` | Required. Participating Person id. |
| `role` | `string` | Required. Canonical Role URI (`NV.child`, `NV.parent`, …). |
| `evidence` | `string` | Record id evidencing the Participation; also mirrored to the annotation's `DCTERMS.source`. |
| `confidence` | `number` | Written as `vo[NV.confidence]` when not `undefined`. |

Returns the stored Participation Annotation, whose Body asserts `NV.participant`
and `NV.role` and whose top-level `rel` is `[agent, eventId]`. Throws `TypeError`
when `event`, `agent` or `role` is missing.

```js
export async function participations(options = {})
```

`{ store, event }` (entity or id). Returns one row per `NV.participant`
ValueObject on the event: `{ agent, role, evidence, confidence }`, where `role` is
the first `NV.role` ValueObject's value (or `undefined`).

```js
export async function assertOutcome(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `event` | `string \| Object` | Required. The Event asserting the outcome; becomes the Assertion's `evidence`. |
| `target` | `string` | Person (or other entity) id receiving the Assertion. Passed through unchecked. |
| `property` | `string` | Property key, e.g. `SCHEMA.birthDate`. Passed through. |
| `value` | `*` | Asserted value. |
| `source` | `Object` | Citation metadata. |
| `confidence` | `number` | Override; when `undefined` it is inherited from `eventProvenance()`. |

Returns the stored Annotation from `assert()`. One call per property.

```js
export async function deriveParentAssertions(options = {})
```

`{ store, event, confidence }`. Returns the array of created `nv:hasParent`
Annotations: one per (`NV.child` participant × participant in a parent role) pair,
each targeting the child with `evidence` set to the event id and
`rel: [child, parent]`, at the event's provenance Confidence unless overridden.
Parent roles are `NV.parent`, `NV.mother`, `NV.father`. Conflicting derivations
coexist. Throws `TypeError` without an event id.

## label.js

`js/model/label.js` — the label page's use-case layer: what a Person is called,
and keeping the denormalized bare `label` cache honest when a new name is
recorded.

```js
export const PROPERTY_LABELS = {
    [FULL_NAME_PROPERTY]: 'Full name',
    [LABEL_PROPERTY]: 'Label'
}
```

The two kinds of claim this page audits: the formal `schema.org/name` and the
bare-`label` Assertion `createPerson()` records.

```js
export async function loadLabel(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. |

Returns `{ personId, entity, label, listLabel, cacheStale, legacy, names,
evidenceLabels, view }`, or `null` when the id is not a Person. `label` is what
`personLabel()` renders and `listLabel` what `deriveLabel()` gives a list row;
`cacheStale` is `label !== listLabel`. `names` is the name-property slice of
`resolve()`'s map, in that shape. `evidenceLabels` maps each name claim's evidence
id to that document's label, falling back to the id. `view` is `getPerson()`'s
result.

```js
export async function saveLabel(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. This page never creates a Person. |
| `name` | `string` | Required after trimming. The display name to record. |
| `evidence` | `Object` | Required: `{ title }` to name a new Record, or `{ id }` to reuse one. |
| `confidence` | `number` | Confidence for the name Assertion. |

Asserts-only: never dedupes or overwrites. The cache write happens **before** the
Assertion, and the id the store returns is adopted as the person's id. Returns
`{ personId, recordId, annotationId, label, cacheUpdated, cacheSkipped }`.
`cacheSkipped` is `'unchanged'` when the cache already held that string and
`'legacy'` when the person is still served as a DEER v1 document whose inline facts
an update would replace; `cacheUpdated` is true when the cache was written. Throws
`TypeError` for a missing person, an empty name or unnamed evidence, and `Error`
when no Person is found at `personId`.

```js
export default { saveLabel, loadLabel, PROPERTY_LABELS }
```

Default-export convention only; nothing imports it.

## lacunae.js

`js/model/lacunae.js` — a Lacuna marks an expected-but-unrecorded slot ("birth
mother unknown") as an ordinary `nv:Lacuna` Assertion, so it resolves like every
other claim. No default export.

```js
export async function markLacuna(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `target` | `string` | id of the entity with the gap. Not validated here; `assert()` throws `TypeError` when it is missing. |
| `value` | `string` | Required. Description of the gap. |
| `about` | `string` | When truthy, written as `body[NV.Lacuna].about`: the property URI of the empty slot. |
| `…rest` | — | Any other key (`evidence`, `source`, `confidence`, `motivation`, `creator`, `rel`) is forwarded to `assert()`. |

Returns the Annotation from `store.update()`. The Annotation is written **twice on
every call**, `about` or not: `assert()` creates it and `store.update()` then
replaces it, so on a versioning store one call produces two document versions.

```js
export async function lacunaeOn(options = {})
```

`{ store, target }`. Returns the target's Lacunae as ValueObjects
(`search.valuesOf` filtered to `NV.Lacuna`).

## parents.js

`js/model/parents.js` — the parents slice's use-case layer. Parentage is a
Birth-type Event with Roles, never a column on a Person.

```js
export const ROLE_TOKENS = {
    child: CANONICAL_ROLES.child,
    parent: CANONICAL_ROLES.parent,
    mother: CANONICAL_ROLES.mother,
    father: CANONICAL_ROLES.father
}
```

Accepted parent-position tokens for `saveParents({ parents })`. `child` is included
so a caller cannot record the child as one of its own parents; an entry resolving
to `NV.child` is skipped.

```js
export async function birthEventsOfChild(options = {})
```

`{ store, personId }`; `personId` required. Returns the birth-family Events this
person appears in as `NV.child`, each
`{ id, event, label, subtype, recordId, confidence, participants }` — `participants`
are `participations()` rows, `recordId` and `confidence` come from
`eventProvenance()`, and `subtype` is the canonical URI or `null`. DEER v1 events
are picked up through `legacyTypes`.

```js
export async function loadParents(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. The CHILD whose parents this shows. |

Returns `{ personId, label, legacy, view, events, parents, children, residence,
evidenceLabels, personLabels }`, or `null` when the id is not a Person.

- `parents` — one row per derived claim, two disagreeing sources for the same
  mother being two rows: `{ agentId, label, role, roleLabel, eventId, eventLabel,
  subtype, confidence, recordId, recordLabel, migrated }`, sorted mother → father
  → generic parent, then by label.
- `children` — the computed inverse, one row per claim:
  `{ childId, label, eventId, confidence, recordLabel, migrated }`.
- `residence` — `{ value, confidence, recordLabel, migrated }` per
  `SCHEMA.homeLocation` claim.
- `migrated` — true when the claim has no Event of this person behind it, i.e. it
  came from a DEER v1 `hasFather`-style property.
- `events` — `birthEventsOfChild()`'s result, plus any event a row references.

```js
export async function saveParents(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. The existing child. |
| `parents` | `Array<Object>` | `{ role, agentId?, name?, label?, confidence? }`; blank rows are ignored. |
| `evidence` | `Object` | Required: `{ title, id?, confidence? }` naming the Record. |
| `residence` | `string` | `SCHEMA.homeLocation` asserted by the same source. |
| `confidence` | `number` | Default Confidence (`evidence.confidence` wins). |
| `subtype` | `string` | Event subtype; `'Birth'` by default. |

Reuses the birth-family Event this Record already evidences, or creates one, so two
parents from one certificate land on one Event and a different Record produces a
second Event whose disagreement stays visible. Each Participation and each derived
`nv:hasParent` claim is written at most once. Returns
`{ personId, eventId, recordId, participants, derived }`, where `participants` is
`{ agentId, role, id }` per Participation actually written and `derived` the created
`nv:hasParent` Annotations. Nothing is written onto the Person document, and
`nv:hasChild` is never stored.

```js
export default { loadParents, saveParents, birthEventsOfChild, ROLE_TOKENS }
```

Default-export convention only; nothing imports it.

## person.js

`js/model/person.js` — the assembled Person view, plus the name write path. No
default export.

```js
export async function getPerson(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `id` | `string` | Required. Person entity id. |

Returns `{ entity, label, assertions, parents, children, lacunae }`, or `null` when
the id is unreadable or its `'@type'` (string or array) is not `'Person'`. `label`
comes from `personLabel({ entity, assertions })`. `assertions` is `resolve()`'s map;
`parents` the stored `nv:hasParent` ValueObjects; `children` the computed inverse;
`lacunae` the `NV.Lacuna` ValueObjects.

```js
export const PROPERTY_LABELS = {
    label: 'Label',
    [SCHEMA.name]: 'Full name',
    [SCHEMA.givenName]: 'Given name',
    [SCHEMA.additionalName]: 'Middle name(s)',
    [SCHEMA.familyName]: 'Family name',
    [SCHEMA.alternateName]: 'Alternate name',
    [SCHEMA.birthDate]: 'Date of birth',
    [SCHEMA.birthPlace]: 'Place of birth',
    [SCHEMA.deathDate]: 'Date of death',
    [SCHEMA.deathPlace]: 'Place of death',
    [SCHEMA.sex]: 'Sex',
    [SCHEMA.gender]: 'Gender',
    [SCHEMA.homeLocation]: 'Residence',
    [NV.hasParent]: 'Parent'
}

export const ASSERTION_ORDER = Object.keys(PROPERTY_LABELS)
```

`ASSERTION_ORDER` is the audit view's order: names, then vital facts, then
parentage.

```js
export async function assertPersonName(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Existing Person; omit to create one labelled from `value`. |
| `value` | `string` | Required after trimming. The name as written in the source. |
| `property` | `string` | Name property URI; `SCHEMA.name` by default. Must be one of `NAME_PROPERTY_TOKENS`' values. |
| `nameType` | `string` | e.g. `'married name'`; written as `vo[NV_NAME_TYPE] = { value }`. |
| `activeFrom` | `string` | ISO date; written as `vo[NV_ACTIVE_FROM] = { value }`. |
| `activeTo` | `string` | ISO date; written as `vo[NV_ACTIVE_TO] = { value }`. |
| `evidence` | `Object` | Required: `{ title, id? }` — the Record naming the source. |
| `confidence` | `number` | Confidence for the claim. |
| `comment` | `string` | Kept in the ValueObject's `source.comment`. |

Returns `{ personId, recordId, annotationId }`. Qualifiers ride inside the
ValueObject, so two disagreeing name claims keep their own type and range. Throws
`TypeError` for a nameless claim, unnamed evidence, or a `property` outside the name
tokens, and `RangeError` when `activeFrom` sorts after `activeTo`. For an existing
person the bare `label` cache is refreshed too — a full-name write sets it, a part
write only fills an absent cache — and is left alone when the person still holds
DEER v1 facts.

```js
export async function loadPerson(options = {})
```

`{ store, personId }`; `personId` required. Returns
`{ personId, label, legacy, view, assertions, evidenceLabels, personLabels, parents,
children, lacunae }`, or `null` when the id is not a Person. `evidenceLabels` maps
each evidence id to a document label (the id itself when nothing displayable is
found), aliasing an Event's id to the label of the Record behind it; `personLabels`
maps each linked parent/child id to its `deriveLabel()` string. `legacy` is true
when any annotation id carries `#legacy-`.

## search.js

`js/model/search.js` — read helpers over the Store: index and picker reads,
find-by-assertion, a Person's Events, and the derived parent/child edges. Per its
module doc, `nv:hasChild` "exists ONLY here, computed at read time from stored
`nv:hasParent` assertions — it is never written." No default export.

```js
export async function assertionsOn(options = {})
```

`{ store, targetId, type }`. Returns `assertions.list()` for that target, optionally
filtered to the `type` property key.

```js
export async function valuesOf(options = {})
```

`{ store, targetId, type }`; `type` is required in practice — it is both the
annotation filter and the Body key. Returns every coexisting ValueObject asserted
for that one property on that target, unmerged.

```js
export async function personsByAnnotationType(options = {})
```

`{ store, type }`; `type` required. Returns every bare Person entity with at least
one Assertion of that property key. Costs one `listByType` plus a `query` per
person.

```js
export async function eventsForPerson(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `personId` | `string` | Required. |
| `role` | `string` | Optional canonical Role filter, matched against the Body's `NV.role`. |
| `legacyTypes` | `Array<string>` | `'@type'` tokens to enumerate when the `rel` index is empty. Include both the bare v1 token (`'Birth'`) and the URI. |

Returns Event entities. The normal read is one `rel` lookup
(`query({ rel: personId, type: NV.participant })`), de-duplicated by target and
role-filtered from the Body. When it yields nothing **and** `legacyTypes` is
non-empty, it falls back to `eventsWithoutIndex()`.

```js
export async function eventsWithoutIndex(options = {})
```

`{ store, personId, role, legacyTypes = [] }`; `personId` required. The bounded scan
behind `legacyTypes`: `listByType` per token plus per-event `participations()`
matching on `agent` (and `role`). Returns Event entities.

```js
export async function parentsOf(options = {})
```

`{ store, personId }`. Returns the `nv:hasParent` ValueObjects asserted on the
person; each `value` is a parent id. Conflicting parents are all returned, each with
its own evidence.

```js
export async function childrenOf(options = {})
```

`{ store, personId }`; `personId` required. Returns the computed inverse as
`{ ...vo, target }` rows — each `value` equals `personId` and each `target` is a
child id — recovered from the `rel` reverse index of stored `nv:hasParent`
Assertions. Nothing is written.

```js
export const UNLABELED = '[ unlabeled ]'
```

What a Person shows in a list when its identity carries nothing displayable.

```js
export function personLabel(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `entity` | `Object` | A bare Person entity, in any identity shape. |
| `assertions` | `Object` | `resolve()`'s map. Omit it for the cheap list read, which then sees identity data only. |

**The one label rule.** Preference order: `label` on the entity, then
`assertions.label`, then a bare or `SCHEMA.name` `name` (entity, then assertion),
then given + additional + family (asserted first, then bare identity properties,
then the unmapped v1 bare keys `givenName` / `additionalName` / `familyName`), then
`UNLABELED`. Name parts are joined with a space. Returns a string and never throws
on odd input; only one readable value is used for display — conflicts are not
merged or ranked.

```js
export function deriveLabel(entity)
```

Positional — a bare Person entity, not an options object. Literally
`personLabel({ entity })`: the identity-only list label. A list row must never
resolve an Annotation to get one.

```js
export function normalizeQuery(query)
```

Positional. Lowercase, trimmed, whitespace-split tokens. Returns `[]` for an empty
or missing query.

```js
export function matchesQuery(label, query)
```

Positional. True when every token of `query` appears in `label` as a
case-insensitive substring; an empty query matches everything.

```js
export async function listPersons(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `query` | `string` | Filter text; every token must be in the label. |
| `sort` | `boolean` | Sort rows by label A-Z. `true` by default. |

Returns `Array<{ id, label, entity }>` from **one** `listByType` read, labels via
`deriveLabel()`. Limitation stated in the source: devstore returns at most 10
documents with no paging, so this lists at most 10 people and the sort orders only
that sample; there is also no collection scoping, so it sees every Person in the
shared sandbox.

## timeline.js

`js/model/timeline.js` — the ancestor-timeline reads: walk the ancestor chain with
the derived reads and return plain rows. No default export.

```js
export const DEFAULT_MAX_GENERATION = 4
```

Generations above the subject walked when `maxGeneration` is omitted.

```js
export function classifyDate(raw)
```

Positional. Classifies one raw asserted date value into a plottable point. Returns
`{ display, year, precision, span, estimated }`, where `precision` is `'day'`,
`'range'`, `'month'`, `'year'` or `'approximate'`, `span` is `[from, to]` only for a
range, and `estimated` is set from a leading hedge (`circa`, `c.`, `ca.`, `abt.`,
`about`, `approx.`, `est.`, `estimated`, `assumed`, `calc.`, `calculated`). Returns
`null` for `null`, `undefined`, whitespace-only input, or a value carrying no 3- or
4-digit year — the caller then keeps the assertion undated rather than dropping it.

```js
export async function loadAncestorTimeline(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Passed straight through to the primitives, which apply their own `getDefaultStore()` fallback. This is the one model function whose destructuring has no `= getDefaultStore()`. |
| `personId` | `string` | Required. Subject Person id. |
| `maxGeneration` | `number` | Generations of ancestors to walk; `DEFAULT_MAX_GENERATION` by default. |

Returns `{ personId, label, people, items, undated, legacy }`:

- `people` — the walked chain as `{ id, label, generation, subject }`.
- `items` — one dated Assertion each: `{ id, personId, label, generation, eventId,
  eventLabel, eventSubtype, role, roleLabel, property, display, year, precision,
  span, estimated, estimatedNote, confidence, evidenceId, evidenceLabel }`.
- `undated` — events and facts with no parseable year. A row for a dated-property
  assertion carries the `items` fields plus `persons`; a row for an Event with no
  dates at all carries `{ id, eventId, display, eventLabel, eventSubtype,
  evidenceId, persons }`.
- `legacy` — true when any annotation id seen carries `#legacy-`.

Disputes are preserved: two sources asserting different dates produce two rows.

## tree.js

`js/model/tree.js` — the family-tree read: nodes and edges assembled from derived
reads only, upward from `parentsOf()` and downward from `childrenOf()`. Nothing in
this module reads or writes a stored `nv:hasChild` — "the parent→child edge exists
exactly once on the wire, in the child's hasParent assertion."

```js
export const DEFAULT_MAX_GENERATIONS = 2
```

Generations shown above **and** below the root unless `maxGenerations` overrides it.

```js
export async function loadTree(options = {})
```

| Option | Type | Meaning |
|--------|------|---------|
| `store` | `Store` | Defaults to `getDefaultStore()`. |
| `rootId` | `string` | Required. The person the tree is drawn around. |
| `maxGenerations` | `number` | Generations in both directions. A finite value is truncated toward zero and floored at 0; a non-finite one falls back to `DEFAULT_MAX_GENERATIONS`. |

Returns `{ rootId, rootLabel, maxGenerations, nodes, edges }`, or `null` when
`rootId` resolves to nothing. `nodes` is `{ id, label, gen, contested }` sorted by
generation, then label, then id. `edges` is `{ from, to, role, evidence,
evidenceLabel, contested }`, `role` present only when a parent Role was found, and
deduplicated on `from>to`. A person is `contested` when its parent claims span two
evidence documents, exceed two distinct parents, or name two different people for
the same Role; every claim still becomes its own edge. Fan-out is bounded by
`maxGenerations`, and label, evidence and person reads are cached per call. DEER v1
downward edges exist only when the tree is rooted through the child, because v1
documents carry no `rel`.

```js
export default { loadTree, DEFAULT_MAX_GENERATIONS }
```

Default-export convention only; nothing imports it.

## vocabulary.js

`js/model/vocabulary.js` — the controlled vocabulary. Standard ontologies
(schema.org, dcterms, OA, PROV, geo, time) are preferred wherever a term exists
there; only Eventities-specific terms are minted in `nv:`. No default export.

```js
export const NAMESPACES = {
    nv: 'https://cubap.github.io/Genealogger/nv#',
    schema: 'https://schema.org/',
    dcterms: 'http://purl.org/dc/terms/',
    oa: 'http://www.w3.org/ns/oa#',
    prov: 'http://www.w3.org/ns/prov#',
    geo: 'http://www.w3.org/2003/01/geo/wgs84_pos#',
    time: 'http://www.w3.org/2006/time#'
}

export function term(prefix, local)
```

Positional. Expands a prefix and local name to a full term URI; throws `Error` for
an unknown prefix.

```js
export const TYPES = {
    Person: 'Person',
    Event: 'Event',
    Record: 'Record',
    Place: 'Place',
    Annotation: 'Annotation'
}
```

Bare entity and Annotation types, kept plain for devstore shape compatibility.

```js
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
```

`NV.hasChild` is declared here and used nowhere else in `js/model/` or
`js/adapters/` — the inverse edge is computed instead.

```js
export const EVENT_SUBTYPES = {
    Birth: term('nv', 'Birth'),
    Christening: term('nv', 'Christening'),
    Baptism: term('nv', 'Baptism'),
    Death: term('nv', 'Death'),
    Burial: term('nv', 'Burial'),
    Marriage: term('nv', 'Marriage'),
    Census: term('nv', 'Census')
}

export function typeTokens(...subtypes)
```

Variadic, not an options object: type URIs or arrays of them. Returns each URI
followed by its bare fragment (`'Birth'`), de-duplicated — the spellings both
document generations store under, since devstore matches `'@type'` exactly.

```js
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
```

Every Role token the model recognises; `js/adapters/legacy.js` builds its
case-insensitive v1 `additionalType` mapping from these keys.

```js
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

export const NV_NAME_TYPE = term('nv', 'nameType')
export const NV_ACTIVE_FROM = term('nv', 'activeFrom')
export const NV_ACTIVE_TO = term('nv', 'activeTo')

export const QUALIFIER_LABELS = {
    [NV_NAME_TYPE]: 'type',
    [NV_ACTIVE_FROM]: 'from',
    [NV_ACTIVE_TO]: 'to'
}

export const NAME_PROPERTY_TOKENS = {
    full: SCHEMA.name,
    given: SCHEMA.givenName,
    family: SCHEMA.familyName,
    additional: SCHEMA.additionalName,
    alternate: SCHEMA.alternateName
}

export const NAME_TYPE_TOKENS = [
    'birth name', 'married name', 'nickname', 'adopted name', 'religious name',
    'professional name', 'alias', 'customary name', 'other name'
}

export const DCTERMS = {
    source: term('dcterms', 'source'),
    created: term('dcterms', 'created'),
    modified: term('dcterms', 'modified'),
    title: term('dcterms', 'title'),
    type: term('dcterms', 'type')
}

export const PROV = {
    wasDerivedFrom: term('prov', 'wasDerivedFrom'),
    wasAttributedTo: term('prov', 'wasAttributedTo')
}

export const GEO = {
    lat: term('geo', 'lat'),
    long: term('geo', 'long')
}

export const TIME = {
    inXSDDate: term('time', 'inXSDDate')
}

export const IDENTITY_KEYS = ['@id', '@type', '@context', '__rerum']
```

`NAME_PROPERTY_TOKENS` is the whitelist `assertPersonName` validates its `property`
against. `QUALIFIER_LABELS` and `NAME_TYPE_TOKENS` drive the person page's name
form. `IDENTITY_KEYS` are the keys that stay raw on a resolved entity instead of
becoming ValueObjects.

## Default exports

Six `js/model/*` modules also export a default: `birth.js`, `config.js`,
`death.js`, `label.js`, `parents.js` and `tree.js`. Everywhere but `config.js` the
default is a convenience bundle duplicating the named exports, and it is **a
convention only** — no code imports it. `config.js` is the only model module
actually default-imported anywhere in the repository (verified against
`js/adapters/memory-store.js`, `js/adapters/rerum-store.js`,
`js/adapters/legacy.js`, `tests/unit/model-person.test.js` and
`tests/unit/adapters-rerum.test.js`). Pages in `js/pages/` import named bindings
from `js/model/*`, plus `resolveStore` from `js/adapters/store-bootstrap.js`. The
store adapters likewise export their classes as defaults (`MemoryStore`,
`LocalStore`, `FixtureStore`, `RerumStore`) while callers use the factories.

## Cross-cutting invariants

Each item is traceable to the code named.

- **The bare `label` cache is never authoritative.** A Person document carries
  `label` only as a denormalized copy written for list reads
  (`entities.createPerson()`, `label.saveLabel()`, `person.refreshLabelCache()`).
  `search.personLabel()` is the one rule that decides what a Person is called, and
  `search.deriveLabel()` is that rule without assertions; every surface that names a
  person goes through one of the two, and neither merges conflicts. A write that
  asserts a new name refreshes the cache too, and where it cannot (a DEER v1 person)
  it reports `cacheSkipped` rather than leaving the drift silent. `loadLabel()`
  exposes the disagreement as `cacheStale`.
- **The `rel` reverse index is minted by the write path and must never be read as
  fact.** `assert({ rel })`, `events.participate()` (`rel: [agent, eventId]`) and the
  parent derivations (`rel: [child, parent]`) write it so a store that cannot filter
  dotted Body paths can answer the other direction of a relation. `events.js` says so
  in place: "Read paths must not treat `rel` as authoritative — body[nv:participant]
  remains the record." The reads agree — `eventsForPerson()` re-checks the Role in the
  Body, `childrenOf()` re-checks `vo.value === personId` — and `RerumStore.query()`
  throws rather than scan when a filter carries neither `target` nor `rel`.
- **Derived views are never written.** `parentsOf()` reads stored `nv:hasParent`
  Assertions and `childrenOf()` computes the inverse at read time. `nv:hasParent` *is*
  written, by `deriveParentAssertions()` and by `saveParents()`; `NV.hasChild` is
  declared in `vocabulary.js` and appears in no code outside it — only in the
  comments that say it is never stored — and `tree.js` states that it neither
  reads nor writes one.
- **A Body's property keys are URIs except `label`.** `assert()` writes whatever
  `property` string it is given, and every vocabulary-backed write passes a full URI —
  `SCHEMA.birthDate`, `NV.hasParent`, `DCTERMS.source`, `NV.participant`. The one
  exception is deliberate: `entities.LABEL_PROPERTY` is the bare string `'label'`,
  `createPerson()` asserts the cache under it, and `personLabel()` reads it back by
  that bare key. Nothing enforces URI-ness at the store layer — `MemoryStore.query()`
  compares Body keys with plain property lookup — and `legacy.js` maps known bare v1
  keys onto standard URIs while passing an unrecognised bare key through verbatim as
  its bare name.
- **Confidence is a number from 0 to 1, and `valueObject()` enforces it.** A defined
  `confidence` that is not a number, is `NaN`, or falls outside `[0, 1]` throws
  `RangeError('nv:confidence must be a number between 0 and 1')`. It is stored under
  the full `NV.confidence` URI key, not a bare `confidence` key.
  `events.participate()` is the one write path that builds its ValueObject inline and
  so skips that check.
- **Conflicts survive every write.** No model function overwrites or dedupes an
  existing Assertion; `assert()` never merges, `resolve()` returns an array when a
  property carries more than one ValueObject, and `saveBirth` / `saveDeath` /
  `saveLabel` / `saveParents` each say so in their own docs. `tree.loadTree()` flags
  disagreement as `contested` instead of resolving it.
- **Lazy migration is read-only.** DEER v1 documents surface through
  `RerumStore`'s migration as a bare entity plus `#legacy-*` Annotations, detection is
  structural (a document is legacy when it carries facts directly on itself, exempting
  `PLUMBING_KEYS` and the `dcterms:type` subtype mirror), and the `#legacy-` in those
  minted ids is what sets the `legacy` flag on every assembled view. The first save
  through the model writes only the new shape.
