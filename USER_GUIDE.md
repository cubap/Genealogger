# Genealogger User Guide

> **Encoding and Exhibition of Genealogical Entities** — a DEER-based web application for recording and visualizing family relationships through RERUM/TinyThings annotation patterns.

## Overview

Genealogger is a browser-based tool for creating and navigating genealogical data. It uses the [DEER framework](https://github.com/CenterForDigitalHumanities/deer) (Data Encoding and Exhibition for RERUM) to store entities as JSON-LD annotations in the RERUM store.

**Core capabilities:**
- Create and edit Person entities with family relationships
- Record birth and death events
- Navigate family trees (parent-child hierarchies)
- Visualize ancestor timelines across generations
- View entity details with evidence attribution

## Getting Started

1. Open `index.html` in a browser (or deploy via GitHub Pages)
2. Navigate to `person.html` to create or view a person
3. Use `tree.html` for family tree visualization
4. Use `timeline.html` for ancestor timeline visualization

## Core Concepts

### Entities

Genealogger works with JSON-LD entities stored in RERUM. The primary entity types are:

- **Person** — an individual with family relationships (parents, children)
- **Family** — a family unit connecting parents and children
- **Event** — a life event (birth, death, marriage)

Each entity has:
- `@id` — unique identifier (RERUM URI)
- `@type` — entity type (Person, Family, etc.)
- `familyName`, `givenName` — name properties
- `birthDate`, `deathDate` — date properties
- `parents`, `children` — relationship arrays

### DEER Attributes

Components use custom attributes to load and render data:

| Attribute | Purpose |
|-----------|---------|
| `deer-id` | URI of the entity to render |
| `deer-type` | Entity type for forms and components |
| `deer-key` | Property key for annotations |
| `deer-source` | URI of asserting annotation |
| `deer-motivation` | Annotation motivation (property-assertion, etc.) |
| `deer-attribution` | Creator of the annotation |
| `deer-list` | Property containing resource arrays |

### Web Components

Genealogger defines custom HTML elements:

| Component | Purpose |
|-----------|---------|
| `<deer-entity>` | Generic entity display |
| `<deer-person>` | Person-specific display with family links |
| `<deer-event>` | Event display (birth, death) |
| `<deer-list>` | List rendering for arrays |
| `<deer-tree>` | D3.js family tree visualization |
| `<deer-timeline>` | D3.js ancestor timeline visualization |
| `<deer-children-list>` | Expandable children list |
| `<deer-ancestor-timeline>` | Generation-based ancestor timeline |

## Workflows

### Creating a Person

1. Navigate to `person.html`
2. Fill in name fields (`familyName`, `givenName`)
3. Add birth/death dates if known
4. Submit — the entity is created in RERUM and returned with a unique `@id`

### Viewing Family Relationships

1. Open `tree.html` with a person's `@id`
2. The tree fetches the person and their children recursively
3. Click a node to view entity details
4. Navigate to `timeline.html` to see ancestor generations over time

### Recording Events

1. Navigate to `birth.html` or `death.html`
2. Select or create a Person
3. Record event details (date, location, evidence)
4. Submit — the event is annotated to the Person entity

## Data Patterns

### Entity Structure

```json
{
  "@id": "https://devstore.rerum.io/v1/id/...",
  "@type": "Person",
  "familyName": "Smith",
  "givenName": "Jane",
  "birthDate": "1950-01-01",
  "deathDate": "2020-06-15",
  "parents": ["https://devstore.rerum.io/v1/id/..."],
  "children": ["https://devstore.rerum.io/v1/id/..."]
}
```

### Annotation Pattern

Genealogger follows the DEER annotation pattern:

```json
{
  "@context": "http://www.w3.org/ns/anno.jsonld",
  "type": "Annotation",
  "motivation": "property-assertion",
  "target": "https://devstore.rerum.io/v1/id/...",
  "body": {
    "familyName": { "value": "Smith" }
  }
}
```

### Evidence Attribution

Each annotation can carry:
- `deer-source` — URI of the asserting source
- `deer-attribution` — creator of the annotation
- `deer-evidence` — supporting evidence URI

## Eventities Alignment

Genealogger's data patterns align with the [Eventities model](https://github.com/cubap/unews) used in related projects (Rerum-Collection-Management, unews). Key alignments:

### Current Alignment

| Pattern | Genealogger | Eventities |
|---------|-------------|------------|
| Entity type | `@type: Person` | `slu:Person`, `slu:CampusOrganization` |
| Annotation | DEER `motivation` attribute | `oa:motivation` (property-assertion, relationship-assertion) |
| Evidence | `deer-source`, `deer-evidence` | `slu:evidence`, `slu:confidence` |
| Attribution | `deer-attribution` | `dcterms:creator`, `dcterms:created` |
| Relationships | `parents`, `children` arrays | `slu:siblingEventities`, relationship assertions |

### Future Considerations

The Eventities model introduces lifecycle states and richer evidence patterns that could enhance Genealogger:

1. **Lifecycle States** — Entities transition through states: `encountered` → `anchored` → `described` → `related` → `reconciled` → `absorbed` → `invalidated`. This could track confidence in genealogical assertions over time.

2. **Birth Annotations** — The `slu:birthAnnotation` pattern records the first annotation that created an entity, useful for tracking original sources.

3. **Confidence Scoring** — The `slu:confidence` property allows numeric confidence in assertions, useful for distinguishing well-sourced relationships from speculative ones.

4. **Sibling Eventities** — The `slu:siblingEventities` pattern tracks related entities that represent the same concept across different collections or sources.

5. **Lacuna Markers** — The `Lacuna` type represents known gaps in knowledge, useful for marking unknown parents or missing dates.

These patterns are not yet implemented in Genealogger but could be added as `slu:` prefixed properties on entities and annotations.

## Testing

### Unit Tests
```bash
npm test          # Run Vitest unit tests (35 tests)
```

### E2E Tests
```bash
npm run test:e2e  # Run Playwright E2E tests (15 tests, 3 browsers)
```

### Code Quality
```bash
npm run lint      # Run ESLint
```

## Deployment

Genealogger is deployed via GitHub Actions to GitHub Pages:
- **Trigger**: Push to `main` branch
- **Jobs**: Unit tests → E2E tests → Deploy
- **Target**: `gh-pages` branch

## Troubleshooting

- **Entity won't load**: Check the `@id` URI is valid and accessible
- **Tree won't render**: Ensure the person has `children` or `parents` arrays
- **Form won't submit**: Check browser console for DEER errors
- **Annotations missing**: Verify RERUM store connectivity

## Contributing

1. Install dependencies: `npm install`
2. Run tests: `npm test && npm run test:e2e`
3. Check lint: `npm run lint`
4. Open a pull request targeting `main`

## License

See repository license for details.
