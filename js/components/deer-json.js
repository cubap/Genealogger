import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue, getArrayFromObj, cleanArray } from '../utils/data-utils.js'
import { stringifyArray, getLabel } from '../utils/string-utils.js'

class DeerJsonTemplate extends HTMLElement {
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
        const indent = options.indent || 4
        const replacer = (k, v) => (config.SUPPRESS.includes(k) ? null : v)
        try {
            this.innerHTML = `<pre>${JSON.stringify(obj, replacer, indent)}</pre>`
        } catch (err) {
            this.innerHTML = `<span>Error rendering JSON</span>`
        }
    }
}

customElements.define('deer-json', DeerJsonTemplate)
export default DeerJsonTemplate
