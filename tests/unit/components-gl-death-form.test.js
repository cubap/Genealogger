/**
 * Tests for gl-death-form's only real logic: the HTML surface -> plain-object
 * mapping (and back). The component must not save, fetch, or encode storage
 * shapes — it collects `deer-key` inputs, `[data-confidence-for]` selects and
 * `[data-participant]` rows into the object model/death.saveDeath consumes, and
 * reports that object through a `gl-death-submit` event.
 */

import '../../js/components/gl-death-form.js'

const SURFACE = `
    <gl-death-form id="deathForm" deereventtype="Death">
        <form id="deathDetail" novalidate>
            <input type="text" deer-key="givenName" value="  Ada ">
            <input type="text" deer-key="familyName" value="Byron">
            <input type="text" deer-key="additionalName" value="">
            <input type="text" deer-key="alternateName" value="">
            <input type="text" deer-key="deathPlace" value="London">
            <input type="date" deer-key="deathDate" value="1852-01-01">
            <select deer-key="gender"><option value="Female" selected>female</option></select>
            <select data-confidence-for="deathDate"><option value="high" selected>High</option></select>
            <select data-confidence-for="deathPlace"><option value="" selected>(inherit)</option></select>
            <div data-participants>
                <div data-participant class="participant-row">
                    <input type="text" data-participant-given value="John">
                    <input type="text" data-participant-family value="Halo">
                    <select data-role>
                        <option value="witness" selected>Witness</option>
                        <option value="attendant">Attendant</option>
                        <option value="informant">Informant</option>
                        <option value="parent">Parent</option>
                    </select>
                    <select data-confidence><option value="" selected>(inherit)</option></select>
                </div>
                <div data-participant class="participant-row">
                    <input type="text" data-participant-given value="">
                    <input type="text" data-participant-family value="">
                    <select data-role><option value="attendant">Attendant</option></select>
                    <select data-confidence><option value="" selected>(inherit)</option></select>
                </div>
            </div>
            <input type="submit" value="Record death">
        </form>
    </gl-death-form>
`

function mount(html = SURFACE) {
    document.body.innerHTML = html
    return document.getElementById('deathForm')
}

describe('gl-death-form', () => {
    test('collects the deer-key surface into the model input shape', () => {
        const form = mount()
        const data = form.value
        expect(data.subtype).toBe('Death')
        expect(data.name).toEqual({ given: 'Ada', family: 'Byron', additional: '', alternate: '' })
        expect(data.deathPlace).toBe('London')
        expect(data.deathDate).toBe('1852-01-01')
        expect(data.gender).toBe('Female')
        // '(inherit)' is not a confidence claim, so it is absent, not zero.
        expect(data.confidences).toEqual({ deathDate: 0.9 })
    })

    test('collects participant rows with roles and drops blank rows', () => {
        const form = mount()
        expect(form.value.participants).toEqual([
            { agentId: undefined, role: 'witness', confidence: undefined, name: { given: 'John', family: 'Halo' } }
        ])
    })

    test('keeps an existing participant bound to its agent id', () => {
        const form = mount()
        const row = form.querySelector('[data-participant]')
        row.setAttribute('data-agent-id', 'https://example.org/person/9')
        const [participant] = form.value.participants
        expect(participant.agentId).toBe('https://example.org/person/9')
    })

    test('reads the event subtype from deereventtype', () => {
        const form = mount(SURFACE.replace('deereventtype="Death"', 'deereventtype="Burial"'))
        expect(form.value.subtype).toBe('Burial')
    })

    test('loads values back into the fields when editing', () => {
        const form = mount()
        form.value = {
            personId: 'https://example.org/person/3',
            name: { given: 'Augusta', family: 'King' },
            deathDate: '1852-01-01',
            deathPlace: 'Westminster',
            gender: 'Female'
        }
        expect(form.getAttribute('person')).toBe('https://example.org/person/3')
        expect(form.querySelector('[deer-key="givenName"]').value).toBe('Augusta')
        expect(form.querySelector('[deer-key="deathPlace"]').value).toBe('Westminster')
    })

    test('add/remove participant buttons work from outside the row list', () => {
        // death.html keeps the buttons siblings of [data-participants], so the
        // component must delegate on itself rather than on the row container.
        document.body.innerHTML = `
            <gl-death-form id="deathForm">
                <form novalidate>
                    <input type="text" deer-key="givenName">
                    <div data-participants></div>
                    <button type="button" data-add-participant>+ Add participant</button>
                    <input type="submit">
                </form>
            </gl-death-form>
        `
        const form = document.getElementById('deathForm')
        expect(form.querySelectorAll('[data-participant]')).toHaveLength(1)
        form.querySelector('[data-add-participant]').click()
        expect(form.querySelectorAll('[data-participant]')).toHaveLength(2)
        form.querySelectorAll('[data-remove-participant]')[0].click()
        expect(form.querySelectorAll('[data-participant]')).toHaveLength(1)
    })

    test('submit emits gl-death-submit with the collected data and saves nothing', () => {
        const form = mount()
        const seen = []
        form.addEventListener('gl-death-submit', event => seen.push(event.detail))
        form.querySelector('input[type="submit"]').click()
        expect(seen).toHaveLength(1)
        expect(seen[0].deathDate).toBe('1852-01-01')
        expect(seen[0].participants[0].role).toBe('witness')
    })
})
