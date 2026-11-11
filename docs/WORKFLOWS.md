# Genealogger Workflows

> Every journey through the app, expressed as the model calls behind it, so you
> can follow a piece of data from a form field to stored JSON and back to a
> rendered row. The [model](MODEL.md) explains *why* the shapes are what they
> are; [API.md](API.md) is the per-function reference. The executable versions
> of everything below are the Playwright journeys in `tests/e2e/`.

## The shape of every page

All eight pages (`index`, `birth`, `death`, `parents`, `person`, `tree`,
`timeline`, `label`) follow one wiring, and it is the same one to copy for a
ninth page:

```
window load
  -> resolveStore({})                  store-bootstrap: ?store= picks the adapter
  -> setDefaultStore(store)            so model calls may omit `store`
  -> read ids/params out of the URL    ?person=<id>, plus legacy #<id>
  -> load*({ store, personId })        one model call assembles the view
  -> toAssertionRows(view.assertions, { propertyLabels, evidenceLabels, order })
  -> render <gl-assertion> rows        components stay dumb
  <- <gl-*form> dispatches gl-*-submit
  -> save*({ store, ...formData })     one model call writes the family
```

Three rules fall out of this and hold everywhere:

- **Pages never fetch.** No page module calls `fetch()` or `store.query()`;
  only `js/adapters/` touches the wire, only `js/model/` touches the store API.
- **Pages never encode domain rules.** A page may not build an Annotation body,
  mint a `rel`, or pick a confidence — it hands form values to a model function.
- **Storage ids cross the seam, not storage shapes.** A page passes an entity
  id and reads back an assembled view (`{ label, view, assertions, … }`).

Store selection matters more than it looks: **with no `?store=`, a page in a
browser talks to the shared devstore sandbox** (`?store=local` is the isolated
per-checkout store, `memory` is non-persistent, `fixture` is the sample family).
The E2E suite runs on `local`/`memory` and asserts zero non-localhost requests,
so tests never write shared data — but a hand-opened page does. See journey 12.

---

## 1. Create a person by recording a birth

The app has no "add person" button on purpose: **a person comes into existence
because a source says something about them.** `birth.html` is the front door.

Form: given/family name, gender, date, place, the evidence document's title,
per-field confidence, and optional participants (mother, father, witnesses).

```js
saveBirth({
  store,
  name: { given: 'Ada', family: 'Gordon' },
  gender: 'Female',
  birthDate: '1855-03-12',
  birthPlace: 'Aberdeen',
  evidence: { title: 'Parish register, 1855', confidence: 0.9 },
  confidences: { birthDate: 0.9, birthPlace: 0.7 },
  participants: [{ role: 'mother', name: 'Jane' }, { role: 'father', name: 'William' }]
})
// -> { personId, eventId, recordId }
```

What lands, in this order (all inside one model call):

1. a **Record** entity for the source, labelled by `evidence.title` (skipped
   when `evidence.id` names one that exists);
2. a bare **Person** — `createPerson({ label: "Ada Gordon", evidence: recordId })`
   writes the `label` cache *and* asserts bare `label` as an Annotation carrying
   the creating evidence, so the name has a source from birth;
3. a **Birth event** (`@type: ["Event", "nv#Birth"]`, labelled "Birth of Ada
   Gordon") with `evidence: recordId` and the document's confidence;
4. `participate({ event, agent: personId, role: nv#child })` — the child is a
   participant of their own birth, and this row is what parentage derivation
   hangs on;
5. `participate()` per other participant, each with its role, evidence and
   per-participant confidence. A participant with only a `name` gets a bare
   Person created from the same Record;
6. one **`assertOutcome()`** per populated field — `schema:givenName`,
   `schema:familyName`, `schema:additionalName`, `schema:alternateName`,
   `schema:name`, `schema:gender`, `schema:birthDate`, `schema:birthPlace` —
   each a separate Annotation on the person whose evidence **is the event**, and
   each with `confidences[field] ?? confidence`. Empty fields assert nothing:
   silence is not a claim of absence (that's a Lacuna, journey 10);
7. `deriveParentAssertions({ event })` → `nv:hasParent` (+ `nv:mother` /
   `nv:father`) Annotations on the child, generated from the roles.

Read back: `loadBirth({ personId })` → `{ personId, label, legacy, view, events,
assertions, evidenceLabels, personLabels }`, rendered as one `<gl-assertion>`
row per ValueObject plus the participants grouped by event. Since each fact's
evidence is the event, the row's source reads as "Birth of Ada Gordon" — follow
`events.eventProvenance({ event })` (journey 9) to reach the document.

Journey: `tests/e2e/birth-journey.spec.js`.

## 2. Add parents from a different source

`parents.html?person=<id>` edits parentage without touching the birth record.

```js
saveParents({
  store,
  personId,
  evidence: { id: recordId },           // reuse a Record, or { title } to mint one
  parents: [{ role: 'mother', agentId }, { role: 'father', name: 'Thomas' }],
  residence: { value: 'London', confidence: 0.6 },
  confidence: 0.8
})
// -> { personId, eventId, recordId, participants, derived }
```

- The parent either **picks an existing person** (`agentId`, from the page's
  dropdown) or **gives a name**, which creates a bare Person for the source's
  claim; the claim is then attached to that new person, not to a string.
- Event selection is keyed on the evidence Record: same certificate → same
  event; different record → a **second birth event**, so disagreeing accounts
  stay separate events rather than competing values in one.
- Parentage is *derived*: participation annotations are the fact, and
  `nv:hasParent` / `nv:mother` / `nv:father` annotations on the child are
  generated from them, with an **idempotency guard** so re-saving the same
  claim from the same source doesn't stack duplicates.
- `derived` reports what was newly created versus already present.

Read back: `loadParents({ personId })` → rows + `events` + a disagreement hint
that counts **distinct people per role** (two documents naming the same mother
are not a conflict). Journeys: `parents-journey.spec.js`, and the E2E families
are seeded through this real form, not by poking storage.

## 3. Name, rename, and label a person

Two writes, one rule: a display name is an assertion like any other, so it needs
a source. `label.html?person=<id>` sets *what the app calls this person*;
`person.html`'s name form records *a name a source gives*, with qualifiers.

**Set the display name** (label page):

```js
saveLabel({ store, personId, name: 'Ada Gordon', evidence: { id: recordId }, confidence: 0.9 })
// -> { personId, recordId, annotationId, label, cacheUpdated, cacheSkipped }
```

`saveLabel()` writes the cache **first** (so that on a store which answers an
update with a new document version, the surviving document is the one the fresh
fact targets), then asserts the name under `schema:name` with that Record as its
`evidence`. It never merges with what other sources already claimed.
`cacheSkipped` tells the page why nothing was written — `'unchanged'` (the cache
already holds this name; a no-op PUT isn't worth a new version) or `'legacy'`
(the person is still served as a DEER v1 document whose inline facts a PUT of
the read-back shape would replace). In the legacy case the page must say out
loud that lists keep showing the old name. It returns the id the store now
serves for this person, which on a versioning store is the new version's.

**Record a name with qualifiers** (person page, `<gl-person-name-form>`):

```js
assertPersonName({
  store, personId,                       // omit personId to create the Person
  value: 'Ada Gordon',                   // as written in the source
  property: SCHEMA.name,                 // any canonical name property
  nameType: 'married name',              // page-local nv: qualifiers
  activeFrom: '1875-01-01', activeTo: '1901-06-30',
  evidence: { title: '1881 census' }, confidence: 0.9, comment: 'transcribed'
})
// -> { personId, recordId, annotationId }
```

- The type and active range live **inside the ValueObject** (as `nv:` qualifiers)
  rather than as separate annotations, because `assert()` builds one property per
  call and would detach a name's type from the name itself.
- Nothing dedupes or overwrites: the same name from a second document adds a
  second annotation, so disagreement survives.
- **Write-side invariant:** a full-name write refreshes the bare `label` cache;
  a name-*part* write only fills an absent/`UNLABELED` cache, and does so through
  `personLabel()` — the same single rule the reads use, never a second standard.
  A person still holding DEER v1 `#legacy-` annotations is left alone, because
  rewriting that document would destroy the legacy facts inside it; lazy
  migration stays the owning page's job.

Read back: `loadLabel({ personId })` → `{ personId, entity, label, listLabel,
cacheStale, legacy, names, evidenceLabels, view }`. `label` is what the detail
page shows (always `personLabel()`), `listLabel` is what `deriveLabel()` gives a
list row, and `cacheStale` is true when the two differ — i.e. the bare cache
holds nothing displayable and only the assertions can name this person, which the
page shows as a hint that recording the display name again repairs it. `names` is
the name-property slice of the resolved map, still one ValueObject per claim, so
it goes straight into `toAssertionRows()`. The label rule itself, and the reason
a bare list read can be `UNLABELED` while the person page shows a name, is in
MODEL.md §9. Journey: `tests/e2e/label-journey.spec.js`.

## 4. View a person

`person.html#<id>` (or `?person=<id>`) is the hub. One call assembles
everything:

```js
getPerson({ store, id })
// -> { entity, label, assertions, parents, children, lacunae }
```

- `label` comes from the **one** label rule (`personLabel({ entity, assertions })`)
  — the hub does not re-derive it.
- `assertions` is the grouped `resolve()` map; the page renders it with
  `toAssertionRows()` in `PROPERTY_LABELS` order, each row showing evidence
  label + confidence level. Rows are **read-only here**; editing a fact means
  recording it again from a form, which keeps both claims.
- `parents` / `children` come from the `rel` index, so they are one query each.
- `lacunae` lists known-absence statements (`nv:Lacuna` subjects) so the page
  can say "no mother recorded — checked the 1881 census, it doesn't name one"
  instead of rendering a blank.
- `entity` is `null` when the id isn't a Person; the page shows an explanatory
  empty state rather than an error.

Hub links out to `birth.html?person=`, `death.html?person=`,
`parents.html?person=`, `timeline.html?person=`, `tree.html?person=`,
`label.html?person=`. Journey: `person-journey.spec.js`.

## 5. Record a death

Same shape as birth, `death.html?person=<id>`, and it can create the person too
(a death-only person is legitimate — that's how tombstones enter a tree).

```js
saveDeath({
  store, personId,                             // omit to create a new person
  name: { given, family }, deathDate, deathPlace,
  evidence: { title, id?, confidence? }, confidences: {},
  participants: [{ role: 'spouse', name }, { role: 'parent', agentId }, …]
})
// -> { personId, eventId, recordId }
```

- The death event participates like any other, so **who witnessed a death** is
  a `rel` lookup: `search.eventsForPerson({ personId, role })` answers it
  without a `query()` call anywhere in the slice.
- The role list currently offers a single **"Parent"** token for a bereaved
  parent; `nv:mother` / `nv:father` are canonical now, so splitting it into two
  roles is an open, small follow-up (see the follow-ups note at the end).

Read back: `loadDeath({ personId })`. Journey: `death-journey.spec.js`.

## 6. Ancestor timeline

`timeline.html?person=<id>` walks upward from one person and shows dated life
events by generation.

```js
loadAncestorTimeline({ store, personId, maxGeneration })
// -> { personId, label, people, items, undated, legacy }
```

- `people` = the ancestors reached, `items` = one entry per person per dated
  event, each carrying `{ year, precision, display, role, evidence }`.
- Undated events are **not dropped**: they land in `undated` so the page can
  list them separately rather than silently losing a source's claim.
- `?person=`, legacy `#<id>` and `#https://…` all work (the hash is captured
  before URL normalisation). `?store=fixture` boots a self-contained demo
  (`timeline-standalone.html` is the same page kept for reference; nothing links
  to it since the v1 script that did is gone).
- DEER v1 events convert on either spelling of `hasAgent`: a bare id string, or
  an embedded `{ '@id': …, additionalType: 'mother' }` object — the adapter
  unwraps to the id and reads the per-agent `additionalType` as the Role,
  case-insensitively against the canonical roles. An agent with no role lands on
  `nv:child`, the subject slot both the birth and death slices use.

Journey: `timeline-journey.spec.js`; layout unit tests in
`tests/unit/components-gl-timeline.test.js`.

## 7. Relationship tree

`tree.html?person=<id>` draws the family block-free, straight from events.

```js
loadTree({ store, rootId, maxGenerations })     // default 2 both directions
// -> { rootId, rootLabel, maxGenerations,
//      nodes: [{ id, label, gen, contested }],
//      edges: [{ from, to, role, evidence, evidenceLabel, contested }] }
```

- Edges upward come from `parentsOf()` / the `rel` index; downward from
  `childrenOf()`. **Nothing is stored about "family"**: the graph is assembled.
- Contested parentage marks **all** edges into the disputed person (not just the
  minority claim), dashed, with a ⚠ on the node — every competing claim keeps
  its own visible edge.
- Depth is bounded (`?generations=N`) because the read fans out one
  `eventsForPerson` per visible person; a deep real ancestor is a good stress
  case.
- DEER v1 persons get **upward edges only**: v1 stores parent/child links on the
  person document, and the conversion yields parent edges, not child edges.
  Legacy direct `hasFather`/`hasMother` edges carry no role label.

Rendering is a pure `layoutTree()` feeding hand-rolled SVG — no D3, no build
step. Journey: `tree-journey.spec.js`; layout tests:
`tests/unit/components-gl-tree.test.js` (`layoutTree` is tested without a DOM).

## 8. Find people

`index.html` lists and searches:

```js
listPersons({ store, query, sort: true })   // -> [{ id, label }]
search.deriveLabel(entity)                  // bare list read: may be UNLABELED
```

- `query` matches the label and the assertion values; results are sorted by
  label. The search page links `person.html#<id>`.
- **The label of a list row can be `UNLABELED` while the person page shows a
  name** — a cheap list read has no assertion map to fall back to. That's the
  documented cost of not writing derived data (MODEL.md §9).
- `rerum` store caveat: devstore `/query` returns at most **10 documents** with
  no collection scoping, so a live listing is silently truncated. `?store=local`
  has no such limit. This is on the list blocking production data.

Journey: `index-journey.spec.js` (plus `core-journeys.spec.js` for the shell).

## 9. Read provenance; see a contested fact

Any evidence question on any page resolves the same way — the `evidence` id on
a ValueObject is a **Record**, and the Record has its own bare label:

```js
const assertions = await resolve({ store, target: personId })
const vo = assertions[NV.hasParent]                    // a lone ValueObject, or an Array
const prov = await eventProvenance({ store, event })   // -> { evidence, confidence }
```

The `evidence` ids are Records, and the assembled views already resolve them:
every `load*()` returns `evidenceLabels` and `personLabels` maps (id → human
label, via `readEntity()` + `deriveLabel()`, falling back to the id) so a page
never reads storage shapes or labels documents itself.

Two or more ValueObjects on one property **is** the representation of a
disagreement; no conflict is resolved at read time. `toAssertionRows()` renders
one row per ValueObject in stored order (assertion properties in the page's
`order`), each with its own source and confidence level — the weak claim is
visibly weak, never hidden or re-ranked behind the researcher's back.
Journeys: `tests/e2e/label-journey.spec.js` (evidence naming), and every journey
above asserts its own provenance rows.

## 10. Mark something as known-absent

A **Lacuna** is an ordinary Annotation asserted under `nv:Lacuna` whose value
describes the gap — so it carries evidence, confidence and a citation exactly
like a positive claim, and "absent because no evidence was sought" stays
distinguishable from "absent because it isn't in the source".

```js
markLacuna({
  store,
  target: personId,
  value: 'No father named in the 1861 census.',
  about: NV.hasParent,                 // the empty slot, for later reconciliation
  evidence: recordId,                  // the document that omits it
  confidence: 0.9,
  source: { citationNote: 'household schedule, folio 12' }
})
// -> the stored Annotation
const gaps = await lacunaeOn({ store, target: personId })   // -> Array<ValueObject>
```

`getPerson()` / `loadPerson()` return them as `lacunae`, `person.html` renders
them under the facts they qualify, and the birth/death views show the same rows,
so a researcher who searches and finds nothing leaves a finding aid behind
instead of a blank. There is **no** `clearLacuna()` yet: retiring a gap means
recording the fact, and the Lacuna stays as the record of the earlier search.
Unit tests: `tests/unit/model-lacuna.test.js`, and the end-to-end gap story in
`tests/unit/milestone.test.js`.

## 11. Migrate a DEER v1 record without a migration script

Every read path *also* works on old records, and a save re-asserts the facts in
the new shape instead of editing the old ones. Nothing bulk-rewrites storage, and
a page never has to ask which shape it got:

1. `convertLegacyEntity()` (in `js/adapters/legacy.js`) presents a v1 document
   in the vocabulary — `givenName`, `hasFather`, a `#legacy-` annotation — while
   leaving the stored bytes alone.
2. Evidence survives rather than being invented: the v1 document's own
   `evidence` id becomes each converted ValueObject's `evidence` *and* the
   annotation's `dcterms:source`, and a v1 inline citation object
   (`{ name, source, comment }`) maps onto `source.citationNote`,
   `source.citationSource` and `source.comment`. **No Record is synthesised** —
   where a v1 fact had no source document, its assertion has no `evidence`, and
   the pages render that as an unlabeled row rather than a fabricated citation.
3. Reads flag it: every assembled view returns `legacy: true` (or a
   `legacyAnnotation` count), which renders the banner and the inherited rows as
   read-only.
4. The first save writes the new shape (story 6) **alongside** the old documents:
   the v1 annotation stays, and its rows keep rendering next to the new ones, so a
   migrated record visibly shows both claims until the v1 documents themselves are
   retired. That duplication is the price of never rewriting shared data.
5. Because v1 mints **no `rel` at all**, a v1 person's events are invisible to
   the `rel` lookup. `search.eventsForPerson({ personId, role, legacyTypes })`
   falls back to `search.eventsWithoutIndex()` — `listByType()` per token plus a
   `participations()` probe per event — only when the rel lookup comes back
   empty, so new-shape reads stay single-query. Callers build the token list with
   `typeTokens()` (`birth.js`, `death.js`, `parents.js`, `tree.js`, `timeline.js`
   all pass it), which yields both the bare v1 word and the canonical URI.

Tests: `tests/unit/adapters-legacy.test.js` (conversion, synthesised Records) and
`tests/unit/model-death.test.js` (the legacy fallback: another person's death
must not leak, a witness must not be read as the deceased, rel-indexed records
skip the scan entirely).

## 12. Write against the shared devstore

```js
const store = await resolveStore({})                     // honours ?store=, installs the model default
const store = await createStore('rerum', {
    writeBase: 'https://tinydev.rerum.io',               // POST /create, /query; PUT /update
    readBases: ['https://devstore.rerum.io/v1'],          // GET /id/<hex>
    queryBase: 'https://tinydev.rerum.io',
    fetchImpl                                  // injectable, for tests
})
```

`js/model/config.js` holds those bases (mirroring antlers' `DEERConfig` keys), so
moving devstore → production is a config change and never a caller change.
`store-bootstrap` picks the adapter and calls `setDefaultStore()`, which is why
model functions take `store` but default to it. The no-URL default **in a browser
is `rerum` (the shared devstore)**, on purpose — a saved record should be usable
data, not a per-browser sketch — so a page opened without `?store=` writes to the
shared sandbox. `?store=local` is the isolated per-checkout store and what the
tests use.

Three consequences of swapping the adapter, all documented in MODEL.md §16 and
`docs/devstore-query-contract.md`:

- `RerumStore.update()` does **not** preserve ids — a read-modify-write on an
  existing entity mints a new `@id` and orphans references. That's why
  `saveLabel()` writes the cache *before* the fact and returns the id the store
  now serves, and why the model generally adds documents rather than editing them
  in place. An id-preserving `update()` is an open follow-up.
- `/query` is capped at 10 documents and is not collection-scoped.
- Writes are visible to every other researcher's sandbox, so automated tests
  must not do them. `tests/live/browser-devstore.mjs` is the manual, opt-in
  check; `tests/live/smoke-devstore.mjs` is the scripted probe.

---

## Follow-ups these journeys exposed

Not part of the workflows above, and deliberately not fixed under cover of
documentation:

- `death.html` offers one generic **"Parent"** role; split it into Mother/Father
  now that `nv:mother`/`nv:father` are canonical.
- **Cause of death, burial place and spouse/partner** are not modelled — no
  vocabulary term and no page field. The data model already accommodates all
  three as event participations/outcomes.
- `Place` is declared in the vocabulary and the JSON-LD context but **no page
  writes one**; places are schema text values today.
- `convertLegacyEntity()` mints **no `rel`**, so every DEER v1 read takes the
  bounded scan behind `legacyTypes` (`eventsWithoutIndex()`: one `listByType()`
  plus one `participations()` query per candidate event) instead of the single
  indexed query the new shape gets. It is correct on all five slices and slow on
  a large corpus; minting `rel` in the adapter, or migrating, fixes it once.
- `rec.label || '(untitled document)'` is duplicated across four page modules
  instead of living in one label helper.
- The **legacy fallback** in `loadDeath` is covered by unit tests only; the E2E
  journeys run on the new shape, and a live devstore leg for it was left out of
  scope because it writes shared data.
