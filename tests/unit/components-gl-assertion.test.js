/**
 * Tests for gl-assertion: confidence parsing/formatting, ValueObject list
 * rendering (rows, qualifiers, conflict grouping) and what the rendered row
 * actually shows. The model layer owns the rest and is tested in model-*.test.js.
 */

import { parseConfidence, formatConfidence, toAssertionRows, toAssertionGroups, CONFIDENCE_LEVELS } from '../../js/components/gl-assertion.js'
import { NV, SCHEMA, term } from '../../js/model/vocabulary.js'
import { NV_NAME_TYPE, NV_ACTIVE_FROM, NV_ACTIVE_TO, QUALIFIER_LABELS } from '../../js/model/person.js'

describe('parseConfidence', () => {
    test('numbers pass through and clamp to 0-1', () => {
        expect(parseConfidence(0.75)).toBe(0.75)
        expect(parseConfidence(0)).toBe(0)
        expect(parseConfidence(1)).toBe(1)
        expect(parseConfidence(3)).toBe(1)
        expect(parseConfidence(-2)).toBe(0)
    })

    test('numeric strings and percentages parse', () => {
        expect(parseConfidence('0.5')).toBe(0.5)
        expect(parseConfidence('75%')).toBe(0.75)
        expect(parseConfidence('100%')).toBe(1)
    })

    test('named tokens map to their level values', () => {
        for (const level of CONFIDENCE_LEVELS) {
            expect(parseConfidence(level.token)).toBe(level.value)
            expect(parseConfidence(level.token.toUpperCase())).toBe(level.value)
        }
    })

    test('empty and unparseable input yield undefined (no guess)', () => {
        expect(parseConfidence('')).toBeUndefined()
        expect(parseConfidence('   ')).toBeUndefined()
        expect(parseConfidence(null)).toBeUndefined()
        expect(parseConfidence(undefined)).toBeUndefined()
        expect(parseConfidence('maybe')).toBeUndefined()
        expect(parseConfidence(NaN)).toBeUndefined()
    })
})

describe('formatConfidence', () => {
    test('renders a whole-number percentage', () => {
        expect(formatConfidence(0.9)).toBe('90%')
        expect(formatConfidence('high')).toBe('90%')
        expect(formatConfidence(1)).toBe('100%')
    })

    test('absent confidence formats to empty string', () => {
        expect(formatConfidence(undefined)).toBe('')
        expect(formatConfidence('')).toBe('')
    })
})

describe('toAssertionRows', () => {
    const evidenceLabels = { 'rec-1': 'Parish certificate' }
    const propertyLabels = { [SCHEMA.birthDate]: 'Date of birth' }

    test('one row per ValueObject, resolving labels', () => {
        const grouped = {
            [SCHEMA.birthDate]: { value: '1815-12-10', evidence: 'rec-1', [NV.confidence]: 0.9 }
        }
        const rows = toAssertionRows(grouped, { propertyLabels, evidenceLabels, order: [SCHEMA.birthDate] })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
            property: SCHEMA.birthDate,
            propertyLabel: 'Date of birth',
            value: '1815-12-10',
            evidenceLabel: 'Parish certificate',
            confidence: 0.9
        })
    })

    test('conflicting sources stay separate rows and are never merged', () => {
        const grouped = {
            [SCHEMA.birthDate]: [
                { value: '1815-12-10', evidence: 'rec-1', [NV.confidence]: 0.9 },
                { value: '1815-12-11', evidence: 'rec-2', [NV.confidence]: 0.4 }
            ]
        }
        const rows = toAssertionRows(grouped, { propertyLabels, evidenceLabels })
        expect(rows).toHaveLength(2)
        expect(rows.map(r => r.value).sort()).toEqual(['1815-12-10', '1815-12-11'])
    })

    test('honours the requested property order and appends the rest', () => {
        const grouped = {
            [SCHEMA.familyName]: { value: 'Byron' },
            [SCHEMA.birthDate]: { value: '1815-12-10' }
        }
        const rows = toAssertionRows(grouped, { order: [SCHEMA.birthDate] })
        expect(rows[0].property).toBe(SCHEMA.birthDate)
        expect(rows.map(r => r.property)).toContain(SCHEMA.familyName)
    })
})

describe('toAssertionRows qualifiers', () => {
    const ANY_TERM = term('nv', 'alibi')

    test('a plain ValueObject carries no qualifiers', () => {
        const rows = toAssertionRows({ [SCHEMA.birthDate]: { value: '1815', evidence: 'rec-1' } })
        expect(rows[0].qualifiers).toBeUndefined()
    })

    test('any extra ValueObject key becomes a labelled qualifier', () => {
        const grouped = {
            [SCHEMA.name]: {
                value: 'Margaret Doyle',
                evidence: 'rec-1',
                [NV_NAME_TYPE]: { value: 'married name' },
                [NV_ACTIVE_FROM]: { value: '1880-01-01' },
                [NV_ACTIVE_TO]: {}
            }
        }
        const rows = toAssertionRows(grouped, { qualifierLabels: QUALIFIER_LABELS })
        expect(rows[0].qualifiers).toEqual([
            { key: NV_NAME_TYPE, label: 'type', value: 'married name' },
            { key: NV_ACTIVE_FROM, label: 'from', value: '1880-01-01' }
        ])
    })

    test('an unknown qualifier falls back to its local name, and blanks are dropped', () => {
        const rows = toAssertionRows({ [SCHEMA.name]: { value: 'Ada', [ANY_TERM]: '' } })
        expect(rows[0].qualifiers).toBeUndefined()
        const labelled = toAssertionRows({ [SCHEMA.name]: { value: 'Ada', [ANY_TERM]: 'yes' } })
        expect(labelled[0].qualifiers).toEqual([{ key: ANY_TERM, label: 'alibi', value: 'yes' }])
    })
})

describe('toAssertionGroups', () => {
    test('one group per assertion type, in row order, never merging rows', () => {
        const rows = toAssertionRows({
            [SCHEMA.givenName]: { value: 'Ada' },
            [SCHEMA.name]: [
                { value: 'Ada Gordon', evidence: 'rec-1' },
                { value: 'Ada Byron', evidence: 'rec-2' }
            ]
        })
        const groups = toAssertionGroups(rows)
        expect(groups.map(g => g.property)).toEqual([SCHEMA.givenName, SCHEMA.name])
        expect(groups[0].rows).toHaveLength(1)
        expect(groups[1].rows.map(r => r.value)).toEqual(['Ada Gordon', 'Ada Byron'])
    })

    test('a group is conflicting only when the sources actually disagree', () => {
        const agreeing = toAssertionGroups(toAssertionRows({
            [SCHEMA.birthDate]: [{ value: '1815-12-10', evidence: 'rec-1' }, { value: '1815-12-10', evidence: 'rec-2' }]
        }))
        expect(agreeing[0].conflicting).toBe(false)
        const disagreeing = toAssertionGroups(toAssertionRows({
            [SCHEMA.birthDate]: [{ value: '1815-12-10', evidence: 'rec-1' }, { value: '1815-12-11', evidence: 'rec-2' }]
        }))
        expect(disagreeing[0].conflicting).toBe(true)
    })
})

describe('gl-assertion rendering', () => {
    function renderRow(row, { readonly = true } = {}) {
        const el = document.createElement('gl-assertion')
        if (readonly) el.setAttribute('readonly', '')
        document.body.appendChild(el)
        el.row = row
        return el
    }

    test('shows the qualifiers and flags a conflict', () => {
        const el = renderRow({
            property: SCHEMA.name,
            propertyLabel: 'Full name',
            value: 'Ada Byron',
            evidenceLabel: 'Family bible',
            confidence: 0.4,
            conflicting: true,
            qualifiers: [{ key: NV_NAME_TYPE, label: 'type', value: 'married name' }]
        })
        const text = el.shadowRoot.textContent
        expect(text).toContain('Full name')
        expect(text).toContain('Ada Byron')
        expect(text).toContain('Family bible')
        expect(text).toContain('40%')
        expect(text).toContain('type: married name')
        expect(el.shadowRoot.querySelector('.conflict')).not.toBeNull()
        el.remove()
    })

    test('a plain readonly row shows no badge and no confidence editor', () => {
        const el = renderRow({
            property: SCHEMA.birthDate,
            propertyLabel: 'Date of birth',
            value: '1815-12-10',
            evidenceLabel: '',
            confidence: undefined
        })
        expect(el.shadowRoot.querySelector('.conflict')).toBeNull()
        expect(el.shadowRoot.querySelector('select.confidence')).toBeNull()
        expect(el.shadowRoot.textContent).toContain('evidence: —')
        el.remove()
    })

    test('an editable row emits the new confidence for that claim', () => {
        const el = renderRow({ property: SCHEMA.name, propertyLabel: 'Name', value: 'Ada' }, { readonly: false })
        const events = []
        el.addEventListener('gl-confidence-change', event => events.push(event.detail))
        const select = el.shadowRoot.querySelector('select.confidence')
        select.value = 'low'
        select.dispatchEvent(new Event('change'))
        expect(events).toEqual([{ property: SCHEMA.name, value: 'Ada', confidence: 0.25 }])
        el.remove()
    })
})
