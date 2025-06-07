import { expand, getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerPersonDates extends HTMLElement {
    static get observedAttributes() { return ['deer-id'] }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'deer-id' && oldValue !== newValue) this.render()
    }
    connectedCallback() { this.render() }

    async render() {
        const id = this.getAttribute('deer-id')
        if (!id) {
            this.innerHTML = 'No dates'
            return
        }
        // Query for events with hasAgent = person id
        const query = {
            "__rerum.history.next": { "$exists": true, "$size": 0 },
            "body.hasAgent.value": { $in: [id.replace(/^https?:/, 'https:')] }
        }
        const events = await fetch('https://tinydev.rerum.io/query', {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(query)
        }).then(r => r.json()).catch(() => [])
        // Expand and filter for Birth/Death events
        const dateEvents = []
        for (const ev of events) {
            if (!ev?.target) continue
            const dateObj = await expand(ev.target)
            const type = getValue(dateObj.additionalType)
            if (type === 'Birth' || type === 'Death') dateEvents.push(dateObj)
        }
        if (dateEvents.length) {
            this.innerHTML = dateEvents.reduce((a, b) => {
                const birth = getValue(b.birthDate)
                const death = getValue(b.deathDate)
                return a + `<span gl-birthdate="${birth ?? ''}" gl-deathdate="${death ?? ''}">${getLabel(b)}<br>(${birth ?? '?'}—${death ?? '?'})</span>`
            }, '')
        } else {
            this.innerHTML = 'No dates'
        }
    }
}
customElements.define('deer-person-dates', DeerPersonDates)
export default DeerPersonDates
