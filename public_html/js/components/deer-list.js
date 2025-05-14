import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue, getArrayFromObj } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerListTemplate extends HTMLElement {
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

        const { list: listKey = '', link = '' } = JSON.parse(this.getAttribute('data-options') ?? '{}')
        const itemList = obj.itemListElement ?? []

        if (!itemList.length) {
            this.innerHTML = `<span>No items to display</span>`
            return
        }

        let tmpl = `<h2>${getLabel(obj)}</h2><ul>`
        itemList.forEach((val, index) => {
            const name = getLabel(val, val.type ?? val['@type'] ?? index)
            tmpl += val["@id"] && this.link
                ? `<li ${config.ID}="${val["@id"]}"><a href="${this.link}${val["@id"]}">${name}</a></li>`
                : `<li ${config.ID}="${val["@id"]}">${name}</li>`
        })
        tmpl += `</ul>`

        this.innerHTML = tmpl
    }
}

customElements.define('deer-list', DeerListTemplate)
export default DeerListTemplate
