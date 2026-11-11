/**
 * Tests for gl-parents-form's only real logic: the DEER v1 HTML surface (retained
 * `deer-key` names hasFather / hasMother / homeLocation and the .personDropdown
 * selects) -> the plain object model/parents.saveParents() consumes, and back
 * again when editing. The component must not save, not fetch, and not encode any
 * storage shape: "Father" is a row affordance, and the role URI is the model's
 * business.
 */

import '../../js/components/gl-parents-form.js'
import { parseConfidence } from '../../js/components/gl-assertion.js'

const CHILD = 'https://devstore.rerum.io/v1/CHILD1'
const MOTHER_ID = 'https://devstore.rerum.io/v1/MOTHER1'
const FATHER_ID = 'https://devstore.rerum.io/v1/FATHER1'

const SURFACE = `
    <gl-parents-form id="parentsForm" person="${CHILD}">
        <form id="parentsDetail" novalidate>
            <div data-participant data-parent-role="father" class="participant-row">
                <input type="text" deer-key="hasFather" data-participant-name>
                <select class="personDropdown" title="Select a person"></select>
                <label>confidence <select data-confidence></select></label>
            </div>
            <div data-participant data-parent-role="mother" class="participant-row">
                <input type="text" deer-key="hasMother" data-participant-name>
                <select class="personDropdown" title="Select a person"></select>
                <label>confidence <select data-confidence></select></label>
            </div>
            <div data-participants></div>
            <button type="button" data-add-parent>+ Add another parent</button>
            <gl-evidence-picker deerlabel="Evidence document"></gl-evidence-picker>
            <input type="text" deer-key="homeLocation">
            <input type="submit" value="Record parents">
        </form>
    </gl-parents-form>
`

function mount(html = SURFACE) {
    document.body.innerHTML = html
    return document.getElementById('parentsForm')
}

function rowFor(form, role) {
    return form.querySelector(`[data-participant][data-parent-role="${role}"]`)
}

describe('gl-parents-form', () => {
    test('collects the surface into the model input shape, dropping blank rows', () => {
        const form = mount()
        rowFor(form, 'mother').querySelector('[data-participant-name]').value = 'Anne Milbanke'
        const conf = rowFor(form, 'mother').querySelector('[data-confidence]')
        // The fixed rows are authored empty in the HTML and filled by the component.
        expect(conf.options.length).toBeGreaterThan(1)
        conf.value = 'high'
        form.querySelector('[deer-key="homeLocation"]').value = ' London '

        const data = form.value
        expect(data.personId).toBe(CHILD)
        expect(data.residence).toBe('London')
        expect(data.parents).toEqual([
            { role: 'mother', agentId: undefined, name: 'Anne Milbanke', confidence: parseConfidence('high') }
        ])
    })

    test('a dropdown pick names an existing person; typing means a new one', () => {
        const form = mount()
        form.personOptions = [{ id: MOTHER_ID, label: 'Anne Milbanke' }, { id: FATHER_ID, label: 'William Byron' }]
        const row = rowFor(form, 'father')
        const dropdown = row.querySelector('.personDropdown')
        expect([...dropdown.options].map(o => o.textContent)).toContain('William Byron')

        dropdown.value = FATHER_ID
        dropdown.dispatchEvent(new Event('change', { bubbles: true }))
        expect(row.getAttribute('data-agent-id')).toBe(FATHER_ID)
        expect(row.querySelector('[data-participant-name]').value).toBe('William Byron')
        expect(form.value.parents).toEqual([
            { role: 'father', agentId: FATHER_ID, name: undefined, confidence: undefined }
        ])

        // Overwriting the name is a claim about a different, unrecorded person.
        const name = row.querySelector('[data-participant-name]')
        name.value = 'William Gordon Byron'
        name.dispatchEvent(new Event('input', { bubbles: true }))
        expect(row.hasAttribute('data-agent-id')).toBe(false)
        expect(form.value.parents[0]).toEqual(
            { role: 'father', agentId: undefined, name: 'William Gordon Byron', confidence: undefined }
        )

        dropdown.value = ''
        dropdown.dispatchEvent(new Event('change', { bubbles: true }))
        expect(name.value).toBe('')
        expect(form.value.parents).toHaveLength(0)
    })

    test('extra parents are added beside the fixed rows, never over them', () => {
        const form = mount()
        const before = form.rows.length
        form.querySelector('[data-add-parent]').click()
        expect(form.rows).toHaveLength(before + 1)

        const added = form.rows[form.rows.length - 1]
        expect(added.hasAttribute('data-parent-role')).toBe(false)
        added.querySelector('[data-role]').value = 'parent'
        added.querySelector('[data-participant-name]').value = 'George Byron'
        form.querySelector('[data-add-parent]').click()
        expect(form.rows).toHaveLength(before + 2)

        const data = form.value
        expect(data.parents.map(p => p.role)).toEqual(['parent'])
        expect(data.parents[0].name).toBe('George Byron')

        added.querySelector('[data-remove-participant]').click()
        expect(form.rows).toHaveLength(before + 1)
    })

    test('loads existing claims into the fixed rows, conflicts into generic ones', () => {
        const form = mount()
        form.personOptions = [{ id: MOTHER_ID, label: 'Anne Milbanke' }]
        form.value = {
            personId: CHILD,
            residence: 'London',
            parents: [
                { role: 'mother', agentId: MOTHER_ID, name: 'Anne Milbanke', confidence: 1 },
                { role: 'father', name: 'William Byron' },
                { role: 'mother', name: 'Isabella Milbanke', confidence: 0.5 }
            ]
        }
        const mother = rowFor(form, 'mother')
        expect(mother.getAttribute('data-agent-id')).toBe(MOTHER_ID)
        expect(mother.querySelector('.personDropdown').value).toBe(MOTHER_ID)
        expect(mother.querySelector('[data-participant-name]').value).toBe('Anne Milbanke')
        expect(mother.querySelector('[data-confidence]').value).toBe('certain')
        expect(rowFor(form, 'father').querySelector('[data-participant-name]').value).toBe('William Byron')

        // The disagreeing mother cannot share the fixed row, so she gets her own.
        const added = form.rows.filter(row => !row.hasAttribute('data-parent-role'))
        expect(added).toHaveLength(1)
        expect(added[0].querySelector('[data-role]').value).toBe('mother')
        expect(added[0].querySelector('[data-participant-name]').value).toBe('Isabella Milbanke')

        const reloaded = form.value
        expect(reloaded.parents).toHaveLength(3)
        expect(reloaded.residence).toBe('London')
        expect(reloaded.parents.map(p => p.role)).toEqual(['father', 'mother', 'mother'])
        expect(reloaded.parents.find(p => p.agentId === MOTHER_ID).confidence).toBe(1)
        expect(reloaded.parents.find(p => p.name === 'Isabella Milbanke').confidence).toBe(0.5)

        // Loading a different person's claims must not leave the old rows behind.
        form.value = { personId: CHILD, parents: [{ role: 'father', name: 'Nobody else' }] }
        expect(form.rows).toHaveLength(2)
        expect(form.value.parents).toEqual([
            { role: 'father', agentId: undefined, name: 'Nobody else', confidence: undefined }
        ])
    })

    test('submitting reports the form data and saves nothing itself', () => {
        const form = mount()
        const seen = []
        form.addEventListener('gl-parents-submit', event => {
            event.preventDefault()
            seen.push(event.detail)
        })
        rowFor(form, 'mother').querySelector('[data-participant-name]').value = 'Anne Milbanke'
        form.querySelector('input[type="submit"]').click()

        expect(seen).toHaveLength(1)
        expect(seen[0]).toEqual(form.value)
        // Bare surface tokens, not role URIs: the model mints those.
        expect(seen[0].parents[0].role).toBe('mother')
        expect(JSON.stringify(seen[0])).not.toMatch(/nvocabulary/)
        expect(document.body.innerHTML).not.toMatch(/nvocabulary/)
    })
})
