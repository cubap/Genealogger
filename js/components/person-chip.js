import { expand, getEventDates } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class PersonChip extends HTMLElement {
    static get observedAttributes() {
        return ['deer-id']
    }

    attributeChangedCallback(name, oldValue, newValue) {
        if (name === 'deer-id' && oldValue !== newValue) this.render()
    }
    connectedCallback() { this.render() }

    async render() {
        const id = this.getAttribute('deer-id')
        if (!id) {
            this.innerHTML = `<span class="chip">[no person]</span>`
            return
        }
        const obj = await expand(id)
        // Fetch all events for this person
        const events = await fetch('https://tinydev.rerum.io/query', {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                $or: [
                    { 'body.hasAgent': id },
                    { 'body.hasAgent.value': id }
                ],
                'body.additionalType': { $in: ['Birth', 'Death'] },
                '__rerum.history.next': { '$exists': true, '$size': 0 }
            })
        }).then(res => res.json()).catch(() => [])
        const { birthDate, deathDate } = getEventDates(obj, events)
        const label = getLabel(obj) || obj.name || 'Unknown'
        const gender = obj.gender
        const marital = obj.maritalStatus

        let summary = ''
        if (birthDate) summary += `b. ${birthDate}`
        if (deathDate) summary += (summary ? ' – ' : '') + `d. ${deathDate}`

        let age = ''
        if (birthDate && !deathDate) {
            const birthYear = parseInt(birthDate)
            if (!isNaN(birthYear)) {
                const now = new Date()
                age = `age: ${now.getFullYear() - birthYear}`
            }
        }

        let genderIcon = ''
        if (gender) {
            switch (gender.toLowerCase()[0]) {
                case 'm': genderIcon = '♂️'; break
                case 'f': genderIcon = '♀️'; break
                default: genderIcon = '⚧️'
            }
        }

        let maritalIcon = ''
        if (marital) {
            if (marital.toLowerCase().includes('married')) maritalIcon = '💍'
            else if (marital.toLowerCase().includes('single')) maritalIcon = '🧑'
            else if (marital.toLowerCase().includes('widow')) maritalIcon = '🖤'
        }

        this.innerHTML = `
            <style>
                .chip {
                    display: inline-flex;
                    align-items: center;
                    background: #f0f0f0;
                    border-radius: 16px;
                    padding: 0.5em 1em;
                    margin: 0.25em;
                    font-size: 1em;
                    box-shadow: 1px 1px 3px #ccc;
                    cursor: pointer;
                    transition: background 0.2s
                }
                .chip:hover { background: #e0e0e0 }
                .name { font-weight: bold; margin-right: 0.5em }
                .summary { color: #666; font-size: 0.9em; margin-right: 0.5em }
                .icons { font-size: 1.1em }
            </style>
            <div class="chip" title="${label}">
                <a href="#${id}" style="text-decoration:none; color:inherit;">
                    <span class="name">${label}</span>
                    <span class="summary">${summary}${age ? ' • ' + age : ''}</span>
                    <span class="icons">${genderIcon} ${maritalIcon}</span>
                </a>
            </div>
        `
    }
}
customElements.define('person-chip', PersonChip)
export default PersonChip
