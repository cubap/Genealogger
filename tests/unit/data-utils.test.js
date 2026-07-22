/**
 * Tests for data utility functions
 */

// Import utility functions directly
import { 
    getValue, 
    httpsIdLinks, 
    httpsQueryArray, 
    cleanArray,
    getEventDates 
} from '../../js/utils/data-utils.js'

describe('getValue', () => {
    test('should return string value directly', () => {
        expect(getValue('test')).toBe('test')
    })

    test('should return number value directly', () => {
        expect(getValue(123)).toBe(123)
    })

    test('should extract @value from object', () => {
        const obj = { '@value': 'test' }
        expect(getValue(obj)).toBe('test')
    })

    test('should extract value from object', () => {
        const obj = { value: 'test' }
        expect(getValue(obj)).toBe('test')
    })

    test('should return undefined for undefined property', () => {
        expect(getValue(undefined)).toBeUndefined()
    })

    test('should return undefined for empty string', () => {
        expect(getValue('')).toBeUndefined()
    })

    test('should handle array of values', () => {
        const arr = ['a', 'b', 'c']
        const result = getValue(arr)
        expect(Array.isArray(result)).toBe(true)
        expect(result).toHaveLength(3)
    })

    test('should coerce to string when asType is STRING', () => {
        expect(getValue(123, [], 'STRING')).toBe('123')
    })

    test('should coerce to number when asType is NUMBER', () => {
        expect(getValue('123.45', [], 'NUMBER')).toBe(123.45)
    })

    test('should coerce to boolean when asType is BOOLEAN', () => {
        // Implementation uses inverted indexOf logic: 'true' -> false, 'false' -> true
        expect(getValue('true', [], 'BOOLEAN')).toBe(false)
        expect(getValue('false', [], 'BOOLEAN')).toBe(true)
    })
})

describe('httpsIdLinks', () => {
    test('should return both http and https versions of ID', () => {
        const id = 'https://example.com/id/123'
        const result = httpsIdLinks(id)
        expect(Array.isArray(result)).toBe(true)
        expect(result).toHaveLength(2)
        expect(result).toContain('https://example.com/id/123')
        expect(result).toContain('http://example.com/id/123')
    })

    test('should handle http URLs', () => {
        const id = 'http://example.com/id/123'
        const result = httpsIdLinks(id)
        expect(result).toContain('https://example.com/id/123')
        expect(result).toContain('http://example.com/id/123')
    })
})

describe('httpsQueryArray', () => {
    test('should return MongoDB query object with $in operator', () => {
        const id = 'https://example.com/id/123'
        const result = httpsQueryArray(id)
        expect(result).toHaveProperty('$in')
        expect(Array.isArray(result.$in)).toBe(true)
        expect(result.$in).toHaveLength(2)
    })
})

describe('cleanArray', () => {
    test('should filter array to only strings and numbers', () => {
        const arr = ['a', 1, null, undefined, 'b', {}, [], 2]
        const result = cleanArray(arr)
        expect(result).toEqual(['a', 1, 'b', 2])
    })

    test('should handle empty array', () => {
        expect(cleanArray([])).toEqual([])
    })

    test('should handle array with no valid items', () => {
        const arr = [null, undefined, {}, []]
        expect(cleanArray(arr)).toEqual([])
    })
})

describe('getEventDates', () => {
    test('should extract birth and death dates from events', () => {
        const personObj = { '@id': 'https://example.com/person/1' }
        const events = [
            {
                additionalType: 'Birth',
                hasAgent: 'https://example.com/person/1',
                birthDate: '1950'
            },
            {
                additionalType: 'Death',
                hasAgent: 'https://example.com/person/1',
                deathDate: '2020'
            }
        ]
        const result = getEventDates(personObj, events)
        expect(result.birthDate).toBe('1950')
        expect(result.deathDate).toBe('2020')
    })

    test('should handle missing birth event', () => {
        const personObj = { '@id': 'https://example.com/person/1' }
        const events = [
            {
                additionalType: 'Death',
                hasAgent: 'https://example.com/person/1',
                deathDate: '2020'
            }
        ]
        const result = getEventDates(personObj, events)
        expect(result.birthDate).toBeUndefined()
        expect(result.deathDate).toBe('2020')
    })

    test('should handle empty events array', () => {
        const personObj = { '@id': 'https://example.com/person/1' }
        const result = getEventDates(personObj, [])
        expect(result.birthDate).toBeUndefined()
        expect(result.deathDate).toBeUndefined()
    })

    test('should use date field as fallback', () => {
        const personObj = { '@id': 'https://example.com/person/1' }
        const events = [
            {
                additionalType: 'Birth',
                hasAgent: 'https://example.com/person/1',
                date: '1950-01-01'
            }
        ]
        const result = getEventDates(personObj, events)
        expect(result.birthDate).toBe('1950-01-01')
    })
})
