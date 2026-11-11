# Nothing derived is stored; views are assembled, with `rel` the one index

A Person document carries its type and the `label` cache and nothing else —
parents, children, witnesses and vital dates are all discovered by reading the
events a Person participates in, so a record can hold two contradicting fathers
without the storage layer having to pick one. The trade is read cost: every
assembled view is several queries rather than one document, which on devstore is
bounded hard by `/query` returning at most ten documents with no paging (see
`docs/devstore-query-contract.md`).

## Considered options

- **Store relationships on the Person** (`nv:hasParent`, `nv:hasChild`, or the
  GEDCOM/Ancestry family block). Rejected: it forces a single truth per slot, and
  "which source says so, and how sure are we" is the thing this project exists to
  model. `nv:hasParent` *is* written, but always as a derivation — from a
  participation that carries its own evidence, or, for old data, converted off a
  v1 `hasFather`/`hasMother`. `nv:hasChild` is never written at all and exists in
  the vocabulary only so the derived direction has a name; where a screen needs a
  label for it, the page passes `NV.hasChild` as a display property, not a write.
- **Cache the best-evidenced value of each fact onto the Person.** Rejected except
  for `label`, which is the one value a list genuinely needs before it knows which
  Person it is looking at. Everywhere else the cache would go stale the moment a
  second source disagrees.

## Consequences

- `rel: [agent, event]` on a participation Annotation is a **reverse index, not a
  second record**: devstore cannot filter dotted body properties, so the query
  "which events is this person in?" needs the id at the top level. It is minted by
  the write path, and no read treats it as authoritative — `eventsForPerson()`
  re-checks the Role in the Body, and a document with no `rel` (any DEER v1
  record) still resolves through the bounded `legacyTypes` scan. Adding a second
  denormalized slot like `rel` would need its own argument.
- The `label` cache is allowed to disagree with the assertions, and surfacing that
  disagreement (`cacheStale` on `loadLabel()`) is a feature of the label page
  rather than a bug to reconcile silently.
