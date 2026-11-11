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

Four ideas carry the whole app. [docs/MODEL.md](docs/MODEL.md) is the normative
write-up of each, with worked examples; this is the summary.

- **Entities are bare.** A `Person` document holds its `label` cache and nothing
  factual. `Event`s are typed with a subtype (`["Event", "…/nv#Birth"]`);
  `Record`s hold a citation label and are what facts cite.
- **Facts are annotations.** A claim is a Web Annotation whose `target` is the
  entity and whose `body` is one property, keyed by its URI, holding a
  ValueObject: the value plus `evidence` (the Record that says so),
  `nv#confidence` (on the claim, not the person) and optional `source` citation
  fields. Two documents that disagree produce two ValueObjects, and the UI shows
  both instead of picking a winner.
- **Relationships are events.** A parent link is a participation annotation on a
  birth Event — `nv#participant` = the parent, `nv#role` = `nv#mother` /
  `nv#father` / `nv#child`. There is no `hasFather` / `children` array on the
  person document (that is the DEER v1 shape, still read and lazily migrated).
- **Absence is asserted.** `nv:Lacuna` annotations mark an expected-but-
  unrecorded slot ("birth mother unknown", naming the census that omits her), so
  the app can tell "nobody looked" from "nothing there".

A fifth idea is about the code: every read of a person, tree or timeline is
**assembled** from annotations at request time, so the same data drives a list, a
hub, a tree and a timeline without a second copy that could drift.

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

Each journey below is summarised for a first-time user;
**[docs/WORKFLOWS.md](docs/WORKFLOWS.md)** shows the same journeys as the model
calls behind them, and `tests/e2e/*-journey.spec.js` runs them for real.

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

## Data patterns

The stored JSON shapes — entity, annotation, participation, Lacuna — and two
worked examples of ambiguity (competing fathers; a well-evidenced birthday
against a doubtful draft-card age) live in
**[docs/MODEL.md](docs/MODEL.md)**. Its §14 is the "what does this buy over a
family block" comparison, written against real documents.

The one pattern worth repeating here because it surprises people: `rel` on a
participation annotation is a **reverse index**, not the record. Devstore cannot
filter dotted body properties, so `rel` carries `[agent, event]` to make "which
events is this person in?" one query. Reads never treat it as authoritative —
the body remains the fact, and a record without `rel` (any DEER v1 document)
falls back to a bounded scan.

## Eventities alignment

Genealogger's patterns align with the [Eventities model](https://github.com/cubap/unews)
used in related projects (Rerum-Collection-Management, unews). The full
term-by-term correspondence table, and the three Eventities concepts not yet
adopted (lifecycle states, birth annotations, sibling eventities), are in
[docs/MODEL.md §13](docs/MODEL.md).

## Testing

```bash
npx vitest run tests/unit       # 25 files / 290 tests, model + component surface
npx playwright test --project=chromium --workers=1
node tests/live/browser-devstore.mjs   # every page against real devstore
npm run lint
```

E2E runs on `?store=local`, so it never writes to the shared devstore, and the
tree suite asserts zero non-localhost requests. Use `--workers=1`: parallel
browsers flake on Windows. Each checkout gets its own dev-server port.

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
