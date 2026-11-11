# Migrate DEER v1 lazily, at read time; never bulk-rewrite devstore

Old Genealogger data stays where it is and is converted on the way into memory
(`js/adapters/legacy.js`, applied inside `RerumStore` for both `query()` and
`listByType()` and memoized per instance), rather than being rewritten in place
once. The decisive constraint is that RERUM's `PUT /update` answers with a **new
version under a freshly minted `@id`**, so a bulk pass would orphan every
annotation that targeted the old id — and it could not even enumerate the corpus,
because `listByType()` shares `/query`'s ten-document, no-paging ceiling. A real
migration is therefore a separate, reviewed job against a store that pages, not a
script in this repo.

## Consequences

- `js/adapters/legacy.js` is load-bearing for as long as old devstore data exists,
  and is headed `TRIMMABLE` so its removal stays a deliberate act. The conversion
  runs in `RerumStore` only — `MemoryStore` and `LocalStore` hold new-shape
  documents, and tests feed them already-converted fixtures.
- Reads must tolerate both shapes. Because v1 mints no `rel`, the reverse-index
  lookup in `eventsForPerson()` comes back empty for old records and falls through
  to `eventsWithoutIndex()`: a bounded scan that lists each legacy type and checks
  its participations, shared by all five event slices rather than re-implemented
  per page. It samples ten events per type (the `/query` ceiling again), so a v1
  record past the tenth of its type is simply unreachable.
- **Writes are always new-shape, and additive.** A page fixes a v1 fact by
  asserting new documents, never by editing the v1 one in place, because the v1
  document holds facts the converter cannot round-trip: `person.js` deliberately
  leaves a Person's v1 `#legacy-` annotation alone for exactly that reason. The
  visible cost is that after a "migrating" save the old rows still render beside
  the new ones (`parents-journey.spec.js` asserts two William Byron rows), until a
  real migration retires the v1 documents.
- Assembled views carry `legacy: true` (from the `#legacy-` id prefix the
  converter mints). Pages render the inherited rows read-only (`gl-assertion`
  `readonly`) while leaving the form live, so the way out of a legacy record is to
  re-assert it; the birth and death banners' promise that the record "will be
  migrated" means exactly this, not a rewrite.
