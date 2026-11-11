/**
 * Tests for the timeline's only non-delegating logic (issue #14's testing
 * decision): the pure `layoutTimeline()` bucketing — the REVERSED x-scale
 * (newest left), row assignment by generation with the subject first,
 * stacking when markers crowd, dispute grouping that keeps BOTH conflicting
 * assertions visible, and the exclusion of undated rows (the component lists
 * those separately). Plus a shadow-DOM mount check for `gl-ancestor-timeline`.
 */

import { layoutTimeline } from '../../js/components/gl-ancestor-timeline.js'
import '../../js/components/gl-ancestor-timeline.js'

const PEOPLE = [
    { id: 'p-ada', label: 'Ada Gordon', generation: 0, subject: true },
    { id: 'p-anne', label: 'Anne Milbanke', generation: 1 }
]

function item(over) {
    return {
        id: `tl-${Math.random()}`,
        personId: 'p-ada',
        label: 'Ada Gordon',
        generation: 0,
        eventId: 'e1',
        eventLabel: 'Birth',
        eventSubtype: 'Birth',
        role: 'nv:child',
        roleLabel: 'child',
        property: 'birthDate',
        display: '1815',
        year: 1815,
        precision: 'year',
        estimated: false,
        evidenceId: 'r1',
        evidenceLabel: 'Certificate',
        ...over
    }
}

describe('layoutTimeline', () => {
    test('draws the newest year to the LEFT of an older one', () => {
        const layout = layoutTimeline({ people: PEOPLE, items: [item({ year: 1790 }), item({ year: 1815 })] })
        const byYear = {}
        for (const marker of layout.markers) byYear[marker.year] = marker.x
        expect(byYear[1815]).toBeLessThan(byYear[1790])
    })

    test('ticks cover the domain and step sensibly with its span', () => {
        const layout = layoutTimeline({ people: PEOPLE, items: [item({ year: 1700 }), item({ year: 1815 })] })
        expect(layout.ticks.length).toBeGreaterThan(2)
        expect(layout.ticks.length).toBeLessThanOrEqual(13)
        expect(Math.min(...layout.ticks.map(t => t.year))).toBeGreaterThanOrEqual(1698)
        expect(Math.max(...layout.ticks.map(t => t.year))).toBeLessThanOrEqual(1817)
    })

    test('rows are ordered by generation with the subject first', () => {
        const people = [
            { id: 'g2', label: 'Grandpa', generation: 2 },
            ...PEOPLE,
            { id: 'g1b', label: 'George Milbanke', generation: 1 }
        ]
        const layout = layoutTimeline({ people, items: [] })
        expect(layout.rows.map(row => row.personId)).toEqual(['p-ada', 'p-anne', 'g1b', 'g2'])
        expect(layout.rows.map(row => row.generationLabel)).toEqual(['self', 'parents', 'parents', 'grandparents'])
        expect(layout.rows[1].y).toBeLessThan(layout.rows[2].y)
    })

    test('crowded markers on a row are stacked so both stay readable', () => {
        const layout = layoutTimeline({
            people: [PEOPLE[0]],
            items: [item({ year: 1815, eventId: 'e1' }), item({ year: 1816, eventId: 'e2' })],
            options: { width: 600 }
        })
        expect(layout.markers.map(marker => marker.y)).toHaveLength(2)
        expect(layout.markers[0].y).not.toBe(layout.markers[1].y)
        expect(layout.markers[1].stacked).toBe(true)
    })

    test('two assertions about the same event form ONE dispute bracket, both kept', () => {
        const layout = layoutTimeline({
            people: [PEOPLE[0]],
            items: [
                item({ display: '1815-12-10', year: 1815 }),
                item({ display: '1817', year: 1817 })
            ]
        })
        expect(layout.markers).toHaveLength(2)
        expect(layout.disputes).toHaveLength(1)
        expect(layout.disputes[0]).toMatchObject({ eventId: 'e1', count: 2, label: 'disputed ×2' })
        expect(layout.disputes[0].x1).toBeLessThan(layout.disputes[0].x2)
    })

    test('identical dates from two sources are not a layout dispute at one x', () => {
        const layout = layoutTimeline({
            people: [PEOPLE[0]],
            items: [item({ display: '1815' }), item({ display: '1815' })]
        })
        // deduped upstream by the model; even raw, same display never brackets
        expect(layout.disputes).toHaveLength(0)
    })

    test('estimated rows pass through untouched for hollow rendering', () => {
        const layout = layoutTimeline({ people: [PEOPLE[0]], items: [item({ estimated: true, display: 'c. 1798', year: 1798 })] })
        expect(layout.markers[0]).toMatchObject({ estimated: true, display: 'c. 1798' })
    })

    test('an empty timeline still produces a drawable canvas', () => {
        const layout = layoutTimeline({ people: [], items: [] })
        expect(layout.ticks).toEqual([])
        expect(layout.markers).toEqual([])
        expect(layout.height).toBeGreaterThan(0)
    })
})

describe('gl-ancestor-timeline element', () => {
    test('renders shadow DOM SVG with role, event and evidence per marker', () => {
        const el = document.createElement('gl-ancestor-timeline')
        document.body.appendChild(el)
        el.data = {
            people: PEOPLE,
            items: [
                item({ display: '1815-12-10', year: 1815, evidenceLabel: 'Parish baptism certificate, 1815' }),
                item({ display: '1817', year: 1817, evidenceLabel: 'Census return, 1851' })
            ],
            undated: [{ id: 'u1', display: 'sometime before 1841', eventLabel: 'Emigration', persons: [{ label: 'Ada Gordon', roleLabel: 'child' }] }]
        }
        const shadow = el.shadowRoot
        expect(shadow.querySelector('svg')).toBeTruthy()
        const text = shadow.textContent
        expect(text).toContain('Parish baptism certificate, 1815')
        expect(text).toContain('Census return, 1851')
        expect(text).toContain('child')
        expect(text).toContain('disputed')
        expect(text).toContain('Emigration')
        expect(shadow.querySelectorAll('.marker.estimated')).toHaveLength(0)
        el.remove()
    })

    test('estimated markers get the hollow class and italic date', () => {
        const el = document.createElement('gl-ancestor-timeline')
        document.body.appendChild(el)
        el.data = { people: [PEOPLE[0]], items: [item({ estimated: true, display: 'c. 1798', year: 1798 })], undated: [] }
        const shadow = el.shadowRoot
        expect(shadow.querySelectorAll('circle.marker.estimated')).toHaveLength(1)
        expect(shadow.querySelector('.m-date.estimated').textContent).toContain('c. 1798')
        el.remove()
    })
})
