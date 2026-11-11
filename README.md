# Genealogger

A web-based genealogy application for creating, managing, and visualizing family relationships, built as a **reference implementation of the entity + annotation + evidence model** for person records: facts live in evidenced Web Annotations about bare entities, not in the entity documents themselves. That keeps competing claims side by side and traceable to the source record that says so, which the traditional family-block encoding (one document per family, facts as fields) cannot represent.

The storage layer is RERUM (`devstore` today, production RERUM as a config switch) in JSON-LD, following the DEER ("Data Encoding and Exhibition for RERUM") ideas without its v1 runtime.

## Features

- **Person Management**: Create and manage family members with detailed information
- **Per-claim evidence and confidence**: every fact names the source Record that asserts it, so two documents that disagree both stay visible
- **Event-centred records**: births and deaths are Event entities with typed participants (child, mother, father, informant, witness), so a parent link and a witness link are the same mechanism
- **Display names as data**: a person's `label` is a cache of the best evidenced name, refreshed through one label rule shared by every surface
- **Family Trees**: hierarchical visualization of family relationships with contested-parentage marking
- **Ancestor Timelines**: visual timeline showing ancestors across generations
- **Data Persistence**: all data stored in RERUM (Research and Educational Digital Object Management)

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, CSS3 — **no build step**, no framework
- **Components**: Custom Web Elements prefixed `gl-*`, thin views over a `js/model` use-case layer
- **Data Storage**: RERUM/TinyThings APIs (JSON-LD, Web Annotations), behind an injected store adapter
- **Visualization**: hand-rolled SVG (no D3 dependency)
- **Testing**: Vitest (unit), Playwright (E2E), plus a live devstore browser smoke
- **CI/CD**: GitHub Actions
- **Deployment**: GitHub Pages

## Getting Started

### Prerequisites

- Modern web browser with ES6+ support
- Internet connection (for RERUM API access)
- Node.js and npm (for development and testing)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/cubap/Genealogger.git
   cd Genealogger
   ```

2. Install dependencies (for testing):
   ```bash
   npm install
   ```

3. Open `index.html` in your browser or run a local server:
   ```bash
   npm run serve
   ```

4. Navigate to `http://localhost:8080`

### Development

- **Run unit tests**: `npm test`
- **Run E2E tests**: `npm run test:e2e` (Playwright, three browsers; `--workers=1` on Windows)
- **Lint code**: `npm run lint`
- **Start local server**: `npm run serve`, then open `http://localhost:8080`
- **Smoke the real store**: `node tests/live/browser-devstore.mjs` (drives every page against devstore; read-only for pages, leaves stamped probe records)

### Stores

`?store=<name>` selects the injected adapter on any page, and the choice persists across links:

| Store | Use |
| --- | --- |
| `rerum` (default) | devstore documents; pages cannot mutate shared data because the store's write path is the only mutator and the smoke guard blocks it |
| `local` | `localStorage`-backed documents — no network at all, used by most E2E journeys |
| `fixture` | the in-repo demo family (`js/adapters/fixtures/sample-family.js`) |
| `memory` | in-process store for tests |

## Usage

### Creating a person

1. `index.html` lists people; "New birth record" (`birth.html`) creates the Person, the birth Event, the typed participations, and the name/birth-date assertions — each citing the source Record you attach with the evidence picker.
2. `person.html` is the hub for one person: everything shown there is derived from annotations at read time, never stored twice.
3. `label.html` records the person's display name **with its source** and refreshes the cached `label` the lists read.

### Adding family relationships

`parents.html` records mother/father as `nv:parent`+role participations on a birth Event (the child's own document stays fact-free), and `death.html` records a death with its informants and witnesses. `tree.html` and `timeline.html` derive their edges and rows from those events.

### Viewing family trees

`tree.html?person=<id>` draws ancestors and descendants (bounded depth, `?generations=N`), with contested parentage marked on the edges rather than silently resolved.

### Viewing ancestor timelines

`timeline.html?person=<id>` lists the ancestor lines and dated markers, each citing a source document.

## Project Structure

```
Genealogger/
├── css/site.css              # One stylesheet, no framework
├── js/
│   ├── pages/                # One module per page: DOM wiring only
│   ├── components/           # gl-* custom elements; thin, documented views
│   ├── model/                # Use-case layer: person, birth, death, parents,
│   │                         #   label, tree, timeline, search, assertions,
│   │                         #   events, entities, vocabulary (terms live here)
│   └── adapters/             # Store contract + implementations
│       ├── store.js          #   the interface every adapter satisfies
│       ├── rerum-store.js    #   devstore/production RERUM (+ lazy v1 migration)
│       ├── local-store.js    #   browser storage
│       ├── memory-store.js   #   tests
│       ├── fixture-store.js  #   demo family
│       └── legacy.js         #   read-only DEER v1 shape conversion
├── docs/                     # MODEL.md, API.md, WORKFLOWS.md, adr/, page-model-adapter.md
├── schemas/
│   └── genealogger-context.jsonld  # normative JSON-LD context for nv: + reuse
├── nv/index.html             # the nv: namespace URL, rendered from the context
├── GLOSSARY.md               # the words this repo agrees to use
├── tests/
│   ├── unit/                 # Vitest
│   ├── e2e/                  # Playwright journeys
│   └── live/                 # browser-devstore.mjs smoke
├── index.html birth.html death.html person.html parents.html
├── label.html tree.html timeline.html
└── .github/workflows/ci-cd.yml
```

Layers point one way: `pages → model → adapters`. A page never fetches or writes documents itself, and the model layer performs no DOM work.

## Documentation

| Document | What it answers |
|---|---|
| [USER_GUIDE.md](USER_GUIDE.md) | using the app: pages, forms, stores, troubleshooting |
| [GLOSSARY.md](GLOSSARY.md) | the words this repo agrees to use, and the ones it avoids |
| [docs/MODEL.md](docs/MODEL.md) | **why the data is shaped this way** — entities, annotations, evidence, conflicts, lacunae, worked examples |
| [docs/API.md](docs/API.md) | every exported function in `js/model/` and `js/adapters/` |
| [docs/WORKFLOWS.md](docs/WORKFLOWS.md) | each user journey as the model calls behind it |
| [docs/page-model-adapter.md](docs/page-model-adapter.md) | the page → model → adapter wiring contract |
| [docs/devstore-query-contract.md](docs/devstore-query-contract.md) | what the RERUM query endpoint can and cannot answer |
| [nv/](nv/index.html) | the `nv:` namespace, rendered from the normative JSON-LD context |

## API Documentation

### RERUM endpoints in use

- **Read**: `GET https://devstore.rerum.io/v1/id/<hex>` — the current version of a document
- **Create**: `POST https://tinydev.rerum.io/create` — 201 + the stored doc, server-minted `@id`
- **Query**: `POST https://tinydev.rerum.io/query` — filter in the body; **at most 10 documents, no paging** (see `docs/devstore-query-contract.md`)
- **Update**: `PUT https://tinydev.rerum.io/update` — returns a NEW version under a fresh `@id`

Production RERUM is a second base-URI pair in `js/model/config.js`; no caller changes.

### Data format

JSON-LD entities with Web Annotation assertions. The terms are defined
normatively in [`schemas/genealogger-context.jsonld`](schemas/genealogger-context.jsonld),
rendered at [the `nv:` namespace URL](https://cubap.github.io/Genealogger/nv), and
named in [GLOSSARY.md](GLOSSARY.md). One family, as stored:

```json
{ "@id": "…/id/ada", "@type": "Person", "label": "Ada Gordon" }

{ "@id": "…/id/certificate", "@type": "Record",
  "label": "Parish baptism certificate, 1815" }

{ "@id": "…/id/ada-birth", "@type": ["Event", "…/nv#Birth"], "label": "Birth of Ada Gordon" }

// a fact: an annotation about the Person, carrying its own evidence
{ "@id": "…/id/anno-birthdate", "type": "Annotation",
  "target": "…/id/ada",
  "body": { "https://schema.org/birthDate": {
      "value": "1815-12-10",
      "evidence": "…/id/certificate",
      "…/nv#confidence": 0.95 } } }

// a relationship: a typed participation in an Event, also evidenced
{ "type": "Annotation", "target": "…/id/ada-birth", "rel": ["…/id/george", "…/id/ada-birth"],
  "body": { "…/nv#participant": { "value": "…/id/george", "evidence": "…/id/certificate" },
            "…/nv#role": { "value": "…/nv#father" } } }
```

Nothing above is derived-and-stored twice: the person document has no `birthDate`, no `hasFather`, no name fields. The `label` cache is the single exception, and `label.html` keeps it honest.

## Testing

### Unit tests

```bash
npm test                        # everything vitest is configured for
npx vitest run tests/unit       # 24 files
```

Unit tests cover the model layer and the components' collection/dispatch surface against an injected fake store — no network, no fixtures leaking into assertions about behaviour.

### E2E tests

```bash
npx playwright test --project=chromium --workers=1
```

Journeys drive real pages against `?store=local`, so they seed families through the forms and assert on what a researcher sees.

### Live smoke

`node tests/live/browser-devstore.mjs` runs every page against real devstore with a network guard that fails the run if a page attempts a write. It is the only check that a page works against stored data rather than an injected fake.

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write/update tests
5. Ensure all tests pass
6. Submit a pull request

### Code Style

- ES6+ JavaScript
- No external frameworks (vanilla JS only)
- Web Components for modular UI
- Semantic HTML5
- Mobile-first responsive design

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [DEER Framework](https://github.com/CenterForDigitalHumanities/deer) - Data Encoding and Exhibition for RERUM; the v1 runtime this app was rewritten off, and whose v2 shape informs the `gl-*` elements
- [RERUM](https://rerum.io/) - Research and Educational Digital Object Management
- [Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) - the assertion shape every fact uses

## Contact

- Author: cubap
- Repository: [github.com/cubap/Genealogger](https://github.com/cubap/Genealogger)

## Roadmap

- [ ] User authentication and authorization
- [ ] Advanced search and filtering
- [ ] Export family data (GEDCOM format)
- [ ] Mobile-native application
- [ ] Offline support (PWA)
- [ ] Multi-language support (i18n)
- [ ] Advanced analytics and reporting
