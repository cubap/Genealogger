/**
 * Tests for gl-person-name-form. The behaviour worth pinning is that the
 * controlled name-type list comes from the vocabulary module rather than the
 * markup (so the reference implementation keeps one spelling of story 12 of #12),
 * and that collecting the form yields the shape model/person.assertPersonName
 * expects.
 */

import { GLPersonNameForm } from '../../js/components/gl-person-name-form.js'
import { NAME_TYPE_TOKENS } from '../../js/model/vocabulary.js'

const MARKUP = `
<gl-person-name-form person="ada">
    <form>
        <input deer-key="name" value="Annabella Gordon">
        <select deer-key="nameProperty"><option value="family" selected>family</option></select>
        <select deer-key="nameType"><option value="">(unspecified)</option></select>
        <input deer-key="activeFrom" value="1815">
        <input deer-key="activeTo" value="1820">
    </form>
</gl-person-name-form>
`

/** Mount markup and return the upgraded element. */
function mount(html = MARKUP) {
    document.body.innerHTML = html
    return document.querySelector('gl-person-name-form')
}

afterEach(() => {
    document.body.innerHTML = ''
})

describe('gl-person-name-form', () => {
    test('the name-type select is filled from the vocabulary', () => {
        const form = mount()
        expect(form).toBeInstanceOf(GLPersonNameForm)
        const options = [...form.querySelectorAll('select[deer-key="nameType"] option')]
        expect(options.map(option => option.value)).toEqual(['', ...NAME_TYPE_TOKENS])
    })

    test('re-attaching the element does not duplicate the generated options', () => {
        const form = mount()
        const before = form.querySelectorAll('select[deer-key="nameType"] option').length
        form.remove()
        document.body.appendChild(form)
        expect(form.querySelectorAll('select[deer-key="nameType"] option').length).toBe(before)
    })

    test('value collects the fields, the person id, and a confidence-free assertion input', () => {
        const form = mount()
        const select = form.querySelector('select[deer-key="nameType"]')
        select.value = 'married name'
        expect(form.value).toMatchObject({
            personId: 'ada',
            propertyToken: 'family',
            value: 'Annabella Gordon',
            nameType: 'married name',
            activeFrom: '1815',
            activeTo: '1820'
        })
    })

    test('submitting dispatches the collected data instead of saving', () => {
        const form = mount()
        const seen = []
        document.body.addEventListener('gl-person-name-submit', event => seen.push(event.detail))
        form.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
        expect(seen).toHaveLength(1)
        expect(seen[0].value).toBe('Annabella Gordon')
    })
})
