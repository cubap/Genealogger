# The Genealogger data model

> The normative description of how genealogical knowledge is stored here. It is
> written *from* the working code (`js/model/`, `js/adapters/`), so where this
> document and the code disagree, the code is the bug — or this document is
> stale, and CI should be told about it.
>
> Machine-readable term definitions live in
> [`schemas/genealogger-context.jsonld`](../schemas/genealogger-context.jsonld)
> and are rendered at the namespace URL
> <https://cubap.github.io/Genealogger/nv>. The words we agree to use are in
> [`GLOSSARY.md`](../GLOSSARY.md). Function-by-function signatures are in
> [`API.md`](API.md); the journeys below are expanded into call sequences in
> [`WORKFLOWS.md`](WORKFLOWS.md).

## 1. The problem this model solves

The dominant encoding of genealogical data is the **family block**: one record
per person (or per family) with a slot per fact — `birthDate`, `father`,
`mother`, `occupation`. That shape has two failures that matter for evidence:

1. **A slot holds one value.** When the 1855 marriage certificate names William
   as the father and the family bible names Thomas, the second entry overwrites
   the first. The disagreement — which *is* the interesting historical
   claim — is destroyed by the storage layer, and nothing in the surviving
   document records that anything was lost.
2. **Provenance is per-record, not per-fact.** A citation attached to the
   family sheet cannot say *which* fact came from *which* document, so a
   transcription error in the mother's name contaminates the father's date.

Genealogger stores the opposite way. An entity document is **bare**: it carries
identity and a display-name cache and nothing else. Every fact is a separate
Web Annotation that names the property it asserts, the value it claims, and the
Record that says so. Two sources that disagree produce two annotations, both
readable, each traceable, and the UI shows both.

The model this implements is the **Eventities** pattern (see §13 for the
alignment table): *entities are bare, knowledge is annotated, annotations
carry evidence and confidence, relationships are events.*

## 2. Three layers, one direction

```
pages (js/pages/*.js)  →  model (js/model/*.js)  →  stores (js/adapters/*.js)
   DOM wiring only         use cases, no DOM         document CRUD, no domain
```

- A **page** never fetches or writes a document. It resolves a Store from the
  URL, installs it, calls model functions, and hands plain objects to `gl-*`
  components.
- The **model** performs no DOM work and no direct network calls. It composes
  assertions, events, and derived views, and it is where every vocabulary term
  is chosen.
- A **store** moves documents. It knows nothing about people, events, or roles.

Every model call takes a single options object and accepts an injected `store`;
when omitted, it uses `getDefaultStore()`. That is what makes the whole model
layer testable in memory and what lets the same page run against devstore,
`localStorage`, or the demo fixture family without a branch.

## 3. Entities are bare

Four entity types exist. Their `@type` tokens are deliberately **bare strings**
(`"Person"`, `"Event"`, `"Record"`, `"Place"`) because that is what the store's
type filter matches, and an Event adds its subtype URI alongside:

```json
{ "@id": "…/id/ada",        "@type": "Person" }
{ "@id": "…/id/certificate","@type": "Record" }
{ "@id": "…/id/ada-birth",  "@type": ["Event", "https://cubap.github.io/Genealogger/nv#Birth"] }
{ "@id": "…/id/bletchley",  "@type": "Place", "label": "Bletchley, Buckinghamshire" }
```

`Place` is declared in the vocabulary and the context (`geo:` coordinates are
defined so an adopter can use them), but no page in the current build writes
one: places are still recorded as `schema` text values on the event's outcome
assertions.

A Person document holds identity and the `label` cache — that is all:

```json
{ "@id": "…/id/ada", "@type": "Person", "label": "Ada Gordon" }
```

No `birthDate`. No `hasFather`. No name parts. Writing a fact onto the entity
is the exact regression this model exists to prevent, so the reads that could
reintroduce it are pinned: `tests/unit/adapters-legacy.test.js` asserts a
converted DEER v1 person comes back with `givenName` absent, and the model's
own write paths put every fact in an annotation.

Event subtypes in `nv:`: `Birth`, `Christening`, `Baptism`, `Death`, `Burial`,
`Marriage`, `Census`. `typeTokens()` emits both the full URI and the bare
fragment for every subtype, because migrated DEER v1 documents store the bare
word and devstore matches `@type` **exactly** — a read that must see both
generations asks for both spellings.

## 4. A fact is an Annotation

Assertions follow the Web Annotation shape: `type: "Annotation"`, `target` =
the entity the fact is *about*, `body` = an object **keyed by the property URI**
being asserted.

```json
{
  "@id": "…/id/anno-1",
  "type": "Annotation",
  "target": "https://devstore.rerum.io/v1/id/ada",
  "body": {
    "https://schema.org/birthDate": {
      "value": "1815-12-10",
      "evidence": "https://devstore.rerum.io/v1/id/certificate",
      "https://cubap.github.io/Genealogger/nv#confidence": 0.95
    }
  }
}
```

`assert()` never merges with an existing annotation about the same property.
That single decision is what makes ambiguity survivable: the operation has no
"set" semantics, only "record that this source says this".

The body may hold more than one property, and the model reads every property it
finds, but the write path emits one property per annotation so that provenance
attaches to exactly one claim.

### Compactness of stored keys

Stored documents mix compact and expanded keys, and this is intentional rather
than an accident to be tidied:

| Position in the document | Shape the code writes | Where |
|---|---|---|
| Entity `@id`, `@type`, `label` | identity keys, raw | `js/model/entities.js` |
| Annotation `type` | bare `"Annotation"` | `js/model/assertions.js` |
| Body property key | **full URI** (`https://schema.org/birthDate`) | `js/model/assertions.js` |
| ValueObject qualifiers | bare `value`, `evidence`, `source`, `about` | `js/model/assertions.js` |
| ValueObject confidence | **full URI** `…/nv#confidence` | `js/model/assertions.js`, `js/model/lacunae.js` |
| Participation reverse index | `rel`: array of full ids | `js/model/events.js` |

The reason is the store boundary: devstore keys its query index on the literal
document shape, so the model writes what the server can already answer without
compaction. The JSON-LD context maps **both** the bare and expanded spellings to
the same IRI, so a consumer that compacts or expands with
[`schemas/genealogger-context.jsonld`](../schemas/genealogger-context.jsonld)
sees one consistent vocabulary. Changing what is *stored* is a data-upgrade
decision (M5), not a documentation decision.

## 5. The ValueObject

The value of a body property is a **ValueObject**: the claim plus its
qualifiers. Built by `valueObject(value, { source, evidence, confidence })`.

| Key | IRI | Meaning |
|---|---|---|
| `value` | `rdf:value` | the asserted value |
| `evidence` | `nv:evidence` | id of the Record (or Event) that says so |
| `source` | `dcterms:source` | inline citation: `citationSource`, `citationNote`, `comment` |
| `nv#confidence` | `nv:confidence` | 0–1 on this claim |
| `about` | `nv:about` | on a Lacuna, the property URI of the empty slot |

Name claims add three more qualifiers, minted in `nv:` because schema.org has
no equivalent: `nv:nameType` (`married name`, `nickname`, …), `nv:activeFrom`,
`nv:activeTo`.

One id is written at two levels, and both spellings share the `dcterms:source`
IRI: **inside a ValueObject**, `source` is citation metadata about the value,
while **on the Annotation document**, `dcterms:source` records the source
Document that was current when the assertion was written. Read the nesting, not
just the key.

`resolve({ target })` groups a target's annotations into a
property → ValueObject(s) map. **One ValueObject is returned bare, more than one
as an array.** Callers must handle both, and must not pick a winner: the point
of resolving is to see every claim.

## 6. Evidence

`evidence` is the id of the document that supports the claim — usually a
`Record`, sometimes the `Event` the claim was derived from. A Record holds a
citation label, not genealogical facts:

```json
{ "@id": "…/id/certificate", "@type": "Record",
  "label": "Parish baptism certificate, 1815" }
```

Terminology is load-bearing: call the document a **Record** and the pointer
**evidence**. "Source" is reserved for the inline `source` citation object,
because `dcterms:source` means "a different document" in a reader's head and
`nv:source` means "a note about where the text came from". Mixing them is the
easiest way to make this model unreadable.

Every evidence id is resolvable to a label by one shared helper
(`assertions.list` + `deriveLabel()`), so a row can name the document behind a
claim without a second read per row.

## 7. Confidence

`nv:confidence` is a number 0–1 **on the claim**, never on the person and never
on the Record. It answers "how much does this record support this fact", which
is a per-fact judgement: a transcript may be certain about the name and shaky
about the date from the same page.

The write path takes `confidence` per call and, on the family-record pages,
`confidences` — a per-field override map — with a default applied to fields that
do not name one. The UI control is a set of **named levels**, not a free number
(`CONFIDENCE_LEVELS` in `js/components/gl-assertion.js`):
`certain` 1, `high` 0.9, `medium` 0.5, `low` 0.25, `uncertain` 0.1.
`parseConfidence()` also accepts numbers, numeric strings and percentages, and
returns `undefined` for empty input so a claim is stored **without** a
confidence rather than with a guessed one. `valueObject()` itself performs no
validation — a caller may store any number it is handed.

Rows render at the level they were stored at: an editing surface shows the
claim's confidence and lets a user change it (`gl-confidence-change`), and a
migrated DEER v1 view renders the same rows `readonly`.

`eventProvenance()` reads an Event's own evidence annotation so derived claims
can **inherit** the confidence of the record that produced them rather than
re-asserting 1.0 for a fact the event merely implies.

## 8. Relationships are events

A parent link is not an array on a person. It is a **participation** annotation
on the birth Event naming the relationship:

```json
{
  "type": "Annotation",
  "target": "…/id/ada-birth",
  "rel": ["…/id/george", "…/id/ada-birth"],
  "body": {
    "https://cubap.github.io/Genealogger/nv#participant": { "value": "…/id/george" },
    "https://cubap.github.io/Genealogger/nv#role": { "value": "…/nv#father" }
  }
}
```

`participate({ event, agent, role, evidence, confidence })` writes it;
`participations({ event })` reads every such row back. Roles come from
`CANONICAL_ROLES` (`child`, `parent`, `mother`, `father`, `godParent`,
`informant`, `witness`, `attendant`) — the model mints no new role tokens
outside the vocabulary, and the forms cannot submit one that is not canonical.

`rel` is a **reverse index**, not a fact: `participate()` puts both the agent id
and the event id in it so a store that cannot filter on dotted body properties
can still answer "which events is this person in?" with one query. Nothing may
read `rel` as authoritative — the Body is the record, and `rel` exists only so
the body can be found. That distinction is in the context's own `rdfs:comment`,
and the drift test asserts it stays there.

Outcome facts then attach to the participant, evidenced by the event:
`assertOutcome({ event, target, property, value })` is an ordinary annotation
whose `evidence` is the Event id. One event routinely yields many outcomes
(a birth certificate evidences the date, the place, and both parents' names).

## 9. Derived views are computed, never stored

`nv:hasParent` and `nv:hasChild` are the vocabulary for parentage **as read**,
and `deriveParentAssertions()` writes `hasParent` annotations so a
single-source consumer can see the derivation. What is *never* written:

- `nv:hasChild` — the parent→child direction is always computed, as the inverse
  of the child's `hasParent` assertion via its `rel` index
  (`childrenOf({ personId })`).
- Any `hasFather` / `hasMother` / `children` array on a Person document (the
  DEER v1 shape).

`parentsOf()` returns every conflicting derived claim with its own evidence.
`loadTree()` and `loadAncestorTimeline()` build their structures out of these
reads at render time. A derived view is a *read*, so it can never go stale
relative to the annotations behind it — and it cannot be edited, which is why
the tree and timeline are display surfaces, not forms.

## 10. Lacunae

An absent fact is ambiguous: not recorded, or recorded as unknown? `nv:Lacuna`
annotations separate the two.

```js
await markLacuna({
  target: adaId,
  value: "birth mother unknown",
  about: NV.hasParent,                    // the empty slot, for reconciliation
  evidence: certificateId,                // the document that demonstrates the gap
  source: { citationNote: "certificate reads 'baseborn'" }
})
```

`lacunaeOn({ target })` returns them as ValueObjects, so a gap can itself be
evidenced and given a confidence. Pages render lacunae as explicit rows:
"absent because a source says nobody knew" instead of a blank field.

## 11. Contested data

Two things are contested: **identity** (two documents name the same person
differently) and **parentage** (two records name different parents). The model's
answer is always the same — keep both claims visible with their provenance, and
mark that they disagree — never pick a winner in storage.

- `resolve()` and `valuesOf()` return every coexisting ValueObject, unmerged.
- `loadParents()` emits **one row per derived claim**, so two sources naming the
  same mother are two rows; the "N sources disagree" hint counts *distinct
  people per role*, not rows, because two documents agreeing is not a conflict.
- `loadTree()` marks **every** edge into a disputed person as contested (not
  just the minority claim), so each competing claim keeps its own visible edge.
- `label.js` reports `cacheStale` when the display-name cache and the
  evidenced claims disagree, and says so out loud rather than choosing.

The invariant to preserve when adding a page: **editing a value means adding an
assertion, never mutating one.** Nothing in `js/model/` overwrites an existing
annotation's value.

## 12. The label rule

A person is named by exactly one function, `personLabel()` in `js/model/search.js`,
with the cheap list variant `deriveLabel()`. Preference order:

1. the bare `label` cache (a previous write's decision, and the only thing a
   list read can afford),
2. `schema:name` — expanded or bare `name` on the entity, or asserted,
3. name parts (given, additional, family), asserted first, then identity
   properties, then unmapped v1 keys,
4. `UNLABELED` (`"[ unlabeled ]"`), so absence is visible rather than blank.

Write-side invariant, because the cache must not rot silently: anything that
asserts a **full** name refreshes the bare `label`; a name-*part* claim fills the
cache only when it is absent, through the same function. When a store's write
would cost a document version for no change, the write is skipped and the result
says why (`cacheUpdated: false` with `cacheSkipped: "unchanged" | "legacy"`).
A DEER v1 document's cache is never refreshed by a new-stack write, because
rewriting the v1 document would destroy the inline facts inside it — the page
must state that lists keep showing the old name.

Conflicting assertions are **not** ranked by `personLabel()`: it takes the first
readable value for display, and any surface that shows the *fact* of naming must
render every ValueObject with its provenance.

## 13. Alignment with Eventities

Genealogger's patterns align with the [Eventities model](https://github.com/cubap/unews)
used in related projects (Rerum-Collection-Management, unews).

| Pattern | Genealogger | Eventities |
|---|---|---|
| Entity type | `@type: Person`; `["Event", "…/nv#Birth"]` | `slu:Person`, `slu:CampusOrganization` |
| Annotation | Web Annotation, body keyed by the property URI | `oa:motivation` (property-assertion, relationship-assertion) |
| Evidence | `body.<prop>.evidence` → a Record id | `slu:evidence` |
| Confidence | `body.<prop>.nv#confidence` | `slu:confidence` |
| Attribution | optional `creator` / `dcterms` on the annotation | `dcterms:creator`, `dcterms:created` |
| Relationships | typed participation on an Event (`nv#participant` + `nv#role`) | relationship assertions between entities |
| Known gaps | `nv:Lacuna` annotations | `Lacuna` |

### Still to adopt

1. **Lifecycle States** — Eventities transitions entities `encountered` →
   `anchored` → `described` → `related` → `reconciled` → `absorbed` →
   `invalidated`. Genealogger has no lifecycle field; it would sit on the Person
   alongside `label`.
2. **Birth Annotations** — the `slu:birthAnnotation` pattern records the
   annotation that first created an entity. Genealogger infers provenance from
   event participation instead.
3. **Sibling Eventities** — `slu:siblingEventities` tracks the same concept
   across collections. Genealogger has no collection scoping against production
   RERUM yet, which is also why `listPersons()` sees every Person in the shared
   sandbox.

## 14. Worked examples

### A. Two records disagree about who the father was

Ada's 1855 marriage certificate names **William Gordon**; her family bible names
**Thomas Gordon**. Neither is discarded.

Stored (ids abbreviated). A Record is a *source*, so the two claims sit on
**two** birth events — one per record. "Same event" in this model means "the
same source's account", not "the same historical fact":

```jsonc
// bare identities
{ "@id": "…/id/ada",      "@type": "Person", "label": "Ada Gordon" }
{ "@id": "…/id/william",  "@type": "Person" }
{ "@id": "…/id/thomas",   "@type": "Person" }

// two sources
{ "@id": "…/id/cert1855", "@type": "Record", "label": "Marriage certificate, 1855" }
{ "@id": "…/id/bible",    "@type": "Record", "label": "Gordon family bible" }

// each source's account of the birth is its own Event
{ "@id": "…/id/ada-birth-cert",  "@type": ["Event", "…/nv#Birth"], "label": "Birth of Ada Gordon" }
{ "@id": "…/id/ada-birth-bible", "@type": ["Event", "…/nv#Birth"], "label": "Birth of Ada Gordon" }

// the child is always a participant; each record names its own father
{ "type": "Annotation", "target": "…/id/ada-birth-cert",
  "rel": ["…/id/william", "…/id/ada-birth-cert"],
  "body": { "…/nv#participant": { "value": "…/id/william", "evidence": "…/id/cert1855" },
            "…/nv#role": { "value": "…/nv#father", "evidence": "…/id/cert1855" } } }

{ "type": "Annotation", "target": "…/id/ada-birth-bible",
  "rel": ["…/id/thomas", "…/id/ada-birth-bible"],
  "body": { "…/nv#participant": { "value": "…/id/thomas", "evidence": "…/id/bible" },
            "…/nv#role": { "value": "…/nv#father", "evidence": "…/id/bible" } } }

// derived parentage on the child: two hasParent claims, both kept
{ "type": "Annotation", "target": "…/id/ada", "rel": ["…/id/william", "…/id/ada"],
  "body": { "…/nv#hasParent": { "value": "…/id/william",
            "evidence": "…/id/cert1855", "…/nv#confidence": 0.8 } } }

{ "type": "Annotation", "target": "…/id/ada", "rel": ["…/id/thomas", "…/id/ada"],
  "body": { "…/nv#hasParent": { "value": "…/id/thomas",
            "evidence": "…/id/bible", "…/nv#confidence": 0.5 } } }
```

Written by:

```js
const { eventId: certEvent } = await saveParents({
  personId: adaId,
  evidence: { id: cert1855Id },
  parents: [{ role: 'father', agentId: williamId }],
  confidence: 0.8
})
// a second call, a second source — not an edit of the first
await saveParents({
  personId: adaId,
  evidence: { id: bibleId },
  parents: [{ role: 'father', agentId: thomasId }],
  confidence: 0.5
})
```

`saveParents()` reuses the birth event **this Record already evidences**, so
adding the mother from the same certificate lands both parents on one event;
a different Record is a different account and mints its own.

Read back:

- `parentsOf({ personId: adaId })` → **two** ValueObjects, william (0.8) and
  thomas (0.5), each naming its own record.
- `loadParents({ personId: adaId })` → `events: [ada-birth-cert,
  ada-birth-bible]`, `parents:` one row per derived claim, and the page's hint
  counts distinct people in the father role: **2**, so it says "2 sources
  disagree".
- `birthEventsOfChild({ personId: adaId })` → both events, because Ada is the
  `nv:child` participant of each.
- `childrenOf({ personId: williamId })` and `childrenOf({ personId: thomasId })`
  both include Ada. Nothing chose between the two men in storage, so both
  people's pages are correct about what their source claims.
- `loadTree({ rootId: adaId })` → two edges into Ada, both `contested: true`,
  drawn dashed with a ⚠ on her node.

What a family block would have kept: one father, no trace of the other claim,
and no way to see that the bible is the weaker source.

### B. A draft-card age marked doubtful

Ada's death certificate gives her birth year as **1815**. A 1917 draft card
states an age of 55 — implying **1862**, which is impossible against the
certificate but is still what that document says. The researcher records it with
low confidence; it is not deleted, and it is not "corrected" in place.

```js
// the certificate's date, asserted by the death event that restates it
await assertOutcome({
  event: adaDeathEvent, target: adaId, property: SCHEMA.birthDate,
  value: '1815-12-10', confidence: 0.95          // evidence = the event's record
})
// the draft card's impossible age, as its own claim
await assert({
  target: adaId, property: SCHEMA.birthDate,
  value: 'about 1862',
  evidence: draftCardId,
  confidence: 0.2,
  source: { citationSource: 'World War I draft card, 1917',
            citationNote: 'age 55; conflicts with baptism certificate' }
})
```

```jsonc
{ "type": "Annotation", "target": "…/id/ada",
  "body": { "https://schema.org/birthDate": {
      "value": "about 1862",
      "evidence": "…/id/draftcard",
      "source": { "citationSource": "World War I draft card, 1917",
                  "citationNote": "age 55; conflicts with baptism certificate" },
      "…/nv#confidence": 0.2 } } }
```

Read back:

- `resolve({ target: adaId })` → `birthDate: [1815-12-10 @0.95, "about 1862" @0.2]`
  (an array, because there are two).
- `person.html` renders one `<gl-assertion>` row **per ValueObject**, in
  assertion-property order and, within a property, in stored order — nothing
  re-ranks the two dates behind each researcher's back. Each row shows its own
  evidence label and confidence level, so the 0.2 claim reads as `Low` next to
  the certificate's `Certain`, visibly doubtful rather than hidden.
- `timeline.classifyDate('about 1862')` → a plottable point flagged
  `estimated: true`, so the timeline can draw it as an estimate. If the value
  carries no year at all, `classifyDate()` returns `null` and the caller keeps
  it in the **undated** list — disagreement means surviving visibly, never
  being silently dropped by a date parser.
- Nothing writes the "best" birth date onto the Person. A consumer that wants a
  single value must make a documented choice; the storage layer declines to.

The lesson is the same in both examples: **confidence and evidence are
attributes of the claim**, so a doubtful claim stays in the record as exactly
the doubtful claim it is.

## 15. Reading old data

DEER v1 documents — the previous generation of this app — store facts inline
(`birthDate`, `hasFather`, `name` on the person document) and annotate with v1
shapes. Reads convert them lazily:

- `js/adapters/legacy.js` converts a v1 document into the new shape at
  **read** time. Nothing is rewritten on sight; opening a page writes nothing.
- The first save through the new stack migrates the records that save touches,
  and only those. Assembled views carry `legacy: true` so a page can show a
  "migrated view" banner and stay read-only until the user edits.
- v1 minted no `rel` reverse index, so `eventsForPerson({ legacyTypes })`
  falls back to a bounded enumeration (`listByType()` + per-event `target`
  queries) *only when the index returns nothing*. New-shape reads stay
  single-query.
- Not everything round-trips: v1 stored role granularity only as
  `hasFather`/`hasMother`, and a person document's `hasChildren` gave the
  downward edge that derived events cannot reproduce. The tree shows v1 persons
  their upward edges and documents the gap.

Why not migrate everything in one batch: the shared sandbox holds documents no
script here should rewrite, and an unreviewed bulk PUT against a versioning
store mints a new `@id` per document, orphaning every annotation that targeted
the old one. Rationale in `docs/adr/` (lazy migration).

## 16. Storing data

| Kind | Class | Backing | Use |
|---|---|---|---|
| `memory` | `MemoryStore` | a `Map` | tests; the default when nothing is resolved |
| `local` | `LocalStore` | `localStorage` | `?store=local` — an offline sandbox, per browser |
| `rerum` | `RerumStore` | devstore / production RERUM | the default for real use |
| `fixture` | `FixtureStore` | an in-memory family | `?store=fixture` demos and E2E seeding |

The **Store contract** is six methods — `create`, `read`, `update`, `remove`,
`listByType`, `query` — checked by `assertStore()`; `STORE_METHODS` is the
single list it is checked against. A `QueryFilter` is `{ target, type, rel }`
and nothing else, because those are the only keys a server can answer for; see
[`devstore-query-contract.md`](devstore-query-contract.md).

Three consequences worth knowing before adopting the vocabulary:

1. **devstore `/query` returns at most 10 documents and cannot page.** List
   counts are floors, not totals, and `listPersons()` sorts only that sample.
   Production data needs a scoped/paged read (M5).
2. **`update()` on a versioning store returns a NEW `@id`.** A model write that
   needs the id to stay stable must account for that; today the label page
   reports the id the store now serves for the person.
3. **`@type` matching is exact**, which is why `typeTokens()` exists (§3).

## 17. Vocabulary: three sites, one definition

| Site | Role |
|---|---|
| `js/model/vocabulary.js` | what the code can write; the source of truth |
| `schemas/genealogger-context.jsonld` | the normative, machine-readable definition |
| `nv/index.html` | the dereferenceable documentation, rendered from the context |

`tests/unit/schemas-context.test.js` fails the build if the first and second
disagree — every URI `vocabulary.js` can hand a store must appear in the
context with the same expansion, and every term must carry `rdfs:label` and
`rdfs:comment`. The namespace page renders the context rather than restating
it, so the third site cannot lie.

Rules for adding a term:

1. If a standard term exists, **reuse it** (`schema.org` facts, OA annotation
   shape, DCTERMS records and dates, PROV-O derivation, WGS84 places, OWL Time).
2. `nv:` is reserved for Eventities-specific concepts only — event subtypes,
   roles, `confidence`, `Lacuna`, name qualifiers, `rel`, `evidence`.
3. Add it in `vocabulary.js`, add it to the context with a label and a comment,
   run the drift test. Do not mint a term inside a page or a model module; the
   three slices that did during M3 were consolidated for exactly this reason.
