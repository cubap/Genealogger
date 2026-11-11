# Genealogger

Genealogger is a **build-less, client-side JavaScript reference implementation of the entity + annotation + evidence ("eventities") model for person records**. An entity document stays almost empty; every fact is a separate Web Annotation that names the source Record supporting it, so competing claims coexist instead of overwriting each other. It aims to express genealogical records more robustly than the family-block encoding used by commercial sites, and it replaces the DEER v1 runtime it was originally written against.

Static ES6 modules and custom elements, served straight from the repo, talking to RERUM devstore.

Always reference these instructions first and fall back to search or shell commands only when you encounter information that does not match what is here.

## Working effectively

### Bootstrap
- `npm ci` — installs the dev toolchain only (vitest, @playwright/test, eslint, jsdom). There are **no runtime dependencies**.
- `npx playwright install --with-deps` — only if you will run E2E tests (~1 minute, downloads browsers).
- `npm run serve` — `http-server` on port 8080 for manual browsing. Any static server works.
- There is no build, no bundler and no transpile step. Never add one: browsers load `js/**` directly.

### Commands
- `npm run lint` — ESLint over `js/**/*.js`. Currently **0 errors / 0 warnings**; keep it there. Under 10 seconds.
- `npx vitest run tests/unit` — unit suite (25 files / 290 tests, ~20 seconds). `npm test` runs the same thing.
- `npx playwright test --project=chromium --workers=1` — E2E journeys (~1 minute; use `--workers=1`, parallel workers are flaky on Windows). All three browsers: `npx playwright test --workers=1`.
- `node tests/live/browser-devstore.mjs` — **opt-in** smoke against real devstore. It writes stamped probe records to shared storage. Do not add it to CI, and do not run it unless the change justifies touching shared data.

### Choosing a store
Every page honours `?store=`:
- `rerum` (default) — devstore, real network
- `local` — `localStorage`, no network. **This is what E2E uses**; journeys assert zero non-localhost requests.
- `fixture` — in-memory sample family. Note: the shipped fixture is an ES module with import attributes that some Node versions cannot parse; prefer driving the forms.
- `memory` — in-memory, for tests and storybook-style demos

`?person=<id>` (and legacy `#<id>`) deep-links a person on every page.

## Architecture (the parts that must not be violated)

- **Layering: `js/pages/*` → `js/model/*` → `js/adapters/*`.** Pages read the URL and render; model modules hold the domain; adapters implement the `Store` contract. Components and pages must never `fetch` or import an adapter directly — the store is injected by `js/adapters/store-bootstrap.js`. That seam is what makes the app testable off-network and portable off devstore.
- **Facts are annotations.** `js/model/assertions.js` writes `{ type: "Annotation", target: <entity>, body: { <propertyURI>: { value, evidence, "nv#confidence" } } }`. Reads group by body property; multiple assertions about one property are surfaced, never merged.
- **Relationships are events.** A parent link is a participation annotation on a birth Event: `body.nv#participant` + `body.nv#role`, with `rel: [agentId, eventId]` as a **reverse index for queries only** (devstore cannot filter dotted body properties). Never read `rel` as authority.
- **Entities carry at most a `label` cache.** `label` is a denormalization of the best evidenced name; `deriveLabel(entity)` (lists, bare documents) and `personLabel({ entity, assertions })` (detail) are the **one** label rule, owned by `js/model/search.js`. If those two ever disagree, `label.html` shows `#cacheNote`. Do not write a fourth labelling helper.
- **`deer-key` is the surviving v1 attribute name**, meaning "which property this field edits". Everything else DEER v1 (`js/deer*.js`, the `deer-*` elements, `js/utils/`) was deleted at the end of M3. E2E asserts `customElements.get("deer-…")` is undefined; keep that green.
- **DEER v1 data is still readable.** `js/adapters/legacy.js` converts v1 documents lazily. When you fix a v1 read gap, do it in the adapter or with a bounded fallback (see `legacySubjectEvents()` in `js/model/death.js`) — not by teaching pages about v1 shapes.
- Vocabulary lives in `js/model/vocabulary.js` (canonical terms and `CANONICAL_ROLES`). Hoist a term there rather than re-minting a namespace in a page module. `schemas/genealogger-context.jsonld` is its normative public counterpart and `GLOSSARY.md` fixes the words; `tests/unit/schemas-context.test.js` fails if code and context drift, so a new term goes in all three.

`docs/page-model-adapter.md` describes the page/model/adapter contract and `docs/devstore-query-contract.md` records the store's query behaviour. Read them before changing shared seams.

## Repository structure

```
index.html person.html label.html birth.html parents.html death.html tree.html timeline.html
css/site.css
js/pages/        one module per page
js/components/   gl-* custom elements (forms, views, pickers) — no network access
js/model/        config, vocabulary, entities, assertions, events, search, label, person,
                 birth, parents, death, tree, timeline, lacunae, default-store
js/adapters/     store.js contract, rerum-store, local-store, memory-store, fixture-store,
                 store-bootstrap, legacy (v1 reader), fixtures/
docs/            page-model-adapter.md, devstore-query-contract.md, agents/, adr/
schemas/         genealogger-context.jsonld — the normative JSON-LD context
nv/index.html    the nv: namespace URL, rendered from the context file
GLOSSARY.md      domain vocabulary; issues, tests and docs use these words
tests/unit       Vitest
tests/e2e        Playwright journeys on ?store=local
tests/live       opt-in devstore smoke
```

## Known constraints

- devstore `POST /query` returns **at most 10 documents with no paging**; `listByType` counts are floors, not totals. Production-scale queries are a known gap, not a bug to paper over locally.
- `RerumStore.update()` (PUT) returns a **new version under a fresh `@id`**, which can orphan annotations pointing at the old id. Avoid in-place rewrites of documents other annotations target.
- The Playwright port is derived from the checkout path (override with `GL_PORT`) because multiple worktrees share a machine. Never assume `:8080` belongs to your tree; if E2E failures look like "my page is stale", check which server answered.
- Back-to-back live smoke runs can make devstore slow enough that later legs time out and report `Loading…`. Re-run before debugging the pages.

## Validation

After any change:
1. `npm run lint` and `npx vitest run tests/unit` must pass.
2. If you touched a page, form, component, or the adapter layer: `npx playwright test --project=chromium --workers=1`.
3. Manual check: `npm run serve`, then open `http://localhost:8080/?store=local` and exercise the flow — add a birth record, open the person hub, follow Label / Parents / Death / Tree / Timeline, and confirm claims show their evidence and that two disagreeing sources both stay visible.
4. Do not write to devstore to "prove" UI behaviour; `?store=local` is the sandbox.

Environment notes: static files need only a static server; blocked external requests are visible in the console and degrade `?store=rerum` only. Screenshots of UI changes are welcome.

## Contribution style

- Small PRs against `main`, one slice each, tests in the same PR. Aim for a few hundred lines, not a thousand.
- Short imperative commit subjects; the body explains the *why* and records verified numbers.
- New behaviour gets a unit test at the model seam, and an E2E journey when it is user-visible.
