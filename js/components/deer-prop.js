import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerPropTemplate extends HTMLElement {
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
        let obj = JSON.parse(this.getAttribute('data-obj') || '{}')
        if (Object.keys(obj).length === 0) {
            const id = this.getAttribute(config.ID)
            if (id) {
                obj = await expand(id)
            }
        }
        const options = JSON.parse(this.getAttribute('data-options') || '{}')
        const key = options.key || "@id"
        const prop = obj[key] || "[ undefined ]"
        const label = options.label || getLabel(obj, prop)
        try {
            this.innerHTML = `<span class="${prop}">${label}: ${getValue(prop) || "[ undefined ]"}</span>`
        } catch (err) {
            this.innerHTML = `<span>Error loading data</span>`
        }
    }
}

customElements.define('deer-prop', DeerPropTemplate)
export default DeerPropTemplate
