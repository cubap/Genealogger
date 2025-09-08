import { expand } from '../utils/data-utils.js'
import { default as config } from '../deer-config.js'
import { getValue } from '../utils/data-utils.js'
import { getLabel } from '../utils/string-utils.js'

class DeerEntityTemplate extends HTMLElement {
    static get observedAttributes() {
        return [config.ID]
    }

    async connectedCallback() {
        this.innerHTML = `<div>Loading...</div>`
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
        let tmpl = `<h2>${getLabel(obj)}</h2>`
        let list = ''
        for (let key in obj) {
            if (config.SUPPRESS.includes(key)) continue
            let label = key
            let value = getValue(obj[key], key)
            try {
                if ((value.image || value.trim?.()).length > 0) {
                    list += (label === "depiction")
                        ? `<img title="${label}" src="${value.image || value}" ${config.SOURCE}="${getValue(obj[key].source, 'citationSource')}">`
                        : `<dt deer-source="${getValue(obj[key].source, 'citationSource')}">${label}</dt><dd>${value.image || value}</dd>`
                }
            } catch {
                list += `<dt>${label}</dt>`
                if (Array.isArray(value)) {
                    value.forEach((v, index) => {
                        let name = getLabel(v, (v.type || v['@type'] || label + '' + index))
                        list += (v["@id"])
                            ? `<dd><a href="#${v["@id"]}">${name}</a></dd>`
                            : `<dd ${config.SOURCE}="${getValue(v.source, 'citationSource')}">${getValue(v)}</dd>`
                    })
                } else {
                    if (typeof value === "string") {
                        value = {
                            value: value,
                            source: {
                                citationSource: obj['@id'] || obj.id || "",
                                citationNote: "Primitive object from DEER",
                                comment: "Learn about the assembler for this object at https://github.com/CenterForDigitalHumanities/deer"
                            }
                        }
                    }
                    let v = getValue(value)
                    if (typeof v === "object") v = getLabel(v)
                    if (v === "[ unlabeled ]") v = v['@id'] || v.id || "[ complex value unknown ]"
                    list += (value['@id'])
                        ? `<dd ${config.SOURCE}="${getValue(value.source, 'citationSource')}"><a href="${options.link || ''}#${value['@id']}">${v}</a></dd>`
                        : `<dd ${config.SOURCE}="${getValue(value, 'citationSource')}">${v}</dd>`
                }
            }
        }
        tmpl += (list.includes("</dd>")) ? `<dl>${list}</dl>` : ''
        this.innerHTML = tmpl
    }
}

customElements.define('deer-entity', DeerEntityTemplate)
export default DeerEntityTemplate
