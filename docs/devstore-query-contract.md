# Live store query contract

Everything on this page was measured against the real devstore/tinydev services,
not inferred from RERUM docs. It explains why the adapters look the way they do
and what a new slice **must not** try to do server-side.

## Endpoints

| Operation | URL | Notes |
| --- | --- | --- |
| Create | `POST https://tinydev.rerum.io/create` | 201 + stored doc. **The client `@id` is ignored** — the server mints one. |
| Query | `POST https://tinydev.rerum.io/query` | 200 + array of latest-version docs. |
| Update | `PUT https://tinydev.rerum.io/update` | Doc travels in the body, no id in the path. Returns a **new** doc with a **new** `@id`; the previous doc gains `__rerum.history.next = [newId]`. |
| Read one | `GET https://devstore.rerum.io/v1/id/<24-hex>` | The only place `devstore.rerum.io/v1` works. |

`https://devstore.rerum.io/v1/create` is a **404**. `config.js` therefore keeps
two URLs: `BASE_URI` (document reads, and the id prefix stamped into every
`@id`) and `URLS.API_BASE` (writes and queries). Do not "unify" them.

The store is **append-only**: there is no delete. `RerumStore.remove()` returns
`false`, and reconciliation on update must expect the old version to linger.

## What a `POST /query` filter can express

Filters are Mongo-style dot-notation paths matched against stored documents.
Three properties of that, verified with throwaway documents, shape the whole
architecture:

1. **A path segment containing a `.` is unreachable.** Every property URI we use
   (`https://cubap.github.io/Genealogger/nv#participant`, `https://schema.org/...`)
   contains dots, so `body.<uri>.value` can never be filtered server-side. Any
   code that asks devstore for "annotations whose body property X is Y" returns
   `[]` — silently, and `[]` looks like "no data", not like "bad query".
2. **Unknown keys are applied, not ignored** — a nonsense filter returns zero
   rows. A wrong filter and an empty store are indistinguishable, so keep an
   assertion on the *posted* filter in unit tests.
3. **Dot-free top-level keys work, including array membership**, and clauses AND
   together: `{ rel: "<id>", type: "Annotation" }` is a valid indexed lookup.

Latest-version-only is expressed as
`'__rerum.history.next': { $exists: true, $size: 0 }`.

## Consequence: the `rel` reverse index

Because a participation annotation **targets the Event**, "which events did this
Person participate in?" cannot be answered by `target`, and cannot be answered by
a body filter (rule 1). The same applies to "who are this Person's children?"
from the parent's side.

The fix is one generic field, not bespoke per-relationship indexes: every
annotation may carry a top-level `rel` array of related entity ids — dot-free,
so queryable. `assert({ rel })` writes it, `participate()` sets
`rel: [agent, event]`, `deriveParentAssertions()` sets `rel: [child, parent]`,
and `RerumStore.query({ rel })` resolves it.

`rel` is a **non-authoritative index**. The body properties remain the truth;
`rel` may be absent (legacy data) or stale without invalidating the annotation.
Never read `rel` to decide what a fact *is* — only to find candidates.

`RerumStore.query()` now **throws** when given neither `target` nor `rel`. The
previous behaviour was a full-collection scan capped by the server, which
returned `[]` against real data: a silent wrong answer. In-memory stores keep
the loose behaviour (they can answer anything), which is exactly why
`tests/unit/adapters-rerum.test.js` runs the same scenarios against a fake that
reproduces these constraints.

## Consequences for future slices

- **Name typeahead cannot be a body query.** Either write a dot-free top-level
  index field (the `rel` trick, e.g. `sortKey`) or fetch a bounded set and
  filter client-side. Do not build it on `body.<uri>`.
- **Legacy docs have no `rel`, and no reader-side migration can give them one.**
  `query({ rel })` asks the *server* about a field those documents predate; the
  v1 -> v2 conversion happens after the fetch, so it cannot influence the
  filter. Reverse lookups over v1 data therefore use the bounded enumeration in
  `search.js` (`eventsForPerson({ legacyTypes })` -> `eventsWithoutIndex()`):
  list the candidate event types, then confirm each candidate with a `target`
  query, which *is* indexed. It is opt-in precisely so a new-shape read can
  never pay for a scan. Note that the v1 corpus actually sitting in devstore
  (the 2023 `mm-prototype` demo events) links events to nobody at all, so the
  scan legitimately finds nothing there — do not treat an empty result as proof
  the fallback is broken; the live smoke script says which case you are in.
- **A `@type` is spelled differently by each generation.** Verified live:
  a DEER v1 event is stored as `'@type': "Birth"` (scalar, bare local name)
  while a new-shape event is `'@type': ["Event", "…/nv#Birth"]` (array, subtype
  as a URI). `Persons` are the scalar bare `"Person"` in *both* generations.
  Since a filter matches a whole array too (`$all`), one token can only ever see
  one generation: `vocabulary.js#typeTokens()` returns both spellings and
  `search.js` queries each. Adding a URI token for `Person` buys nothing and
  costs a request.
- **`/query` returns at most 10 documents and offers no paging.** `limit`,
  `$limit` and `$skip` are all rejected or ignored. So every `listByType()`
  result is a **floor**, not a total: the index page cannot list an 11th person,
  and a legacy scan samples 10 events per type. This is the binding constraint
  on real data and the reason the app still needs a scoped collection query
  (unmodelled so far) or a migration into a store that pages.
- **Test fakes must reproduce the server**: server-minted ids, `__rerum`
  stamping on every document, and failing dotted paths. Two of the four defects
  fixed in the `rel` PR were invisible because the old fake was more generous
  than devstore.
- **One live smoke script is worth several unit tests.** Run
  `node tests/live/smoke-devstore.mjs` before believing a slice that touched the
  adapter; it writes a throwaway person to devstore, asserts the full birth
  round trip (rel lookup, canonical roles, derived `nv:hasParent`, per-field
  confidence, evidence labels), then makes a read-only pass over the real DEER
  v1 documents to prove the two-generation `@type` spelling and that the bounded
  scan neither throws nor escapes its bounds. Every fact on this page came from
  that script or a throwaway probe like it.
