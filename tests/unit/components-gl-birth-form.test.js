// @vitest-environment jsdom
/**
 * The participant chrome in gl-birth-form is wired by event delegation, and the
 * "+ Add participant" button lives OUTSIDE [data-participants] in birth.html.
 * A listener bound to the list therefore never fires for it — the button was
 * silently dead in the browser while every model-level test stayed green.
 * These tests mount the component with the page's real markup shape.
 */

import '../../js/components/gl-birth-form.js'

function mountForm() {
    document.body.innerHTML = `
        <gl-birth-form>
            <form>
                <div data-participants></div>
                <button type="button" data-add-participant>+ Add participant</button>
            </form>
        </gl-birth-form>`
    // jsdom only runs connectedCallback for elements upgraded while attached,
    // so detach and re-attach to exercise the same wiring path the browser uses.
    const form = document.querySelector('gl-birth-form')
    form.remove()
    document.body.appendChild(form)
    return form
}

function rows(form) {
    return form.querySelectorAll('[data-participant]')
}

describe('gl-birth-form participant chrome', () => {
    test('mounts with one participant row so the form is never empty', () => {
        const form = mountForm()
        expect(rows(form)).toHaveLength(1)
    })

    test('the sibling "+ Add participant" button adds a row', () => {
        const form = mountForm()
        form.querySelector('[data-add-participant]').click()
        expect(rows(form)).toHaveLength(2)
    })

    test('a row can be removed again', () => {
        const form = mountForm()
        const add = form.querySelector('[data-add-participant]')
        add.click()
        add.click()
        expect(rows(form)).toHaveLength(3)
        rows(form)[1].querySelector('[data-remove-participant]').click()
        expect(rows(form)).toHaveLength(2)
    })

    test('roles offered by the form are canonical tokens the model maps to URIs', async () => {
        const { ROLE_TOKENS } = await import('../../js/model/birth.js')
        const form = mountForm()
        const offered = [...form.querySelectorAll('[data-role] option')].map(option => option.value)
        expect(offered.length).toBeGreaterThan(0)
        for (const token of offered) {
            expect(ROLE_TOKENS[token], `ROLE_TOKENS is missing "${token}"`).toBeTypeOf('string')
        }
    })

    test('collected value carries the chosen role token through unchanged', () => {
        const form = mountForm()
        const select = form.querySelector('[data-role]')
        select.value = 'mother'
        select.dispatchEvent(new Event('change'))
        const given = form.querySelector('[data-participant-given]')
        given.value = 'Anne'
        expect(form.value.participants[0].role).toBe('mother')
        expect(form.value.participants[0].name.given).toBe('Anne')
    })
})
