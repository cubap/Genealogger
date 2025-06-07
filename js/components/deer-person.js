import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerPersonTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading...</span>`
    }

    async attributeChangedCallback(name, oldValue, newValue) {
        if (name === config.ID && oldValue !== newValue) {
            await this.render()
        }
    }

    async render() {
        let obj = JSON.parse(this.getAttribute('data-obj') ?? '{}')
        if (!Object.keys(obj).length) {
            const id = this.getAttribute(config.ID)
            if (id) {
                obj = await expand(id)
            }
        }

        const { key: birthKey = "birthDate", label: birthLabel = "Birth Date" } = {}
        const { key: deathKey = "deathDate", label: deathLabel = "Death Date" } = {}
        const dob = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "${birthKey}", "label": "${birthLabel}"}'></deer-prop-template>`
        const dod = `<deer-prop-template data-obj='${JSON.stringify(obj)}' data-options='{"key": "${deathKey}", "label": "${deathLabel}"}'></deer-prop-template>`

        const famName = obj.familyName ? getValue(obj.familyName) : "[ unknown ]"
        const givenName = obj.givenName ? getValue(obj.givenName) : ""
        let tmpl = `<h2>${getLabel(obj)}</h2>`
        tmpl += (obj.familyName || obj.givenName) ? `<div>Name: ${famName}, ${givenName}</div>` : ''
        tmpl += dob + dod
        tmpl += `<a href="#${obj["@id"]}">${getLabel(obj)}</a>`
        this.innerHTML = tmpl
    }
}

customElements.define('deer-person', DeerPersonTemplate)
export default DeerPersonTemplate
