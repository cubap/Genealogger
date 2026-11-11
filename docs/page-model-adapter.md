# Page → Model → Adapter wiring (M2 recipe, reused by M3)

The birth slice (`birth.html`) is the reference vertical slice: the first page
rebuilt on the new stack. This note is the copy-paste recipe for doing the same
to the next page. It assumes the M1 model layer (`js/model/`) and store adapters
(`js/adapters/`) already exist — do not duplicate their logic in a page.

## The one rule

A page is **wiring only**. It moves data between `gl-*` components and the model
API. It never calls `fetch`, and it never encodes a storage/JSON shape. If you
find yourself building a request body or reading `__rerum` in a page or
component, it belongs one layer down.

```
birth.html            static HTML: form fields keep their deer-key names
   └─ js/pages/birth.js        the ONLY script; explicit handler, no data shapes
        ├─ resolveStore()      adapters/store-bootstrap.js   (which store?)
        ├─ saveBirth/loadBirth model/birth.js                 (domain use-case)
        └─ <gl-*> components   components/gl-*.js            (DOM ↔ plain objects)
```

## Layer responsibilities

| Layer | Module | Owns | Never does |
|-------|--------|------|-----------|
| Page  | `js/pages/<page>.js` | resolve store once; translate component events into model calls; re-render | fetch, JSON shapes, domain rules |
| Components | `js/components/gl-<name>.js` | render/collect plain JS objects; dispatch `gl-*` custom events | fetch, storage shapes, saving |
| Use-case model | `js/model/<page>.js` | orchestrate entities/events/assertions into a user story; map field names → property URIs | DOM, network |
| Primitives | `js/model/{entities,events,assertions,person,search}.js` | generic graph operations, derived reads (`nv:hasChild`) | page-specific names, network |
| Adapter | `js/adapters/<x>-store.js` | the Store contract + wire format + (RERUM) lazy legacy migration | domain rules, DOM |

## Wiring a new page in M3 — checklist

1. **Pick the store once.** In the page module call `await resolveStore()`. It
   reads `?store=` (falling back to `rerum`/devstore in the browser) and installs
   the result as the model default, so model calls need no per-call `store`
   argument.
   Production/devstore is a config switch in `store-bootstrap.js`, never a page
   edit.
2. **Keep the HTML surface.** Reuse the familiar `deer-key` attribute names on
   form fields; the `gl-*` component reads those names. New custom elements use
   the `gl-` prefix only; replace the old `deer-*` elements, don't patch them.
3. **Add a use-case module** like `model/birth.js` with `saveX()` / `loadX()`.
   It composes the M1 primitives and is the only place the page's field names map
   to property URIs. Put per-assertion `nv:confidence` in here (write path) and
   the read-only assembled view (read path) in here.
4. **Submit handler:** `<form>` submit → component dispatches `gl-<page>-submit`
   with a plain data object → page calls `saveX({ store, ...detail })` →
   `history.replaceState` the new id into `?…=` → re-render from `loadX()`.
5. **Read view = audit list.** Render every assertion through
   `toAssertionRows()`; it emits one row per ValueObject, so conflicting sources
   coexist and are never merged (constraint: disagreement is preserved).
6. **Provenance for display.** Facts are evidenced by their Event; the event is
   evidenced by a Record. `loadBirth` aliases each event id to its record label
   so a fact row names its source document. Reuse that aliasing.
7. **Lazy migration.** Legacy records read through `RerumStore` are converted to
   the new shape by the legacy reader on every read (`#legacy-` ids flag them).
   Render them read-only; the first save goes through `saveX`, which writes only
   the new shape. No batch migration step.
8. **Never store `nv:hasChild`.** Compute it at read time with
   `search.childrenOf()`. Keep that invariant.
9. **Reverse lookups need a `rel` index, not a body query.** devstore cannot
   filter any path containing a `.` — which is every property URI — so
   "find annotations about X from X's side" only works through the top-level
   `rel` array (`assert({ rel })`, `participate()`, `deriveParentAssertions()`
   all write it). Anything with no `target` and no `rel` throws in
   `RerumStore.query()` rather than scanning. See
   [devstore-query-contract.md](devstore-query-contract.md).
10. **Roles are canonical URIs.** Map form tokens through `ROLE_TOKENS` /
    `CANONICAL_ROLES` (`nv#mother`, `nv#father`, …); a bare `"mother"` string is
    unfindable and `deriveParentAssertions()` skips it.

## Testing pattern

- Model and adapter logic is unit-tested without a DOM: use
  `createMemoryStore()` for use-cases and an **injected fake `fetch`** for
  `RerumStore` (see `tests/unit/adapters-rerum.test.js`).
- Component **pure helpers** (`parseConfidence`, `toAssertionRows`) are exported
  and tested directly; rendering itself stays presentational.
- E2E runs against the default **LocalStore** so create → reload → assertions
  persist deterministically with no network and no devstore pollution
  (`tests/e2e/birth-journey.spec.js`).

## Component reference (copy for new components)

- `gl-birth-form` — light DOM; reads `deer-key` fields + `deereventtype`;
  collects `[data-confidence-for]` fact confidences and `[data-participant]`
  role rows; emits `gl-birth-submit` with a plain object. Never saves.
- `gl-assertion` — shadow DOM; one ValueObject → one row (value, evidence label,
  confidence); `readonly` suppresses the control for the migrated view.
- `gl-evidence-picker` — shadow DOM; names the source Record separately from the
  facts; the page feeds existing records via `.records`.
