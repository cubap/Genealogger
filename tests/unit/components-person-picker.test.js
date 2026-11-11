/**
 * Tests for the delegation-free logic of the two person-picker components
 * (issue #14 stories 2 and 11): what a chip displays for every shape of person
 * data it can be handed, and when the filter announces a query instead of
 * waiting out its debounce. Rendering and event wiring are presentational and
 * covered by tests/e2e/index-journey.spec.js.
 */

import { toChipView, PERSON_HREF } from '../../js/components/gl-person-chip.js'
import { announcesImmediately, DEFAULT_DEBOUNCE_MS } from '../../js/components/gl-typeahead-filter.js'
import { SCHEMA } from '../../js/model/vocabulary.js'
import { UNLABELED } from '../../js/model/search.js'

const ID = 'https://devstore.rerum.io/v1/id/ada'

describe('toChipView', () => {
    test('renders a listPersons() row, linking to the person page', () => {
        const view = toChipView({ id: ID, label: 'Ada Gordon', entity: { '@id': ID } })
        expect(view).toEqual({
            id: ID,
            label: 'Ada Gordon',
            href: PERSON_HREF + ID,
            detail: ''
        })
    })

    test('derives the label from a bare Person entity when no row is given', () => {
        const view = toChipView({ '@id': ID, '@type': 'Person', [SCHEMA.givenName]: 'Ada' })
        expect(view.id).toBe(ID)
        expect(view.label).toBe('Ada')
    })

    test('passes a caller-resolved detail through untouched', () => {
        const view = toChipView({ id: ID, label: 'Ada Gordon' }, { detail: 'b. 1815' })
        expect(view.detail).toBe('b. 1815')
    })

    test('explicit href="" makes an unlinked chip for picker mode', () => {
        expect(toChipView({ id: ID, label: 'Ada' }, { href: '' }).href).toBe('')
        expect(toChipView({ id: ID, label: 'Ada' }, { href: 'other.html#' + ID }).href)
            .toBe('other.html#' + ID)
    })

    test('a person with no id renders unlinked rather than pointing at nothing', () => {
        const view = toChipView({ label: 'Unknown relative' })
        expect(view).toMatchObject({ id: '', href: '', label: 'Unknown relative' })
    })

    test('tolerates a bare string and absent input', () => {
        expect(toChipView('Ada Gordon').label).toBe('Ada Gordon')
        expect(toChipView(null)).toEqual({ id: '', label: UNLABELED, href: '', detail: '' })
    })
})

describe('announcesImmediately', () => {
    test('an emptied box is announced at once so the list snaps back', () => {
        expect(announcesImmediately('')).toBe(true)
        expect(announcesImmediately('   ')).toBe(true)
        expect(announcesImmediately(null)).toBe(true)
    })

    test('typing waits for the debounce', () => {
        expect(announcesImmediately('a')).toBe(false)
        expect(announcesImmediately('ada g')).toBe(false)
    })

    test('the default debounce is short enough to feel live', () => {
        expect(DEFAULT_DEBOUNCE_MS).toBeLessThanOrEqual(200)
    })
})
