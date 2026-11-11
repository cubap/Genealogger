# Genealogger User Guide

> **Encoding and Exhibition of Genealogical Entities** — a browser application for recording and visualizing family relationships as evidenced annotations in RERUM/TinyThings.

## Overview

Genealogger is a browser-based tool for creating and navigating genealogical data. Its premise is the **eventities** pattern: an entity document stays almost empty, and every fact about it is a separate Web Annotation that names the source record which says so. Two documents that disagree about a birth date therefore coexist, each traceable, instead of one silently overwriting the other.

**Core capabilities:**
- Create people through a birth or death record, or name an existing person on the label page
- Record births and deaths as **events** with typed participants (child, mother, father, informant, witness)
- Attach evidence and confidence to each individual claim
- Navigate family trees (parent-child hierarchies), including contested parentage
- Visualize ancestor timelines across generations
- All data lives in RERUM (`devstore` by default; `?store=local` for an offline sandbox)

## Getting Started

1. Open `index.html` — the person list (or run `npm run serve` and browse to `http://localhost:8080`)
2. Add a birth record (`birth.html`); that creates the Person, the birth Event, and the evidenced name/date claims in one submit
3. `person.html` is the hub for a person: named facts, events, sources, and links to the detail pages
4. `tree.html` and `timeline.html` derive their views from those events
5. Add `?store=local` to any URL to work entirely in browser storage, and `?person=<id>` (or `#<id>`) to deep-link a person

## Core Concepts

### Entities

Bare documents that identify a thing. Types in use:

- **Person** — an individual. Carries a `label` cache of its display name and nothing else factual.
- **Event** — a life event, typed with a subtype (`@type: ["Event", "…/nv#Birth"]`): birth, death, and so on.
- **Record** — a source document (a certificate, a census return). It holds a citation label, not genealogical facts; facts cite it.

### Assertions

Facts are Web Annotations whose `target` is the entity and whose `body` is a single property keyed ValueObject:

```json
"body": { "https://schema.org/birthDate": {
    "value": "1815-12-10",
    "evidence": "https://devstore.rerum.io/v1/id/certificate",
    "https://cubap.github.io/Genealogger/nv#confidence": 0.95 } }
```

- `evidence` — the Record id that says so
- `nv#confidence` — a number on the claim, not on the person
- `source.citationSource` — a human-readable citation string
- Multiple assertions about the same property are **not** merged; the UI groups them and counts the disagreement

### Lacunae

`nv:Lacuna` annotations mark an expected-but-unrecorded slot ("birth mother unknown"), so the app can tell "absent because unrecorded" from "absent because nobody looked".

### Relationships are events, not arrays

A parent link is a participation annotation on a birth Event: `nv#participant` = the parent, `nv#role` = `nv#mother`/`nv#father`/`nv#child`. There is no `hasFather`/`children` array on the person document (the DEER v1 shape, which the app still reads and lazily migrates).

### HTML surface vocabulary

The `deer-key` attribute name survives the DEER v1 rewrite as the recognised name for "which property this field edits" (`deer-key="givenName"`, `deer-key="hasMother"`, `deer-key="name"`). The `gl-*` forms read it. Nothing else from DEER v1 remains.

### Web Components

| Component | Purpose |
|-----------|---------|
| `<gl-person-chip>` | The person list row / picker row, and the owner of the `person.html#<id>` href |
| `<gl-typeahead-filter>` | Person search over `model/search` |
| `<gl-birth-form>`, `<gl-death-form>`, `<gl-parents-form>`, `<gl-label-form>`, `<gl-person-name-form>` | Light-DOM fact forms; they collect fields and dispatch, they do not save |
| `<gl-assertion>` | One claim row: value, evidence label, confidence, provenance |
| `<gl-evidence-picker>` | Attach or name the Record a claim cites |
| `<gl-tree-view>` | SVG family tree, contested edges marked |
| `<gl-ancestor-timeline>` | Generation rows and dated markers |

Forms and views never touch the network; pages call `js/model/*`, which calls the injected store adapter.

## Workflows

### Recording a birth (the usual way a person comes into existence)

1. Open `birth.html` (optionally `?person=<id>` to record about someone already stored)
2. Fill the child's name and birth details, choose a confidence, and attach the source Record with the evidence picker
3. Add parents as participants — each participation is its own claim and can cite its own Record
4. Submit. You get a Person, a birth Event, and evidenced assertions; nothing factual is written onto the Person document

### Naming a person

`label.html?person=<id>` (reached by the **Label** button on the hub) records a display name with its source and refreshes the `label` cache the lists read. Name *parts* (`givenName`, `familyName`, …) are separate evidenced claims; editing a name means adding another assertion, never mutating an old one.

### Adding parents later

`parents.html?person=<id>` records or amends the mother/father claims on the child's birth event — reusing an existing birth event when there is one, creating one when there is not, and showing every competing claim per role rather than picking a winner.

### Viewing family relationships

1. `tree.html?person=<id>` draws ancestors and descendants; depth is bounded (`?generations=N`, default two each way)
2. Dashed edges and the ⚠ marker mean sources disagree about that parentage — every competing claim keeps its own visible edge
3. Click a node to open that person's hub; `timeline.html?person=<id>` shows the same family as generation rows with dated markers

### Recording a death

`death.html?person=<id>` stores the death Event with date and place claims and typed participants (informant, witness), including which parent was still living — the shape that family-block encodings cannot express.

## Data Patterns

### Entity structure

```json
{
  "@id": "https://devstore.rerum.io/v1/id/...",
  "@type": "Person",
  "label": "Ada Gordon"
}
```

`label` is the only denormalized property, and it is a **cache** of the best evidenced name: lists read it because it costs one document, detail pages derive it from the assertions. When the two disagree, `label.html` says so.

### Annotation pattern

```json
{
  "type": "Annotation",
  "target": "https://devstore.rerum.io/v1/id/ada",
  "body": {
    "https://schema.org/birthDate": {
      "value": "1815-12-10",
      "source": { "citationSource": "Parish baptism certificate, 1815" },
      "evidence": "https://devstore.rerum.io/v1/id/certificate",
      "https://cubap.github.io/Genealogger/nv#confidence": 0.95
    }
  }
}
```

### Participation pattern

```json
{
  "type": "Annotation",
  "target": "https://devstore.rerum.io/v1/id/ada-birth",
  "rel": ["https://devstore.rerum.io/v1/id/george", "https://devstore.rerum.io/v1/id/ada-birth"],
  "body": {
    "https://cubap.github.io/Genealogger/nv#participant": { "value": "https://devstore.rerum.io/v1/id/george" },
    "https://cubap.github.io/Genealogger/nv#role": { "value": "https://cubap.github.io/Genealogger/nv#father" }
  }
}
```

`rel` is a reverse index for "which events is this person in?" — devstore cannot filter dotted body properties. Reads never treat it as authoritative; the body remains the record.

## Eventities Alignment

Genealogger's data patterns align with the [Eventities model](https://github.com/cubap/unews) used in related projects (Rerum-Collection-Management, unews).

| Pattern | Genealogger | Eventities |
|---------|-------------|------------|
| Entity type | `@type: Person`; `["Event", "nv#Birth"]` | `slu:Person`, `slu:CampusOrganization` |
| Annotation | Web Annotation, body keyed by the property URI | `oa:motivation` (property-assertion, relationship-assertion) |
| Evidence | `body.<prop>.evidence` → a Record id | `slu:evidence` |
| Confidence | `body.<prop>.nv#confidence` | `slu:confidence` |
| Attribution | optional `creator` / `dcterms` on the annotation | `dcterms:creator`, `dcterms:created` |
| Relationships | typed participation on an Event (`nv#participant` + `nv#role`) | relationship assertions between entities |
| Known gaps | `nv:Lacuna` annotations | `Lacuna` |

### Still to adopt

1. **Lifecycle States** — Eventities transitions entities `encountered` → `anchored` → `described` → `related` → `reconciled` → `absorbed` → `invalidated`. Genealogger has no lifecycle field yet; it would sit on the Person alongside `label`.
2. **Birth Annotations** — the `slu:birthAnnotation` pattern records the annotation that first created an entity. Genealogger infers provenance from event participation instead.
3. **Sibling Eventities** — `slu:siblingEventities` tracks the same concept across collections. Genealogger has no collection scoping against production RERUM yet.

## Testing

```bash
npx vitest run tests/unit       # 24 files, model + component surface
npx playwright test --project=chromium --workers=1
node tests/live/browser-devstore.mjs   # every page against real devstore
npm run lint
```

## Deployment

Genealogger is deployed via GitHub Actions to GitHub Pages:
- **Trigger**: Push to `main` branch
- **Jobs**: Unit tests → E2E tests → Deploy
- **Target**: `gh-pages` branch

## Troubleshooting

- **A page shows `[ unlabeled ]`**: nothing names that entity — no cached `label` and no evidenced name claim. `label.html?person=<id>` fixes it.
- **A fact is missing that you expect**: it is an annotation. Check that its `target` is the entity (for facts) or the Event (for relationships), and open the person's provenance view.
- **An old record renders but edits look odd**: DEER v1 documents are read through the legacy adapter and converted lazily; the page says so in its banner. Save once to migrate.
- **`?store=local` shows nothing**: it is a separate sandbox from devstore and holds only what you saved in that browser.
- **Lists look incomplete against devstore**: `POST /query` returns at most 10 documents with no paging (`docs/devstore-query-contract.md`). Counts are floors, not totals.

## Contributing

1. Install dependencies: `npm install`
2. Run tests: `npm test && npm run test:e2e`
3. Check lint: `npm run lint`
4. Open a pull request targeting `main`

## License

See repository license for details.
