# Mirror the DEER v2 shapes instead of depending on antlers

Genealogger demonstrates a data model, so its documents and custom elements have
to agree with the DEER v2 shapes being rewritten in
`CenterForDigitalHumanities/antlers` — but we copied those shapes rather than
importing them, so a change in antlers' release cadence, build tooling, or
module layout can never break this reference implementation. The cost is drift,
and we pay for it in two places: every `nv:` term is defined in exactly one file
(`js/model/vocabulary.js`) plus the normative
`schemas/genealogger-context.jsonld`, with
`tests/unit/schemas-context.test.js` failing if the two stop agreeing, so an
alignment change with DEER v2 is a deliberate edit in one place rather than a
dependency bump nobody noticed.

## Considered options

- **Depend on antlers directly.** Rejected: this repo's job is to be readable as
  a model, and a `node_modules` hop into another project's internals makes the
  shape hard to see and the upgrade involuntary. We align by following the v2
  plan (custom-element shapes preserved, no build step), not by sharing code.
- **Invent our own element and document shapes.** Rejected: the point is to show
  that Eventities-shaped data is workable in the DEER ecosystem, which a private
  vocabulary would not demonstrate.
