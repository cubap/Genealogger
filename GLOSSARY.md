# Glossary

The vocabulary of this repository, in one place. Issues, PRs, docs, tests, and
code comments should use these words with these meanings. Where the code uses a
different token, the code's spelling is given in backticks.

## The premise

**Eventities** — the model this app demonstrates: a genealogical record is not a
family block, it is a set of *events*, each asserted by *sources*, each with its
own evidence and confidence. Relationships are discovered through events rather
than stored in arrays on people.

**DEER v2** — the Document-Entity-Editing-Relationship shape this app mirrors for
its custom elements and data documents. Mirrored, not depended on: there is no
import from the `antlers` repository (see `docs/adr/`).

## Entities

**Person** — a bare human identity. Its document carries only its type and the
`label` cache. Every fact about a Person lives in an Annotation targeting it.

**Event** — something that happened to someone: `nv:Birth`, `nv:Death`,
`nv:Marriage`, `nv:Census`, and the rest of `EVENT_SUBTYPES`. A Person's parents,
children, witnesses, and vital dates are all reached through the events they
participate in. An event document's `@type` is an array: `["Event", "<subtype>"]`.

**Record** — a source document: a certificate, a census return, a family bible
page. A Record carries citation metadata, never genealogical facts. It is what an
assertion points at with `evidence`.

**Place** — a location, coordinate-capable (`geo:lat` / `geo:long`). A
place-valued fact may be a bare string or reference a Place.

## Assertions

**Annotation** — the document: an OA `oa:Annotation` with one `target` (the
entity being asserted about) and one `body`. "Annotation" names the container.

**Assertion** — one property claim inside a body, e.g.
`"https://schema.org/birthDate": { "value": "1815-12-10" }`. A body may hold
several assertions; the model's read path resolves them into assertions keyed by
property.

**Body** — the property-keyed map of ValueObjects on an Annotation. The property
key is always a full URI, never a compact token.

**ValueObject** — the shape an assertion's value takes:

```json
{ "value": "Ada", "evidence": "<Record id>", "confidence": 0.9, "source": { "citationSource": "..." } }
```

Qualifiers (`value`, `evidence`, `source`, `about`, `nv#confidence`) are written
as keys *inside* the ValueObject. This is what lets two disagreeing claims about
the same property keep their own evidence instead of overwriting each other.

**Evidence** — the Record that says so. Absence of evidence is itself
information: the claim is unsourced. Do not use "source" for this — `source` in
the data means citation *metadata*.

**Confidence** — a 0–1 decimal asserted alongside a single value, so a doubtful
draft-card age and a certain parish-register age of the same person coexist.

**Contested** — more than one assertion of the same property with different
values. The model never picks a winner at write time; readers rank by evidence
and confidence and show the disagreement.

## Relationships

**Participation** — a Person's involvement in an Event, recorded as a body pair
of `nv#participant` and `nv:role` on the event's Annotation.

**Role** — the capacity of that participation: `child`, `parent`, `mother`,
`father`, `godParent`, `informant`, `witness`, `attendant` (`CANONICAL_ROLES`).
Follows the W3C *Property of a Role* pattern.

**`rel`** — a non-authoritative reverse index (`[agent, event]`) written
alongside participations so a store that cannot filter dotted body properties can
still answer "which events involve this person". Never read `rel` as fact; the
body is the record.

**Derived view** / **assembled view** — what a read returns after gathering a
target's annotations: `hasParent`, `hasChild`, siblings, and the tree are
computed from participations. They are never written onto the entity documents.

**Lacuna** — an annotation marking an expected-but-unrecorded slot ("birth
mother unknown"), with `about` naming the empty property. It separates "nobody
looked" from "nothing there".

## Naming

**Bare label** — the single `label` cache allowed on an entity document: a copy
of the best evidenced name, written for list reads and indexes. Never
authoritative over the assertions.

**Label rule** — one function, `personLabel()`, decides what a Person is called.
A list read (no annotations) and a detail read (annotations included) must agree;
`UNLABELED` marks a Person with nothing evidenced yet.

## Legacy and storage

**DEER v1** / **legacy** — the pre-modernization shape still present in old
devstore documents (`hasFather`, `givenName` on the person document, `nv:child`
arrays). **Lazy migration** — reading code tolerates legacy documents and leaves
them alone; only the page that edits a document converts it, and only when it can
do so without destroying the facts inside it.

**`deer-key`** — the one DEER attribute that survives the v2 rewrite: the marker
on a `gl-*` form field naming the property it edits.

**Store** — the persistence seam (`js/adapters/`): `rerum` (devstore, the
default), `local` (localStorage), `memory` (tests), `fixture` (demo data).
Chosen with `?store=`; pages never fetch directly.
