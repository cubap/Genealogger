/**
 * Tests for gl-label-form's only real logic: the HTML surface -> plain-object
 * mapping (and back). Like its death/birth twins it must not save, fetch, or
 * encode storage shapes — it reads the `deer-key="name"` input, the
 * `[data-confidence]` select and the inner `<gl-evidence-picker>`, and reports
 * the lot through a `gl-label-submit` event for the page to hand to
 * model/label.saveLabel (which is where the bare `label` cache gets refreshed).
 */

import '../../js/components/gl-label-form.js'

const SURFACE = `
    <gl-label-form id="labelForm" person="https://example.org/person/7">
        <form id="labelDetail" novalidate>
            <fieldset>
                <legend>Name</legend>
                <label>Display Name: <input title="Display name" type="text" deer-key="name" value="  Ada Lovelace "></label>
                <label>Confidence
                    <select data-confidence>
                        <option value="">(inherit)</option>
                        <option value="high" selected>High</option>
                        <option value="low">Low</option>
                    </select>
                </label>
            </fieldset>
            <gl-evidence-picker deerlabel="Evidence document"></gl-evidence-picker>
            <input type="submit" value="Record name">
        </form>
    </gl-label-form>
`

function mount(html = SURFACE) {
    document.body.innerHTML = html
    const form = document.getElementById('labelForm')
    form.evidencePicker.records = [
        { id: 'https://example.org/record/1', title: 'Family bible' },
        { id: 'https://example.org/record/2', title: 'Census 1841' }
    ]
    return form
}

describe('gl-label-form', () => {
    test('collects the deer-key surface into the model input shape', () => {
        const form = mount()
        form.evidencePicker.value = { id: 'https://example.org/record/2' }
        const data = form.value
        expect(data.personId).toBe('https://example.org/person/7')
        // Trimmed: a trailing space from a fast typist is not part of a name.
        expect(data.name).toBe('Ada Lovelace')
        expect(data.confidence).toBe(0.9)
        expect(data.evidence).toEqual({ id: 'https://example.org/record/2', title: 'Census 1841' })
    })

    test("'(inherit)' is no confidence claim, so it is absent rather than 0", () => {
        const form = mount()
        form.confidenceControl.value = ''
        expect(form.value.confidence).toBeUndefined()
    })

    test('a free-text evidence title is collected as a new Record', () => {
        const form = mount()
        form.evidencePicker.value = { title: 'Wills book' }
        expect(form.value.evidence).toEqual({ id: '', title: 'Wills book' })
    })

    test('loads values back into the fields when showing a person', () => {
        const form = mount()
        form.value = {
            personId: 'https://example.org/person/9',
            name: 'Ada King',
            confidence: 0.25,
            evidence: { id: 'https://example.org/record/1' }
        }
        expect(form.getAttribute('person')).toBe('https://example.org/person/9')
        expect(form.querySelector('[deer-key="name"]').value).toBe('Ada King')
        // Numbers are shown with the word the user chose, not as "0.25".
        expect(form.confidenceControl.value).toBe('low')
        expect(form.evidencePicker.value.id).toBe('https://example.org/record/1')
    })

    test('an unknown confidence number still survives a round-trip', () => {
        const form = mount()
        form.value = { confidence: 0.75 }
        expect(form.confidenceControl.value).toBe('0.75')
        expect(form.value.confidence).toBe(0.75)
    })

    test('the submit control works from outside the fieldset and saves nothing', () => {
        // Same trap gl-death-form documents: a control that sits outside the
        // container a handler is bound to silently never fires. label.html keeps
        // the picker and the submit button as siblings of the fieldset, so the
        // component must scope its lookups to itself, not to the fieldset.
        const form = mount()
        const fetchSpy = vi.fn()
        global.fetch = fetchSpy
        const seen = []
        form.addEventListener('gl-label-submit', event => seen.push(event.detail))

        form.querySelector('input[type="submit"]').click()

        expect(seen).toHaveLength(1)
        expect(seen[0].name).toBe('Ada Lovelace')
        expect(seen[0].confidence).toBe(0.9)
        // Reading and writing are the model's business; this element performs neither.
        expect(fetchSpy).not.toHaveBeenCalled()
        delete global.fetch
    })

    test('re-attaching the element does not double-bind submit', () => {
        const form = mount()
        const wrapper = document.createElement('div')
        document.body.appendChild(wrapper)
        wrapper.appendChild(form)
        const seen = []
        form.addEventListener('gl-label-submit', () => seen.push(1))
        form.querySelector('input[type="submit"]').click()
        expect(seen).toHaveLength(1)
    })

    test('a form with no name input collects an empty name instead of throwing', () => {
        document.body.innerHTML = `
            <gl-label-form id="labelForm">
                <form><input type="submit"></form>
            </gl-label-form>
        `
        const form = document.getElementById('labelForm')
        expect(form.value.name).toBe('')
        expect(form.value.personId).toBeUndefined()
        expect(form.evidencePicker).toBeNull()
    })
})
