/**
 * Tests for the non-trivial gl-assertion logic that is pure delegation-free:
 * confidence parsing/formatting and ValueObject list rendering. The component's
 * render method is presentational and not covered here; the model layer owns the
 * rest and is tested in model-*.test.js.
 */

import { parseConfidence, formatConfidence, toAssertionRows, CONFIDENCE_LEVELS } from '../../js/components/gl-assertion.js'
import { NV, SCHEMA } from '../../js/model/vocabulary.js'

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
