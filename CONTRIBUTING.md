# Contributing to Genealogger

Thank you for your interest in contributing to Genealogger! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

Please be respectful and constructive in all interactions. We aim to foster an inclusive and welcoming community.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/cubap/Genealogger/issues)
2. If not, create a new issue with:
   - Clear description of the bug
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Screenshots if applicable
   - Browser and OS information

### Suggesting Features

1. Check [Issues](https://github.com/cubap/Genealogger/issues) for existing feature requests
2. Create a new issue with:
   - Clear description of the feature
   - Use case and benefits
   - Potential implementation approach
   - Any relevant examples or references

### Submitting Code

1. **Fork the repository**
2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**
4. **Write or update tests**
5. **Ensure all tests pass**:
   ```bash
   npm test
   npm run test:e2e
   ```
6. **Lint your code**:
   ```bash
   npm run lint
   ```
7. **Commit your changes** with a descriptive message
8. **Push to your fork**
9. **Submit a Pull Request**

## Development Guidelines

### Code Style

- **JavaScript**: ES6+ syntax, no frameworks
- **HTML**: Semantic HTML5 elements
- **CSS**: Mobile-first, responsive design
- **Components**: Web Components (custom elements)
- **Naming**: camelCase for variables/functions, PascalCase for classes/components

### File Structure

```
Genealogger/
├── css/                  # Stylesheets
├── js/
│   ├── pages/            # One module per HTML page: reads the URL, calls the model, renders
│   ├── components/       # gl-* custom elements (forms, views, pickers) — no network access
│   ├── model/            # The eventities domain: entities, assertions, events, search, labels
│   └── adapters/         # Store contract + implementations (rerum, local, memory, fixture) and the legacy reader
├── docs/                 # page-model-adapter.md, devstore-query-contract.md, agents/
├── tests/
│   ├── unit/             # Vitest, model + component surface
│   ├── e2e/              # Playwright journeys against ?store=local
│   └── live/             # Optional scripts that run against real devstore
├── *.html                # One page per file, each loading js/pages/<name>.js
└── package.json
```

**The layering rule is load-bearing:** `pages → model → adapters`. A component or page must never
`fetch` or import an adapter directly; every read and write goes through `js/model/*`, which receives
the store from `js/adapters/store-bootstrap.js`. That is what makes the whole app testable against the
memory store and portable off devstore. See `docs/page-model-adapter.md`.

### Web Components

When creating a new web component:

1. Create a file in `js/components/` named `gl-[component-name].js`
2. Extend `HTMLElement`, use light DOM (the pages are inspectable and styleable as-is)
3. Pass data in through a property (`node.row = row`), not through re-parsed attributes
4. Dispatch a `CustomEvent` for user intent; let the page decide what to save
5. Register with `customElements.define('gl-…', …)` and import the module from the page script that uses it

Example:
```javascript
class GlMyComponent extends HTMLElement {
    set row(row) {
        this._row = row
        this.render()
    }

    render() {
        this.textContent = this._row?.label ?? '[ unlabeled ]'
    }
}

customElements.define('gl-my-component', GlMyComponent)
```

`deer-key` is the one retained DEER v1 attribute name: forms read it to know which property a field
edits (`deer-key="givenName"`). Do not reintroduce any other `deer-*` attribute or element — the v1
runtime was deleted at the end of M3, and the E2E suite asserts that `customElements.get('deer-…')`
is undefined.

### Testing

- **Unit tests** (`tests/unit/`) cover the model and the component surface. Test the shape a store
  returns, not the store: every model function takes `{ store, … }`, so pass a fake or
  `MemoryStore`. Importing real fixtures is preferred over hand-built docs when one exists.
- **E2E tests** (`tests/e2e/`) are user journeys that seed through the real forms on `?store=local`.
  They must assert zero non-localhost requests, and each worktree gets its own port (derived from the
  checkout path, `GL_PORT` to override) — never assume `:8080` is yours.
- **Live smoke** (`tests/live/browser-devstore.mjs`) is opt-in and writes probe records to the shared
  devstore. Do not add it to CI; run it manually before touching `js/adapters/`.

Run them:
```bash
npx vitest run tests/unit
npx playwright test --project=chromium --workers=1
npm run lint
```

### Error Handling

Each page catches at its own boundary and renders the failure in place (a banner, an empty state)
rather than throwing into the console — see `js/pages/tree.js`. Adapters throw plain `Error`s with the
response text, so page-level messages stay useful. Guard reads with the model's own fall-backs
(`[ unlabeled ]`, `legacySubjectEvents()`) instead of special-casing a document shape in a page.

## Pull Request Process

1. **Update documentation** if needed
2. **Ensure tests pass** and coverage is maintained
3. **Self-review** your code
4. **Request review** from maintainers
5. **Address feedback** and iterate

## Commit Messages

Short imperative subject ("Cover the label page in the live devstore smoke"), body explaining the
*why* — the finding or constraint that made the change necessary, and any numbers you verified. Pull
request titles carry the issue reference when there is one.

Example:
```
Rebuild ancestor timeline on the gl-* stack

The v1 timeline read hasFather/hasMother arrays, so it could only show the
majority claim. Deriving rows from birth events keeps every competing claim
visible, with its own evidence.

- 21 unit tests, 3 E2E journeys on ?store=local
- Closes #14 partially
```

## Getting Help

- Open an issue for questions or problems
- Check existing documentation
- Review existing components for patterns

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
