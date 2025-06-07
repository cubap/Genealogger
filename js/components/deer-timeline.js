import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerTimelineTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<span>Loading timeline...</span>`
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

        let tmpl = `<ul>`
        for (const item of obj.itemListElement || []) {
            tmpl += `<li><deer-label deer-template="personDates" deer-id="${item['@id']}"></deer-label></li>`
        }
        tmpl += `</ul>`

        this.innerHTML = tmpl
    }
}

customElements.define('deer-timeline', DeerTimelineTemplate)
export default DeerTimelineTemplate
