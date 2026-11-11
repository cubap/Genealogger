/**
 * Tests for string utility functions
 */

import { 
    stringifyArray, 
    getLabel 
} from '../../js/utils/string-utils.js'

describe('stringifyArray', () => {
    test('should join array with delimiter', () => {
        const arr = ['a', 'b', 'c']
        expect(stringifyArray(arr, ',')).toBe('a,b,c')
    })

    test('should handle empty array', () => {
        expect(stringifyArray([], ',')).toBe('')
    })

    test('should handle single element array', () => {
        expect(stringifyArray(['a'], ',')).toBe('a')
    })

    test('should use custom delimiter', () => {
        const arr = ['a', 'b', 'c']
        expect(stringifyArray(arr, ' | ')).toBe('a | b | c')
    })

    test('should return empty string for undefined array', () => {
        expect(stringifyArray(undefined, ',')).toBe('')
    })
})

describe('getLabel', () => {
    test('should return string directly if input is string', () => {
        expect(getLabel('test')).toBe('test')
    })

    test('should prioritize nickname over name', () => {
        const obj = {
            name: 'John Doe',
            nick: 'Johnny'
        }
        expect(getLabel(obj)).toBe('Johnny')
    })

    test('should use name if no nickname', () => {
        const obj = {
            name: 'John Doe'
        }
        expect(getLabel(obj)).toBe('John Doe')
    })

    test('should use label if no name or nickname', () => {
        const obj = {
            label: 'John Doe'
        }
        expect(getLabel(obj)).toBe('John Doe')
    })

    test('should use title if no other label fields', () => {
        const obj = {
            title: 'John Doe'
        }
        expect(getLabel(obj)).toBe('John Doe')
    })

    test('should return noLabel default if no label fields', () => {
        const obj = {}
        expect(getLabel(obj)).toBe('[ unlabeled ]')
    })

    test('should handle array of labels', () => {
        const obj = {
            name: ['John', 'Johnny', 'Jon']
        }
        const result = getLabel(obj)
        expect(Array.isArray(result)).toBe(true)
        expect(result).toHaveLength(3)
    })

    test('should extract value from object label', () => {
        const obj = {
            name: { '@value': 'John Doe' }
        }
        expect(getLabel(obj)).toBe('John Doe')
    })

    test('should use custom noLabel parameter', () => {
        const obj = {}
        expect(getLabel(obj, 'Custom Default')).toBe('Custom Default')
    })

    test('should use custom label field from options', () => {
        const obj = {
            customLabel: 'Custom Name'
        }
        expect(getLabel(obj, '[ unlabeled ]', { label: 'customLabel' })).toBe('Custom Name')
    })
})
